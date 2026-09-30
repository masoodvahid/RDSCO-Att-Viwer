'use strict';
/**
 * Syntax check for every JavaScript file in the project (used by CI: `npm run check`).
 * Cross-platform replacement for a long chain of `node --check` calls.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIRS = ['src', 'test', 'build', 'scripts'];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'out') walk(p, out);
    } else if (entry.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = DIRS.flatMap((d) => walk(path.join(ROOT, d)));
let failed = 0;
for (const file of files) {
  const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (res.status !== 0) {
    failed++;
    console.error(`✗ ${path.relative(ROOT, file)}\n${res.stderr}`);
  }
}
console.log(`Syntax check: ${files.length - failed}/${files.length} files OK`);
process.exit(failed ? 1 : 0);
