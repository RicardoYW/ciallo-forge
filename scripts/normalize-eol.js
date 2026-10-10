'use strict';

/**
 * 行尾规范化：.bat / .cmd / .ps1 一律 CRLF（cmd.exe 对混合行尾容错差），
 * 其余文本文件一律 LF。幂等。
 * 用法：node scripts/normalize-eol.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CRLF_EXT = new Set(['.bat', '.cmd', '.ps1']);
const SKIP_DIRS = new Set(['out', 'node_modules', '.git']);
const TEXT_EXT = new Set(['.js', '.json', '.md', '.txt', '.bat', '.cmd', '.ps1', '.html', '.csv', '.gitignore', '']);

function walk(dir, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

let changed = 0;
const report = [];
for (const p of walk(ROOT)) {
  const ext = path.extname(p).toLowerCase();
  if (ext === '.png' || ext === '.jpg' || ext === '.zip') continue;
  if (!TEXT_EXT.has(ext) && path.basename(p) !== '.gitignore') continue;

  const raw = fs.readFileSync(p, 'utf8');
  const wantCRLF = CRLF_EXT.has(ext);
  const normalized = wantCRLF
    ? raw.replace(/\r?\n/g, '\r\n')
    : raw.replace(/\r\n/g, '\n');
  if (normalized !== raw) {
    fs.writeFileSync(p, normalized, 'utf8');
    changed++;
    report.push(`${path.relative(ROOT, p)} → ${wantCRLF ? 'CRLF' : 'LF'}`);
  }
}

console.log(`[OK] 行尾规范化：${changed} 个文件被修正`);
for (const r of report) console.log('     · ' + r);
