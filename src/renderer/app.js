'use strict';
/* global api */

// ================================================================= helpers
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('en-US'); // digits are rendered Persian by the font
const clone = (o) => JSON.parse(JSON.stringify(o));
const toLatin = (s) => String(s ?? '')
  .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
  .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

function fmtDur(min) {
  if (min == null) return '';
  const m = Math.round(Math.abs(min));
  return `${min < 0 ? '-' : ''}${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}
const durOrEmpty = (min) => (min ? fmtDur(min) : '');
const nextDayTag = (n) => (n === 1 ? '<span class="nd">فردا</span>' : n > 1 ? `<span class="nd">${n} روز بعد</span>` : '');

/** Normalizes "1405-6-1" / "۱۴۰۵/۰۶/۰۱" → "1405/06/01"; returns '' if not a date. */
function normDate(v) {
  const m = toLatin(v).trim().match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (!m) return '';
  return `${m[1]}/${m[2].padStart(2, '0')}/${m[3].padStart(2, '0')}`;
}
function normDateTime(v) {
  const m = toLatin(v).trim().match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (!m) return '';
  const d = `${m[1]}/${m[2].padStart(2, '0')}/${m[3].padStart(2, '0')}`;
  return m[4] != null ? `${d} ${m[4].padStart(2, '0')}:${m[5]}` : d;
}
function normTime(v) {
  const m = toLatin(v).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m || +m[1] > 23 || +m[2] > 59) return '';
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

async function call(p) {
  const res = await p;
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

let toastTimer = null;
function toast(msg, { error = false, actions = [], timeout = 5000 } = {}) {
  const el = $('#toast');
  el.className = `toast${error ? ' error' : ''}`;
  el.innerHTML = `<span>${esc(msg)}</span>`;
  for (const [label, fn] of actions) {
    const b = document.createElement('button');
    b.className = 'link';
    b.textContent = label;
    b.onclick = () => { fn(); el.hidden = true; };
    el.appendChild(b);
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, error ? Math.max(timeout, 7000) : timeout);
}

async function busy(btn, fn) {
  const html = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>${html}`; }
  try {
    return await fn();
  } catch (e) {
    toast(e.message || String(e), { error: true });
    return undefined;
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = html; }
  }
}

// ================================================================= state
const S = {
  settings: null,
  summary: null,
  report: null,
  selectedUid: null,
  detailView: 'shifts',
  selectedUids: new Set(), // empty = all
  shiftDraft: [],
  clockDraft: [],
  empShiftsDraft: {},
};

function applyResult(d) {
  S.settings = d.settings;
  S.empShiftsDraft = clone(d.settings.employeeShifts || {});
  applySummary(d.summary);
  renderEmployees();
  renderShifts();
  renderClock();
  renderRules();
}

// ================================================================= files
function renderFileInfo() {
  const sm = S.summary;
  const el = $('#fileInfo');
  if (!sm || !sm.files.length) { el.innerHTML = '<span>هنوز فایلی بارگذاری نشده است.</span>'; return; }
  const chips = sm.files.map((f) => `
    <span class="chip" title="${esc(f.path)}">
      <button class="x" data-remove="${esc(f.path)}" title="حذف این فایل">×</button>
      ${esc(f.name)} <span class="stat">(${nf.format(f.count)})</span>
      ${f.errors ? `<span class="badge warn" title="${esc(f.errorSample.map((e) => `خط ${e.line}: ${e.text}`).join('\n'))}">${nf.format(f.errors)} خط نامعتبر</span>` : ''}
    </span>`).join('');
  const st = sm.loaded ? `
    <span class="stat"><b>${nf.format(sm.stats.unique)}</b> تردد</span>·
    <span class="stat"><b>${nf.format(sm.users.length)}</b> نفر</span>·
    <span class="stat">${sm.stats.fromJ} تا ${sm.stats.toJ}</span>
    ${sm.stats.corrected ? `· <span class="stat fix">${nf.format(sm.stats.corrected)} تردد با اصلاح ساعت</span>` : ''}` : '';
  el.innerHTML = chips + st;
}

async function openFiles() {
  await busy($('#btnOpen'), async () => {
    const sm = await call(api.openFiles());
    if (sm) { applySummary(sm); renderEmployees(); toast('فایل بارگذاری شد.'); }
  });
}

async function loadPaths(paths) {
  await busy(null, async () => {
    const sm = await call(api.loadPaths(paths));
    applySummary(sm);
    renderEmployees();
    toast('فایل بارگذاری شد.');
  });
}

// ================================================================= report tab
function applySummary(sm) {
  S.summary = sm;
  renderFileInfo();
  const loaded = sm && sm.loaded;
  $('#emptyState').hidden = !!loaded;
  $('#reportUi').hidden = !loaded;
  if (!loaded) return;

  const valid = new Set(sm.users.map((u) => u.uid));
  S.selectedUids = new Set([...S.selectedUids].filter((u) => valid.has(u)));

  const sel = $('#monthSel');
  const cur = sel.value;
  sel.innerHTML = '<option value="">بازه دلخواه</option>'
    + sm.months.map((m) => `<option value="${m.from}|${m.to}">${m.label}</option>`).join('');
  if (!$('#fromDate').value && sm.months.length) {
    sel.value = `${sm.months[0].from}|${sm.months[0].to}`;
    applyMonth();
  } else {
    sel.value = [...sel.options].some((o) => o.value === cur) ? cur : '';
  }
  renderPicker();
  runReport();
}

function applyMonth() {
  const v = $('#monthSel').value;
  if (!v) return;
  const [from, to] = v.split('|');
  $('#fromDate').value = from;
  $('#toDate').value = to;
}

function syncMonthSelect() {
  const v = `${normDate($('#fromDate').value)}|${normDate($('#toDate').value)}`;
  const sel = $('#monthSel');
  sel.value = [...sel.options].some((o) => o.value === v) ? v : '';
}

function currentFilter() {
  return {
    uids: [...S.selectedUids],
    from: normDate($('#fromDate').value),
    to: normDate($('#toDate').value),
  };
}

let reportSeq = 0;
async function runReport() {
  if (!S.summary || !S.summary.loaded) return;
  const seq = ++reportSeq;
  try {
    const rep = await call(api.getReport(currentFilter()));
    if (seq !== reportSeq) return; // a newer request is on its way
    if (rep.error) { toast(rep.error, { error: true }); return; }
    S.report = rep;
    if (!rep.employees.some((e) => e.uid === S.selectedUid)) S.selectedUid = rep.employees[0] ? rep.employees[0].uid : null;
    renderSummary();
    renderDetail();
  } catch (e) {
    toast(e.message, { error: true });
  }
}

function renderSummary() {
  const rep = S.report;
  const tpl = rep.hasTemplates;
  $('#periodLabel').textContent = `${rep.from} تا ${rep.to} · ${nf.format(rep.dayCount)} روز · ${nf.format(rep.employees.length)} نفر`;
  const tot = { presentDays: 0, shifts: 0, workedMin: 0, requiredMin: 0, lateMin: 0, earlyMin: 0, overtimeMin: 0, incomplete: 0, review: 0 };
  const rows = rep.employees.map((e) => {
    const t = e.totals;
    for (const k of Object.keys(tot)) tot[k] += t[k];
    return `<tr class="clickable${e.uid === S.selectedUid ? ' selected' : ''}" data-uid="${esc(e.uid)}">
      <td class="b">${esc(e.uid)}</td>
      <td class="r">${esc(e.name) || '<span class="muted">—</span>'}</td>
      <td>${t.presentDays}</td>
      <td>${t.shifts}</td>
      <td class="b">${fmtDur(t.workedMin)}</td>
      <td>${tpl ? fmtDur(t.requiredMin) : '—'}</td>
      <td class="${t.lateMin ? 'bad' : ''}">${tpl ? durOrEmpty(t.lateMin) : '—'}</td>
      <td class="${t.earlyMin ? 'bad' : ''}">${tpl ? durOrEmpty(t.earlyMin) : '—'}</td>
      <td class="ot">${tpl ? durOrEmpty(t.overtimeMin) : '—'}</td>
      <td>${t.incomplete ? `<span class="badge warn">${t.incomplete}</span>` : ''}</td>
      <td>${t.review ? `<span class="badge warn">${t.review}</span>` : ''}</td>
    </tr>`;
  }).join('');
  $('#summaryTable').innerHTML = `
    <thead><tr>
      <th>کد پرسنلی</th><th class="r">نام</th><th>روز حضور</th><th>شیفت</th><th>کارکرد</th><th>موظفی</th>
      <th>تأخیر</th><th>تعجیل</th><th>اضافه‌کار</th><th title="ورود یا خروج ثبت نشده">تردد ناقص</th><th title="شیفت طولانی یا نامشخص">نیازمند بررسی</th>
    </tr></thead>
    <tbody>${rows || '<tr><td colspan="11" class="muted" style="padding:24px">در این بازه ترددی ثبت نشده است.</td></tr>'}</tbody>
    ${rep.employees.length > 1 ? `<tfoot><tr class="total">
      <td></td><td class="r">جمع</td><td>${tot.presentDays}</td><td>${tot.shifts}</td><td>${fmtDur(tot.workedMin)}</td>
      <td>${tpl ? fmtDur(tot.requiredMin) : '—'}</td><td>${tpl ? durOrEmpty(tot.lateMin) : '—'}</td><td>${tpl ? durOrEmpty(tot.earlyMin) : '—'}</td>
      <td>${tpl ? durOrEmpty(tot.overtimeMin) : '—'}</td><td>${tot.incomplete || ''}</td><td>${tot.review || ''}</td>
    </tr></tfoot>` : ''}`;
}

function renderDetail() {
  const e = S.report && S.report.employees.find((x) => x.uid === S.selectedUid);
  $('#detailCard').hidden = !e;
  if (!e) return;
  $('#detailTitle').textContent = `${e.name ? `${e.name} — ` : ''}کد پرسنلی ${e.uid}`;
  $$('#detailSeg button').forEach((b) => b.classList.toggle('active', b.dataset.view === S.detailView));

  if (S.detailView === 'raw') {
    const rows = e.punches.map((p) => `<tr>
      <td>${p.date}</td><td>${p.weekday}</td><td class="b">${p.time}</td>
      <td class="${p.corrected ? 'fix' : 'small'}">${p.deviceDate} ${p.deviceTime}</td>
      <td class="small">${esc(p.verify)}</td>
      <td class="small">${[p.corrected ? 'ساعت اصلاح شد' : '', p.duplicate ? 'تکراری (نادیده گرفته شد)' : ''].filter(Boolean).join('، ')}</td>
    </tr>`).join('');
    $('#detailTable').innerHTML = `<thead><tr><th>تاریخ</th><th>روز</th><th>ساعت</th><th>ساعت ثبت‌شده در دستگاه</th><th>روش ثبت</th><th>توضیح</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="muted" style="padding:24px">ترددی ثبت نشده است.</td></tr>'}</tbody>`;
    return;
  }

  const rows = [];
  for (const day of e.days) {
    if (!day.rows.length) {
      rows.push(`<tr class="off${day.isFriday ? ' fri' : ''}"><td>${day.date}</td><td>${day.weekday}</td><td colspan="10">—</td></tr>`);
      continue;
    }
    day.rows.forEach((r, i) => {
      const cls = [day.isFriday ? 'fri' : '', i ? 'cont' : '', r.status !== 'ok' ? 'warn' : ''].filter(Boolean).join(' ');
      rows.push(`<tr class="${cls}">
        <td class="dt b">${day.date}</td><td class="dt">${day.weekday}</td>
        <td>${r.in || '<span class="q" title="ورود ثبت نشده">؟</span>'}</td>
        <td>${r.out ? `${r.out}${nextDayTag(r.outDayOffset)}` : '<span class="q" title="خروج ثبت نشده">؟</span>'}</td>
        <td class="b">${r.workedMin ? fmtDur(r.workedMin) : '—'}</td>
        <td>${esc(r.shift)}</td>
        <td>${durOrEmpty(r.requiredMin)}</td>
        <td class="bad">${durOrEmpty(r.lateMin)}</td>
        <td class="bad">${durOrEmpty(r.earlyMin)}</td>
        <td class="ot">${durOrEmpty(r.overtimeMin)}</td>
        <td class="st">${r.status === 'ok' ? '' : esc(r.statusLabel)}</td>
        <td class="small" title="${r.corrected ? 'ساعت دستگاه برای این ترددها اصلاح شده است' : ''}">${r.punches.join('  ')}${r.corrected ? ' <span class="fix">*</span>' : ''}</td>
      </tr>`);
    });
  }
  $('#detailTable').innerHTML = `<thead><tr>
      <th>تاریخ</th><th>روز</th><th>ورود</th><th>خروج</th><th>کارکرد</th><th>شیفت</th><th>موظفی</th>
      <th>تأخیر</th><th>تعجیل</th><th>اضافه‌کار</th><th>وضعیت</th><th>ترددها</th>
    </tr></thead><tbody>${rows.join('')}</tbody>`;
}

// ---------------------------------------------------------------- employee picker
function renderPicker() {
  const users = S.summary.users;
  const n = S.selectedUids.size;
  let label = `همه پرسنل (${nf.format(users.length)} نفر)`;
  if (n === 1) {
    const u = users.find((x) => S.selectedUids.has(x.uid));
    label = u ? `${u.uid}${u.name ? ` — ${u.name}` : ''}` : label;
  } else if (n > 1) label = `${nf.format(n)} نفر انتخاب شده`;
  $('#empPickerBtn').textContent = label;

  const q = toLatin($('#empSearch').value).trim().toLowerCase();
  $('#empList').innerHTML = users
    .filter((u) => !q || u.uid.includes(q) || (u.name || '').toLowerCase().includes(q))
    .map((u) => `<label><input type="checkbox" value="${esc(u.uid)}" ${S.selectedUids.has(u.uid) ? 'checked' : ''}>
      <span class="code">${esc(u.uid)}</span><span class="nm">${esc(u.name)}</span></label>`).join('')
    || '<div class="muted" style="padding:8px">موردی پیدا نشد.</div>';
}

let pickerDirty = false;
function closePicker() {
  if ($('#empPickerPop').hidden) return;
  $('#empPickerPop').hidden = true;
  if (pickerDirty) { pickerDirty = false; runReport(); }
}

// ---------------------------------------------------------------- date picker
const DP = { input: null, jy: 0, jm: 0 };
async function openDatePicker(input) {
  DP.input = input;
  const v = normDate(input.value);
  if (v) { const [y, m] = v.split('/').map(Number); DP.jy = y; DP.jm = m; } else {
    const t = await call(api.calToday());
    DP.jy = t.jy; DP.jm = t.jm;
  }
  await renderDatePicker();
  const pop = $('#datePop');
  const r = input.getBoundingClientRect();
  pop.style.top = `${r.bottom + 4}px`;
  pop.style.left = `${Math.max(8, r.right - 264)}px`;
  pop.hidden = false;
}

async function renderDatePicker() {
  const [cal, today] = await Promise.all([call(api.calMonth(DP.jy, DP.jm)), call(api.calToday())]);
  const selected = normDate(DP.input.value);
  const cells = [];
  for (let i = 0; i < cal.firstCol; i++) cells.push('<span></span>');
  for (let d = 1; d <= cal.days; d++) {
    const val = `${cal.jy}/${String(cal.jm).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
    const col = (cal.firstCol + d - 1) % 7;
    const cls = [val === selected ? 'sel' : '', today.jy === cal.jy && today.jm === cal.jm && today.jd === d ? 'today' : '', col === 6 ? 'fri' : ''].filter(Boolean).join(' ');
    cells.push(`<button type="button" class="${cls}" data-date="${val}">${d}</button>`);
  }
  $('#datePop').innerHTML = `
    <div class="dp-head">
      <button type="button" data-nav="-1" title="ماه قبل">›</button>
      <span>${cal.label}</span>
      <button type="button" data-nav="1" title="ماه بعد">‹</button>
    </div>
    <div class="dp-grid">${['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'].map((w) => `<span class="wd">${w}</span>`).join('')}${cells.join('')}</div>`;
}

function closeDatePicker() { $('#datePop').hidden = true; DP.input = null; }

// ================================================================= employees tab
function renderEmployees() {
  if (!S.settings) return;
  const users = (S.summary && S.summary.users) || [];
  const map = new Map(users.map((u) => [u.uid, u]));
  for (const uid of Object.keys(S.settings.employees)) if (!map.has(uid)) map.set(uid, { uid, count: null });
  const q = toLatin($('#empTabSearch').value).trim().toLowerCase();
  const names = S.settings.employees;
  const rows = [...map.values()]
    .sort((a, b) => (a.uid.length - b.uid.length) || a.uid.localeCompare(b.uid))
    .filter((u) => !q || u.uid.includes(q) || (names[u.uid] || '').toLowerCase().includes(q))
    .map((u) => `<tr>
      <td class="b">${esc(u.uid)}</td>
      <td class="r"><input type="text" class="emp-name" data-uid="${esc(u.uid)}" value="${esc(names[u.uid] || '')}" placeholder="نام و نام خانوادگی" style="width:100%;min-width:240px"></td>
      <td>${u.count == null ? '<span class="muted">در فایل نیست</span>' : nf.format(u.count)}</td>
      <td>${assignButton(u.uid)}</td>
      <td>${u.first || ''}</td><td>${u.last || ''}</td>
      <td>${u.incomplete ? `<span class="badge warn">${u.incomplete}</span>` : ''}</td>
    </tr>`).join('');
  $('#empTable').innerHTML = `<thead><tr><th>کد پرسنلی</th><th class="r">نام</th><th>تعداد تردد</th><th>شیفت‌های مجاز</th><th>اولین تردد</th><th>آخرین تردد</th><th>تردد ناقص (کل فایل)</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7" class="muted" style="padding:24px">ابتدا فایل تردد را بارگذاری کنید.</td></tr>'}</tbody>`;
}

function assignButton(uid) {
  const names = (S.empShiftsDraft[uid] || []).filter((n) => S.settings.templates.some((t) => t.name === n));
  return `<button type="button" class="assign-btn${names.length ? ' set' : ''}" data-assign="${esc(uid)}" title="${esc(names.join('، '))}">${names.length ? esc(names.join('، ')) : 'همه شیفت‌ها'}</button>`;
}

function openAssign(btn) {
  const uid = btn.dataset.assign;
  const cur = new Set(S.empShiftsDraft[uid] || []);
  const pop = $('#assignPop');
  pop.dataset.uid = uid;
  pop.innerHTML = `<div class="hint">شیفت‌های مجاز برای ${esc(uid)} (هیچ‌کدام = همه)</div><div class="picker-list">${
    S.settings.templates.map((t) => `<label><input type="checkbox" value="${esc(t.name)}" ${cur.has(t.name) ? 'checked' : ''}>
      <span class="code">${esc(t.name)}</span><span class="nm">${esc(t.start)}–${esc(t.end)}</span></label>`).join('')
    || '<div class="muted" style="padding:8px">ابتدا در زبانه «شیفت‌ها» شیفت تعریف کنید.</div>'}</div>`;
  const r = btn.getBoundingClientRect();
  pop.style.top = `${Math.min(r.bottom + 4, window.innerHeight - 320)}px`;
  pop.style.left = `${Math.max(8, r.right - 260)}px`;
  pop.hidden = false;
}

function collectEmployeeNames() {
  const employees = { ...S.settings.employees };
  $$('#empTable .emp-name').forEach((inp) => {
    const v = inp.value.trim();
    if (v) employees[inp.dataset.uid] = v; else delete employees[inp.dataset.uid];
  });
  return employees;
}

// ================================================================= shifts tab
function shiftDuration(t) {
  const s = normTime(t.start), e = normTime(t.end);
  if (!s || !e) return null;
  const toMin = (x) => +x.slice(0, 2) * 60 + +x.slice(3);
  let d = toMin(e) - toMin(s) + (t.nextDay ? 1440 : 0);
  if (d <= 0) d += 1440;
  return d;
}

function renderShifts() {
  if (!S.settings) return;
  S.shiftDraft = clone(S.settings.templates).map((t) => ({ ...t, orig: t.name }));
  drawShifts();
}

/** Keeps per-employee shift assignments in sync when templates are renamed or deleted. */
function remapAssignments(saved) {
  const rename = new Map(saved.filter((t) => t.orig).map((t) => [t.orig, t.name]));
  const out = {};
  for (const [uid, names] of Object.entries(S.settings.employeeShifts || {})) {
    const next = names.map((n) => rename.get(n)).filter(Boolean);
    if (next.length) out[uid] = [...new Set(next)];
  }
  return out;
}

function drawShifts() {
  const rows = S.shiftDraft.map((t, i) => {
    const d = shiftDuration(t);
    return `<tr data-i="${i}">
      <td><input type="text" class="w" data-k="name" value="${esc(t.name)}" placeholder="نام شیفت"></td>
      <td><input type="text" class="t" data-k="start" value="${esc(t.start)}" placeholder="07:30"></td>
      <td><input type="text" class="t" data-k="end" value="${esc(t.end)}" placeholder="15:30"></td>
      <td><input type="checkbox" data-k="nextDay" ${t.nextDay ? 'checked' : ''}></td>
      <td class="b dur">${d ? fmtDur(d) : '<span class="q">؟</span>'}</td>
      <td><button class="icon-btn" data-del="${i}" title="حذف">×</button></td>
    </tr>`;
  }).join('');
  $('#shiftTable').innerHTML = `<thead><tr><th>نام شیفت</th><th>شروع</th><th>پایان</th><th title="پایان شیفت روز بعد است (برای شیفت ۲۴ ساعته)">روز بعد</th><th>مدت (موظفی)</th><th></th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6" class="muted" style="padding:20px">شیفتی تعریف نشده؛ تأخیر و اضافه‌کار محاسبه نمی‌شود.</td></tr>'}</tbody>`;
}

// ================================================================= clock tab
function renderClock() {
  if (!S.settings) return;
  S.clockDraft = clone(S.settings.clockRules);
  drawClock();
}

function drawClock() {
  const rows = S.clockDraft.map((r, i) => `<tr data-i="${i}">
      <td><input type="text" class="dt" data-k="from" value="${esc(r.from)}" placeholder="1405/03/23 15:00"></td>
      <td><input type="text" class="dt" data-k="to" value="${esc(r.to)}" placeholder="1405/06/04 12:00"></td>
      <td><input type="number" class="num" data-k="offset" value="${esc(r.offset)}" step="1"></td>
      <td class="small">${r.offset ? `${r.offset > 0 ? 'دستگاه عقب' : 'دستگاه جلو'} ${fmtDur(Math.abs(r.offset))}` : ''}</td>
      <td><input type="text" class="w" data-k="note" value="${esc(r.note || '')}" placeholder="توضیح (اختیاری)"></td>
      <td><button class="icon-btn" data-del="${i}" title="حذف">×</button></td>
    </tr>`).join('');
  $('#clockTable').innerHTML = `<thead><tr><th>از (ساعت دستگاه)</th><th>تا (ساعت دستگاه)</th><th>اختلاف (دقیقه)</th><th></th><th class="r">توضیح</th><th></th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6" class="muted" style="padding:20px">بازه‌ای تعریف نشده است.</td></tr>'}</tbody>`;
}

// ================================================================= rules tab
const RULE_FIELDS = [
  { key: 'orgName', top: true, type: 'text', label: 'عنوان گزارش (نام سازمان)', hint: 'در سربرگ گزارش PDF و اکسل نمایش داده می‌شود.' },
  { key: 'graceLate', label: 'تأخیر مجاز (دقیقه)', hint: 'تأخیرِ کمتر یا مساوی این مقدار نادیده گرفته می‌شود؛ بیشتر از آن به‌طور کامل حساب می‌شود.' },
  { key: 'graceEarly', label: 'تعجیل مجاز (دقیقه)', hint: 'خروج زودتر از پایان شیفت تا این مقدار نادیده گرفته می‌شود.' },
  { key: 'minOvertime', label: 'حداقل اضافه‌کار (دقیقه)', hint: 'ماندن بعد از پایان شیفت کمتر از این مقدار اضافه‌کار حساب نمی‌شود.' },
  { key: 'countEarlyArrival', type: 'checkbox', label: 'حضور قبل از شروع شیفت هم اضافه‌کار حساب شود', hint: 'در حالت عادی فقط ماندن بعد از پایان شیفت اضافه‌کار است.' },
  { key: 'dupMinutes', label: 'فاصله تردد تکراری (دقیقه)', hint: 'اگر کسی در این فاصله دوباره تردد بزند، یک تردد حساب می‌شود.' },
  { key: 'mergeGapMinutes', label: 'فاصله مجاز خروج و ورود داخل شیفت (دقیقه)', hint: 'خروج و ورودهایی که فاصله‌شان کمتر از این مقدار است (مثل ترددهای نیمه‌شب یا استراحت کوتاه) جزو همان شیفت و کارکرد حساب می‌شوند؛ یعنی کارکرد = اولین ورود تا آخرین خروج.' },
  { key: 'maxShiftHours', label: 'حداکثر فاصله ورود تا خروج (ساعت)', hint: 'ورود و خروجی که فاصله‌شان بیشتر از این باشد به هم وصل نمی‌شوند و شیفت‌های طولانی‌تر برای بررسی علامت می‌خورند.' },
  { key: 'maxStartDeviation', label: 'حداکثر اختلاف ورود با شروع شیفت (دقیقه)', hint: 'اگر ساعت ورود با شروع هیچ‌کدام از الگوهای شیفت این‌قدر نزدیک نباشد، شیفت «نامشخص» علامت می‌خورد.' },
];

function renderRules() {
  if (!S.settings) return;
  $('#rulesForm').innerHTML = RULE_FIELDS.map((f) => {
    const val = f.top ? S.settings[f.key] : S.settings.rules[f.key];
    const input = f.type === 'checkbox'
      ? `<input type="checkbox" data-rule="${f.key}" ${val ? 'checked' : ''} style="justify-self:center">`
      : f.type === 'text'
        ? `<input type="text" class="txt" data-rule="${f.key}" data-top="1" value="${esc(val || '')}" placeholder="مثلاً: شرکت …">`
        : `<input type="number" min="0" step="1" data-rule="${f.key}" value="${esc(val)}">`;
    return `<div class="fr${f.type === 'text' ? ' wide' : ''}"><label>${f.label}</label>${input}<div class="hint">${f.hint}</div></div>`;
  }).join('');
}

// ================================================================= bindings
function bindAll() {
  // tabs
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    $$('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
    $$('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${b.dataset.tab}`));
  });

  // files
  $('#btnOpen').onclick = openFiles;
  $('[data-action=open]').onclick = openFiles;
  $('#fileInfo').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-remove]');
    if (!b) return;
    await busy(null, async () => { applySummary(await call(api.removeFile(b.dataset.remove))); renderEmployees(); });
  });

  // drag & drop anywhere
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('#dropOverlay').hidden = false; });
  window.addEventListener('dragleave', (e) => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; $('#dropOverlay').hidden = true; } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    $('#dropOverlay').hidden = true;
    const paths = [...(e.dataTransfer.files || [])].map((f) => api.pathForFile(f)).filter(Boolean);
    if (paths.length) loadPaths(paths);
  });

  // filters
  $('#monthSel').onchange = () => { applyMonth(); runReport(); };
  for (const id of ['#fromDate', '#toDate']) {
    const inp = $(id);
    inp.addEventListener('focus', () => openDatePicker(inp));
    inp.addEventListener('click', () => { if ($('#datePop').hidden) openDatePicker(inp); });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { inp.value = normDate(inp.value) || inp.value; closeDatePicker(); syncMonthSelect(); runReport(); }
      if (e.key === 'Escape') closeDatePicker();
    });
    inp.addEventListener('change', () => { inp.value = normDate(inp.value) || inp.value; syncMonthSelect(); });
  }
  $('#datePop').addEventListener('mousedown', (e) => e.preventDefault()); // keep input focus
  $('#datePop').addEventListener('click', async (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      DP.jm += Number(nav.dataset.nav);
      if (DP.jm < 1) { DP.jm = 12; DP.jy--; }
      if (DP.jm > 12) { DP.jm = 1; DP.jy++; }
      await renderDatePicker();
      return;
    }
    const day = e.target.closest('[data-date]');
    if (day && DP.input) {
      DP.input.value = day.dataset.date;
      closeDatePicker();
      syncMonthSelect();
      runReport();
    }
  });

  $('#btnShow').onclick = () => busy($('#btnShow'), runReport);
  $('#btnExcel').onclick = () => busy($('#btnExcel'), async () => {
    const p = await call(api.exportExcel(currentFilter()));
    if (p) toast('فایل اکسل ذخیره شد.', { actions: [['باز کردن', () => api.openPath(p)], ['نمایش در پوشه', () => api.showInFolder(p)]], timeout: 9000 });
  });
  $('#btnPdf').onclick = () => busy($('#btnPdf'), async () => {
    const p = await call(api.exportPdf(currentFilter()));
    if (p) toast('گزارش PDF ذخیره شد.', { actions: [['باز کردن', () => api.openPath(p)], ['نمایش در پوشه', () => api.showInFolder(p)]], timeout: 9000 });
  });

  // employee picker
  $('#empPickerBtn').onclick = () => {
    const pop = $('#empPickerPop');
    if (pop.hidden) { pop.hidden = false; $('#empSearch').value = ''; renderPicker(); $('#empSearch').focus(); } else closePicker();
  };
  $('#empSearch').oninput = renderPicker;
  $('#empList').addEventListener('change', (e) => {
    const cb = e.target.closest('input[type=checkbox]');
    if (!cb) return;
    if (cb.checked) S.selectedUids.add(cb.value); else S.selectedUids.delete(cb.value);
    pickerDirty = true;
    renderPicker();
  });
  $('#empAll').onclick = () => { S.selectedUids.clear(); pickerDirty = true; renderPicker(); };

  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('#empPicker')) closePicker();
    if (!e.target.closest('#assignPop') && !e.target.closest('[data-assign]')) $('#assignPop').hidden = true;
    if (!e.target.closest('#datePop') && !e.target.closest('.date-input')) closeDatePicker();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closePicker(); closeDatePicker(); $('#assignPop').hidden = true; } });

  // summary / detail
  $('#summaryTable').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-uid]');
    if (!tr) return;
    S.selectedUid = tr.dataset.uid;
    $$('#summaryTable tr[data-uid]').forEach((r) => r.classList.toggle('selected', r === tr));
    renderDetail();
  });
  $('#detailSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (!b) return;
    S.detailView = b.dataset.view;
    renderDetail();
  });

  // employees tab
  $('#empTabSearch').oninput = () => {
    S.settings.employees = collectEmployeeNames(); // keep typed names while filtering
    renderEmployees();
  };
  $('#empTable').addEventListener('click', (e) => {
    const b = e.target.closest('[data-assign]');
    if (b) { e.stopPropagation(); openAssign(b); }
  });
  $('#assignPop').addEventListener('change', () => {
    const pop = $('#assignPop');
    const uid = pop.dataset.uid;
    const names = $$('input[type=checkbox]', pop).filter((c) => c.checked).map((c) => c.value);
    if (names.length) S.empShiftsDraft[uid] = names; else delete S.empShiftsDraft[uid];
    const btn = $(`#empTable [data-assign="${CSS.escape(uid)}"]`);
    if (btn) btn.outerHTML = assignButton(uid);
  });
  $('#btnSaveEmp').onclick = () => busy($('#btnSaveEmp'), async () => {
    applyResult(await call(api.saveSettings({ employees: collectEmployeeNames(), employeeShifts: S.empShiftsDraft })));
    toast('اطلاعات پرسنل ذخیره شد و گزارش دوباره محاسبه شد.');
  });
  $('#btnImportEmp').onclick = () => busy($('#btnImportEmp'), async () => {
    const d = await call(api.importEmployees());
    if (d) { applyResult(d); toast(`${nf.format(d.imported)} نام وارد شد.`); }
  });

  // shifts tab
  $('#shiftTable').addEventListener('input', (e) => {
    const tr = e.target.closest('tr[data-i]');
    if (!tr) return;
    const t = S.shiftDraft[+tr.dataset.i];
    const k = e.target.dataset.k;
    t[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    const d = shiftDuration(t);
    tr.querySelector('.dur').innerHTML = d ? fmtDur(d) : '<span class="q">؟</span>';
  });
  $('#shiftTable').addEventListener('click', (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    S.shiftDraft.splice(+b.dataset.del, 1);
    drawShifts();
  });
  $('#btnAddShift').onclick = () => { S.shiftDraft.push({ name: '', start: '', end: '', nextDay: false }); drawShifts(); };
  $('#btnSaveShifts').onclick = () => busy($('#btnSaveShifts'), async () => {
    const out = [];
    for (const [i, t] of S.shiftDraft.entries()) {
      const start = normTime(t.start), end = normTime(t.end);
      if (!String(t.name).trim() && !t.start && !t.end) continue; // empty row
      if (!String(t.name).trim()) throw new Error(`ردیف ${i + 1}: نام شیفت را وارد کنید.`);
      if (!start || !end) throw new Error(`ردیف ${i + 1}: ساعت شروع و پایان را به شکل ۰۷:۳۰ وارد کنید.`);
      out.push({ name: String(t.name).trim(), start, end, nextDay: !!t.nextDay, orig: t.orig });
    }
    const employeeShifts = remapAssignments(out);
    applyResult(await call(api.saveSettings({ templates: out.map(({ orig, ...t }) => t), employeeShifts })));
    toast('شیفت‌ها ذخیره شد و گزارش دوباره محاسبه شد.');
  });
  $('#btnResetShifts').onclick = () => busy($('#btnResetShifts'), async () => {
    applyResult(await call(api.resetSettings(['templates'])));
    toast('شیفت‌های پیش‌فرض بازگردانده شد.');
  });

  // clock tab
  $('#clockTable').addEventListener('input', (e) => {
    const tr = e.target.closest('tr[data-i]');
    if (!tr) return;
    const r = S.clockDraft[+tr.dataset.i];
    r[e.target.dataset.k] = e.target.type === 'number' ? Number(e.target.value) : e.target.value;
  });
  $('#clockTable').addEventListener('change', (e) => { if (e.target.dataset.k === 'offset') drawClock(); });
  $('#clockTable').addEventListener('click', (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    S.clockDraft.splice(+b.dataset.del, 1);
    drawClock();
  });
  $('#btnAddClock').onclick = () => { S.clockDraft.push({ from: '', to: '', offset: 0, note: '' }); drawClock(); };
  $('#btnSaveClock').onclick = () => busy($('#btnSaveClock'), async () => {
    const out = [];
    for (const [i, r] of S.clockDraft.entries()) {
      if (!r.from && !r.to && !r.offset) continue;
      const from = normDateTime(r.from), to = normDateTime(r.to);
      if (!from || !to) throw new Error(`ردیف ${i + 1}: تاریخ را به شکل ۱۴۰۵/۰۳/۲۳ یا ۱۴۰۵/۰۳/۲۳ ۱۵:۰۰ وارد کنید.`);
      if (!Number.isFinite(Number(r.offset)) || Number(r.offset) === 0) throw new Error(`ردیف ${i + 1}: مقدار اختلاف (دقیقه) را وارد کنید.`);
      out.push({ from, to, offset: Math.round(Number(r.offset)), note: r.note || '' });
    }
    applyResult(await call(api.saveSettings({ clockRules: out })));
    toast('اصلاح ساعت ذخیره شد و گزارش دوباره محاسبه شد.');
  });

  // rules tab
  $('#btnSaveRules').onclick = () => busy($('#btnSaveRules'), async () => {
    const rules = { ...S.settings.rules };
    let orgName = S.settings.orgName;
    $$('#rulesForm [data-rule]').forEach((inp) => {
      if (inp.dataset.top) orgName = inp.value.trim();
      else if (inp.type === 'checkbox') rules[inp.dataset.rule] = inp.checked;
      else rules[inp.dataset.rule] = Math.max(0, Number(toLatin(inp.value)) || 0);
    });
    if (rules.maxShiftHours < 4) throw new Error('حداکثر فاصله ورود تا خروج باید حداقل ۴ ساعت باشد.');
    applyResult(await call(api.saveSettings({ rules, orgName })));
    toast('تنظیمات ذخیره شد و گزارش دوباره محاسبه شد.');
  });
  $('#btnResetRules').onclick = () => busy($('#btnResetRules'), async () => {
    applyResult(await call(api.resetSettings(['rules'])));
    toast('تنظیمات محاسبه به پیش‌فرض برگشت.');
  });
  $('#btnExportSettings').onclick = () => busy($('#btnExportSettings'), async () => {
    const p = await call(api.exportSettings());
    if (p) toast('فایل پشتیبان ذخیره شد.', { actions: [['نمایش در پوشه', () => api.showInFolder(p)]] });
  });
  $('#btnImportSettings').onclick = () => busy($('#btnImportSettings'), async () => {
    const d = await call(api.importSettings());
    if (d) { applyResult(d); toast('تنظیمات بازیابی شد.'); }
  });
}


// ================================================================= updates
const U = { state: null, hiddenKey: null };
const mb = (bytes) => (bytes ? `${(bytes / 1048576).toFixed(1)}` : '0');
const updateKey = (st) => `${st.status}|${st.version || ''}|${st.phase || ''}`;

function updateStatusText(st) {
  const v = st.version;
  switch (st.status) {
    case 'disabled': return 'در اجرای مستقیم از سورس (حالت توسعه) به‌روزرسانی خودکار غیرفعال است.';
    case 'idle': return 'هنوز بررسی نشده است.';
    case 'checking': return 'در حال بررسی نسخه جدید…';
    case 'none': return `برنامه به‌روز است${v ? ` (آخرین نسخه منتشرشده: ${v})` : ''}.`;
    case 'available': return `نسخه جدید ${v} آماده دریافت است.`;
    case 'downloading': return `در حال دریافت نسخه ${v}… ${st.percent != null ? `${st.percent}٪` : ''}`;
    case 'downloaded': return `نسخه ${v} دریافت شد و با اجرای مجدد برنامه نصب می‌شود.`;
    case 'error': return st.error || 'خطا در به‌روزرسانی';
    default: return '';
  }
}

function renderUpdate(st) {
  if (!st) return;
  U.state = st;
  $('#appVersion').textContent = st.current ? `نسخه ${st.current}` : '';
  $('#curVersion').textContent = st.current || '';
  const modeNote = st.mode === 'portable' ? ' نسخه جدید کنار فایل فعلی ذخیره می‌شود.'
    : st.mode === 'manual' ? ' دریافت از صفحه Releases انجام می‌شود.' : '';
  $('#updateStatus').textContent = updateStatusText(st) + (st.status === 'available' ? modeNote : '');
  $('#btnCheckUpdate').disabled = ['checking', 'downloading', 'disabled'].includes(st.status);

  const bar = $('#updateBar');
  const v = esc(st.version || '');
  let html = '';
  let err = false;
  if (st.status === 'available') {
    html = `<span class="ub-text"><b>نسخه جدید ${v}</b> آماده است (نسخه فعلی ${esc(st.current)}).</span>
      <div class="ub-actions">
        <button class="btn primary small" data-u="download">${st.mode === 'manual' ? 'دانلود از سایت' : 'به‌روزرسانی'}</button>
        <button class="link" data-u="page">تغییرات این نسخه</button>
        <button class="link" data-u="hide">بعداً</button>
      </div>`;
  } else if (st.status === 'downloading') {
    const known = st.percent != null && st.total;
    html = `<span class="ub-text">در حال دریافت نسخه ${v}… ${known ? `${st.percent}٪ (${mb(st.transferred)} از ${mb(st.total)} مگابایت)` : `${mb(st.transferred)} مگابایت`}</span>
      <div class="ub-progress${known ? '' : ' indeterminate'}"><div style="width:${known ? st.percent : 30}%"></div></div>
      <div class="ub-actions"><button class="link" data-u="cancel">لغو</button></div>`;
  } else if (st.status === 'downloaded') {
    const portable = st.mode === 'portable';
    html = `<span class="ub-text"><b>نسخه ${v}</b> دریافت شد.${portable ? ` فایل: ${esc(st.downloadedPath || '')}` : ' برای نصب، برنامه بسته و دوباره باز می‌شود.'}</span>
      <div class="ub-actions">
        <button class="btn primary small" data-u="install">${portable ? 'اجرای نسخه جدید' : 'نصب و اجرای مجدد'}</button>
        <button class="link" data-u="hide">بعداً</button>
      </div>`;
  } else if (st.status === 'error' && (st.phase !== 'check' || st.manual)) {
    err = true;
    html = `<span class="ub-text" title="${esc(st.detail || '')}">به‌روزرسانی انجام نشد: ${esc(st.error)}</span>
      <div class="ub-actions">
        <button class="link" data-u="${st.phase === 'check' ? 'check' : 'download'}">تلاش دوباره</button>
        <button class="link" data-u="page">دانلود از سایت</button>
        <button class="link" data-u="hide">بستن</button>
      </div>`;
  }
  const hidden = !html || U.hiddenKey === updateKey(st);
  bar.classList.toggle('err', err);
  bar.hidden = hidden;
  if (!hidden) bar.innerHTML = html;
}

function bindUpdates() {
  api.onUpdateState((st) => {
    const prev = U.state;
    renderUpdate(st);
    if (prev && prev.status === 'checking' && st.manual && st.status === 'none') {
      toast(`برنامه به‌روز است (نسخه ${st.current}).`);
    }
  });
  $('#updateBar').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-u]');
    if (!b) return;
    const act = b.dataset.u;
    if (act === 'hide') { U.hiddenKey = updateKey(U.state); $('#updateBar').hidden = true; return; }
    try {
      if (act === 'download') renderUpdate(await call(api.updateDownload()));
      else if (act === 'cancel') renderUpdate(await call(api.updateCancel()));
      else if (act === 'install') renderUpdate(await call(api.updateInstall()));
      else if (act === 'check') renderUpdate(await call(api.updateCheck()));
      else if (act === 'page') await call(api.updatePage());
    } catch (err) {
      toast(err.message, { error: true });
    }
  });
  $('#btnCheckUpdate').onclick = () => busy($('#btnCheckUpdate'), async () => {
    U.hiddenKey = null;
    renderUpdate(await call(api.updateCheck()));
  });
  $('#autoUpdateChk').onchange = (e) => busy(null, async () => {
    const d = await call(api.saveSettings({ autoCheckUpdates: e.target.checked }));
    S.settings = d.settings;
    toast(e.target.checked ? 'بررسی خودکار نسخه جدید فعال شد.' : 'بررسی خودکار نسخه جدید غیرفعال شد.');
  });
}

// ================================================================= start
(async function start() {
  bindAll();
  bindUpdates();
  try {
    const d = await call(api.init());
    S.settings = d.settings;
    S.empShiftsDraft = clone(d.settings.employeeShifts || {});
    $('#autoUpdateChk').checked = d.settings.autoCheckUpdates !== false;
    renderUpdate(d.update);
    renderShifts();
    renderClock();
    renderRules();
    applySummary(d.summary);
    renderEmployees();
  } catch (e) {
    toast(e.message, { error: true });
  }
}());
