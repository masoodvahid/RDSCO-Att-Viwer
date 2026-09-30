'use strict';
/**
 * Excel export (RTL). Durations are stored as real Excel time values with the
 * [h]:mm format, so the operator can sum/filter them in Excel directly.
 */
const ExcelJS = require('exceljs');

const FONT = 'Tahoma';
const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF3F6' } };
const WARN_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4E5' } };
const BORDER = { style: 'thin', color: { argb: 'FFD9DEE3' } };

const dur = (min) => (min == null ? null : min / 1440);
const durNz = (min) => (min ? min / 1440 : null); // blank instead of 0:00 in detail rows
const code = (uid) => (/^\d{1,15}$/.test(uid) ? Number(uid) : uid);

function addSheet(wb, name, columns) {
  const ws = wb.addWorksheet(name, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width || 12 }));
  const head = ws.getRow(1);
  head.height = 22;
  head.eachCell((cell) => {
    cell.font = { name: FONT, bold: true, size: 10 };
    cell.fill = HEAD_FILL;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: BORDER };
  });
  columns.forEach((c, i) => {
    if (c.fmt) ws.getColumn(i + 1).numFmt = c.fmt;
  });
  return ws;
}

function styleBody(ws, fromRow = 2) {
  for (let r = fromRow; r <= ws.rowCount; r++) {
    ws.getRow(r).eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { name: FONT, size: 10, ...(cell.font && cell.font.bold ? { bold: true } : {}) };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = { bottom: BORDER };
    });
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
}

async function writeExcel(report, filePath) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Attendance Report';
  wb.created = new Date();

  // ---------------------------------------------------------- summary
  const sum = addSheet(wb, 'خلاصه', [
    { header: 'کد پرسنلی', key: 'uid', width: 13 },
    { header: 'نام', key: 'name', width: 24 },
    { header: 'روزهای حضور', key: 'presentDays', width: 11 },
    { header: 'تعداد شیفت', key: 'shifts', width: 10 },
    { header: 'کارکرد', key: 'worked', width: 11, fmt: '[h]:mm' },
    { header: 'موظفی', key: 'required', width: 11, fmt: '[h]:mm' },
    { header: 'تأخیر', key: 'late', width: 10, fmt: '[h]:mm' },
    { header: 'تعجیل', key: 'early', width: 10, fmt: '[h]:mm' },
    { header: 'اضافه‌کار', key: 'overtime', width: 11, fmt: '[h]:mm' },
    { header: 'تردد ناقص', key: 'incomplete', width: 10 },
    { header: 'نیازمند بررسی', key: 'review', width: 12 },
  ]);
  for (const e of report.employees) {
    const t = e.totals;
    sum.addRow({
      uid: code(e.uid), name: e.name, presentDays: t.presentDays, shifts: t.shifts,
      worked: dur(t.workedMin), required: dur(t.requiredMin), late: dur(t.lateMin),
      early: dur(t.earlyMin), overtime: dur(t.overtimeMin), incomplete: t.incomplete, review: t.review,
    });
  }
  styleBody(sum);
  sum.getColumn('name').alignment = { horizontal: 'right', vertical: 'middle' };
  // Period caption under the table
  const cap = sum.addRow([]);
  cap.getCell(1).value = `بازه گزارش: ${report.from} تا ${report.to}${report.orgName ? `  —  ${report.orgName}` : ''}`;
  cap.getCell(1).font = { name: FONT, size: 9, color: { argb: 'FF6B7280' } };

  // ---------------------------------------------------------- details
  const det = addSheet(wb, 'جزئیات شیفت‌ها', [
    { header: 'کد پرسنلی', key: 'uid', width: 12 },
    { header: 'نام', key: 'name', width: 22 },
    { header: 'تاریخ شیفت', key: 'date', width: 12 },
    { header: 'روز', key: 'weekday', width: 10 },
    { header: 'ورود', key: 'in', width: 8 },
    { header: 'خروج', key: 'out', width: 10 },
    { header: 'کارکرد', key: 'worked', width: 9, fmt: '[h]:mm' },
    { header: 'شیفت', key: 'shift', width: 16 },
    { header: 'موظفی', key: 'required', width: 9, fmt: '[h]:mm' },
    { header: 'تأخیر', key: 'late', width: 8, fmt: '[h]:mm' },
    { header: 'تعجیل', key: 'early', width: 8, fmt: '[h]:mm' },
    { header: 'اضافه‌کار', key: 'overtime', width: 9, fmt: '[h]:mm' },
    { header: 'وضعیت', key: 'status', width: 20 },
    { header: 'ترددها', key: 'punches', width: 34 },
  ]);
  for (const e of report.employees) {
    for (const d of e.days) {
      for (const r of d.rows) {
        const row = det.addRow({
          uid: code(e.uid), name: e.name, date: r.date, weekday: r.weekday, in: r.in,
          out: r.out ? r.out + (r.outDayOffset === 1 ? ' (فردا)' : r.outDayOffset > 1 ? ` (${r.outDayOffset} روز بعد)` : '') : '',
          worked: r.workedMin ? dur(r.workedMin) : null,
          shift: r.shift, required: durNz(r.requiredMin), late: durNz(r.lateMin), early: durNz(r.earlyMin),
          overtime: durNz(r.overtimeMin), status: r.statusLabel + (r.corrected ? ' *' : ''),
          punches: r.punches.join('  '),
        });
        if (r.status !== 'ok') row.eachCell({ includeEmpty: true }, (c) => { c.fill = WARN_FILL; });
      }
    }
  }
  styleBody(det);

  // ---------------------------------------------------------- raw punches
  const raw = addSheet(wb, 'ترددهای خام', [
    { header: 'کد پرسنلی', key: 'uid', width: 12 },
    { header: 'نام', key: 'name', width: 22 },
    { header: 'تاریخ', key: 'date', width: 12 },
    { header: 'روز', key: 'weekday', width: 10 },
    { header: 'ساعت', key: 'time', width: 10 },
    { header: 'ساعت ثبت‌شده در دستگاه', key: 'device', width: 22 },
    { header: 'روش ثبت', key: 'verify', width: 11 },
    { header: 'توضیح', key: 'note', width: 22 },
  ]);
  for (const e of report.employees) {
    for (const p of e.punches) {
      raw.addRow({
        uid: code(e.uid), name: e.name, date: p.date, weekday: p.weekday, time: p.time,
        device: `${p.deviceDate} ${p.deviceTime}`, verify: p.verify,
        note: [p.corrected ? 'ساعت اصلاح شد' : '', p.duplicate ? 'تکراری' : ''].filter(Boolean).join('، '),
      });
    }
  }
  styleBody(raw);

  await wb.xlsx.writeFile(filePath);
}

/** Reads a two-column (code, name) list from .xlsx or .csv for the employees table. */
async function readEmployeeList(filePath) {
  const out = {};
  const lower = filePath.toLowerCase();
  let rows = [];
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    const text = require('fs').readFileSync(filePath, 'utf8').replace(/^﻿/, '');
    rows = text.split(/\r?\n/).map((l) => l.split(/[,;\t]/));
  } else {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const ws = wb.worksheets[0];
    ws.eachRow((row) => {
      const vals = row.values.slice(1).map((v) => (v && typeof v === 'object' && 'text' in v ? v.text : v));
      rows.push(vals);
    });
  }
  const { toLatinDigits } = require('../core/time');
  for (const r of rows) {
    if (!r || r.length < 2) continue;
    const code = toLatinDigits(String(r[0] ?? '')).trim().replace(/^0+(?=\d)/, '');
    const name = String(r[1] ?? '').trim();
    if (/^\d+$/.test(code) && name) out[code] = name;
  }
  return out;
}

module.exports = { writeExcel, readEmployeeList };
