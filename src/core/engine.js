'use strict';
/**
 * Attendance engine.
 *
 * Pipeline (per employee):
 *   1. Clock correction  – fixes periods where the device clock was wrong.
 *   2. De-duplication    – repeated scans within N minutes count once.
 *   3. IN/OUT pairing    – the device does not record in/out (status 255), and many
 *                          shifts cross midnight, so punches are paired with a small
 *                          dynamic program. Each employee's usual entry times and
 *                          shift lengths are learned from their own recent history, so
 *                          a missing punch only affects its own shift instead of
 *                          shifting every pair that follows it.
 *   4. Work blocks       – pairs/punches separated by short gaps (e.g. the midnight
 *                          out/in punches, short breaks) are merged. Worked time of a
 *                          block = first entry → last exit.
 *   5. Shift matching    – each block is matched to the closest shift template
 *                          (mainly by start time) to compute lateness, early leave
 *                          and overtime. A block belongs to the date it started on.
 */
const T = require('./time');

const DEFAULT_RULES = {
  dupMinutes: 3,           // scans closer than this are one punch
  mergeGapMinutes: 120,    // gaps up to this inside a shift are counted as work
  maxShiftHours: 26,       // longest possible single entry→exit span
  graceLate: 0,            // minutes of lateness ignored
  graceEarly: 0,           // minutes of early leave ignored
  minOvertime: 15,         // overtime shorter than this is ignored
  countEarlyArrival: false,// arriving before shift start counts as overtime
  maxStartDeviation: 180,  // a block matches a template only if it starts within ±N minutes
};

// ---------------------------------------------------------------- templates

function templateDuration(tpl) {
  const s = T.parseHm(tpl.start);
  const e = T.parseHm(tpl.end);
  if (s == null || e == null) return null;
  let dur = e - s + (tpl.nextDay ? 1440 : 0);
  if (dur <= 0) dur += 1440;
  return dur;
}

function normalizeTemplates(templates) {
  return (templates || [])
    .map((t) => ({ ...t, startMin: T.parseHm(t.start), dur: templateDuration(t) }))
    .filter((t) => t.startMin != null && t.dur != null && t.name);
}

// ---------------------------------------------------------------- clock rules

function normalizeClockRules(rules) {
  return (rules || [])
    .map((r) => {
      const to = T.parseJalali(r.to, '23:59');
      return {
        ...r,
        fromTs: T.parseJalali(r.from, '00:00'),
        toTs: to != null ? to + 59 : null,
        offsetSec: Math.round(Number(r.offset) || 0) * 60,
      };
    })
    .filter((r) => r.fromTs != null && r.toTs != null && r.toTs >= r.fromTs && r.offsetSec !== 0);
}

function applyClock(punches, clockRules) {
  const rules = normalizeClockRules(clockRules);
  for (const p of punches) {
    const r = rules.find((x) => p.deviceTs >= x.fromTs && p.deviceTs <= x.toTs);
    p.ts = r ? p.deviceTs + r.offsetSec : p.deviceTs;
    p.corrected = !!r;
  }
}

// ---------------------------------------------------------------- histograms
//
// A profile is a smoothed 2-D histogram: (entry time-of-day) × (shift length).
// Scoring a candidate pair with the joint distribution means "18:00 → 18:04 next
// day" is judged against how long shifts that start at 18:00 usually last for
// this person, not just whether 18:00 and 18:04 are common times on their own.

const TOD_BIN = 15;                 // minutes per time-of-day bin
const TOD_BINS = 1440 / TOD_BIN;    // 96
const DUR_BIN = 30;                 // minutes per duration bin
const FLOOR = 0.01;                 // probability mass spread uniformly
const PRIOR_W = 0.1;                // weight of the structural prior after the first pass

function todBin(ts) {
  return Math.floor(T.minuteOfDay(ts) / TOD_BIN);
}

function durBinOf(spanSec, durBins) {
  return Math.min(durBins - 1, Math.floor(spanSec / 60 / DUR_BIN));
}

function gaussKernel(sigma) {
  const r = Math.ceil(sigma * 3);
  const w = [];
  for (let k = -r; k <= r; k++) w.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  return { r, w };
}
const K_TOD = gaussKernel(2);  // ±30 min
const K_DUR = gaussKernel(1);  // ±30 min

/** Separable Gaussian smoothing: circular along time-of-day, linear along duration. */
function smooth2d(h, durBins) {
  const tmp = new Float64Array(TOD_BINS * durBins);
  for (let t = 0; t < TOD_BINS; t++) {
    for (let d = 0; d < durBins; d++) {
      const v = h[t * durBins + d];
      if (!v) continue;
      for (let k = -K_TOD.r; k <= K_TOD.r; k++) {
        const tt = (t + k + TOD_BINS) % TOD_BINS;
        tmp[tt * durBins + d] += v * K_TOD.w[k + K_TOD.r];
      }
    }
  }
  const out = new Float64Array(TOD_BINS * durBins);
  for (let t = 0; t < TOD_BINS; t++) {
    for (let d = 0; d < durBins; d++) {
      const v = tmp[t * durBins + d];
      if (!v) continue;
      for (let k = -K_DUR.r; k <= K_DUR.r; k++) {
        const dd = d + k;
        if (dd < 0 || dd >= durBins) continue;
        out[t * durBins + dd] += v * K_DUR.w[k + K_DUR.r];
      }
    }
  }
  return out;
}

function normalize(h) {
  let sum = 0;
  for (const v of h) sum += v;
  const n = h.length;
  return Float64Array.from(h, (v) => (sum > 0 ? v / sum : 1 / n));
}

const smoothNorm = (joint, durBins) => normalize(smooth2d(joint, durBins));

function mix(parts, n) {
  const out = new Float64Array(n);
  const total = parts.reduce((s, [, w]) => s + w, 0);
  for (const [p, w] of parts) {
    if (!w) continue;
    for (let i = 0; i < n; i++) out[i] += (p[i] * w) / total;
  }
  return out;
}

function newStats(durBins) {
  return { joint: new Float64Array(TOD_BINS * durBins), inH: new Float64Array(TOD_BINS), outH: new Float64Array(TOD_BINS), n: 0 };
}

function addPair(s, a, b, durBins) {
  s.joint[todBin(a) * durBins + durBinOf(b - a, durBins)]++;
  s.inH[todBin(a)]++;
  s.outH[todBin(b)]++;
  s.n++;
}

function collectStats(pairs, durBins) {
  const s = newStats(durBins);
  for (const [a, b] of pairs) addPair(s, a, b, durBins);
  return s;
}

function addInto(dst, src) {
  for (let i = 0; i < dst.joint.length; i++) dst.joint[i] += src.joint[i];
  for (let i = 0; i < TOD_BINS; i++) { dst.inH[i] += src.inH[i]; dst.outH[i] += src.outH[i]; }
  dst.n += src.n;
}

// ---------------------------------------------------------------- structural prior
//
//  - generic: a 3–13.5 h shift is plausible at any start time, a ~24 h shift only
//    slightly. Lets the model discover patterns the first guess missed without
//    inventing 24 h shifts out of an entry followed by the next day's entry.
//  - templates: the organisation's declared shifts (start time × length).

function genericPrior(durBins) {
  const wd = new Float64Array(durBins);
  for (let d = 0; d < durBins; d++) {
    const h = (d * DUR_BIN) / 60;
    if (h >= 3 && h < 13.5) wd[d] = 1;
    else if (h >= 23 && h < 25.5) wd[d] = 0.15;
  }
  const p = new Float64Array(TOD_BINS * durBins);
  for (let t = 0; t < TOD_BINS; t++) for (let d = 0; d < durBins; d++) p[t * durBins + d] = wd[d];
  return normalize(p);
}

function templatePrior(templates, durBins) {
  if (!templates.length) return null;
  let h = new Float64Array(TOD_BINS * durBins);
  for (const t of templates) {
    const tb = Math.floor(t.startMin / TOD_BIN);
    const db = Math.min(durBins - 1, Math.floor(t.dur / DUR_BIN));
    h[tb * durBins + db] += 1 / templates.length;
  }
  for (let k = 0; k < 2; k++) h = smooth2d(h, durBins); // ±45 min on start, ±1 h on length
  return normalize(h);
}

// ---------------------------------------------------------------- time windows
//
// Shift patterns change over time (e.g. a summer rotation), so habits are learned
// per 30-day window from the pairs within ±45 days of it, blended with the
// person's long-term habits and the organisation's habits in the same window.

const WIN_SEC = 30 * T.DAY;
const CTX_SEC = 45 * T.DAY;

function makeTimeline(minTs, maxTs) {
  const t0 = T.dayStart(minTs);
  const n = Math.max(1, Math.floor((maxTs - t0) / WIN_SEC) + 1);
  return {
    n,
    winOf: (ts) => Math.min(n - 1, Math.max(0, Math.floor((ts - t0) / WIN_SEC))),
    /** windows whose context range contains ts */
    windowsFor: (ts) => {
      const out = [];
      const w0 = Math.floor((ts - t0) / WIN_SEC);
      for (let w = w0 - 2; w <= w0 + 2; w++) {
        if (w < 0 || w >= n) continue;
        const lo = t0 + w * WIN_SEC - CTX_SEC, hi = t0 + (w + 1) * WIN_SEC + CTX_SEC;
        if (ts >= lo && ts < hi) out.push(w);
      }
      return out;
    },
  };
}

function localStats(pairs, tl, durBins) {
  const arr = new Array(tl.n).fill(null);
  for (const [a, b] of pairs) {
    for (const w of tl.windowsFor(a)) {
      if (!arr[w]) arr[w] = newStats(durBins);
      addPair(arr[w], a, b, durBins);
    }
  }
  return arr;
}

// ---------------------------------------------------------------- pairing

/** Starting guess: first and last punch of each calendar day (when there are two or more). */
function calendarDayPairs(ts) {
  const pairs = [];
  let i = 0;
  while (i < ts.length) {
    const day = T.dayStart(ts[i]);
    let j = i;
    while (j + 1 < ts.length && T.dayStart(ts[j + 1]) === day) j++;
    if (j > i) pairs.push([ts[i], ts[j]]);
    i = j + 1;
  }
  return pairs;
}

// Cost of leaving a punch unpaired. A pair is kept when -ln P(pair) < 2 × this,
// i.e. when the shift is at least roughly as likely as an average one would be
// if shifts were spread uniformly over every start time and length.
const ORPHAN_COST = 5.5;

/**
 * Optimal split of the punch sequence into (IN,OUT) pairs of consecutive punches
 * and single orphan punches. `jointAt(ts)` returns the profile valid at time ts.
 * Returns [{type:'pair', i, j} | {type:'orphan', i}].
 */
function dpPair(ts, jointAt, durBins, maxSpanSec) {
  const n = ts.length;
  const cost = new Float64Array(n + 1);
  const choice = new Int8Array(n + 1); // 1 = orphan, 2 = pair
  for (let i = 1; i <= n; i++) {
    cost[i] = cost[i - 1] + ORPHAN_COST;
    choice[i] = 1;
    if (i >= 2) {
      const a = ts[i - 2], b = ts[i - 1];
      const span = b - a;
      if (span > 0 && span <= maxSpanSec) {
        const c = cost[i - 2] - Math.log(jointAt(a)[todBin(a) * durBins + durBinOf(span, durBins)]);
        if (c < cost[i]) { cost[i] = c; choice[i] = 2; }
      }
    }
  }
  const out = [];
  for (let i = n; i > 0;) {
    if (choice[i] === 2) { out.push({ type: 'pair', i: i - 2, j: i - 1 }); i -= 2; }
    else { out.push({ type: 'orphan', i: i - 1 }); i -= 1; }
  }
  return out.reverse();
}

/**
 * Learns profiles and pairs every employee's punches.
 * Returns { segsBy: Map<uid, segments>, entryExit: Map<uid, {pin, pout}> }.
 */
function pairAll(tsByUser, templates, durBins, maxSpan) {
  const NJ = TOD_BINS * durBins;
  const generic = genericPrior(durBins);
  const tplPrior = templatePrior(templates, durBins);
  const structural = tplPrior ? mix([[tplPrior, 0.5], [generic, 0.5]], NJ) : generic;
  const finish = (base) => Float64Array.from(base, (v, i) => (1 - FLOOR - PRIOR_W) * v + PRIOR_W * structural[i] + FLOOR / NJ);

  let minTs = Infinity, maxTs = -Infinity;
  for (const ts of tsByUser.values()) if (ts.length) { minTs = Math.min(minTs, ts[0]); maxTs = Math.max(maxTs, ts[ts.length - 1]); }
  const tl = makeTimeline(Number.isFinite(minTs) ? minTs : 0, Number.isFinite(maxTs) ? maxTs : 0);

  // Pass 0 (first guess): organisation-wide first/last punch of each calendar day,
  // guided by the declared shift templates. No per-person habits yet, so one
  // person's odd pattern cannot lock itself in.
  const seedStats = newStats(durBins);
  for (const ts of tsByUser.values()) addInto(seedStats, collectStats(calendarDayPairs(ts), durBins));
  const seedP = smoothNorm(seedStats.joint, durBins);
  const seedJoint = mix(tplPrior ? [[seedP, 0.3], [tplPrior, 0.5], [generic, 0.2]] : [[seedP, 0.6], [generic, 0.4]], NJ)
    .map((v) => (1 - FLOOR) * v + FLOOR / NJ);

  const run = (jointFor) => {
    const segsBy = new Map(), pairsBy = new Map();
    for (const [uid, ts] of tsByUser) {
      const jointAt = jointFor(uid);
      const segs = dpPair(ts, jointAt, durBins, maxSpan);
      segsBy.set(uid, segs);
      pairsBy.set(uid, segs.filter((s) => s.type === 'pair').map((s) => [ts[s.i], ts[s.j]]));
    }
    return { segsBy, pairsBy };
  };

  let { segsBy, pairsBy } = run(() => () => seedJoint);
  let entryExit = new Map();

  // Passes 1–2: learn habits from the previous pass (per person, per time window) and re-pair.
  for (let pass = 1; pass <= 2; pass++) {
    const own = new Map();
    const orgAll = newStats(durBins);
    const orgLocal = new Array(tl.n).fill(null).map(() => newStats(durBins));
    for (const [uid, pairs] of pairsBy) {
      const all = collectStats(pairs, durBins);
      const local = localStats(pairs, tl, durBins);
      own.set(uid, { all, local });
      addInto(orgAll, all);
      local.forEach((s, w) => { if (s) addInto(orgLocal[w], s); });
    }
    const orgAllP = smoothNorm(orgAll.joint, durBins);
    const orgLocalP = orgLocal.map((s) => {
      if (!s.n) return orgAllP;
      const w = s.n / (s.n + 50);
      return mix([[smoothNorm(s.joint, durBins), w], [orgAllP, 1 - w]], NJ);
    });
    const orgIn = normalize(orgAll.inH), orgOut = normalize(orgAll.outH);

    entryExit = new Map();
    ({ segsBy, pairsBy } = run((uid) => {
      const { all, local } = own.get(uid);
      const wa = all.n / (all.n + 30);
      const ownAllP = all.n ? smoothNorm(all.joint, durBins) : null;
      const inH = normalize(all.inH), outH = normalize(all.outH);
      entryExit.set(uid, {
        pin: Float64Array.from(inH, (v, i) => wa * v + (1 - wa) * orgIn[i] + 1e-6),
        pout: Float64Array.from(outH, (v, i) => wa * v + (1 - wa) * orgOut[i] + 1e-6),
      });
      const cache = new Map();
      return (ts) => {
        const w = tl.winOf(ts);
        let j = cache.get(w);
        if (!j) {
          const loc = local[w];
          const longTerm = ownAllP ? mix([[ownAllP, wa], [orgLocalP[w], 1 - wa]], NJ) : orgLocalP[w];
          const wl = loc ? loc.n / (loc.n + 20) : 0;
          j = finish(wl ? mix([[smoothNorm(loc.joint, durBins), wl], [longTerm, 1 - wl]], NJ) : longTerm);
          cache.set(w, j);
        }
        return j;
      };
    }));
  }
  return { segsBy, entryExit };
}

// ---------------------------------------------------------------- blocks

function buildBlocks(uid, punches, segments, ee, rules) {
  const gap = rules.mergeGapMinutes * 60;
  const blocks = [];
  for (const s of segments) {
    const it = s.type === 'pair'
      ? { start: punches[s.i].ts, end: punches[s.j].ts, idx: [s.i, s.j], pair: true }
      : { start: punches[s.i].ts, end: punches[s.i].ts, idx: [s.i], pair: false };
    const last = blocks[blocks.length - 1];
    if (last && it.start - last.end <= gap) {
      last.end = Math.max(last.end, it.end);
      last.idx.push(...it.idx);
      if (it.pair) last.pairs++;
    } else {
      blocks.push({ start: it.start, end: it.end, idx: [...it.idx], pairs: it.pair ? 1 : 0 });
    }
  }

  return blocks.map((b) => {
    const ps = b.idx.sort((x, y) => x - y).map((i) => punches[i]);
    const complete = b.pairs > 0;
    let status = 'ok';
    let missing = null;
    if (!complete) {
      // Lone punch(es): guess whether it was an entry or an exit
      const t = ps[0].ts;
      missing = ee.pin[todBin(t)] >= ee.pout[todBin(t)] ? 'out' : 'in';
      status = missing === 'out' ? 'noOut' : 'noIn';
    }
    const workedMin = complete ? Math.round((b.end - b.start) / 60) : 0;
    if (complete && workedMin > rules.maxShiftHours * 60) status = 'long';
    return {
      uid,
      start: b.start,
      end: complete ? b.end : null,
      shiftDate: T.gDate(b.start),
      punches: ps,
      complete,
      missing,
      workedMin,
      status,
    };
  });
}

// ---------------------------------------------------------------- shift matching

function matchShift(block, templates, rules) {
  if (!block.complete || !templates.length) return null;
  const base = T.dayStart(block.start);
  let best = null;
  for (const t of templates) {
    for (const off of [-1, 0, 1]) {
      const ts = base + off * T.DAY + t.startMin * 60;
      const te = ts + t.dur * 60;
      const sd = (block.start - ts) / 60; // + late, - early arrival
      const ed = (block.end - te) / 60;   // + stayed longer, - left early
      if (Math.abs(sd) > rules.maxStartDeviation) continue;
      const score = Math.abs(sd) + 0.25 * Math.abs(ed);
      if (!best || score < best.score) best = { t, sd, ed, score };
    }
  }
  if (!best) return null;
  const { t, sd, ed } = best;
  const late = sd > rules.graceLate ? Math.round(sd) : 0;
  const early = -ed > rules.graceEarly ? Math.round(-ed) : 0;
  const otBefore = rules.countEarlyArrival && -sd >= rules.minOvertime ? Math.round(-sd) : 0;
  const otAfter = ed >= rules.minOvertime ? Math.round(ed) : 0;
  return {
    name: t.name,
    requiredMin: t.dur,
    lateMin: late,
    earlyMin: early,
    overtimeMin: otBefore + otAfter,
  };
}

// ---------------------------------------------------------------- main

/**
 * @param {Array} rawPunches  output of parser (all files merged)
 * @param {Object} settings   { templates, clockRules, rules }
 * @returns {{ users: string[], punches: Map<string,Array>, blocks: Map<string,Array>, stats }}
 */
function processAll(rawPunches, settings = {}) {
  const rules = { ...DEFAULT_RULES, ...(settings.rules || {}) };
  const templates = normalizeTemplates(settings.templates);
  const maxSpan = rules.maxShiftHours * 3600;
  const durBins = Math.ceil((rules.maxShiftHours * 60) / DUR_BIN) + 1;

  // Merge files: drop exact duplicates (same person + same device time)
  const seen = new Set();
  const punches = [];
  for (const p of rawPunches) {
    const key = `${p.uid}|${p.deviceTs}`;
    if (seen.has(key)) continue;
    seen.add(key);
    punches.push({ ...p });
  }
  applyClock(punches, settings.clockRules);

  // Group by user, sort, mark near-duplicate scans
  const byUser = new Map();
  for (const p of punches) {
    if (!byUser.has(p.uid)) byUser.set(p.uid, []);
    byUser.get(p.uid).push(p);
  }
  const effective = new Map(); // punches used for pairing
  let dupCount = 0;
  for (const [uid, list] of byUser) {
    list.sort((a, b) => a.ts - b.ts);
    const eff = [];
    for (const p of list) {
      const prev = eff[eff.length - 1];
      p.duplicate = !!prev && p.ts - prev.ts < rules.dupMinutes * 60;
      if (p.duplicate) dupCount++;
      else eff.push(p);
    }
    effective.set(uid, eff);
  }

  const tsByUser = new Map([...effective].map(([uid, eff]) => [uid, eff.map((p) => p.ts)]));
  const { segsBy, entryExit } = pairAll(tsByUser, templates, durBins, maxSpan);

  const assigned = settings.employeeShifts || {};
  const blocks = new Map();
  for (const [uid, eff] of effective) {
    const list = buildBlocks(uid, eff, segsBy.get(uid), entryExit.get(uid), rules);
    // Employee-specific shifts, if the operator assigned any (unknown names are ignored)
    const allowed = Array.isArray(assigned[uid]) ? templates.filter((t) => assigned[uid].includes(t.name)) : [];
    const tpls = allowed.length ? allowed : templates;
    for (const b of list) {
      b.shift = matchShift(b, tpls, rules);
      if (b.status === 'ok' && templates.length && !b.shift) b.status = 'noShift';
    }
    blocks.set(uid, list);
  }

  const users = [...byUser.keys()].sort((a, b) => (a.length - b.length) || a.localeCompare(b));
  return {
    users,
    punches: byUser,
    blocks,
    stats: {
      total: rawPunches.length,
      unique: punches.length,
      duplicates: dupCount,
      corrected: punches.filter((p) => p.corrected).length,
      from: punches.length ? punches.reduce((m, p) => Math.min(m, p.ts), Infinity) : null,
      to: punches.length ? punches.reduce((m, p) => Math.max(m, p.ts), -Infinity) : null,
    },
  };
}

const STATUS_LABELS = {
  ok: 'عادی',
  noOut: 'خروج ثبت نشده',
  noIn: 'ورود ثبت نشده',
  long: 'شیفت طولانی (بررسی شود)',
  noShift: 'شیفت نامشخص',
};

module.exports = { processAll, DEFAULT_RULES, STATUS_LABELS, templateDuration, normalizeClockRules };
