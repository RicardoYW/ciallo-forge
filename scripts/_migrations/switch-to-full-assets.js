'use strict';

/**
 * 换网后收尾：清掉 54 个分块附件，改为上传完整 exe。
 * 用法：set GH_TOKEN=... && node scripts/_migrations/switch-to-full-assets.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOKEN = process.env.GH_TOKEN;
const OWNER = 'RicardoYW';
const REPO = 'ciallo-forge';
const REL_ID = '408863820';
const DIST = path.resolve(__dirname, '..', '..', 'dist');

const API = 'https://api.github.com';
const UPL = 'https://uploads.github.com';
const H = { authorization: `token ${TOKEN}`, 'user-agent': 'ciallo-fix', accept: 'application/vnd.github+json' };

const log = (s) => process.stdout.write(s + '\n');

async function listAssets() {
  const r = await fetch(`${API}/repos/${OWNER}/${REPO}/releases/${REL_ID}/assets?per_page=100`, { headers: H });
  if (!r.ok) throw new Error(`列附件失败 HTTP ${r.status}`);
  return r.json();
}

async function delAsset(id) {
  const r = await fetch(`${API}/repos/${OWNER}/${REPO}/releases/assets/${id}`, { method: 'DELETE', headers: H });
  return r.status;
}

async function uploadFull(file, attempt = 1) {
  const name = path.basename(file);
  const buf = fs.readFileSync(file);
  const url = `${UPL}/repos/${OWNER}/${REPO}/releases/${REL_ID}/assets?name=${encodeURIComponent(name)}`;
  const t = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `token ${TOKEN}`,
        'content-type': 'application/octet-stream',
        'content-length': String(buf.length),
        'user-agent': 'ciallo-fix',
      },
      body: buf,
    });
    const secs = (Date.now() - t) / 1000;
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`HTTP ${res.status} ${txt.slice(0, 140)}`);
    }
    const j = await res.json();
    return { ok: true, secs, size: buf.length, state: j.state, url: j.browser_download_url };
  } catch (err) {
    if (attempt >= 5) return { ok: false, err: err.message };
    log(`    第 ${attempt} 次失败（${err.message.slice(0, 80)}），5 秒后重试`);
    await new Promise((r) => setTimeout(r, 5000));
    return uploadFull(file, attempt + 1);
  }
}

(async () => {
  log('## 1. 清理分块附件');
  let assets = await listAssets();
  const chunks = assets.filter((a) => /\.part\d+of\d+$/.test(a.name));
  log(`  找到 ${chunks.length} 个分块`);
  let deleted = 0;
  for (const a of chunks) {
    const st = await delAsset(a.id);
    if (st === 204) deleted++;
    else log(`    ${a.name} → HTTP ${st}`);
  }
  log(`  已删除 ${deleted} 个`);
  assets = await listAssets();
  log(`  剩余附件 ${assets.length} 个`);

  log('');
  log('## 2. 上传完整 exe');
  const exes = fs.readdirSync(DIST).filter((f) => f.toLowerCase().endsWith('.exe'));
  for (const exe of exes) {
    const file = path.join(DIST, exe);
    const size = fs.statSync(file).size;
    // 同名旧附件先删
    const dup = assets.find((a) => a.name === exe);
    if (dup) {
      const st = await delAsset(dup.id);
      log(`  删除同名旧附件 ${exe} → HTTP ${st}`);
    }
    log(`  上传 ${exe}（${(size / 1024 / 1024).toFixed(1)} MB）…`);
    const r = await uploadFull(file);
    if (!r.ok) {
      log(`    ✘ 失败：${r.err}`);
      continue;
    }
    const mbps = r.size / 1024 / 1024 / r.secs;
    log(`    ✔ ${r.secs.toFixed(1)}s · ${mbps.toFixed(2)} MB/s · state=${r.state}`);
    log(`    ${r.url}`);
  }

  log('');
  log('## 3. 结果');
  const final = await listAssets();
  const sum = final.reduce((s, a) => s + a.size, 0);
  log(`  附件数 ${final.length} · 合计 ${(sum / 1024 / 1024).toFixed(1)} MB`);
  for (const a of final) {
    log(`  - ${a.name}  ${(a.size / 1024 / 1024).toFixed(1)} MB  ${a.state}`);
  }
})();
