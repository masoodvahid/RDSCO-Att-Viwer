'use strict';
/**
 * First-run settings. Everything here is editable in the app (Settings tab).
 *
 * The shift templates and clock corrections below were derived from the
 * organisation's device log (Tir 1404 – Shahrivar 1405). They are a starting
 * point and must be confirmed by the operator.
 */
const { DEFAULT_RULES } = require('./engine');

module.exports = {
  version: 1,
  orgName: '',
  employees: {},  // { "1001": "نام و نام خانوادگی" }
  // Optional: shift templates allowed per employee (by template name). Empty = all templates.
  employeeShifts: {},  // { "1002": ["صبح‌کار"] }
  templates: [
    { name: 'اداری', start: '07:45', end: '15:45', nextDay: false },
    { name: 'صبح‌کار', start: '06:00', end: '15:45', nextDay: false },
    { name: 'روزکار ۱۲ ساعته', start: '06:00', end: '18:30', nextDay: false },
    { name: 'شب‌کار ۱۲ ساعته', start: '18:00', end: '06:30', nextDay: false },
    { name: '۲۴ ساعته', start: '06:00', end: '06:30', nextDay: true },
    { name: 'عصر', start: '16:30', end: '22:00', nextDay: false },
    { name: 'روزکار ۱۶ ساعته', start: '06:00', end: '22:30', nextDay: false },
    { name: 'شب‌کار ۸ ساعته', start: '22:00', end: '06:30', nextDay: false },
  ],
  // Device time ranges in which the device clock was wrong; offset in minutes is
  // ADDED to the device time (+84 means the device was 84 minutes behind).
  clockRules: [
    { from: '1404/08/19 10:00', to: '1404/09/02 17:00', offset: 84, note: 'تشخیص از روی داده‌ها' },
    { from: '1404/09/11 08:30', to: '1404/09/27 10:00', offset: 55, note: 'تشخیص از روی داده‌ها' },
    { from: '1404/11/03 12:00', to: '1404/11/25 16:00', offset: 127, note: 'تشخیص از روی داده‌ها' },
    { from: '1405/03/04 10:00', to: '1405/03/23 15:00', offset: 138, note: 'تشخیص از روی داده‌ها' },
    { from: '1405/03/23 15:00', to: '1405/06/04 12:00', offset: 317, note: 'تشخیص از روی داده‌ها' },
  ],
  rules: { ...DEFAULT_RULES },
};
