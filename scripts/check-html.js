'use strict';

/** HTML 产物结构自检：标签配平 + 关键锚点 */
const fs = require('fs');
const path = require('path');
const io = require('../src/util/io');

const checks = [
  { file: 'out/showcase.html', must: ['id="grid"', 'class="toolbar"', 'class="card"', 'data-heat=', '<script>'] },
  { file: 'out/指南.html', must: ['<nav', '<section', '<table', '<pre>'] },
];

let fail = 0;
for (const c of checks) {
  const p = path.join(io.ROOT, c.file);
  if (!fs.existsSync(p)) { console.log(`✘ 缺文件 ${c.file}`); fail++; continue; }
  const h = fs.readFileSync(p, 'utf8');
  const pairs = [['section', /<section/g, /<\/section>/g], ['article', /<article/g, /<\/article>/g], ['table', /<table/g, /<\/table>/g], ['pre', /<pre/g, /<\/pre>/g], ['div', /<div/g, /<\/div>/g]];
  const issues = [];
  for (const [name, o, cl] of pairs) {
    const a = (h.match(o) || []).length;
    const b = (h.match(cl) || []).length;
    if (a !== b) issues.push(`${name} ${a}/${b}`);
  }
  for (const m of c.must) if (!h.includes(m)) issues.push(`缺锚点 ${m}`);
  console.log(`${issues.length ? '✘' : '✔'} ${c.file} · ${(h.length / 1024).toFixed(1)} KB${issues.length ? ' — ' + issues.join('; ') : ''}`);
  if (issues.length) fail++;
}
process.exitCode = fail ? 1 : 0;
