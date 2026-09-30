'use strict';
/** Persistent settings stored as JSON in the app's user-data folder. */
const fs = require('fs');
const path = require('path');
const DEFAULTS = require('../core/defaults');
const { DEFAULT_RULES } = require('../core/engine');

function clone(o) { return JSON.parse(JSON.stringify(o)); }

function sanitize(s) {
  const out = clone(DEFAULTS);
  if (!s || typeof s !== 'object') return out;
  if (typeof s.orgName === 'string') out.orgName = s.orgName.slice(0, 200);
  if (typeof s.autoCheckUpdates === 'boolean') out.autoCheckUpdates = s.autoCheckUpdates;
  if (s.employees && typeof s.employees === 'object') {
    out.employees = {};
    for (const [k, v] of Object.entries(s.employees)) {
      const name = String(v || '').trim();
      if (name) out.employees[String(k).trim()] = name.slice(0, 120);
    }
  }
  if (s.employeeShifts && typeof s.employeeShifts === 'object') {
    out.employeeShifts = {};
    for (const [k, v] of Object.entries(s.employeeShifts)) {
      const names = Array.isArray(v) ? v.map((x) => String(x).slice(0, 60)).filter(Boolean).slice(0, 20) : [];
      if (names.length) out.employeeShifts[String(k).trim()] = names;
    }
  }
  if (Array.isArray(s.templates)) {
    out.templates = s.templates
      .filter((t) => t && t.name && t.start && t.end)
      .map((t) => ({ name: String(t.name).slice(0, 60), start: String(t.start), end: String(t.end), nextDay: !!t.nextDay }));
  }
  if (Array.isArray(s.clockRules)) {
    out.clockRules = s.clockRules
      .filter((r) => r && r.from && r.to)
      .map((r) => ({ from: String(r.from), to: String(r.to), offset: Math.round(Number(r.offset) || 0), note: String(r.note || '').slice(0, 120) }));
  }
  out.rules = { ...DEFAULT_RULES };
  if (s.rules && typeof s.rules === 'object') {
    for (const k of Object.keys(DEFAULT_RULES)) {
      if (k in s.rules) {
        out.rules[k] = typeof DEFAULT_RULES[k] === 'boolean' ? !!s.rules[k] : Math.max(0, Number(s.rules[k]) || 0);
      }
    }
  }
  if (Array.isArray(s.lastFiles)) out.lastFiles = s.lastFiles.filter((p) => typeof p === 'string').slice(0, 20);
  return out;
}

class SettingsStore {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    this.data = this.load();
  }

  load() {
    try {
      return sanitize(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch {
      return sanitize(null);
    }
  }

  save(next) {
    this.data = sanitize({ ...this.data, ...next });
    const tmp = `${this.file}.tmp`;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file); // atomic replace: a crash never leaves a half-written file
    return this.data;
  }

  reset(keys) {
    const d = clone(DEFAULTS);
    const patch = {};
    for (const k of keys) patch[k] = d[k];
    return this.save(patch);
  }
}

module.exports = { SettingsStore, sanitize };
