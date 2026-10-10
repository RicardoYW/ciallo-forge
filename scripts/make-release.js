'use strict';

/**
 * 创建 GitHub Release 并上传桌面版附件。
 *
 * 用法：
 *   set GH_TOKEN=<token>
 *   node scripts/make-release.js [--tag v1.0.0] [--draft] [--skip-upload] [--force]
 *
 * 认证：GH_TOKEN 环境变量（GitHub OAuth token / PAT，需要 repo 权限）。
 * 说明：附件走 uploads.github.com，单文件上限 2 GB；断点重试 3 次。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const io = require('../src/util/io');

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt;
};

const OWNER = opt('owner', 'RicardoYW');
const REPO = opt('repo', 'ciallo-forge');
const TAG = opt('tag', 'v1.0.0');
const DRAFT = args.includes('--draft');
const SKIP_UPLOAD = args.includes('--skip-upload');
const FORCE = args.includes('--force');
const DIST = path.join(io.ROOT, 'dist');

const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error('[X] 需要 GH_TOKEN 环境变量（GitHub token，repo 权限）');
  process.exit(2);
}

const API = 'https://api.github.com';
const UPLOADS = 'https://uploads.github.com';
const H = {
  authorization: `token ${TOKEN}`,
  accept: 'application/vnd.github+json',
  'user-agent': 'ciallo-forge-release',
  'content-type': 'application/json',
};

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: H,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON */ }
  if (!res.ok) {
    const msg = json && json.message ? json.message : text.slice(0, 200);
    const err = new Error(`${method} ${url} → HTTP ${res.status}: ${msg}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

async function uploadAsset(release, file) {
  const name = path.basename(file);
  const size = fs.statSync(file).size;
  const url = `${UPLOADS}/repos/${OWNER}/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const started = Date.now();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `token ${TOKEN}`,
          'content-type': 'application/octet-stream',
          'content-length': String(size),
          'user-agent': 'ciallo-forge-release',
        },
        body: fs.createReadStream(file),
        duplex: 'half',
      });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* ignore */ }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(json && json.message) || text.slice(0, 160)}`);
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      const speed = (size / 1024 / 1024 / (secs / 1)).toFixed(2);
      return { name, size, secs, speed, url: json.browser_download_url };
    } catch (err) {
      if (attempt === 3) throw new Error(`${name} 上传失败（3 次）：${err.message}`);
      console.log(`    第 ${attempt} 次失败（${err.message.slice(0, 90)}），5 秒后重试…`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

async function main() {
  console.log('# 创建 Release 并上传桌面版');
  console.log('');
  console.log(`- 仓库：${OWNER}/${REPO}`);
  console.log(`- 标签：${TAG}`);
  console.log(`- 模式：${DRAFT ? '草稿' : '正式发布'}${SKIP_UPLOAD ? ' · 跳过上传' : ''}`);
  console.log('');

  // 1) 收集附件
  const files = fs.existsSync(DIST)
    ? fs.readdirSync(DIST).filter((f) => f.toLowerCase().endsWith('.exe')).map((f) => path.join(DIST, f))
    : [];
  if (!files.length && !SKIP_UPLOAD) {
    console.error(`[X] ${DIST} 里没有 exe，先跑「打包桌面版.bat」或 npm run dist`);
    process.exit(1);
  }

  console.log('## 附件与校验和');
  console.log('');
  const assets = [];
  for (const f of files) {
    const sum = await sha256(f);
    const size = fs.statSync(f).size;
    assets.push({ file: f, name: path.basename(f), size, sum });
    console.log(`- ${path.basename(f)} · ${(size / 1024 / 1024).toFixed(1)} MB`);
    console.log(`  \`SHA256 ${sum}\``);
  }
  console.log('');

  // 2) 建 release（tag 不存在会自动创建，指向默认分支的最新提交）
  const body = [
    '## 夜织 CialloForge v1.0.0',
    '',
    '成人虚构文本 + 绘图提示词双引擎的 Windows 桌面版。运行时零依赖，全离线。',
    '',
    '### 下载哪个',
    '',
    '| 文件 | 说明 |',
    '| --- | --- |',
    '| `CialloForge-Setup-1.0.0.exe` | 安装版：可选安装目录，自动建桌面与开始菜单快捷方式，可在控制面板卸载 |',
    '| `CialloForge-Portable-1.0.0.exe` | 便携版：双击即用，不写注册表 |',
    '',
    '### ⚠️ 首次运行会被 Windows 拦一下',
    '',
    '这两个程序**没有代码签名**，所以 Windows SmartScreen 会提示「已保护你的电脑」。',
    '处理方式：点 **更多信息** → **仍要运行**。部分杀软对未签名的 Electron 打包程序也可能误报，加白名单即可。',
    '',
    '### 数据存在哪',
    '',
    '- 程序本体：安装目录（或便携版解压出的临时目录）',
    '- 数据与产物：`%APPDATA%\\ciallo-forge\\`（升级、重装、卸载都不会丢）',
    '',
    '### 内容分级',
    '',
    '程序内置的是**基础版内容（热度 1-3 档）**。更露骨的部分（热度 4-5）以**内容包**形式单独提供，',
    '放到 `%APPDATA%\\ciallo-forge\\content-pack\\` 后重启即可解锁 —— 内容包不随本 Release 分发。',
    '',
    '### 校验下载完整性',
    '',
    '```powershell',
    'Get-FileHash .\\CialloForge-Setup-1.0.0.exe -Algorithm SHA256',
    '```',
    '',
    '与下面的值比对：',
    '',
    ...assets.map((a) => `- \`${a.name}\` → \`${a.sum}\``),
    '',
    '### 许可',
    '',
    '代码 MIT（见仓库 LICENSE）。全部角色为原创虚构成年人；生成内容的合规性、年龄分级与分发渠道由使用者负责。',
    '',
  ].join('\n');

  let release;
  try {
    release = await api('POST', `${API}/repos/${OWNER}/${REPO}/releases`, {
      tag_name: TAG,
      target_commitish: 'main',
      name: `夜织 CialloForge ${TAG}`,
      body,
      draft: DRAFT,
      prerelease: false,
    });
    console.log(`## 建 Release 成功`);
    console.log('');
    console.log(`- id: ${release.id}`);
    console.log(`- 地址：${release.html_url}`);
    console.log('');
  } catch (err) {
    if (err.status === 422 && /already_exists/i.test(err.message)) {
      console.log('[i] 该标签的 Release 已存在，改为复用');
      const all = await api('GET', `${API}/repos/${OWNER}/${REPO}/releases`);
      release = all.find((r) => r.tag_name === TAG);
      if (!release) throw err;
      console.log(`- 复用 release id: ${release.id}  地址：${release.html_url}`);
      console.log('');
    } else if (err.status === 404) {
      console.error('[X] 404：仓库不存在，或 token 权限不足（需要 repo 权限）');
      process.exit(1);
    } else {
      throw err;
    }
  }

  if (SKIP_UPLOAD) {
    console.log('[i] --skip-upload：只建 Release，不上传附件');
    return;
  }

  // 3) 上传附件（已存在的同名附件先删）
  console.log('## 上传附件');
  console.log('');
  const existing = await api('GET', `${API}/repos/${OWNER}/${REPO}/releases/${release.id}/assets`);
  const results = [];
  for (const a of assets) {
    const dup = existing.find((e) => e.name === a.name);
    if (dup) {
      if (!FORCE) {
        console.log(`- ${a.name}：已存在，跳过（加 --force 可覆盖）`);
        results.push({ name: a.name, skipped: true, url: dup.browser_download_url });
        continue;
      }
      console.log(`- ${a.name}：已存在，先删除旧的`);
      await api('DELETE', `${API}/repos/${OWNER}/${REPO}/releases/assets/${dup.id}`);
    }
    console.log(`- 上传 ${a.name}（${(a.size / 1024 / 1024).toFixed(1)} MB）…`);
    const r = await uploadAsset(release, a.file);
    console.log(`  ✔ 完成 ${r.secs}s · 平均 ${r.speed} MB/s`);
    console.log(`  ${r.url}`);
    results.push({ ...r, sum: a.sum });
  }

  // 4) 汇总
  console.log('');
  console.log('## 结果');
  console.log('');
  console.log(`- Release 页面：${release.html_url}`);
  for (const r of results) {
    console.log(`- ${r.name}${r.skipped ? '（跳过）' : ` · ${(r.size / 1024 / 1024).toFixed(1)} MB`}`);
    if (r.url) console.log(`  ${r.url}`);
  }
  console.log('');
  console.log('[OK] 全部完成');
}

main().catch((err) => {
  console.error('[X] ' + err.message);
  if (err.status === 401) console.error('    token 无效或已过期');
  if (err.status === 403) console.error('    token 权限不足，或触发了 API 限流');
  process.exitCode = 1;
});
