'use strict';

/** 最小上传测试：把附件传到一个已存在的 release 上，每步都打印 */
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.GH_TOKEN;
const OWNER = 'RicardoYW';
const REPO = 'ciallo-forge';
const REL_ID = process.env.REL_ID || '408863820';
const DIST = path.resolve(__dirname, '..', '..', 'dist');

const step = (s) => { process.stdout.write(s + '\n'); };

(async () => {
  const files = fs.readdirSync(DIST).filter((f) => f.toLowerCase().endsWith('.exe'));
  step('目录里的 exe: ' + files.join(', '));

  const existing = await (await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/${REL_ID}/assets`, {
    headers: { authorization: `token ${TOKEN}`, 'user-agent': 'x' },
  })).json();
  step('现有附件: ' + (existing.length ? existing.map((a) => a.name).join(', ') : '（无）'));

  for (const name of files) {
    const file = path.join(DIST, name);
    const size = fs.statSync(file).size;
    const dup = existing.find((a) => a.name === name);
    if (dup) {
      step(`删除旧附件 ${name} (id=${dup.id})`);
      const d = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/assets/${dup.id}`, {
        method: 'DELETE', headers: { authorization: `token ${TOKEN}`, 'user-agent': 'x' },
      });
      step('  DELETE → HTTP ' + d.status);
    }

    step(`开始上传 ${name}（${(size / 1024 / 1024).toFixed(1)} MB）`);
    const t = Date.now();
    const url = `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${REL_ID}/assets?name=${encodeURIComponent(name)}`;
    step('  → POST ' + url.slice(0, 90) + '…');
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `token ${TOKEN}`,
          'content-type': 'application/octet-stream',
          'content-length': String(size),
          'user-agent': 'ciallo-upload',
        },
        body: fs.createReadStream(file),
        duplex: 'half',
      });
    } catch (err) {
      step('  ✘ fetch 抛错: ' + err.message + (err.cause ? ' | cause=' + err.cause.message : ''));
      continue;
    }
    step(`  ← HTTP ${res.status}  ${((Date.now() - t) / 1000).toFixed(1)}s`);
    const text = await res.text();
    step('  body: ' + text.slice(0, 200).replace(/\s+/g, ' '));
  }
  step('测试结束');
})().catch((e) => { step('顶层异常: ' + e.message); });
