'use strict';
/**
 * In-app updates from GitHub Releases.
 *
 * Modes (chosen automatically):
 *  - native   Windows installer (NSIS) and Linux AppImage: electron-updater downloads
 *             the new version and installs it on restart.
 *  - mac      macOS: Squirrel.Mac only accepts apps signed with an Apple Developer ID,
 *             which this app is not, so the new .zip is downloaded here, its SHA-512
 *             checked against latest-mac.yml, extracted, and swapped in on restart.
 *  - portable Windows portable .exe cannot replace itself; the new portable .exe is
 *             downloaded next to the current one and started on restart.
 *  - manual   anything else (e.g. unpacked Linux build): opens the release page.
 *
 * The check itself is the same for all modes: the platform's update feed
 * (latest*.yml) of the latest GitHub release is compared with app.getVersion().
 */
const { app, net, shell } = require('electron');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const core = require('./update-core');

const REPO = { owner: 'masoodvahid', repo: 'rdsco_att_report_maker' };
const RELEASES_PAGE = `https://github.com/${REPO.owner}/${REPO.repo}/releases/latest`;

// Development/testing only (ignored in packaged builds):
//   ATT_UPDATE_FEED=http://127.0.0.1:8080/   serve latest*.yml and files from here
//   ATT_UPDATE_MODE=mac|portable|native|manual
const DEV_FEED = !app.isPackaged ? process.env.ATT_UPDATE_FEED : null;

function detectMode() {
  if (!app.isPackaged) return DEV_FEED ? (process.env.ATT_UPDATE_MODE || 'manual') : 'disabled';
  if (process.platform === 'darwin') return 'mac';
  if (process.platform === 'win32') return process.env.PORTABLE_EXECUTABLE_FILE ? 'portable' : 'native';
  if (process.platform === 'linux') return process.env.APPIMAGE ? 'native' : 'manual';
  return 'manual';
}

function feedFileFor(mode) {
  if (mode === 'mac') return core.FEED_FILE.darwin;
  if (mode === 'portable') return core.FEED_FILE.win32;
  return core.FEED_FILE[process.platform] || core.FEED_FILE.linux;
}

function friendlyError(err) {
  const msg = String((err && err.message) || err || '');
  if (/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_TIMED_OUT|ERR_PROXY|ENOTFOUND|ECONNRE|ETIMEDOUT|net::/i.test(msg)) {
    return 'اتصال به سرور به‌روزرسانی (GitHub) برقرار نشد. اتصال اینترنت را بررسی کنید.';
  }
  if (/HTTP 404/.test(msg)) return 'فایل نسخه جدید در صفحه Releases پیدا نشد.';
  return msg || 'خطای نامشخص';
}

const mkdirp = (d) => fs.mkdirSync(d, { recursive: true });
const run = (cmd, args) => new Promise((resolve, reject) => {
  execFile(cmd, args, { maxBuffer: 1 << 20 }, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)));
});

class Updater {
  /** @param {() => Electron.BrowserWindow | null} getWindow main window for status events */
  constructor(getWindow) {
    this.getWindow = getWindow;
    this.mode = detectMode();
    this.state = { status: this.mode === 'disabled' ? 'disabled' : 'idle', mode: this.mode, current: app.getVersion() };
    this.feed = null;
    this.pending = null;   // what install() will use
    this.abort = null;     // AbortController (custom downloads)
    this.cancelToken = null; // electron-updater downloads
    this.updatesDir = path.join(app.getPath('userData'), 'updates');
    // Leftovers of a previous update (downloaded zip, extracted app, swap script)
    fs.rm(this.updatesDir, { recursive: true, force: true }, () => {});
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    const w = this.getWindow();
    if (w && !w.isDestroyed()) w.webContents.send('update:state', this.state);
  }

  feedBase() {
    return DEV_FEED ? DEV_FEED.replace(/\/?$/, '/') : `https://github.com/${REPO.owner}/${REPO.repo}/releases/latest/download/`;
  }

  releaseBase(version) {
    return DEV_FEED ? this.feedBase() : core.releaseBase(REPO.owner, REPO.repo, version);
  }

  async fetchOk(url, init) {
    const res = await net.fetch(url, { cache: 'no-store', ...init });
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
    return res;
  }

  // ------------------------------------------------------------------ check

  async check({ manual = false } = {}) {
    if (this.mode === 'disabled') { this.set({ status: 'disabled', manual }); return this.state; }
    if (['checking', 'downloading'].includes(this.state.status)) return this.state;
    if (this.state.status === 'downloaded') return this.state; // already waiting for restart
    this.set({ status: 'checking', manual, error: null });
    try {
      const res = await this.fetchOk(this.feedBase() + feedFileFor(this.mode));
      this.feed = core.parseFeed(await res.text());
      if (core.compareVersions(this.feed.version, app.getVersion()) > 0) {
        this.set({ status: 'available', version: this.feed.version, releaseDate: this.feed.releaseDate, checkedAt: Date.now() });
      } else {
        this.set({ status: 'none', version: this.feed.version, checkedAt: Date.now() });
      }
    } catch (err) {
      this.set({ status: 'error', phase: 'check', error: friendlyError(err), detail: String(err && err.message) });
    }
    return this.state;
  }

  // ------------------------------------------------------------------ download

  async download() {
    if (!this.feed || !['available', 'error'].includes(this.state.status)) return this.state;
    if (this.mode === 'manual') { await this.openPage(); return this.state; }
    this.set({ status: 'downloading', percent: 0, transferred: 0, total: null, error: null, phase: 'download' });
    try {
      if (this.mode === 'native') await this.downloadNative();
      else await this.downloadCustom();
      this.set({ status: 'downloaded', percent: 100 });
    } catch (err) {
      if (this.state.status === 'available') return this.state; // cancelled by the user
      this.set({ status: 'error', phase: 'download', error: friendlyError(err), detail: String(err && err.message) });
    }
    return this.state;
  }

  nativeUpdater() {
    const { autoUpdater } = require('electron-updater');
    if (!this.nativeReady) {
      autoUpdater.autoDownload = false;
      autoUpdater.autoInstallOnAppQuit = false;
      autoUpdater.logger = null;
      if (DEV_FEED) {
        autoUpdater.forceDevUpdateConfig = true;
        autoUpdater.setFeedURL({ provider: 'generic', url: this.feedBase() });
      }
      autoUpdater.on('download-progress', (p) => {
        if (this.state.status !== 'downloading') return;
        this.set({ percent: Math.round(p.percent || 0), transferred: p.transferred || 0, total: p.total || null });
      });
      autoUpdater.on('error', () => {}); // errors are handled through the returned promises
      this.nativeReady = true;
    }
    return autoUpdater;
  }

  async downloadNative() {
    const autoUpdater = this.nativeUpdater();
    const result = await autoUpdater.checkForUpdates();
    if (!result || result.isUpdateAvailable === false) throw new Error('نسخه جدیدی برای این سیستم پیدا نشد.');
    const { CancellationToken } = require('builder-util-runtime');
    this.cancelToken = new CancellationToken();
    try {
      await autoUpdater.downloadUpdate(this.cancelToken);
    } finally {
      this.cancelToken = null;
    }
    this.pending = { native: true };
  }

  downloadTarget(fileName) {
    if (this.mode === 'portable') {
      const dir = process.env.PORTABLE_EXECUTABLE_DIR;
      try {
        if (dir) { fs.accessSync(dir, fs.constants.W_OK); return path.join(dir, fileName); }
      } catch { /* not writable → Downloads */ }
      return path.join(app.getPath('downloads'), fileName);
    }
    mkdirp(this.updatesDir);
    return path.join(this.updatesDir, fileName);
  }

  async downloadCustom() {
    const asset = core.pickAsset(this.feed, this.mode, process.arch);
    if (!asset) throw new Error('فایل مناسب این سیستم در نسخه جدید پیدا نشد.');
    const url = core.assetUrl(this.releaseBase(this.feed.version), asset.url);
    const dest = this.downloadTarget(path.basename(asset.url));
    const part = `${dest}.part`;

    this.abort = new AbortController();
    try {
      const res = await this.fetchOk(url, { signal: this.abort.signal });
      const total = Number(res.headers.get('content-length')) || asset.size || null;
      const out = fs.createWriteStream(part);
      const reader = res.body.getReader();
      let transferred = 0;
      let last = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          transferred += value.length;
          if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
          const now = Date.now();
          if (now - last > 200) {
            last = now;
            this.set({ transferred, total, percent: total ? Math.min(99, Math.round((transferred / total) * 100)) : null });
          }
        }
      } finally {
        await new Promise((r) => out.end(r));
      }
      if (total && transferred !== total) throw new Error('دانلود ناقص ماند؛ دوباره تلاش کنید.');
      if (asset.sha512) {
        const actual = await core.sha512Base64(part);
        if (actual !== asset.sha512) throw new Error('فایل دانلودشده سالم نیست (هش مطابقت ندارد).');
      }
      fs.renameSync(part, dest);
    } catch (err) {
      fs.rm(part, { force: true }, () => {});
      throw err;
    } finally {
      this.abort = null;
    }

    if (this.mode === 'mac') {
      this.pending = { newApp: await this.extractMacApp(dest), zip: dest };
    } else {
      try { fs.chmodSync(dest, 0o755); } catch { /* not needed on Windows */ }
      this.pending = { exe: dest };
      this.set({ downloadedPath: dest });
    }
  }

  async extractMacApp(zip) {
    const dir = path.join(this.updatesDir, 'extracted');
    fs.rmSync(dir, { recursive: true, force: true });
    mkdirp(dir);
    if (process.platform === 'darwin') {
      await run('/usr/bin/ditto', ['-x', '-k', zip, dir]); // keeps symlinks and code signatures intact
      await run('/usr/bin/xattr', ['-cr', dir]).catch(() => {});
    } else {
      await run('unzip', ['-q', '-o', zip, '-d', dir]); // dev/testing on Linux
    }
    const appDir = fs.readdirSync(dir).find((n) => n.endsWith('.app'));
    if (!appDir) throw new Error('برنامه داخل فایل دانلودشده پیدا نشد.');
    return path.join(dir, appDir);
  }

  cancel() {
    if (this.state.status !== 'downloading') return this.state;
    this.set({ status: 'available', percent: 0, transferred: 0 });
    if (this.abort) this.abort.abort();
    if (this.cancelToken) this.cancelToken.cancel();
    return this.state;
  }

  // ------------------------------------------------------------------ install

  /** Path of the running .app bundle on macOS, or null. */
  currentMacBundle() {
    if (process.env.ATT_UPDATE_TEST_BUNDLE && !app.isPackaged) return process.env.ATT_UPDATE_TEST_BUNDLE;
    const bundle = path.resolve(process.execPath, '..', '..', '..');
    return bundle.endsWith('.app') ? bundle : null;
  }

  install() {
    if (this.state.status !== 'downloaded' || !this.pending) return this.state;

    if (this.pending.native) {
      setImmediate(() => this.nativeUpdater().quitAndInstall(true, true)); // silent install, then relaunch
      return this.state;
    }

    if (this.pending.exe) { // Windows portable
      this.launchThenQuit(this.pending.exe, [], {});
      return this.state;
    }

    // macOS: swap the .app bundle after this process exits, then reopen it
    const current = this.currentMacBundle();
    const writable = current && !current.includes('/AppTranslocation/') && (() => {
      try { fs.accessSync(path.dirname(current), fs.constants.W_OK); fs.accessSync(current, fs.constants.W_OK); return true; } catch { return false; }
    })();
    if (!writable) {
      shell.showItemInFolder(this.pending.newApp);
      this.set({
        status: 'error', phase: 'install',
        error: 'برنامه اجازه جایگزینی خودش را ندارد. نسخه جدید در Finder باز شد؛ آن را به پوشه Applications بکشید.',
      });
      return this.state;
    }
    const script = path.join(this.updatesDir, 'swap.sh');
    fs.writeFileSync(script, core.SWAP_SCRIPT, { mode: 0o755 });
    this.launchThenQuit('/bin/bash', [script, String(process.pid), current, this.pending.newApp], {
      env: { ...process.env, OPEN_CMD: process.platform === 'darwin' ? '/usr/bin/open' : 'true' },
    });
    return this.state;
  }

  /** Starts a detached helper and quits only once it is actually running. */
  launchThenQuit(cmd, args, opts) {
    let child;
    const fail = (err) => this.set({ status: 'error', phase: 'install', error: `اجرای نسخه جدید ممکن نشد: ${err.message}` });
    try {
      child = spawn(cmd, args, { detached: true, stdio: 'ignore', ...opts });
    } catch (err) { fail(err); return; }
    child.once('error', fail);
    child.once('spawn', () => {
      child.unref();
      app.quit();
    });
  }

  async openPage() {
    await shell.openExternal(RELEASES_PAGE);
  }
}


function registerUpdaterIpc(updater, handle) {
  handle('update:get', () => updater.state);
  handle('update:check', () => updater.check({ manual: true }));
  handle('update:download', () => updater.download());
  handle('update:cancel', () => updater.cancel());
  handle('update:install', () => updater.install());
  handle('update:page', () => updater.openPage());
}

module.exports = { Updater, registerUpdaterIpc, RELEASES_PAGE };
