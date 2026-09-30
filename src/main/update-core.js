'use strict';
/**
 * Update logic that does not depend on Electron (unit-tested in test/update.test.js).
 *
 * Releases are published by the GitHub workflow with electron-builder's update
 * feeds: latest.yml (Windows), latest-mac.yml (macOS) and latest-linux.yml (Linux).
 */
const crypto = require('crypto');
const fs = require('fs');
const yaml = require('js-yaml');

const FEED_FILE = { win32: 'latest.yml', darwin: 'latest-mac.yml', linux: 'latest-linux.yml' };

/** "1.2.3" / "v1.2.3-beta.1" → { nums: [1,2,3], pre: 'beta.1' } */
function parseVersion(v) {
  const m = String(v || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:[-+]([0-9A-Za-z.-]+))?$/);
  if (!m) return null;
  return { nums: [+m[1], +m[2], +m[3]], pre: m[4] || '' };
}

/** > 0 if a is newer than b. A pre-release is older than the same final version. */
function compareVersions(a, b) {
  const pa = parseVersion(a), pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] - pb.nums[i];
  if (pa.pre === pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

/** Parses an electron-builder update feed (YAML). */
function parseFeed(text) {
  const data = yaml.load(String(text || ''));
  if (!data || typeof data !== 'object' || !parseVersion(data.version)) {
    throw new Error('فایل اطلاعات نسخه جدید معتبر نیست.');
  }
  const files = Array.isArray(data.files) && data.files.length
    ? data.files
    : (data.path ? [{ url: data.path, sha512: data.sha512, size: data.size }] : []);
  return {
    version: String(data.version).replace(/^v/i, ''),
    releaseDate: data.releaseDate || null,
    files: files.filter((f) => f && f.url).map((f) => ({ url: String(f.url), sha512: f.sha512 || null, size: Number(f.size) || null })),
  };
}

/**
 * Chooses the file to download for the custom update modes.
 *  - mac:      the .zip (prefer universal, then this CPU's arch)
 *  - portable: the portable .exe is not listed in latest.yml; its name follows
 *              the artifactName pattern in package.json
 */
function pickAsset(feed, mode, arch) {
  if (mode === 'mac') {
    const zips = feed.files.filter((f) => /\.zip$/i.test(f.url));
    return zips.find((f) => /universal/i.test(f.url))
      || zips.find((f) => f.url.includes(arch === 'arm64' ? 'arm64' : 'x64'))
      || zips[0] || null;
  }
  if (mode === 'portable') {
    return { url: `AttendanceReport-${feed.version}-portable.exe`, sha512: null, size: null };
  }
  return feed.files[0] || null;
}

function releaseBase(owner, repo, version) {
  return `https://github.com/${owner}/${repo}/releases/download/v${version}/`;
}

/** Resolves a feed file URL (relative name or absolute URL) against the release base. */
function assetUrl(base, url) {
  return /^https?:\/\//i.test(url) ? url : base + url.split('/').map(encodeURIComponent).join('/');
}

function sha512Base64(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha512');
    fs.createReadStream(file).on('error', reject).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('base64')));
  });
}

// Waits for the app to exit, swaps the bundles (rolls back on failure), reopens the app.
const SWAP_SCRIPT = `#!/bin/bash
PID="$1"; CUR="$2"; NEW="$3"
for i in $(seq 1 240); do kill -0 "$PID" 2>/dev/null || break; sleep 0.25; done
BAK="$CUR.update-backup"
rm -rf "$BAK"
if mv "$CUR" "$BAK"; then
  if mv "$NEW" "$CUR"; then rm -rf "$BAK"; else mv "$BAK" "$CUR"; fi
fi
"\${OPEN_CMD:-/usr/bin/open}" "$CUR"
`;

module.exports = { SWAP_SCRIPT, FEED_FILE, parseVersion, compareVersions, parseFeed, pickAsset, releaseBase, assetUrl, sha512Base64 };
