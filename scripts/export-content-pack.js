'use strict';

/**
 * 内容包导出与基础数据无害化
 *
 *   node scripts/export-content-pack.js            # 生成 pack + 清洗基础数据（默认）
 *   node scripts/export-content-pack.js --dry-run  # 只报告将要发生什么，不写文件
 *   node scripts/export-content-pack.js --zip      # 额外产出可分发的 zip
 *
 * 做两件事：
 *   1) 把当前 data/ 里的**完整**内容导出为 content-pack/（含露骨词库），并写 pack.json 清单
 *   2) 把 data/ 里的露骨部分**降级**为示例尺度（heat ≤ 3），供开源仓库本体使用
 *
 * 之所以能这样切：prose.json 的分级是数据驱动的（每条词带 `min` 阈值），
 * 引擎按热度过滤，抽掉 4/5 档只会让输出更含蓄，不会破坏任何逻辑。
 *
 * ⚠️ 执行前请确认 data/ 是「完整版」；已清洗过的数据再跑一次不会出错（幂等）。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const io = require('../src/util/io');

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const ZIP = args.includes('--zip');
const MAX_HEAT = 3; // 基础数据保留到第 3 档（缠绵：身体描写，无器官名词）

const PACK_DIR = path.join(io.ROOT, 'content-pack');
const OUT_DATA_DIR = path.join(io.ROOT, 'dist', 'open-source-data');
const REPORT = [];

function log(s) { REPORT.push(s); console.log(s); }

// ───────────────────────── 读当前完整数据 ─────────────────────────

const files = ['characters.json', 'scenes.json', 'prose.json', 'voice-registers.json', 'config.json'];
const full = {};
for (const f of files) {
  const p = path.join(io.ROOT, 'data', f);
  full[f] = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
}

// ───────────────────────── 1. 生成内容包 ─────────────────────────

function buildPack() {
  const prose = full['prose.json'];
  const heatKeys = Object.keys(prose.reaction || {}).map(Number).sort((a, b) => a - b);
  const explicitTiers = heatKeys.filter((k) => k > MAX_HEAT);

  // 包只装「基础数据里没有的那部分」：4/5 档词库 + 完整热度定义 + 强度词
  const prosePatch = {
    _packNote: `完整成人向词库：补上 heat ${MAX_HEAT + 1}-5 档。基础数据只到 heat ${MAX_HEAT}。`,
    heat: prose.heat,
    intensityWord: prose.intensityWord,
    bodyPart: (prose.bodyPart || []).filter((x) => (x.min || 1) > MAX_HEAT),
    garment: (prose.garment || []).filter((x) => (x.min || 1) > MAX_HEAT),
    fluid: (prose.fluid || []).filter((x) => (x.min || 1) > MAX_HEAT),
    verb: (prose.verb || []).filter((x) => (typeof x === 'object' ? (x.min || 1) > MAX_HEAT : false)),
    pool: {},
    reaction: {},
    intent: {},
    aftermath: (prose.aftermath || []).filter((x) => (x.min || 1) > MAX_HEAT),
    dialogueVoice: {},
    dialogueNeutral: (prose.dialogueNeutral || []).filter((x) => (x.min || 1) > MAX_HEAT),
  };

  // 池子：只放 4/5 档句子里才出现的（含 {heat:intensityWord} 或流体/器官 token 的）
  const HEAVY = /\{heat:intensityWord\}|\{fluid\}|\{body\}|臀|乳|穴|甬道|花心|抽送|撞|插|含住|咬住|顶/;
  for (const [k, arr] of Object.entries(prose.pool || {})) {
    const heavy = arr.filter((s) => HEAVY.test(String(s)));
    if (heavy.length) prosePatch.pool[k] = heavy;
  }
  for (const k of explicitTiers) {
    if (prose.reaction && prose.reaction[k]) prosePatch.reaction[k] = prose.reaction[k];
    if (prose.intent && prose.intent[k]) prosePatch.intent[k] = prose.intent[k];
  }
  // 声线侧写里的 4/5 档
  for (const [reg, arr] of Object.entries(prose.dialogueVoice || {})) {
    const heavy = arr.filter((x) => (x.min || 1) > MAX_HEAT);
    if (heavy.length) prosePatch.dialogueVoice[reg] = heavy;
  }

  const manifest = {
    id: 'adult-full',
    name: '夜织 · 完整成人向内容包',
    version: '1.0.0',
    rating: 'explicit',
    ageGate: 18,
    requires: '>=1.0.0',
    createdAt: new Date().toISOString(),
    contents: [
      `prose.json：heat ${MAX_HEAT + 1}-5 档词库（器官、体液、动作、强度词、声线侧写）`,
      'config.json：完整安全词表（含幼态词与成年锚点两组）',
    ],
    merge: {
      note: '对象深合并；prose 的 pool / reaction / intent / aftermath / dialogueVoice 为整体替换；characters / scenes 按 id 覆盖。',
      arrays: 'replace',
    },
    warning: '本包含露骨成人内容（18+）。请勿放入公开代码仓库。',
  };

  const configPatch = {
    safety: full['config.json'].safety,
  };

  return { manifest, prose: prosePatch, config: configPatch };
}

// ───────────────────────── 2. 清洗基础数据 ─────────────────────────

function sanitize(base) {
  const p = JSON.parse(JSON.stringify(base['prose.json']));

  const keepMin = (arr) => (arr || []).filter((x) => (typeof x === 'object' ? (x.min || 1) <= MAX_HEAT : true));
  p.bodyPart = keepMin(p.bodyPart);
  p.garment = keepMin(p.garment);
  p.fluid = keepMin(p.fluid);
  p.verb = keepMin(p.verb);
  p.aftermath = keepMin(p.aftermath);
  p.dialogueNeutral = keepMin(p.dialogueNeutral);

  for (const key of ['reaction', 'intent']) {
    if (!p[key]) continue;
    const out = {};
    for (const [k, v] of Object.entries(p[key])) {
      if (Number(k) <= MAX_HEAT) out[k] = v;
    }
    p[key] = out;
  }

  // 强度词：只留到基础档
  if (p.intensityWord) {
    const iw = {};
    for (const [k, v] of Object.entries(p.intensityWord)) {
      if (Number(k) <= MAX_HEAT) iw[k] = v;
    }
    p.intensityWord = iw;
  }

  // 热度档说明：第 4/5 档的 note 里写了露骨词，降级版改成中性描述
  if (p.heat) {
    for (const [k, v] of Object.entries(p.heat)) {
      if (Number(k) > MAX_HEAT && v && typeof v === 'object') {
        v.note = `第 ${k} 档为完整成人向内容，需加载内容包后解锁（仓库本体不含该档词库）。`;
      }
    }
  }

  // 池子：剔除只服务高热度的句子
  const HEAVY = /\{heat:intensityWord\}|\{fluid\}|臀缝|乳肉|乳尖|穴口|甬道|花心|抽送|体液/;
  const poolOut = {};
  for (const [k, arr] of Object.entries(p.pool || {})) {
    const kept = arr.filter((s) => !HEAVY.test(String(s)));
    poolOut[k] = kept;
  }
  p.pool = poolOut;
  p._sanitized = `开源版示例词库：仅含 heat 1-${MAX_HEAT} 档。完整 4-5 档通过内容包加载（见 README）。`;

  // 表情/反应档 4-5 也清掉
  const out = { ...base, 'prose.json': p };
  return out;
}

// ───────────────────────── 执行 ─────────────────────────

log('# 内容包导出与基础数据无害化');
log('');
log(`- 项目：${io.ROOT}`);
log(`- 基础数据保留尺度：heat ≤ ${MAX_HEAT}`);
log(`- 模式：${DRY ? '试运行（不写文件）' : '写入'}`);
log('');

const pack = buildPack();
const sanitized = sanitize(full);

function countProse(x) {
  let n = 0;
  const walk = (v) => {
    if (Array.isArray(v)) n += v.length;
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(x);
  return n;
}

log('## 1. 内容包（放到 content-pack/，不入库）');
log('');
log(`- 词库条目：${countProse(pack.prose)} 条`);
log(`- 池子族：${Object.keys(pack.prose.pool).length} 个（${Object.keys(pack.prose.pool).join(', ')}）`);
log(`- 热度档：bodyPart ${pack.prose.bodyPart.length} · garment ${pack.prose.garment.length} · fluid ${pack.prose.fluid.length}`);
log(`- 反应档：${Object.keys(pack.prose.reaction).join('/')} · 内心档：${Object.keys(pack.prose.intent).join('/')}`);
log('');

log('## 2. 基础数据（入库）');
log('');
log(`- 词库条目：${countProse(sanitized['prose.json'])} 条（原 ${countProse(full['prose.json'])} 条）`);
log(`- 池子族：${Object.keys(sanitized['prose.json'].pool).length} 个`);
log(`- 热度档：bodyPart ${sanitized['prose.json'].bodyPart.length} · garment ${sanitized['prose.json'].garment.length} · fluid ${sanitized['prose.json'].fluid.length}`);
log('');

if (DRY) {
  log('[i] 试运行结束，未写任何文件。');
} else {
  // 写包
  fs.mkdirSync(PACK_DIR, { recursive: true });
  fs.writeFileSync(path.join(PACK_DIR, 'pack.json'), JSON.stringify(pack.manifest, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(PACK_DIR, 'prose.json'), JSON.stringify(pack.prose, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(PACK_DIR, 'config.json'), JSON.stringify(pack.config, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(PACK_DIR, 'README.md'), [
    '# 夜织 · 完整成人向内容包',
    '',
    '⚠️ **18+**。本包含露骨内容，请勿提交到公开代码仓库。',
    '',
    '## 装法',
    '',
    '1. 把整个 `content-pack` 文件夹放到以下任一位置：',
    '   - 项目根目录（开发/命令行形态）',
    '   - `%APPDATA%\\ciallo-forge\\content-pack`（桌面版数据目录）',
    '   - 任意位置 + 设置环境变量 `CIALLO_PACK_DIR`',
    '2. 重载：命令行 `node bin/ciallo.js pack on`，或界面「设置 → 内容包 → 启用」',
    '',
    '## 内容',
    '',
    `- heat ${MAX_HEAT + 1}-5 档词库（器官 / 体液 / 动作 / 强度词 / 声线侧写）`,
    '- 完整安全词表',
    '',
    '## 卸载',
    '',
    '`node bin/ciallo.js pack off`，或删掉 content-pack 文件夹。',
    '基础数据（heat 1-3）本身完整可用，卸载后引擎照常工作，只是最大尺度降到「缠绵」。',
    '',
  ].join('\n'), 'utf8');

  // 写降级版基础数据（写到独立目录，不动工作区的 data/）
  fs.mkdirSync(OUT_DATA_DIR, { recursive: true });
  for (const f of files) {
    fs.writeFileSync(path.join(OUT_DATA_DIR, f), JSON.stringify(sanitized[f], null, 2) + '\n', 'utf8');
  }
  fs.writeFileSync(path.join(OUT_DATA_DIR, 'README.md'), [
    '# 开源版基础数据（heat ≤ ' + MAX_HEAT + '）',
    '',
    '这 5 个文件是给公开仓库用的版本：只保留 heat 1-' + MAX_HEAT + ' 档词库。',
    '完整 4-5 档在 `content-pack/`（不入库）。',
    '',
    '## 提交前',
    '',
    '```',
    'xcopy /Y ' + path.relative(io.ROOT, OUT_DATA_DIR) + '\\*.json data\\',
    '```',
    '',
    '覆盖后本地会由 content-pack/ 自动合并回完整版，`node scripts/verify.js` 仍应全绿。',
    '',
  ].join('\n'), 'utf8');

  log('## 3. 写入结果');
  log('');
  log(`- content-pack/：pack.json + prose.json + config.json + README.md`);
  log(`- ${path.relative(io.ROOT, OUT_DATA_DIR)}/：5 个文件已降级到 heat ≤ ${MAX_HEAT}（这是给开源仓库用的版本）`);
  log('');
  log('[OK] 完成。');
  log('');
  log('## 4. 怎么用');
  log('');
  log('本脚本**不改动工作区的 data/**，完整的 heat 4-5 词库仍在 data/ 里，本地开发与自检不受影响。');
  log('提交到公开仓库前，把降级版覆盖过去即可：');
  log('');
  log('```');
  log(`xcopy /Y ${path.relative(io.ROOT, OUT_DATA_DIR)}\\*.json data\\`);
  log('```');
  log('');
  log('覆盖后引擎会自动发现 content-pack/ 并把它合并回来（见 src/util/content-pack.js），');
  log('所以本地再跑 `node scripts/verify.js` 仍应全绿。');
}

// zip 分发
if (ZIP && !DRY) {
  const distDir = path.join(io.ROOT, 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  const zipPath = path.join(distDir, 'CialloForge-ContentPack-1.0.0.zip');
  try {
    fs.rmSync(zipPath, { force: true });
    execFileSync('tar', ['-a', '-c', '-f', zipPath, '-C', io.ROOT, 'content-pack'], { stdio: 'inherit' });
    log('');
    log(`[OK] 分发包：${path.relative(io.ROOT, zipPath)}（${(fs.statSync(zipPath).size / 1024).toFixed(1)} KB）`);
  } catch (err) {
    log('');
    log(`[!] zip 失败（${err.message}）；可手动压缩 content-pack 文件夹。`);
  }
}

io.writeText(path.join(io.OUT_DIR, 'CONTENT-PACK.md'), REPORT.join('\n') + '\n');
