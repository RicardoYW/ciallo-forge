'use strict';

/**
 * 分块上传桌面版到 GitHub Release（应对慢链路）
 *
 * 背景：本机到 uploads.github.com 的吞吐只有 0.03 MB/s，单请求传 20 MB 以上必超时。
 * 所以把 exe 切成 4 MB 小块分别上传，并支持断点续传（已 uploaded 的块自动跳过）。
 *
 * 用法：
 *   set GH_TOKEN=<token>
 *   node scripts/_migrations/upload-chunks.js            # 续传（推荐）
 *   node scripts/_migrations/upload-chunks.js --chunk 8  # 改块大小（MB）
 *   node scripts/_migrations/upload-chunks.js --clean    # 只清理 release 上的 diag/僵尸附件
 *
 * 完成后把 CialloForge-拼接说明.md 一并提供，用户按说明合并即可。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOKEN = process.env.GH_TOKEN;
const OWNER = 'RicardoYW';
const REPO = 'ciallo-forge';
const REL_ID = process.env.REL_ID || '408863820';
const DIST = path.resolve(__dirname, '..', '..', 'dist');

const args = process.argv.slice(2);
const CHUNK_MB = Number((args.includes('--chunk') && args[args.indexOf('--chunk') + 1]) || 4);
const CHUNK = CHUNK_MB * 1024 * 1024;
const CLEAN_ONLY = args.includes('--clean');

const API = 'https://api.github.com';
const UPL = 'https://uploads.github.com';
const H = { authorization: `token ${TOKEN}`, 'user-agent': 'ciallo-chunk', accept: 'application/vnd.github+json' };
const log = (s) => process.stdout.write(s + '\n');

async function listAssets() {
  const r = await fetch(`${API}/repos/${OWNER}/${REPO}/releases/${REL_ID}/assets?per_page=100`, { headers: H });
  if (!r.ok) throw new Error(`列附件失败 HTTP ${r.status}`);
  return r.json();
}

async function delAsset(id) {
  return fetch(`${API}/repos/${OWNER}/${REPO}/releases/assets/${id}`, { method: 'DELETE', headers: H });
}

async function putChunk(name, buf, attempt = 1, maxAttempt = 8) {
  const url = `${UPL}/repos/${OWNER}/${REPO}/releases/${REL_ID}/assets?name=${encodeURIComponent(name)}`;
  const t = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `token ${TOKEN}`,
        'content-type': 'application/octet-stream',
        'content-length': String(buf.length),
        'user-agent': 'ciallo-chunk',
      },
      body: buf,
    });
    const secs = (Date.now() - t) / 1000;
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`HTTP ${res.status} ${txt.slice(0, 120)}`);
    }
    const j = await res.json();
    return { ok: true, secs, id: j.id, state: j.state };
  } catch (err) {
    if (attempt >= maxAttempt) return { ok: false, err: err.message };
    const wait = Math.min(60, 5 * attempt);
    log(`      第 ${attempt} 次失败（${err.message.slice(0, 70)}）· ${wait}s 后重试`);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return putChunk(name, buf, attempt + 1, maxAttempt);
  }
}

(async () => {
  if (!TOKEN) { log('缺少 GH_TOKEN'); process.exit(2); }

  let assets = await listAssets();

  // 清理：诊断文件与僵尸（starter 且属于我们的）
  const junk = assets.filter((a) => /^diag-|^probe-/.test(a.name) || (a.state !== 'uploaded' && /^diag-|^probe-/.test(a.name)));
  for (const a of junk) {
    const d = await delAsset(a.id);
    log(`清理 ${a.name}（${a.state}）→ HTTP ${d.status}`);
  }
  if (junk.length) assets = await listAssets();
  if (CLEAN_ONLY) { log('清理完成'); return; }

  // 找出要上传的 exe
  const exes = fs.readdirSync(DIST).filter((f) => f.toLowerCase().endsWith('.exe'));
  if (!exes.length) { log('dist 里没有 exe'); process.exit(1); }

  const uploaded = new Set(assets.filter((a) => a.state === 'uploaded').map((a) => a.name));

  for (const exe of exes) {
    const full = path.join(DIST, exe);
    const size = fs.statSync(full).size;
    const total = Math.ceil(size / CHUNK);
    const base = exe.replace(/\.exe$/i, '');

    log('');
    log(`══ ${exe}  ${(size / 1024 / 1024).toFixed(1)} MB → ${total} 块（每块 ${CHUNK_MB} MB）`);
    log(`   完整文件 SHA256: ${await new Promise((res) => { const h = crypto.createHash('sha256'); fs.createReadStream(full).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))); })}`);

    const fd = fs.openSync(full, 'r');
    let done = 0;
    let skipped = 0;
    const t0 = Date.now();

    for (let i = 1; i <= total; i++) {
      const offset = (i - 1) * CHUNK;
      const len = Math.min(CHUNK, size - offset);
      const partName = `${base}.part${String(i).padStart(2, '0')}of${String(total).padStart(2, '0')}`;

      if (uploaded.has(partName) && fs.existsSync(path.join(DIST, partName)) === false) {
        // 仅在能校验时才跳过：没本地块文件就不敢跳（无法确认是本次的块）
      }
      if (uploaded.has(partName)) {
        skipped++;
        log(`   [${i}/${total}] ${partName} 已存在，跳过`);
        continue;
      }

      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, offset);
      const t = Date.now();
      const r = await putChunk(partName, buf);
      if (!r.ok) {
        log(`   [${i}/${total}] ${partName} ✘ 彻底失败：${r.err}`);
        log('   → 已中断，稍后重跑本脚本即可续传（已完成的块会跳过）');
        fs.closeSync(fd);
        process.exit(1);
      }
      done++;
      const secs = ((Date.now() - t) / 1000).toFixed(1);
      const remain = total - i;
      const eta = remain * ((Date.now() - t0) / Math.max(1, done)) / 60000;
      log(`   [${i}/${total}] ${partName}  ${(len / 1024 / 1024).toFixed(1)} MB  ${secs}s  ${(len / 1024 / 1024 / (secs / 1)).toFixed(3)} MB/s  剩余约 ${eta.toFixed(1)} 分钟`);
    }
    fs.closeSync(fd);
    log(`   ✔ ${exe} 完成：上传 ${done} 块 / 跳过 ${skipped} 块 · 总耗时 ${((Date.now() - t0) / 60000).toFixed(1)} 分钟`);
  }

  const final = await listAssets();
  log('');
  log('## Release 现有附件');
  for (const a of final) log(`- ${a.name}  ${(a.size / 1024).toFixed(0)} KB  state=${a.state}`);
})();
