'use strict';

const assert=require('assert');
const {formatJalali,parseJalali}=require('../src/main/jalali');
const {parseAttendanceText,filterRecords,buildDailyReport}=require('../src/main/attendance');

const dates=['2025-07-01','2026-03-21','2026-09-22'];
for(const date of dates){const jalali=formatJalali(date);assert.ok(/^\d{4}\/\d{2}\/\d{2}$/.test(jalali));assert.strictEqual(parseJalali(jalali),date);}

const sample=[
  '1490017\t2025-07-01 08:00:00\t1\t255\t1\t0',
  '1490017\t2025-07-01 16:15:00\t1\t255\t1\t0',
  '1490007\t2025-07-01 09:00:00\t1\t255\t1\t0',
  '1490007\t2025-07-02 09:10:00\t1\t255\t1\t0',
  '1490007\t2025-07-02 12:00:00\t1\t255\t1\t0',
  '1490007\t2025-07-02 17:00:00\t1\t255\t1\t0'
].join('\n');

const parsed=parseAttendanceText(sample,'sample.dat');
assert.strictEqual(parsed.records.length,6);
assert.strictEqual(parsed.employeeCount,2);
const range=filterRecords(parsed.records,parsed.minJalali,parsed.maxJalali);
const report=buildDailyReport(range.records);
assert.strictEqual(report.employeeCount,2);
assert.strictEqual(report.dayCount,3);
assert.ok(report.daily.some(row=>row.count===1));
assert.ok(report.daily.some(row=>row.middle.length===1));
console.log('Smoke tests passed');
