'use strict';

/**
 * 自检 + 运行报告
 * node scripts/verify.js   → 全量体检，写出 out/RUN-REPORT.md
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const io = require('../src/util/io');
const { scrub } = require('../src/util/scrub');
const ds = require('../src/engine/datastore');
const P = require('../src/engine/prompt');
const { Story } = require('../src/engine/story');
const V = require('../src/engine/validate');

const ROOT = path.resolve(__dirname, '..');
const lines = [];
const issues = [];
let checks = 0;
let passed = 0;

function log(s = '') {
  lines.push(s);
  if (!process.env.QUIET) console.log(s);
}

function check(name, fn) {
  checks++;
  try {
    const detail = fn();
    passed++;
    log(`- ✅ ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (err) {
    issues.push(`${name}: ${err.message}`);
    log(`- ❌ ${name} — ${err.message}`);
  }
}

const t0 = Date.now();

log('# 夜织 CialloForge · 运行报告');
log('');
log(`- 生成时间：${new Date().toISOString()}`);
log(`- Node：${process.version}（${process.platform} ${process.arch}）`);
log(`- 项目版本：${require('../package.json').version}`);
log(`- 项目路径：${ROOT}`);
log('');

// ── 1. 数据体检 ──
log('## 1. 数据体检');
const stats = ds.stats();
log('');
log(`| 项 | 值 |`);
log(`| --- | --- |`);
log(`| 角色卡 | ${stats.characters} 张（${stats.minAge}-${stats.maxAge} 岁） |`);
log(`| 场景 | ${stats.scenes} 个 / ${stats.beats} beats |`);
log(`| 绘图标签 | ${stats.tags} 条 |`);
log(`| 声线寄存器 | ${stats.registers.length} 种 |`);
log(`| 散文池 | ${stats.prosePools} 族 / 热度 ${stats.heatTiers} 档 |`);
log(`| 癖好族 | ${stats.kinkCount} 个 |`);
log('');

check('数据文件全部可解析', () => {
  ds.load(true);
  return 'characters / scenes / prose / voice-registers / config';
});

check('结构校验无 error 级问题', () => {
  const errs = ds.structuralIssues().filter((i) => i.level === 'error');
  if (errs.length) throw new Error(errs.map((e) => `[${e.code}]${e.target}`).join(' '));
  const warns = ds.structuralIssues().filter((i) => i.level === 'warn').length;
  return `0 error / ${warns} warn`;
});

const report = V.validateAll();
check('年龄锁校验全部通过', () => {
  if (!report.ok) throw new Error(`${report.failed.length} 项未通过`);
  return `${report.summary.charactersPass}/${report.summary.characters} 卡 · ${report.summary.scenesPass}/${report.summary.scenes} 场景 · 最小年龄 ${report.summary.minAge}`;
});

check('门禁拒绝 17 岁卡', () => {
  const r = V.validateCharacter({ id: 'X', name: 't', age: 17, ageLock: true, appearance: { tags: ['a'] }, body: {}, personality: { core: 'x' }, voice: { register: 'slow-tease' } });
  if (r.ok) throw new Error('17 岁卡被放行');
  return r.errors[0];
});

check('门禁拒绝无年龄卡', () => {
  const r = V.validateCharacter({ id: 'X', name: 't', ageLock: true, appearance: { tags: ['a'] }, body: {}, personality: { core: 'x' }, voice: { register: 'slow-tease' } });
  if (r.ok) throw new Error('无年龄卡被放行');
  return r.errors[0];
});

check('扫描器拒绝幼态词无锚点文本', () => {
  const r = V.scanText('loli, elementary school, flat chest child');
  if (r.ok) throw new Error('未拦下');
  return r.reason;
});

check('扫描器放行「成年 + 幼态造型词」组合', () => {
  const r = V.scanText('18 years old, petite, 娇小, 幼态妆', { hasAgeLock: true });
  if (!r.ok) throw new Error('误拦：' + r.reason);
  return r.level + ' · ' + r.reason;
});

check('引擎对未成年卡抛错', () => {
  try {
    P.compilePrompt({ character: { id: 'X', name: 't', age: 15, ageLock: true, appearance: { tags: [], negative: [], quality: [], loraAnchors: [] }, body: {} }, target: 'sdxl' });
  } catch (e) {
    return e.message.slice(0, 60);
  }
  throw new Error('未抛错');
});

// ── 2. 提示词全矩阵 ──
log('');
log('## 2. 绘图提示词全矩阵');
log('');
const targets = Object.keys(P.TARGETS);
let promptCount = 0;
let promptFail = 0;
const promptErrors = [];

check(`编译 ${ds.characters().length} 卡 × ${ds.scenes().length} 场景 × ${targets.length} 目标`, () => {
  for (const ch of ds.characters()) {
    for (const sc of ds.scenes()) {
      for (const t of targets) {
        promptCount++;
        const p = P.compilePrompt({ character: ch, scene: sc, cast: [ch, ds.characterById(sc.castHint.find((h) => h !== ch.id)) || ch], heat: sc.heatBase, rating: 'explicit', target: t, seed: promptCount });
        const v = V.validatePrompt(p);
        if (!v.ok) {
          promptFail++;
          if (promptErrors.length < 5) promptErrors.push(`${ch.id}/${sc.id}/${t}: ${v.errors.join('；')}`);
        }
        if (t === 'midjourney' && !/--ar \d+:\d+/.test(p.mjCommand || '')) { promptFail++; promptErrors.push(`${ch.id}/${sc.id}/mj 缺 --ar`); }
        if (t === 'comfyui' && !p.workflow) { promptFail++; promptErrors.push(`${ch.id}/${sc.id}/comfy 缺 workflow`); }
        if (t === 'novelai' && !p.nai) { promptFail++; promptErrors.push(`${ch.id}/${sc.id}/nai 缺 payload`); }
      }
    }
  }
  if (promptFail) throw new Error(`${promptFail}/${promptCount} 条不合格：${promptErrors.join(' | ')}`);
  return `${promptCount} 条全部通过校验`;
});

check('提示词 token 量达标（>=25 正向 / >=15 负向）', () => {
  const p = P.compilePrompt({ character: ds.characterById('C02'), scene: ds.sceneById('S02'), heat: 5, rating: 'explicit', target: 'sdxl', seed: 1 });
  if (p.tokenCount.positive < 25) throw new Error('正向 token 偏少：' + p.tokenCount.positive);
  if (p.tokenCount.negative < 15) throw new Error('负向 token 偏少：' + p.tokenCount.negative);
  return `正向 ${p.tokenCount.positive} / 负向 ${p.tokenCount.negative}`;
});

// ── 3. 文本生成全场景 ──
log('');
log('## 3. 全文生成（16 场景 × 5 热度档）');
log('');
const genRows = [];
let residueCount = 0;
let shortCount = 0;

check('16 场景 × 5 热度档全部出稿，无 token 残留', () => {
  for (const sc of ds.scenes()) {
    for (const heat of [1, 2, 3, 4, 5]) {
      const story = new Story({ scene: sc.id, heat, words: 900, pacing: 'balanced', seed: 100 + heat });
      const md = story.markdown();
      const body = md.slice(md.indexOf('## 第一幕'), md.indexOf('## 附录 · 出场角色卡'));
      const meta = story.json();
      const residue = body.match(/[{｛][^{}｛｝]{2,}[}｝]|\{(A|B|who|target|body|prop|line|voice|sensory|garment|reaction|aftermath|intent|mood|kink)\}/g);
      if (residue) { residueCount++; if (issues.length < 8) issues.push(`${sc.id} heat${heat} 残留 ${residue.slice(0, 3).join(',')}`); }
      if (meta.words < 300) shortCount++;
      genRows.push({ scene: sc.id, heat, seed: 100 + heat, words: meta.words, cast: meta.cast.map((c) => c.name).join('×'), residue: residue ? residue.length : 0 });
    }
  }
  if (residueCount) throw new Error(`${residueCount} 篇有 token 残留`);
  if (shortCount) throw new Error(`${shortCount} 篇字数不足 300`);
  const total = genRows.reduce((n, r) => n + r.words, 0);
  return `80 篇 / 合计 ${total} 字 / 平均 ${Math.round(total / genRows.length)} 字`;
});

check('复现性：同 seed 逐字节一致', () => {
  const a = new Story({ scene: 'S06', cast: ['C06'], heat: 5, words: 1200, seed: 'fixed', pacing: 'slow' }).markdown();
  const b = new Story({ scene: 'S06', cast: ['C06'], heat: 5, words: 1200, seed: 'fixed', pacing: 'slow' }).markdown();
  if (a !== b) throw new Error('两次输出不一致');
  return `${a.length} 字符逐字节相同`;
});

check('热度分级生效：低热不漏词 / 高热按可用档位命中直白词', () => {
  const prose = ds.prose();
  const explicitAvailable = (prose.fluid || []).length > 0
    && (prose.bodyPart || []).some((x) => (x.min || 1) >= 4);

  // 低热：多 seed 扫描，一个词都不许漏
  const leakedAll = [];
  for (const seed of [21, 22, 23, 24]) {
    const low = new Story({ scene: 'S16', cast: ['C02'], heat: 2, words: 900, seed, pacing: 'balanced' }).markdown();
    const lowBody = low.slice(low.indexOf('## 第一幕'), low.indexOf('## 附录'));
    for (const w of ['穴口', '乳尖', '甬道深处', '抽送', '臀肉']) if (lowBody.includes(w)) leakedAll.push(`seed${seed}:${w}`);
  }
  if (leakedAll.length) throw new Error('低热漏词：' + leakedAll.join('、'));

  if (!explicitAvailable) {
    const maxHeat = Math.max(...Object.keys(prose.heat || { 1: 1 }).map(Number).filter(Number.isFinite));
    return `低热 0 漏词 · 未加载内容包（最高 heat ${maxHeat}，无 4-5 档词库）→ 高热扫描按设计跳过`;
  }

  // 高热：多场景多 seed 扫描，至少命中 3 个直白词（单场景单 seed 抽到空属正常）
  const hit = new Set();
  const HIGH_SCENES = ['S02', 'S05', 'S06', 'S09', 'S11', 'S14'];
  for (const sc of HIGH_SCENES) {
    for (const seed of [21, 22, 23]) {
      const high = new Story({ scene: sc, heat: 5, words: 900, seed, pacing: 'balanced' }).markdown();
      const highBody = high.slice(high.indexOf('## 第一幕'), high.indexOf('## 附录'));
      for (const w of ['穴口', '乳尖', '甬道深处', '臀肉', '腿根', '抽送', '花心', '湿意']) if (highBody.includes(w)) hit.add(w);
    }
  }
  if (hit.size < 3) throw new Error(`高热直白词覆盖不足：${[...hit].join('、') || '0 个'}`);
  return `低热 0 漏词 · 高热命中 ${[...hit].join('、')}`;
});

check('节奏档位生效：pwp < fast < balanced < slow', () => {
  const mk = (pacing) => new Story({ scene: 'S02', cast: ['C02'], heat: 5, words: 1000, seed: 31, pacing }).json().words;
  const [pwp, fast, bal, slow] = ['pwp', 'fast', 'balanced', 'slow'].map(mk);
  if (!(pwp <= fast && fast <= bal && bal <= slow)) throw new Error(`pwp=${pwp} fast=${fast} bal=${bal} slow=${slow}`);
  return `${pwp} ≤ ${fast} ≤ ${bal} ≤ ${slow}`;
});

check('声线寄存器生效：同一句种子在不同角色口中不同', () => {
  const { renderLine } = require('../src/engine/voice');
  const { Rng } = require('../src/util/rng');
  const seedLine = '你要是疼就说，别忍着';
  const out = ds.characters().map((c) => {
    const reg = ds.registerByName(c.voice.register);
    return renderLine(seedLine, { ...c.voice, tic: c.voice.tic }, new Rng(`v:${c.id}`)) + ' [' + reg.label + ']';
  });
  const uniq = new Set(out);
  if (uniq.size < 6) throw new Error(`去重后仅 ${uniq.size} 种写法`);
  return `${uniq.size}/10 种不同改写`;
});

// ── 3b. 代词与质量指标 ──
log('');
log('## 3b. 代词治理与文本质量');
log('');

check('数据层：beat.text 与散文池无裸性别代词', () => {
  let bad = [];
  for (const s of ds.scenes()) {
    for (const a of s.acts) {
      for (const b of a.beats) {
        if (b.text && /[他她]/.test(b.text)) bad.push(`${s.id}/${a.name}`);
      }
    }
  }
  for (const [k, arr] of Object.entries(ds.prose().pool)) {
    for (const line of arr) if (/[他她]/.test(String(line))) bad.push(`pool.${k}`);
  }
  if (bad.length) throw new Error('裸代词：' + [...new Set(bad)].join(', '));
  return '全部令牌化为 {pronA}/{pronB}/{A}/{B}';
});

check('输出层：抽样段不泄漏裸代词（4 组混合卡司 × 4 seed）', () => {
  const poolStrings = new Set();
  for (const arr of Object.values(ds.prose().pool)) for (const x of arr) poolStrings.add(String(x));
  const leaked = [];
  for (const [sc, cast] of [['S09', ['C09', 'C08']], ['S14', ['C09', 'C08']], ['S01', ['C01', 'C08']], ['S02', ['C02', 'C09']]]) {
    for (const seed of [5, 6, 7, 8]) {
      const story = new Story({ scene: sc, cast, heat: 4, words: 900, seed, pacing: 'balanced' });
      for (const sec of story.json().sections) {
        for (const para of sec.paras) {
          if (!/[他她]/.test(para)) continue;
          const fromPool = [...poolStrings].some((tpl) => {
            const parts = tpl.split(/\{[^}]*\}/).filter((x) => x.length >= 6);
            return parts.length > 0 && parts.every((x) => para.includes(x));
          });
          if (fromPool) leaked.push(`${sc}/seed${seed}: ${para.slice(0, 30)}`);
        }
      }
    }
  }
  if (leaked.length) throw new Error(leaked.slice(0, 3).join(' | '));
  return 'pool 抽样段 0 泄漏（作者手写模板的代词按设定保留）';
});

check('文本质量：重复段 0 / 短残句 0', () => {
  let dup = 0;
  let short = 0;
  let paras = 0;
  for (const sc of ds.scenes()) {
    const meta = new Story({ scene: sc.id, heat: 4, words: 1200, seed: 4242, pacing: 'balanced' }).json();
    dup += meta.duplicateParagraphs;
    short += meta.shortParagraphs;
    paras += meta.paragraphs;
  }
  if (dup) throw new Error(`${dup} 段重复`);
  if (short) throw new Error(`${short} 段短残句`);
  return `16 篇 / ${paras} 段，重复 0、短残句 0`;
});

// ── 4. CLI 端到端 ──
log('');
log('## 4. CLI 端到端');
log('');
const cliCases = [
  { name: 'validate --gate', args: ['validate', '--gate'], expect: 0 },
  { name: 'stats', args: ['stats'], expect: 0 },
  { name: 'chars', args: ['chars'], expect: 0 },
  { name: 'unknown → 2', args: ['nope'], expect: 2 },
];
for (const ccase of cliCases) {
  check(`CLI ${ccase.name} 退出码 ${ccase.expect}`, () => {
    const r = spawn(ccase.args);
    if (r.status !== ccase.expect) throw new Error(`实际 ${r.status}`);
    return `exit=${r.status}`;
  });
}

function spawn(args) {
  const logFile = path.join(io.OUT_DIR, '.verify-cli.log');
  io.ensureDir(io.OUT_DIR);
  const fd = fs.openSync(logFile, 'a');
  try {
    const r = require('child_process').spawnSync(process.execPath, [path.join(ROOT, 'bin', 'ciallo.js'), ...args], {
      cwd: ROOT, stdio: ['ignore', fd, fd], env: { ...process.env, NO_COLOR: '1' },
    });
    return { status: r.status, out: fs.readFileSync(logFile, 'utf8') };
  } finally {
    fs.closeSync(fd);
  }
}

// ── 5. 导出与产物 ──
log('');
log('## 5. 产物');
log('');
const exportDir = path.join(io.OUT_DIR, 'export');
const r = spawn(['export', '--out', exportDir]);
check('export 导出包生成', () => {
  if (r.status !== 0) throw new Error('exit=' + r.status);
  const need = ['characters.json', 'prompts.json', 'prompts.csv', 'prompts.md', 'INDEX.md'];
  const missing = need.filter((f) => !fs.existsSync(path.join(exportDir, f)));
  if (missing.length) throw new Error('缺 ' + missing.join(','));
  const stories = fs.readdirSync(path.join(exportDir, 'stories')).filter((f) => f.endsWith('.md'));
  const prompts = JSON.parse(fs.readFileSync(path.join(exportDir, 'prompts.json'), 'utf8'));
  const chars = JSON.parse(fs.readFileSync(path.join(exportDir, 'characters.json'), 'utf8'));
  return `${chars.characters.length} 卡 / ${prompts.count} 提示词 / ${stories.length} 篇故事`;
});

const files = [];
function walk(dir, base = dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, base);
    else files.push({ rel: path.relative(base, p), size: st.size });
  }
}
walk(ROOT);
const totalBytes = files.reduce((n, f) => n + f.size, 0);
const byExt = {};
for (const f of files) {
  const e = (path.extname(f.rel) || '(none)').toLowerCase();
  byExt[e] = byExt[e] || { n: 0, bytes: 0 };
  byExt[e].n++;
  byExt[e].bytes += f.size;
}
log('### 项目文件清单');
log('');
log('| 类型 | 文件数 | 体积 |');
log('| --- | --- | --- |');
for (const [e, v] of Object.entries(byExt).sort((a, b) => b[1].bytes - a[1].bytes)) {
  log(`| ${e} | ${v.n} | ${(v.bytes / 1024).toFixed(1)} KB |`);
}
log(`| **合计** | **${files.length}** | **${(totalBytes / 1024).toFixed(1)} KB** |`);
log('');

// ── 6. 结论 ──
const secs = ((Date.now() - t0) / 1000).toFixed(2);
log('## 6. 结论');
log('');
log(`- 自检项：**${passed}/${checks} 通过**`);
log(`- 提示词：**${promptCount} 条已编译并校验**`);
log(`- 文本：**${genRows.length} 篇已生成**，token 残留 ${residueCount} 处`);
log(`- 耗时：${secs}s`);
if (issues.length) {
  log('');
  log('### 待办');
  log('');
  for (const i of issues) log(`- ${i}`);
} else {
  log('');
  log('无遗留问题。');
}
log('');

const reportPath = path.join(io.OUT_DIR, 'RUN-REPORT.md');
io.writeText(reportPath, scrub(lines.join('\n')));

// 附：生成样本表
const sample = genRows.slice(0, 20);
io.writeJSON(path.join(io.OUT_DIR, 'verify-matrix.json'), { generatedAt: new Date().toISOString(), checks, passed, promptCount, genRows: genRows.slice(0, 80), sample });

console.log('');
console.log(`[OK] ${passed}/${checks} 自检通过 · 报告 → ${reportPath}`);
if (issues.length) {
  console.log('[!] 遗留：');
  for (const i of issues.slice(0, 10)) console.log('  - ' + i);
}
process.exitCode = issues.length || passed < checks ? 1 : 0;
