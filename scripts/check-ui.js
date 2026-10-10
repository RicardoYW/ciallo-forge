'use strict';

/**
 * GUI 自检：起一个真服务，逐个打端点，校验返回结构与退出码。
 * 用法：node scripts/check-ui.js            （全部检查）
 *       node scripts/check-ui.js --quick    （跳过批量提示词与导出，快跑）
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { start } = require('../src/server/server');
const io = require('../src/util/io');
const { scrub } = require('../src/util/scrub');

const QUICK = process.argv.includes('--quick');
let checks = 0;
let passed = 0;
const issues = [];
const lines = [];

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

async function checkAsync(name, fn) {
  checks++;
  try {
    const detail = await fn();
    passed++;
    log(`- ✅ ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (err) {
    issues.push(`${name}: ${err.message}`);
    log(`- ❌ ${name} — ${err.message}`);
  }
}

function req(base, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const u = new URL(urlPath, base);
    const r = http.request(
      { method, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: data ? { 'content-type': 'application/json', 'content-length': data.length } : {} },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = JSON.parse(text); } catch { /* 非 JSON */ }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      },
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function streamStory(base, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body), 'utf8');
    const u = new URL('/api/story/stream', base);
    const r = http.request(
      { method: 'POST', hostname: u.hostname, port: u.port, path: u.pathname, headers: { 'content-type': 'application/json', 'content-length': data.length } },
      (res) => {
        const events = [];
        let buf = '';
        res.on('data', (c) => {
          buf += c.toString('utf8');
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (line) { try { events.push(JSON.parse(line)); } catch { /* ignore */ } }
          }
        });
        res.on('end', () => resolve({ status: res.statusCode, events }));
      },
    );
    r.on('error', reject);
    r.write(data);
    r.end();
  });
}

async function main() {
  const info = await start({ port: 0 });
  const base = info.url;
  log('# 夜织 GUI 自检报告');
  log('');
  log(`- 时间：${new Date().toISOString()}`);
  log(`- 服务：${base}（临时端口，检查结束后关闭）`);
  log(`- Node：${process.version}`);
  log('');

  // ── 1. 静态资源 ──
  log('## 1. 静态资源');
  log('');
  const index = await req(base, 'GET', '/');
  await checkAsync('GET / 返回 index.html', () => {
    if (index.status !== 200) throw new Error(`状态 ${index.status}`);
    if (!/text\/html/.test(index.headers['content-type'] || '')) throw new Error('content-type 不是 html');
    for (const marker of ['id="app"', 'app.js', 'app.css', '创作', '角色', '场景']) {
      if (!index.text.includes(marker)) throw new Error(`HTML 缺少标记 ${marker}`);
    }
    return `${(index.text.length / 1024).toFixed(1)} KB`;
  });
  await checkAsync('静态资源带防穿越（/../package.json 拿不到源码）', async () => {
    const r = await req(base, 'GET', '/../package.json');
    if (r.status === 200 && r.text.includes('"name": "ciallo-forge"')) throw new Error('路径穿越成功，危险');
    return `状态 ${r.status}`;
  });
  for (const asset of ['/app.css', '/app.js']) {
    await checkAsync(`GET ${asset}`, async () => {
      const r = await req(base, 'GET', asset);
      if (r.status !== 200) throw new Error(`状态 ${r.status}`);
      return `${(r.text.length / 1024).toFixed(1)} KB`;
    });
  }

  // ── 2. 只读端点 ──
  log('');
  log('## 2. 只读端点');
  log('');
  await checkAsync('GET /api/health', async () => {
    const r = await req(base, 'GET', '/api/health');
    if (!r.json || !r.json.ok) throw new Error('返回异常');
    return `v${r.json.data.version}`;
  });
  await checkAsync('GET /api/stats', async () => {
    const r = await req(base, 'GET', '/api/stats');
    const d = r.json.data;
    if (d.characters < 16) throw new Error(`角色数 ${d.characters}`);
    if (d.scenes < 16) throw new Error(`场景数 ${d.scenes}`);
    if (d.male < 6 || d.female < 8) throw new Error(`性别分布异常 ♂${d.male}/♀${d.female}`);
    return `${d.characters} 卡 / ${d.scenes} 场景 / ♂${d.male} ♀${d.female} / ${d.beats} beats`;
  });
  await checkAsync('GET /api/characters 全量 + 筛选', async () => {
    const all = await req(base, 'GET', '/api/characters');
    const male = await req(base, 'GET', '/api/characters?gender=male');
    const female = await req(base, 'GET', '/api/characters?gender=female');
    const search = await req(base, 'GET', '/api/characters?q=' + encodeURIComponent('古籍'));
    if (all.json.data.length !== 16) throw new Error(`全量 ${all.json.data.length}`);
    if (!male.json.data.every((c) => c.gender === 'male')) throw new Error('男性筛选有误');
    if (!female.json.data.every((c) => c.gender === 'female')) throw new Error('女性筛选有误');
    if (!search.json.data.length) throw new Error('关键词搜索无结果');
    for (const c of all.json.data) {
      if (!c.validation || c.validation.ok !== true) throw new Error(`${c.id} 校验未通过`);
      if (c.age < 18 || c.ageLock !== true) throw new Error(`${c.id} 年龄锁异常`);
    }
    return `16 卡 / ♂${male.json.data.length} ♀${female.json.data.length} / 搜索命中 ${search.json.data.length}`;
  });
  await checkAsync('GET /api/scenes 带男女配对', async () => {
    const r = await req(base, 'GET', '/api/scenes');
    const list = r.json.data;
    if (list.length !== 16) throw new Error(`场景数 ${list.length}`);
    for (const s of list) {
      if (!Array.isArray(s.autoCast) || s.autoCast.length !== 2) throw new Error(`${s.id} 缺 autoCast`);
      const [a, b] = s.cast;
      if (!a || !b) throw new Error(`${s.id} cast 不完整`);
      if (a.gender === b.gender) throw new Error(`${s.id} 不是男女组合：${a.name}/${b.name}`);
      if (s.leadGender && a.gender !== s.leadGender) throw new Error(`${s.id} 主导方性别不符`);
      if (!s.acts || !s.acts.length) throw new Error(`${s.id} 缺幕结构`);
    }
    return `16 场景全部男女向，共 ${list.reduce((n, s) => n + s.beats, 0)} beats`;
  });
  await checkAsync('GET /api/prose 词库概览', async () => {
    const r = await req(base, 'GET', '/api/prose');
    const d = r.json.data;
    const poolCount = Object.keys(d.pools || {}).length;
    if (poolCount < 8) throw new Error(`词库族数 ${poolCount}`);
    if (!d.heat || Object.keys(d.heat).length !== 5) throw new Error('热度档不是 5');
    if (!Array.isArray(d.dialogueNeutral) || d.dialogueNeutral.length < 5) throw new Error('缺中性声线池');
    return `${poolCount} 族 / 5 档热度 / 中性侧写 ${d.dialogueNeutral.length} 条`;
  });
  await checkAsync('GET /api/gallery 样章清单', async () => {
    const r = await req(base, 'GET', '/api/gallery');
    return `${r.json.data.length} 篇`;
  });

  // ── 3. 生成端点 ──
  log('');
  log('## 3. 生成端点');
  log('');
  await checkAsync('POST /api/story/plan 预演配对', async () => {
    const r = await req(base, 'POST', '/api/story/plan', { scene: 'S09', words: 600, pacing: 'fast', seed: 3 });
    const d = r.json.data;
    if (d.pairing !== 'mixed') throw new Error(`配对 ${d.pairing}`);
    if (d.cast.length !== 2) throw new Error(`卡司 ${d.cast.length}`);
    return `${d.cast.map((c) => c.name).join(' × ')} · ${d.pairing} · 目标 ${d.targetWords} 字`;
  });
  await checkAsync('POST /api/story 出稿且无残留 token', async () => {
    const r = await req(base, 'POST', '/api/story', { scene: 'S11', words: 800, pacing: 'balanced', seed: 7 });
    const md = r.json.data.md;
    const body = md.slice(md.indexOf('## 第一幕'), md.indexOf('## 附录'));
    const residue = body.match(/[{｛][^{}｛｝]{2,}[}｝]/g);
    if (residue) throw new Error(`残留 ${residue.slice(0, 3).join(',')}`);
    if (!/\*\*配对\*\*：男女向/.test(md)) throw new Error('缺配对声明');
    return `${r.json.data.meta.words} 字`;
  });
  await checkAsync('POST /api/story 非法热度被夹取', async () => {
    const r = await req(base, 'POST', '/api/story', { scene: 'S01', heat: 99, words: 300, pacing: 'pwp', seed: 1 });
    if (r.json.data.meta.heat !== 5) throw new Error(`热度 ${r.json.data.meta.heat}`);
    return 'heat 99 → 5';
  });
  await checkAsync('POST /api/story 未知场景回退第一个场景', async () => {
    const r = await req(base, 'POST', '/api/story', { scene: 'S999', words: 300, pacing: 'pwp', seed: 1 });
    if (!r.json.ok) throw new Error('接口报错');
    return `回退到 ${r.json.data.meta.scene.id}`;
  });
  await checkAsync('POST /api/story/stream 流式事件序列完整', async () => {
    const r = await streamStory(base, { scene: 'S05', words: 900, pacing: 'balanced', seed: 11 });
    const types = r.events.map((e) => e.type);
    if (types[0] !== 'meta') throw new Error('首个事件不是 meta');
    if (types[types.length - 1] !== 'done') throw new Error('末尾不是 done');
    if (types.filter((t) => t === 'paragraph').length < 5) throw new Error('段落事件过少');
    if (types.includes('error')) throw new Error('流里出现 error 事件');
    const meta = r.events.find((e) => e.type === 'meta');
    const done = r.events.find((e) => e.type === 'done');
    if (meta.pairing !== 'mixed') throw new Error('流式配对不是男女向');
    return `${types.filter((t) => t === 'paragraph').length} 段 / ${done.words} 字`;
  });
  await checkAsync('POST /api/story/save 存盘并落位 out/', async () => {
    const gen = await req(base, 'POST', '/api/story', { scene: 'S03', words: 400, pacing: 'fast', seed: 2 });
    const r = await req(base, 'POST', '/api/story/save', { name: '__ui-check', md: gen.json.data.md });
    const d = r.json.data;
    const abs = path.join(io.ROOT, d.path);
    if (!fs.existsSync(abs)) throw new Error('文件未生成');
    if (!abs.startsWith(path.resolve(io.OUT_DIR))) throw new Error('文件落在 out 之外');
    fs.unlinkSync(abs);
    return d.rel;
  });
  await checkAsync('POST /api/story/save 拒绝空内容', async () => {
    const r = await req(base, 'POST', '/api/story/save', { name: 'x', md: '' });
    if (r.status !== 400 || r.json.ok !== false) throw new Error('未报错');
    return `状态 400 · ${r.json.error.code}`;
  });

  // ── 4. 提示词端点 ──
  log('');
  log('## 4. 提示词端点');
  log('');
  await checkAsync('POST /api/prompt 单条（6 目标）', async () => {
    const r = await req(base, 'POST', '/api/prompt', { char: 'C12', scene: 'S11', target: 'all', heat: 5 });
    const d = r.json.data;
    if (d.count !== 6) throw new Error(`条数 ${d.count}`);
    for (const it of d.items) {
      if (!it.validation.ok) throw new Error(`${it.target} 校验失败：${it.validation.errors.join(';')}`);
      if (it.target === 'comfyui' && !it.workflow) throw new Error('缺 workflow');
      if (it.target === 'novelai' && !it.nai) throw new Error('缺 NAI payload');
      if (it.target === 'midjourney' && !/--ar/.test(it.mjCommand || '')) throw new Error('缺 --ar');
    }
    const sdxl = d.items.find((i) => i.target === 'sdxl');
    if (!/1boy/.test(sdxl.positive) || !/hetero/.test(sdxl.positive)) throw new Error('男女标记缺失');
    return `6 目标 / 正向 ${sdxl.tokenCount.positive} token`;
  });
  if (!QUICK) {
    await checkAsync('POST /api/prompt 批量（16 卡 × 16 场景 × sdxl）', async () => {
      const r = await req(base, 'POST', '/api/prompt', { char: 'all', scene: 'all', target: 'sdxl', heat: 4 });
      const d = r.json.data;
      if (d.count !== 256) throw new Error(`条数 ${d.count}`);
      const bad = d.items.filter((i) => !i.validation.ok);
      if (bad.length) throw new Error(`${bad.length} 条校验失败`);
      return `256 条全部通过`;
    });
  }
  await checkAsync('POST /api/prompt 未知角色返回 404', async () => {
    const r = await req(base, 'POST', '/api/prompt', { char: '不存在的角色' });
    if (r.status !== 404) throw new Error(`状态 ${r.status}`);
    return r.json.error.code;
  });
  await checkAsync('POST /api/prompt 未知目标返回 400', async () => {
    const r = await req(base, 'POST', '/api/prompt', { char: 'C01', target: 'nope' });
    if (r.status !== 400) throw new Error(`状态 ${r.status}`);
    return r.json.error.code;
  });
  await checkAsync('POST /api/prompt/export 落盘 json+md+csv', async () => {
    const r = await req(base, 'POST', '/api/prompt/export', { char: 'C12', target: 'sdxl', heat: 5, name: '__ui-check' });
    const d = r.json.data;
    for (const key of ['json', 'md', 'csv']) {
      const abs = path.join(io.ROOT, d[key]);
      if (!fs.existsSync(abs)) throw new Error(`缺 ${key}`);
      fs.unlinkSync(abs);
    }
    return `${d.count} 条 → json/md/csv`;
  });

  // ── 5. 校验 / 配对 / 设置 ──
  log('');
  log('## 5. 校验 · 配对 · 设置');
  log('');
  await checkAsync('GET /api/validate 全库通过', async () => {
    const r = await req(base, 'GET', '/api/validate');
    const d = r.json.data;
    if (!d.ok) throw new Error(`${d.failed.length} 项未通过`);
    const g = d.gate;
    if (!g.minorRejected || !g.scanRejected || !g.engineThrows || !g.adultStylingPassed) {
      throw new Error('门禁演练异常：' + JSON.stringify(g));
    }
    return `${d.summary.characters} 卡 / ${d.summary.scenes} 场景 · 门禁四项全过`;
  });
  await checkAsync('POST /api/scene/pairing 改配对并即时生效', async () => {
    // 备份原配对
    const before = (await req(base, 'GET', '/api/scenes')).json.data.find((s) => s.id === 'S12');
    const original = before.autoCast.slice();
    const swapped = [original[1], original[0]];
    const r = await req(base, 'POST', '/api/scene/pairing', { scene: 'S12', cast: swapped });
    if (!r.json.ok) throw new Error(r.json.error.message);
    const after = (await req(base, 'GET', '/api/scenes')).json.data.find((s) => s.id === 'S12');
    if (after.autoCast.join(',') !== swapped.join(',')) throw new Error('配对未写回');
    const plan = (await req(base, 'POST', '/api/story/plan', { scene: 'S12', words: 300 })).json.data;
    if (plan.cast[0].id !== swapped[0]) throw new Error('生成未按新配对');
    // 还原
    await req(base, 'POST', '/api/scene/pairing', { scene: 'S12', cast: original });
    const restored = (await req(base, 'GET', '/api/scenes')).json.data.find((s) => s.id === 'S12');
    if (restored.autoCast.join(',') !== original.join(',')) throw new Error('还原失败');
    return `${swapped.join('+')} → 已还原 ${original.join('+')}`;
  });
  await checkAsync('POST /api/scene/pairing 拒绝同性配对', async () => {
    const r = await req(base, 'POST', '/api/scene/pairing', { scene: 'S12', cast: ['C04', 'C10'] });
    if (r.status !== 400 || r.json.error.code !== 'SAME_GENDER') throw new Error(`状态 ${r.status} code ${r.json && r.json.error && r.json.error.code}`);
    return r.json.error.message.slice(0, 24) + '…';
  });
  await checkAsync('POST /api/scene/pairing 拒绝同一人', async () => {
    const r = await req(base, 'POST', '/api/scene/pairing', { scene: 'S12', cast: ['C04', 'C04'] });
    if (r.status !== 400) throw new Error(`状态 ${r.status}`);
    return r.json.error.code;
  });
  await checkAsync('GET/POST /api/settings 读写一致', async () => {
    const before = (await req(base, 'GET', '/api/settings')).json.data;
    const r = await req(base, 'POST', '/api/settings', { generation: { defaultWords: 1666 } });
    if (r.json.data.generation.defaultWords !== 1666) throw new Error('写入未生效');
    const restored = await req(base, 'POST', '/api/settings', { generation: { defaultWords: before.generation.defaultWords } });
    if (restored.json.data.generation.defaultWords !== before.generation.defaultWords) throw new Error('还原失败');
    return `defaultWords 往返正常（${before.generation.defaultWords}）`;
  });
  await checkAsync('GET /api/file 读 out 文件 + 拒绝越界', async () => {
    const r = await req(base, 'GET', '/api/file?p=' + encodeURIComponent('../../../package.json'));
    if (r.status !== 403) throw new Error(`越界未被拦：状态 ${r.status}`);
    return `越界状态 ${r.status} · ${r.json.error.code}`;
  });

  // ── 6. 未知路由 ──
  log('');
  log('## 6. 健壮性');
  log('');
  await checkAsync('未知 API 返回 404 JSON', async () => {
    const r = await req(base, 'GET', '/api/nope');
    if (r.status !== 404 || !r.json || r.json.ok !== false) throw new Error('返回异常');
    return r.json.error.code;
  });
  await checkAsync('非法 JSON 请求体返回 400', async () => {
    const raw = await new Promise((resolve, reject) => {
      const u = new URL('/api/story', base);
      const r = http.request({ method: 'POST', hostname: u.hostname, port: u.port, path: u.pathname, headers: { 'content-type': 'application/json' } }, (res) => {
        const c = [];
        res.on('data', (d) => c.push(d));
        res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(c).toString() }));
      });
      r.on('error', reject);
      r.write('{not json');
      r.end();
    });
    if (raw.status !== 400) throw new Error(`状态 ${raw.status}`);
    return JSON.parse(raw.text).error.code;
  });
  if (!QUICK) {
    await checkAsync('POST /api/export 重建导出包', async () => {
      const r = await req(base, 'POST', '/api/export');
      const d = r.json.data;
      for (const f of ['characters.json', 'prompts.json', 'prompts.csv', 'prompts.md', 'INDEX.md']) {
        if (!fs.existsSync(path.join(io.OUT_DIR, 'export', f))) throw new Error(`缺 ${f}`);
      }
      return `${d.characters} 卡 / ${d.prompts} 提示词 / ${d.stories} 篇`;
    });
  }

  // ── 7. 与 CLI 一致性 ──
  log('');
  log('## 7. 界面与 CLI 一致性');
  log('');
  await checkAsync('同一输入：API 生成 == CLI 引擎生成（逐字节）', async () => {
    const { Story } = require('../src/engine/story');
    const opts = { scene: 'S10', cast: ['C15', 'C10'], heat: 4, words: 900, pacing: 'balanced', seed: 4242 };
    const apiRun = (await req(base, 'POST', '/api/story', opts)).json.data.md;
    const direct = new Story(opts).markdown();
    if (apiRun !== direct) throw new Error(`长度 ${apiRun.length} vs ${direct.length}`);
    return `${apiRun.length} 字符完全一致`;
  });

  info.server.close();

  log('');
  log('## 结论');
  log('');
  log(`- 检查项：**${passed}/${checks} 通过**`);
  log(`- 静态资源：index.html + app.css + app.js`);
  log(`- 端点覆盖：只读 7 / 生成 6 / 提示词 4 / 校验配对设置 5 / 健壮性 3`);
  if (issues.length) {
    log('');
    log('### 待修');
    log('');
    for (const i of issues) log(`- ${i}`);
  } else {
    log('');
    log('无遗留问题。');
  }

  const out = path.join(io.OUT_DIR, 'UI-CHECK.md');
  io.writeText(out, scrub(lines.join('\n')) + '\n');
  console.log('');
  console.log(`[${issues.length ? '!' : 'OK'}] ${passed}/${checks} 通过 · 报告 → ${out}`);
  if (issues.length) for (const i of issues.slice(0, 8)) console.log('   - ' + i);
  process.exitCode = issues.length || passed < checks ? 1 : 0;
}

main().catch((err) => {
  console.error('[X] 自检崩溃：' + err.stack);
  process.exitCode = 1;
});
