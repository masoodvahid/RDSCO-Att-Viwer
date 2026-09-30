'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseAttLog } = require('../src/core/parser');
const { processAll } = require('../src/core/engine');
const { buildReport } = require('../src/core/report');
const T = require('../src/core/time');

const line = (uid, d, t) => `        ${uid}\t${d} ${t}\t1\t255\t1\t0`;

function days(startIso, n) {
  const out = [];
  const base = new Date(`${startIso}T00:00:00Z`);
  for (let i = 0; i < n; i++) out.push(new Date(base.getTime() + i * 86400000).toISOString().slice(0, 10));
  return out;
}

test('parser: ZK tab format, Jalali-dated devices, Persian digits, bad lines', () => {
  const txt = [
    line('0012345', '2025-07-01', '18:37:47'),
    '  2001\t1404/04/10 07:45:18\t1\t255\t15\t0', // Jalali date from device
    '  ۲۰۰۲\t۲۰۲۵-۰۷-۰۱ ۱۵:۵۰:۳۶\t1\t255\t1\t0',   // Persian digits
    'garbage line',
    '',
  ].join('\r\n');
  const { punches, errors } = parseAttLog(txt, 'x.dat');
  assert.equal(punches.length, 3);
  assert.equal(errors.length, 1);
  assert.equal(punches[0].uid, '12345');
  assert.equal(T.gDate(punches[1].deviceTs), '2025-07-01');
  assert.equal(punches[1].verifyLabel, 'چهره');
  assert.equal(punches[2].uid, '2002');
});

test('night shifts crossing midnight are paired and dated by their start', () => {
  const rows = [];
  for (const d of days('2025-07-01', 40)) {
    const next = new Date(`${d}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
    rows.push(line('500', d, '18:05:00'));
    rows.push(line('500', next.toISOString().slice(0, 10), '06:35:00'));
  }
  const { punches } = parseAttLog(rows.join('\n'));
  const r = processAll(punches, { templates: [{ name: 'شب', start: '18:00', end: '06:30' }] });
  const blocks = r.blocks.get('500');
  assert.equal(blocks.length, 40);
  assert.ok(blocks.every((b) => b.complete && b.workedMin === 750));
  assert.equal(blocks[0].shiftDate, '2025-07-01');
  assert.equal(blocks[0].shift.lateMin, 5);
  assert.equal(blocks[0].shift.overtimeMin, 0); // 5 min < minOvertime
});

test('a missing exit only affects its own shift', () => {
  const rows = [];
  days('2025-07-01', 30).forEach((d, i) => {
    rows.push(line('600', d, '07:44:00'));
    if (i !== 10) rows.push(line('600', d, '15:48:00')); // forgot to punch out on day 11
  });
  const { punches } = parseAttLog(rows.join('\n'));
  const r = processAll(punches, {});
  const blocks = r.blocks.get('600');
  assert.equal(blocks.length, 30);
  assert.equal(blocks.filter((b) => !b.complete).length, 1);
  assert.equal(blocks[10].status, 'noOut');
  assert.ok(blocks.filter((b) => b.complete).every((b) => b.workedMin === 484));
});

test('24h shift with midnight out/in punches is one shift; duplicates ignored', () => {
  const rows = [];
  for (const d of days('2025-07-01', 30).filter((_, i) => i % 3 === 0)) {
    const next = new Date(`${d}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
    const n = next.toISOString().slice(0, 10);
    rows.push(line('700', d, '06:07:00'), line('700', d, '06:07:40'), line('700', d, '23:47:00'));
    rows.push(line('700', n, '00:03:00'), line('700', n, '06:31:00'));
  }
  const { punches } = parseAttLog(rows.join('\n'));
  const r = processAll(punches, { templates: [{ name: '۲۴', start: '06:00', end: '06:30', nextDay: true }] });
  const blocks = r.blocks.get('700');
  assert.equal(blocks.length, 10);
  assert.ok(blocks.every((b) => b.complete && b.workedMin === 1464));
  assert.equal(r.stats.duplicates, 10);
  assert.equal(blocks[0].shift.name, '۲۴');
});

test('clock correction shifts device time before pairing', () => {
  const rows = [line('800', '2025-07-01', '02:28:00'), line('800', '2025-07-01', '10:33:00')];
  const { punches } = parseAttLog(rows.join('\n'));
  const r = processAll(punches, {
    clockRules: [{ from: '1404/04/10', to: '1404/04/10', offset: 315 }],
    templates: [{ name: 'اداری', start: '07:45', end: '15:45' }],
  });
  const b = r.blocks.get('800')[0];
  assert.equal(T.hhmm(b.start), '07:43');
  assert.equal(T.hhmm(b.end), '15:48');
  assert.equal(b.shift.lateMin, 0);
});

test('report filters by shift start date and totals', () => {
  const rows = [];
  for (const d of days('2025-07-01', 10)) {
    rows.push(line('900', d, '07:45:00'), line('900', d, '16:45:00'));
  }
  const { punches } = parseAttLog(rows.join('\n'));
  const settings = { employees: { 900: 'تست' }, templates: [{ name: 'اداری', start: '07:45', end: '15:45' }] };
  const r = processAll(punches, settings);
  // 1404/04/10 = 2025-07-01 … 1404/04/14 = 2025-07-05
  const rep = buildReport(r, settings, { from: '1404/04/10', to: '1404/04/14' });
  const e = rep.employees[0];
  assert.equal(e.name, 'تست');
  assert.equal(e.days.length, 5);
  assert.equal(e.totals.presentDays, 5);
  assert.equal(e.totals.workedMin, 5 * 540);
  assert.equal(e.totals.overtimeMin, 5 * 60);
  assert.equal(buildReport(r, settings, { from: '1404/04/14', to: '1404/04/10' }).error.length > 0, true);
});

test('per-employee shift assignment restricts template matching', () => {
  const rows = [];
  for (const d of days('2025-07-01', 10)) rows.push(line('950', d, '06:07:00'), line('950', d, '15:43:00'));
  const { punches } = parseAttLog(rows.join('\n'));
  const templates = [
    { name: 'روز ۱۲', start: '06:00', end: '18:30' },
    { name: 'اداری', start: '07:45', end: '15:45' },
  ];
  const auto = processAll(punches, { templates }).blocks.get('950')[0];
  assert.equal(auto.shift.name, 'روز ۱۲');           // closest by start time
  assert.equal(auto.shift.earlyMin, 167);
  const fixed = processAll(punches, { templates, employeeShifts: { 950: ['اداری'] } }).blocks.get('950')[0];
  assert.equal(fixed.shift.name, 'اداری');
  assert.equal(fixed.shift.earlyMin, 2);
  // unknown names are ignored → falls back to all templates
  const stale = processAll(punches, { templates, employeeShifts: { 950: ['حذف‌شده'] } }).blocks.get('950')[0];
  assert.equal(stale.shift.name, 'روز ۱۲');
});
