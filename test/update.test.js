'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const core = require('../src/main/update-core');

test('compareVersions: numeric order, v-prefix, pre-releases', () => {
  assert.ok(core.compareVersions('1.0.1', '1.0.0') > 0);
  assert.ok(core.compareVersions('1.10.0', '1.9.9') > 0);
  assert.ok(core.compareVersions('v2.0.0', '1.99.99') > 0);
  assert.equal(core.compareVersions('1.0.0', 'v1.0.0'), 0);
  assert.ok(core.compareVersions('1.0.0-beta.1', '1.0.0') < 0);
  assert.ok(core.compareVersions('1.0.0', '1.0.0-beta.1') > 0);
  assert.equal(core.compareVersions('garbage', '1.0.0'), 0); // never "newer" on bad input
});

test('parseFeed reads electron-builder latest*.yml', () => {
  const feed = core.parseFeed(`version: 1.2.0
files:
  - url: AttendanceReport-1.2.0-mac-universal.zip
    sha512: abc==
    size: 1234
  - url: AttendanceReport-1.2.0-mac-universal.dmg
    sha512: def==
    size: 5678
path: AttendanceReport-1.2.0-mac-universal.zip
sha512: abc==
releaseDate: '2026-10-01T10:00:00.000Z'
`);
  assert.equal(feed.version, '1.2.0');
  assert.equal(feed.files.length, 2);
  assert.equal(core.pickAsset(feed, 'mac', 'arm64').url, 'AttendanceReport-1.2.0-mac-universal.zip');
  assert.throws(() => core.parseFeed('hello: world'));
});

test('pickAsset: mac arch fallback and portable naming', () => {
  const feed = { version: '1.3.0', files: [{ url: 'A-1.3.0-mac-x64.zip' }, { url: 'A-1.3.0-mac-arm64.zip' }, { url: 'A.dmg' }] };
  assert.equal(core.pickAsset(feed, 'mac', 'arm64').url, 'A-1.3.0-mac-arm64.zip');
  assert.equal(core.pickAsset(feed, 'mac', 'x64').url, 'A-1.3.0-mac-x64.zip');
  assert.equal(core.pickAsset(feed, 'portable', 'x64').url, 'AttendanceReport-1.3.0-portable.exe');
});

test('assetUrl resolves release file names', () => {
  const base = core.releaseBase('o', 'r', '1.2.3');
  assert.equal(base, 'https://github.com/o/r/releases/download/v1.2.3/');
  assert.equal(core.assetUrl(base, 'My App 1.zip'), 'https://github.com/o/r/releases/download/v1.2.3/My%20App%201.zip');
  assert.equal(core.assetUrl(base, 'https://x.test/a.zip'), 'https://x.test/a.zip');
});

test('sha512Base64 matches electron-builder format', async () => {
  const f = path.join(os.tmpdir(), `upd-${process.pid}.bin`);
  const data = crypto.randomBytes(100000);
  fs.writeFileSync(f, data);
  assert.equal(await core.sha512Base64(f), crypto.createHash('sha512').update(data).digest('base64'));
  fs.rmSync(f);
});

test('macOS swap script replaces the app bundle and rolls back on failure', { skip: process.platform === 'win32' }, () => {
  const script = core.SWAP_SCRIPT;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swap-'));
  const sh = path.join(dir, 'swap.sh');
  fs.writeFileSync(sh, script, { mode: 0o755 });
  const cur = path.join(dir, 'Attendance Report.app');
  const neu = path.join(dir, 'extracted', 'Attendance Report.app');
  fs.mkdirSync(cur, { recursive: true });
  fs.writeFileSync(path.join(cur, 'v'), 'old');
  fs.mkdirSync(neu, { recursive: true });
  fs.writeFileSync(path.join(neu, 'v'), 'new');

  // PID 999999 does not exist → no waiting; OPEN_CMD=true skips relaunching
  let r = spawnSync('/bin/bash', [sh, '999999', cur, neu], { env: { ...process.env, OPEN_CMD: 'true' } });
  assert.equal(r.status, 0);
  assert.equal(fs.readFileSync(path.join(cur, 'v'), 'utf8'), 'new');
  assert.ok(!fs.existsSync(`${cur}.update-backup`));

  // New app missing → the current app must stay in place
  r = spawnSync('/bin/bash', [sh, '999999', cur, path.join(dir, 'missing.app')], { env: { ...process.env, OPEN_CMD: 'true' } });
  assert.equal(fs.readFileSync(path.join(cur, 'v'), 'utf8'), 'new');
  fs.rmSync(dir, { recursive: true, force: true });
});
