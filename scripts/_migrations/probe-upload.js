'use strict';

/**
 * 探路：用 1 KB 小文件测两个通道到 uploads.github.com 的连通性。
 *   --proxy   带代理
 *   --direct  不带代理
 * 顺便清理卡在 starter 状态的残留附件。
 */
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.GH_TOKEN;
const OWNER = 'RicardoYW';
const REPO = 'ciallo-forge';
const REL_ID = '408863820';
const MODE = process.argv.includes('--direct') ? 'direct' : 'proxy';

const H = { authorization: `token ${TOKEN}`, 'user-agent': 'ciallo-probe', accept: 'application/vnd.github+json' };
const log = (s) => console.log(s);

(async () => {
  // 1) 现有附件
  const assets = await (await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/${REL_ID}/assets`, { headers: H })).json();
  log('现有附件：');
  for (const a of assets) log(`  · id=${a.id} ${a.name} state=${a.state} ${(a.size / 1024 / 1024).toFixed(2)} MB`);
  if (!assets.length) log('  （无）');

  // 2) 清掉非 uploaded 的残留
  for (const a of assets) {
    if (a.state !== 'uploaded') {
      const d = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/assets/${a.id}`, { method: 'DELETE', headers: H });
      log(`  删除残留附件 ${a.name}（state=${a.state}）→ HTTP ${d.status}`);
    }
  }

  // 3) 小文件上传探路
  const tmp = path.join(process.env.TEMP || '/tmp', `probe-${MODE}.bin`);
  fs.writeFileSync(tmp, Buffer.alloc(1024, 7));
  const name = `probe-${MODE}.bin`;
  const url = `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${REL_ID}/assets?name=${name}`;

  if (MODE === 'direct') {
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.http_proxy;
    delete process.env.https_proxy;
  } else {
    process.env.HTTPS_PROXY = process.env.HTTPS_PROXY || 'http://127.0.0.1:12450';
    process.env.HTTP_PROXY = process.env.HTTP_PROXY || 'http://127.0.0.1:12450';
  }
  log('');
  log(`模式：${MODE}  HTTPS_PROXY=${process.env.HTTPS_PROXY || '(未设)'}`);
  log(`上传 1 KB 测试文件 ${name} …`);

  const t = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `token ${TOKEN}`,
        'content-type': 'application/octet-stream',
        'content-length': '1024',
        'user-agent': 'ciallo-probe',
      },
      body: fs.readFileSync(tmp),
    });
    const text = await res.text();
    log(`  ← HTTP ${res.status}  ${Date.now() - t}ms`);
    log('  body: ' + text.slice(0, 160).replace(/\s+/g, ' '));
    if (res.ok) {
      const j = JSON.parse(text);
      log(`  ✔ 通道可用（附件 id=${j.id}）`);
      const d = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/assets/${j.id}`, { method: 'DELETE', headers: H });
      log(`  清理测试附件 → HTTP ${d.status}`);
    }
  } catch (err) {
    log(`  ✘ 失败 ${Date.now() - t}ms → ${err.message}${err.cause ? ' | cause=' + err.cause.message : ''}`);
  }
  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
})();
