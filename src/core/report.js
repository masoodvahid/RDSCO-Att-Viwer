'use strict';
/**
 * Builds the report model used by the on-screen preview, Excel and PDF exports.
 *
 * A shift (work block) belongs to the date it started on. The date filter is
 * applied to shift dates, so a night shift starting on the last day of the
 * range is fully included, and one that started the day before is not.
 */
const T = require('./time');
const { STATUS_LABELS } = require('./engine');

function blockRow(b) {
  const days = b.end != null ? Math.round((T.dayStart(b.end) - T.dayStart(b.start)) / T.DAY) : 0;
  return {
    date: T.jDate(b.start),
    weekday: T.weekdayFa(b.start),
    in: b.missing === 'in' ? '' : T.hhmm(b.start),
    out: b.complete ? T.hhmm(b.end) : (b.missing === 'out' ? '' : T.hhmm(b.start)),
    outDayOffset: days, // 1 → exit was on the next day
    workedMin: b.workedMin,
    shift: b.shift ? b.shift.name : '',
    requiredMin: b.shift ? b.shift.requiredMin : null,
    lateMin: b.shift ? b.shift.lateMin : null,
    earlyMin: b.shift ? b.shift.earlyMin : null,
    overtimeMin: b.shift ? b.shift.overtimeMin : null,
    status: b.status,
    statusLabel: STATUS_LABELS[b.status] || b.status,
    punches: b.punches.map((p) => T.hhmm(p.ts)),
    corrected: b.punches.some((p) => p.corrected),
  };
}

function todayJalali() {
  const n = new Date(); // local time of the operator's computer
  return T.jDate(T.toTs(n.getFullYear(), n.getMonth() + 1, n.getDate()));
}

function emptyTotals() {
  return {
    presentDays: 0, shifts: 0, workedMin: 0, requiredMin: 0,
    lateMin: 0, earlyMin: 0, overtimeMin: 0,
    incomplete: 0, review: 0,
  };
}

/**
 * @param {object} result    output of engine.processAll
 * @param {object} settings  app settings (employees names)
 * @param {object} filter    { uids: string[] | null, from: 'YYYY/MM/DD', to: 'YYYY/MM/DD' } (Jalali)
 */
function buildReport(result, settings, filter = {}) {
  if (!result) return { error: 'ابتدا فایل تردد را بارگذاری کنید.' };
  const names = settings.employees || {};

  let fromTs = filter.from ? T.parseJalali(filter.from) : null;
  let toTs = filter.to ? T.parseJalali(filter.to) : null;
  if (filter.from && fromTs == null) return { error: 'تاریخ شروع معتبر نیست.' };
  if (filter.to && toTs == null) return { error: 'تاریخ پایان معتبر نیست.' };
  if (fromTs == null) fromTs = T.dayStart(result.stats.from);
  if (toTs == null) toTs = T.dayStart(result.stats.to);
  if (toTs < fromTs) return { error: 'تاریخ پایان باید بعد از تاریخ شروع باشد.' };
  const endExcl = toTs + T.DAY;

  const wanted = filter.uids && filter.uids.length ? new Set(filter.uids.map(String)) : null;
  const uids = wanted ? [...wanted] : result.users;

  const employees = [];
  for (const uid of uids) {
    const blocks = (result.blocks.get(uid) || []).filter((b) => b.start >= fromTs && b.start < endExcl);
    const punches = (result.punches.get(uid) || []).filter((p) => p.ts >= fromTs && p.ts < endExcl);
    if (!wanted && !blocks.length && !punches.length) continue;

    const totals = emptyTotals();
    const byDate = new Map();
    for (const b of blocks) {
      const row = blockRow(b);
      if (!byDate.has(row.date)) byDate.set(row.date, []);
      byDate.get(row.date).push(row);
      if (b.complete) {
        totals.shifts++;
        totals.workedMin += b.workedMin;
        if (b.shift) {
          totals.requiredMin += b.shift.requiredMin;
          totals.lateMin += b.shift.lateMin;
          totals.earlyMin += b.shift.earlyMin;
          totals.overtimeMin += b.shift.overtimeMin;
        }
      } else totals.incomplete++;
      if (b.status === 'long' || b.status === 'noShift') totals.review++;
    }

    // One entry per calendar day in the range (days without shifts included)
    const days = [];
    for (let d = fromTs; d < endExcl; d += T.DAY) {
      const date = T.jDate(d);
      const rows = byDate.get(date) || [];
      if (rows.some((r) => r.workedMin > 0)) totals.presentDays++;
      days.push({ date, weekday: T.weekdayFa(d), isFriday: T.gParts(d).wd === 5, rows });
    }

    employees.push({
      uid,
      name: names[uid] || '',
      totals,
      days,
      punches: punches.map((p) => ({
        date: T.jDate(p.ts),
        weekday: T.weekdayFa(p.ts),
        time: T.hhmmss(p.ts),
        deviceDate: T.jDate(p.deviceTs),
        deviceTime: T.hhmmss(p.deviceTs),
        corrected: p.corrected,
        duplicate: p.duplicate,
        verify: p.verifyLabel,
      })),
    });
  }

  employees.sort((a, b) => (a.uid.length - b.uid.length) || a.uid.localeCompare(b.uid));

  return {
    orgName: settings.orgName || '',
    from: T.jDate(fromTs),
    to: T.jDate(toTs),
    dayCount: Math.round((endExcl - fromTs) / T.DAY),
    hasTemplates: (settings.templates || []).length > 0,
    generatedAt: todayJalali(),
    employees,
  };
}

module.exports = { buildReport };
