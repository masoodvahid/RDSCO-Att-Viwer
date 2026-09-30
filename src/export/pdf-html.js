'use strict';
/**
 * Printable HTML for the PDF report: every employee starts on a new A4 page.
 * Fonts are embedded as base64 so the file renders the same everywhere.
 */
const fs = require('fs');
const path = require('path');
const { fmtDuration } = require('../core/time');

const FONT_DIR = path.join(__dirname, '..', '..', 'assets', 'fonts');

function fontFace(file, weight) {
  const b64 = fs.readFileSync(path.join(FONT_DIR, file)).toString('base64');
  return `@font-face{font-family:'VazirFD';src:url(data:font/woff2;base64,${b64}) format('woff2');font-weight:${weight};font-style:normal;}`;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const d = (min) => (min ? fmtDuration(min) : '');
const nextDayTag = (n) => (n === 1 ? '<span class="nd">فردا</span>' : n > 1 ? `<span class="nd">${n} روز بعد</span>` : '');

const CSS = `
@page { size: A4 portrait; margin: 9mm 8mm 9mm 8mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: 'VazirFD', Tahoma, sans-serif; direction: rtl; color: #1f2937; font-size: 8.4pt;
       -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { break-after: page; }
.page:last-child { break-after: auto; }
.head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 1.2pt solid #1f2937; padding-bottom: 2.2mm; margin-bottom: 3mm; }
.head h1 { font-size: 12.5pt; margin: 0 0 1mm; font-weight: 700; }
.head .who { font-size: 10pt; font-weight: 500; }
.head .who b { font-weight: 700; }
.head .meta { text-align: left; font-size: 8.2pt; color: #4b5563; line-height: 1.6; }
.cards { display: grid; grid-template-columns: repeat(7, 1fr); gap: 1.6mm; margin-bottom: 3mm; }
.card { border: 0.6pt solid #d1d5db; border-radius: 1.4mm; padding: 1.3mm 1.6mm; }
.card .k { font-size: 7.2pt; color: #6b7280; }
.card .v { font-size: 10.5pt; font-weight: 700; margin-top: .3mm; }
.card.accent { border-color: #0f766e; }
.card.accent .v { color: #0f766e; }
table { width: 100%; border-collapse: collapse; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
th { background: #f1f5f9; font-weight: 600; font-size: 7.6pt; color: #374151; padding: 1.3mm .8mm; border-bottom: .8pt solid #cbd5e1; }
td { padding: .95mm .8mm; border-bottom: .45pt solid #e5e7eb; text-align: center; line-height: 1.3; white-space: nowrap; }
td.date { font-weight: 500; }
td.punches { font-size: 7.2pt; color: #6b7280; white-space: normal; }
tr.off td { color: #b6bcc5; }
tr.fri td { background: #f8fafc; }
tr.cont td.date, tr.cont td.wd { color: transparent; }
tr.warn td.status { color: #b45309; font-weight: 600; }
td.worked { font-weight: 600; }
td.ot { color: #0f766e; }
td.late, td.early { color: #b91c1c; }
.nd { font-size: 6.6pt; color: #6b7280; margin-right: .5mm; }
.foot { display: flex; justify-content: space-between; margin-top: 3mm; font-size: 7.4pt; color: #6b7280; gap: 6mm; }
.sign { min-width: 55mm; border-top: .6pt solid #9ca3af; padding-top: 1mm; text-align: center; margin-top: 8mm; }
.empty { padding: 12mm; text-align: center; color: #6b7280; }
`;

function employeePage(rep, e) {
  const t = e.totals;
  const tpl = rep.hasTemplates;
  const cards = [
    ['روزهای حضور', String(t.presentDays)],
    ['کارکرد کل', fmtDuration(t.workedMin), true],
    ['موظفی', tpl ? fmtDuration(t.requiredMin) : '—'],
    ['اضافه‌کار', tpl ? fmtDuration(t.overtimeMin) : '—'],
    ['تأخیر', tpl ? fmtDuration(t.lateMin) : '—'],
    ['تعجیل', tpl ? fmtDuration(t.earlyMin) : '—'],
    ['تردد ناقص', String(t.incomplete)],
  ].map(([k, v, a]) => `<div class="card${a ? ' accent' : ''}"><div class="k">${k}</div><div class="v">${esc(v)}</div></div>`).join('');

  const rows = [];
  for (const day of e.days) {
    if (!day.rows.length) {
      rows.push(`<tr class="off${day.isFriday ? ' fri' : ''}"><td class="date">${day.date}</td><td class="wd">${day.weekday}</td><td colspan="9">—</td></tr>`);
      continue;
    }
    day.rows.forEach((r, i) => {
      const cls = [day.isFriday ? 'fri' : '', i > 0 ? 'cont' : '', r.status !== 'ok' ? 'warn' : ''].filter(Boolean).join(' ');
      const out = r.out ? `${r.out}${nextDayTag(r.outDayOffset)}` : '';
      rows.push(`<tr class="${cls}">
        <td class="date">${day.date}</td><td class="wd">${day.weekday}</td>
        <td>${r.in || '<span style="color:#b45309">؟</span>'}</td>
        <td>${out || '<span style="color:#b45309">؟</span>'}</td>
        <td class="worked">${r.workedMin ? fmtDuration(r.workedMin) : '—'}</td>
        <td>${esc(r.shift)}</td>
        <td class="late">${d(r.lateMin)}</td>
        <td class="early">${d(r.earlyMin)}</td>
        <td class="ot">${d(r.overtimeMin)}</td>
        <td class="status">${r.status === 'ok' ? '' : esc(r.statusLabel)}</td>
        <td class="punches">${r.punches.join('  ')}${r.corrected ? ' *' : ''}</td>
      </tr>`);
    });
  }

  return `<section class="page">
    <div class="head">
      <div>
        <h1>${esc(rep.orgName || 'گزارش تردد پرسنل')}</h1>
        <div class="who">${e.name ? `<b>${esc(e.name)}</b> — ` : ''}کد پرسنلی: <b>${esc(e.uid)}</b></div>
      </div>
      <div class="meta">بازه گزارش: ${rep.from} تا ${rep.to}<br>تاریخ تهیه: ${rep.generatedAt}</div>
    </div>
    <div class="cards">${cards}</div>
    <table>
      <thead><tr>
        <th>تاریخ</th><th>روز</th><th>ورود</th><th>خروج</th><th>کارکرد</th><th>شیفت</th>
        <th>تأخیر</th><th>تعجیل</th><th>اضافه‌کار</th><th>وضعیت</th><th>ترددها</th>
      </tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>
    <div class="foot">
      <div>هر شیفت به تاریخ شروع آن تعلق دارد؛ «فردا» کنار ساعت خروج یعنی خروج در روز بعد ثبت شده است.<br>
      کارکرد = اولین ورود تا آخرین خروج شیفت. ستاره (*) یعنی ساعت دستگاه برای این تردد اصلاح شده است.</div>
      <div class="sign">امضای مسئول</div>
    </div>
  </section>`;
}

function buildPdfHtml(report) {
  const fonts = fontFace('Vazirmatn-FD-Regular.woff2', 400) + fontFace('Vazirmatn-FD-Medium.woff2', 500)
    + fontFace('Vazirmatn-FD-Bold.woff2', 700) + fontFace('Vazirmatn-FD-Bold.woff2', 600);
  const body = report.employees.length
    ? report.employees.map((e) => employeePage(report, e)).join('')
    : '<div class="empty">در بازه انتخاب‌شده ترددی یافت نشد.</div>';
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
<title>گزارش تردد</title><style>${fonts}${CSS}</style></head><body>${body}</body></html>`;
}

module.exports = { buildPdfHtml };
