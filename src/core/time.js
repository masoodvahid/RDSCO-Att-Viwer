'use strict';
/**
 * Time helpers.
 *
 * All instants are stored as "naive seconds": the device's wall-clock time
 * encoded with Date.UTC. This avoids any timezone/DST shifts from the host OS,
 * because the device log has no timezone information anyway.
 */
const jalaali = require('jalaali-js');

const DAY = 86400;

const FA_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];
// Indexed by JS getUTCDay(): 0 = Sunday
const FA_WEEKDAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];

const pad2 = (n) => String(n).padStart(2, '0');

function toTs(y, m, d, hh = 0, mm = 0, ss = 0) {
  return Date.UTC(y, m - 1, d, hh, mm, ss) / 1000;
}

function dayStart(ts) {
  return Math.floor(ts / DAY) * DAY;
}

/** Minutes since midnight (0..1439). */
function minuteOfDay(ts) {
  return Math.floor((ts - dayStart(ts)) / 60);
}

function gParts(ts) {
  const d = new Date(ts * 1000);
  return {
    gy: d.getUTCFullYear(), gm: d.getUTCMonth() + 1, gd: d.getUTCDate(),
    hh: d.getUTCHours(), mi: d.getUTCMinutes(), ss: d.getUTCSeconds(),
    wd: d.getUTCDay(),
  };
}

function jParts(ts) {
  const g = gParts(ts);
  const j = jalaali.toJalaali(g.gy, g.gm, g.gd);
  return { ...g, jy: j.jy, jm: j.jm, jd: j.jd };
}

/** "1405/07/01" */
function jDate(ts) {
  const p = jParts(ts);
  return `${p.jy}/${pad2(p.jm)}/${pad2(p.jd)}`;
}

/** "2026-09-23" */
function gDate(ts) {
  const p = gParts(ts);
  return `${p.gy}-${pad2(p.gm)}-${pad2(p.gd)}`;
}

function hhmm(ts) {
  const p = gParts(ts);
  return `${pad2(p.hh)}:${pad2(p.mi)}`;
}

function hhmmss(ts) {
  const p = gParts(ts);
  return `${pad2(p.hh)}:${pad2(p.mi)}:${pad2(p.ss)}`;
}

function weekdayFa(ts) {
  return FA_WEEKDAYS[gParts(ts).wd];
}

/** Minutes → "H:MM" (e.g. 1470 → "24:30"). Negative values get a leading "-". */
function fmtDuration(min) {
  if (min == null || Number.isNaN(min)) return '';
  const sign = min < 0 ? '-' : '';
  const m = Math.round(Math.abs(min));
  return `${sign}${Math.floor(m / 60)}:${pad2(m % 60)}`;
}

/**
 * Parse a Jalali date "1405/07/01" (also accepts "-" separators and Persian digits)
 * with an optional time "HH:MM". Returns naive seconds or null.
 */
function parseJalali(str, defaultTime = '00:00') {
  if (!str) return null;
  const s = toLatinDigits(String(str)).trim();
  const m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (!m) return null;
  const jy = +m[1], jm = +m[2], jd = +m[3];
  if (!jalaali.isValidJalaaliDate(jy, jm, jd)) return null;
  const [dh, dm] = defaultTime.split(':').map(Number);
  const hh = m[4] != null ? +m[4] : dh;
  const mi = m[5] != null ? +m[5] : dm;
  if (hh > 23 || mi > 59) return null;
  const g = jalaali.toGregorian(jy, jm, jd);
  return toTs(g.gy, g.gm, g.gd, hh, mi, 0);
}

/** "HH:MM" → minutes since midnight, or null. */
function parseHm(str) {
  const m = toLatinDigits(String(str || '')).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return +m[1] * 60 + +m[2];
}

function toLatinDigits(s) {
  return s
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

function toFaDigits(s) {
  return String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
}

/** Start/end of a Jalali month as naive seconds [start, endExclusive). */
function jalaliMonthRange(jy, jm) {
  const g1 = jalaali.toGregorian(jy, jm, 1);
  const len = jalaali.jalaaliMonthLength(jy, jm);
  const start = toTs(g1.gy, g1.gm, g1.gd);
  return { start, end: start + len * DAY, days: len };
}

module.exports = {
  DAY, FA_MONTHS, FA_WEEKDAYS, pad2,
  toTs, dayStart, minuteOfDay, gParts, jParts, jDate, gDate, hhmm, hhmmss,
  weekdayFa, fmtDuration, parseJalali, parseHm, toLatinDigits, toFaDigits,
  jalaliMonthRange, jalaali,
};
