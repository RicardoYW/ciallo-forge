'use strict';

/**
 * 上传体积临界点诊断：依次上传 1 / 5 / 20 / 50 MB 的随机数据，
 * 每档打印耗时、吞吐、以及 GitHub 返回的最终 state。
 * 用来判断「大文件上传失败」是体积问题、超时问题，还是服务器侧问题。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOKEN = process.env.GH_TOKEN;
const OWNER = 'RicardoYW';
const REPO = 'ciallo-forge';
const REL_ID = process.env.REL_ID || '408863820';
const SIZES = (process.env.SIZES || '1,5,20,50').split(',').map((x) => Number(x));
const USE_PROXY = process.env.USE_PROXY === '1';

if (!USE_PROXY) {
  delete process.env.HTTP_PROXY; delete process.env.HTTPS_PROXY;
  delete process.env.http_proxy; delete process.env.https_proxy;
}

const API = 'https://api.github.com';
const UPL = 'https://uploads.github.com';
const H = { authorization: `token ${TOKEN}`, 'user-agent': 'ciallo-diag', accept: 'application/vnd.github+json' };
const log = (s) => console.log(s);

async function clean(name) {
  const list = await (await fetch(`${API}/repos/${OWNER}/${REPO}/releases/${REL_ID}/assets`, { headers: H })).json();
  for (const a of list) {
    if (a.name === name) {
      await fetch(`${API}/repos/${OWNER}/${REPO}/releases/assets/${a.id}`, { method: 'DELETE', headers: H });
    }
  }
  return list.filter((a) => a.name !== name);
}

(async () => {
  log(`代理：${USE_PROXY ? '开' : '关'}  （HTTPS_PROXY=${process.env.HTTPS_PROXY || '未设'}）`);
  log(`测试体积：${SIZES.join(' / ')} MB`);
  log('');

  for (const mb of SIZES) {
    const name = `diag-${mb}mb.bin`;
    const file = path.join(process.env.TEMP || '/tmp', name);
    const bytes = mb * 1024 * 1024;
    // 随机内容，避免被中间层压缩或缓存
    const buf = crypto.randomBytes(bytes);
    fs.writeFileSync(file, buf);

    const others = await clean(name);
    const leftover = others.map((a) => `${a.name}(${a.state})`).join(', ');

    const url = `${UPL}/repos/${OWNER}/${REPO}/releases/${REL_ID}/assets?name=${name}`;
    const t = Date.now();
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `token ${TOKEN}`,
          'content-type': 'application/octet-stream',
          'content-length': String(bytes),
          'user-agent': 'ciallo-diag',
        },
        body: buf,
      });
    } catch (err) {
      log(`${mb} MB: ✘ 请求异常 ${((Date.now() - t) / 1000).toFixed(1)}s → ${err.message}${err.cause ? ' | ' + err.cause.message : ''}`);
      try { fs.unlinkSync(file); } catch { /* ignore */ }
      continue;
    }
    const secs = (Date.now() - t) / 1000;
    const text = await res.text();
    log(`${mb} MB: HTTP ${res.status}  ${secs.toFixed(1)}s  ${(mb / secs).toFixed(2)} MB/s`);

    if (res.ok) {
      const j = JSON.parse(text);
      log(`        返回 state=${j.state} id=${j.id}`);
      // 等 20 秒看它会不会转成 uploaded
      await new Promise((r) => setTimeout(r, 20000));
      const now = await (await fetch(`${API}/repos/${OWNER}/${REPO}/releases/assets/${j.id}`, { headers: H })).json();
      log(`        20 秒后 state=${now.state}`);
      await fetch(`${API}/repos/${OWNER}/${REPO}/releases/assets/${j.id}`, { method: 'DELETE', headers: H });
      log('        已清理测试附件');
    } else {
      log('        body: ' + text.slice(0, 140).replace(/\s+/g, ' '));
    }
    if (leftover) log('        （期间其他附件：' + leftover + '）');
    log('');
    try { fs.unlinkSync(file); } catch { /* ignore */ }
  }
  log('诊断结束');
})();
