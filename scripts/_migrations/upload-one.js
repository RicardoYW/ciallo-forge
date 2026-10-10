'use strict';

/**
 * 单文件上传（Buffer 整块提交，避开流式上传的收尾问题）
 * 用法：node scripts/_migrations/upload-one.js <文件名>
 */
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.GH_TOKEN;
const OWNER = 'RicardoYW';
const REPO = 'ciallo-forge';
const REL_ID = process.env.REL_ID || '408863820';
const NAME = process.argv[2];

const API = 'https://api.github.com';
const UPL = 'https://uploads.github.com';
const H = { authorization: `token ${TOKEN}`, 'user-agent': 'ciallo-up', accept: 'application/vnd.github+json' };

(async () => {
  const file = path.resolve(__dirname, '..', '..', 'dist', NAME);
  if (!fs.existsSync(file)) { console.log('文件不存在: ' + file); process.exit(1); }
  const buf = fs.readFileSync(file);
  console.log(`读取完成：${NAME}  ${(buf.length / 1024 / 1024).toFixed(2)} MB`);

  // 清同名残留
  const assets = await (await fetch(`${API}/repos/${OWNER}/${REPO}/releases/${REL_ID}/assets`, { headers: H })).json();
  const dup = assets.find((a) => a.name === NAME);
  if (dup) {
    const d = await fetch(`${API}/repos/${OWNER}/${REPO}/releases/assets/${dup.id}`, { method: 'DELETE', headers: H });
    console.log(`清除同名旧附件（state=${dup.state}）→ HTTP ${d.status}`);
  }

  const url = `${UPL}/repos/${OWNER}/${REPO}/releases/${REL_ID}/assets?name=${encodeURIComponent(NAME)}`;
  for (let i = 1; i <= 3; i++) {
    const t = Date.now();
    console.log(`第 ${i} 次上传开始…（HTTPS_PROXY=${process.env.HTTPS_PROXY || '未设'}）`);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `token ${TOKEN}`,
          'content-type': 'application/octet-stream',
          'content-length': String(buf.length),
          'user-agent': 'ciallo-up',
        },
        body: buf,
      });
      const text = await res.text();
      const secs = ((Date.now() - t) / 1000).toFixed(1);
      console.log(`  ← HTTP ${res.status}  ${secs}s  ${res.ok ? '平均 ' + (buf.length / 1024 / 1024 / secs).toFixed(2) + ' MB/s' : ''}`);
      if (res.ok) {
        const j = JSON.parse(text);
        console.log(`  ✔ 上传成功  state=${j.state}  size=${(j.size / 1024 / 1024).toFixed(2)} MB`);
        console.log('  ' + j.browser_download_url);
        return;
      }
      console.log('  body: ' + text.slice(0, 200));
    } catch (err) {
      console.log(`  ✘ 第 ${i} 次失败（${((Date.now() - t) / 1000).toFixed(1)}s）: ${err.message}${err.cause ? ' | cause=' + err.cause.message : ''}`);
    }
    if (i < 3) { console.log('  8 秒后重试…'); await new Promise((r) => setTimeout(r, 8000)); }
  }
  console.log('三次都失败');
  process.exitCode = 1;
})();
