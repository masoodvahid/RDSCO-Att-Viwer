'use strict';
/**
 * Parser for attendance-device raw logs (ZKTeco-style attlog .dat/.txt).
 *
 * Expected line format (tab separated, leading spaces allowed):
 *   <PersonnelID> \t <YYYY-MM-DD HH:MM:SS> \t <device> \t <status> \t <verify> \t <workcode>
 *
 * Comma/semicolon separated files and dates with "/" also work.
 * If the device stores Jalali dates (year < 1700), they are converted to Gregorian.
 */
const { toTs, jalaali, toLatinDigits } = require('./time');

const LINE_RE = /^\s*([^\s,;]+)[\s,;]+(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:[\s,;]+([^\s,;]*))?(?:[\s,;]+([^\s,;]*))?(?:[\s,;]+([^\s,;]*))?(?:[\s,;]+([^\s,;]*))?/;

const VERIFY_LABELS = {
  0: 'رمز', 1: 'اثر انگشت', 2: 'کارت', 3: 'رمز', 4: 'کارت', 15: 'چهره', 25: 'کف دست',
};

function parseAttLog(text, sourceName = '') {
  const punches = [];
  const errors = [];
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);

  lines.forEach((rawLine, idx) => {
    const line = toLatinDigits(rawLine);
    if (!line.trim()) return;
    const m = line.match(LINE_RE);
    if (!m) {
      errors.push({ line: idx + 1, text: rawLine.slice(0, 120) });
      return;
    }
    let y = +m[2], mo = +m[3], d = +m[4];
    const hh = +m[5], mi = +m[6], ss = m[7] != null ? +m[7] : 0;

    if (y < 1700) {
      // Device configured with the Persian calendar
      if (!jalaali.isValidJalaaliDate(y, mo, d)) {
        errors.push({ line: idx + 1, text: rawLine.slice(0, 120) });
        return;
      }
      const g = jalaali.toGregorian(y, mo, d);
      y = g.gy; mo = g.gm; d = g.gd;
    }
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 23 || mi > 59 || ss > 59) {
      errors.push({ line: idx + 1, text: rawLine.slice(0, 120) });
      return;
    }

    const verify = m[10] != null && m[10] !== '' ? Number(m[10]) : null;
    punches.push({
      uid: m[1].replace(/^0+(?=\d)/, ''), // "0012345" and "12345" are the same person
      deviceTs: toTs(y, mo, d, hh, mi, ss),
      status: m[9] ?? '',
      verify,
      verifyLabel: verify != null ? (VERIFY_LABELS[verify] || String(verify)) : '',
      source: sourceName,
    });
  });

  return { punches, errors, lineCount: lines.length };
}

module.exports = { parseAttLog };
