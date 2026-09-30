'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const fs = require('fs');
const path = require('path');

const { parseAttLog } = require('../core/parser');
const { processAll } = require('../core/engine');
const { buildReport } = require('../core/report');
const T = require('../core/time');
const { SettingsStore, sanitize } = require('./settings');
const { writeExcel, readEmployeeList } = require('../export/excel');
const { writePdf } = require('../export/pdf');

let win = null;
let store = null;
const state = { files: [], result: null };

// ------------------------------------------------------------------ data

/** Device software exports ASCII/UTF-8, but some tools save UTF-16 — detect by BOM / NUL bytes. */
function readText(p) {
  const buf = fs.readFileSync(p);
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le', 2);
  if (buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2)).swap16().toString('utf16le');
  if (buf.length > 3 && buf[1] === 0 && buf[3] === 0) return buf.toString('utf16le');
  return buf.toString('utf8');
}

function loadFiles(paths) {
  const byPath = new Map(state.files.map((f) => [f.path, f]));
  for (const p of paths) {
    const text = readText(p);
    const parsed = parseAttLog(text, path.basename(p));
    byPath.set(p, { path: p, name: path.basename(p), punches: parsed.punches, errors: parsed.errors });
  }
  state.files = [...byPath.values()];
  store.save({ lastFiles: state.files.map((f) => f.path) });
  recompute();
}

function recompute() {
  const all = state.files.flatMap((f) => f.punches);
  state.result = all.length ? processAll(all, store.data) : null;
}

function summary() {
  const r = state.result;
  const names = store.data.employees;
  const base = {
    files: state.files.map((f) => ({ name: f.name, path: f.path, count: f.punches.length, errors: f.errors.length, errorSample: f.errors.slice(0, 5) })),
  };
  if (!r) return { ...base, loaded: false };

  const months = new Map(); // Jalali months present in the data, newest first
  const users = r.users.map((uid) => {
    const ps = r.punches.get(uid);
    const blocks = r.blocks.get(uid);
    return {
      uid,
      name: names[uid] || '',
      count: ps.length,
      first: T.jDate(ps[0].ts),
      last: T.jDate(ps[ps.length - 1].ts),
      incomplete: blocks.filter((b) => !b.complete).length,
    };
  });
  for (let d = T.dayStart(r.stats.from); d <= r.stats.to; d += T.DAY) {
    const p = T.jParts(d);
    months.set(`${p.jy}/${p.jm}`, { jy: p.jy, jm: p.jm, label: `${T.FA_MONTHS[p.jm - 1]} ${p.jy}` });
  }
  return {
    ...base,
    loaded: true,
    stats: {
      ...r.stats,
      fromJ: T.jDate(r.stats.from),
      toJ: T.jDate(r.stats.to),
    },
    users,
    months: [...months.values()].reverse().map((m) => {
      const range = T.jalaliMonthRange(m.jy, m.jm);
      return { ...m, from: T.jDate(range.start), to: T.jDate(range.end - T.DAY) };
    }),
  };
}

// ------------------------------------------------------------------ IPC

function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      console.error(channel, err);
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  });
}

function registerIpc() {
  handle('app:init', () => ({ settings: store.data, summary: summary(), version: app.getVersion() }));

  handle('files:open', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'انتخاب فایل تردد دستگاه',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'فایل تردد دستگاه', extensions: ['dat', 'txt', 'csv', 'log'] },
        { name: 'همه فایل‌ها', extensions: ['*'] },
      ],
    });
    if (res.canceled || !res.filePaths.length) return null;
    loadFiles(res.filePaths);
    return summary();
  });

  handle('files:load', (paths) => {
    const ok = (paths || []).filter((p) => typeof p === 'string' && fs.existsSync(p) && fs.statSync(p).isFile());
    if (!ok.length) throw new Error('فایل معتبری انتخاب نشد.');
    loadFiles(ok);
    return summary();
  });

  handle('files:remove', (filePath) => {
    state.files = state.files.filter((f) => f.path !== filePath);
    store.save({ lastFiles: state.files.map((f) => f.path) });
    recompute();
    return summary();
  });

  handle('settings:save', (patch) => {
    store.save(patch);
    recompute();
    return { settings: store.data, summary: summary() };
  });

  handle('settings:reset', (keys) => {
    store.reset(keys);
    recompute();
    return { settings: store.data, summary: summary() };
  });

  handle('settings:export', async () => {
    const res = await dialog.showSaveDialog(win, {
      title: 'ذخیره پشتیبان تنظیمات',
      defaultPath: 'attendance-settings.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePath) return null;
    const { lastFiles, ...data } = store.data;
    fs.writeFileSync(res.filePath, JSON.stringify(data, null, 2), 'utf8');
    return res.filePath;
  });

  handle('settings:import', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'بازیابی تنظیمات',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePaths.length) return null;
    const data = sanitize(JSON.parse(fs.readFileSync(res.filePaths[0], 'utf8')));
    delete data.lastFiles;
    store.save(data);
    recompute();
    return { settings: store.data, summary: summary() };
  });

  handle('employees:import', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'فهرست نام پرسنل (ستون اول کد، ستون دوم نام)',
      properties: ['openFile'],
      filters: [{ name: 'Excel / CSV', extensions: ['xlsx', 'csv', 'txt'] }],
    });
    if (res.canceled || !res.filePaths.length) return null;
    const list = await readEmployeeList(res.filePaths[0]);
    if (!Object.keys(list).length) throw new Error('در فایل، ردیفی با «کد پرسنلی، نام» پیدا نشد.');
    store.save({ employees: { ...store.data.employees, ...list } });
    return { settings: store.data, summary: summary(), imported: Object.keys(list).length };
  });

  handle('report:get', (filter) => buildReport(state.result, store.data, filter));

  handle('export:excel', async (filter) => exportWith(filter, 'xlsx', writeExcel));
  handle('export:pdf', async (filter) => exportWith(filter, 'pdf', writePdf));

  // Calendar data for the date picker (all Jalali logic stays in the Node core)
  handle('cal:month', (jy, jm) => {
    const { start, days } = T.jalaliMonthRange(jy, jm);
    const wd = T.gParts(start).wd; // 0 = Sunday … 6 = Saturday
    return { jy, jm, days, firstCol: (wd + 1) % 7, label: `${T.FA_MONTHS[jm - 1]} ${jy}` }; // column 0 = Saturday
  });
  handle('cal:today', () => {
    const n = new Date();
    const p = T.jParts(T.toTs(n.getFullYear(), n.getMonth() + 1, n.getDate()));
    return { jy: p.jy, jm: p.jm, jd: p.jd };
  });

  handle('shell:open', (p) => shell.openPath(p));
  handle('shell:showInFolder', (p) => shell.showItemInFolder(p));
}

async function exportWith(filter, ext, writer) {
  const report = buildReport(state.result, store.data, filter);
  if (report.error) throw new Error(report.error);
  if (!report.employees.length) throw new Error('در بازه انتخاب‌شده ترددی برای خروجی وجود ندارد.');
  const name = `گزارش-تردد-${report.from.replace(/\//g, '-')}-تا-${report.to.replace(/\//g, '-')}.${ext}`;
  const res = await dialog.showSaveDialog(win, {
    title: ext === 'pdf' ? 'ذخیره گزارش PDF' : 'ذخیره فایل اکسل',
    defaultPath: path.join(app.getPath('documents'), name),
    filters: [ext === 'pdf' ? { name: 'PDF', extensions: ['pdf'] } : { name: 'Excel', extensions: ['xlsx'] }],
  });
  if (res.canceled || !res.filePath) return null;
  await writer(report, res.filePath);
  return res.filePath;
}

// ------------------------------------------------------------------ window

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#f5f6f8',
    title: 'گزارش تردد پرسنل',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // Never navigate away or open new windows from the UI
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

const isMac = process.platform === 'darwin';

function setMenu() {
  if (!isMac) {
    Menu.setApplicationMenu(null);
    return;
  }
  // macOS: copy/paste/undo and Cmd+Q/Cmd+W only work through menu roles
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]));
}

app.whenReady().then(() => {
  setMenu();
  store = new SettingsStore(app.getPath('userData'));
  // Reload the files from last session if they still exist
  const last = (store.data.lastFiles || []).filter((p) => fs.existsSync(p));
  if (last.length) {
    try { loadFiles(last); } catch (e) { console.error('reload last files', e); }
  }
  registerIpc();
  createWindow();
});

// macOS convention: closing the window keeps the app in the Dock; clicking the Dock icon reopens it.
app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
app.on('activate', () => {
  if (app.isReady() && store && BrowserWindow.getAllWindows().length === 0) createWindow();
});
