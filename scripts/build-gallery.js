'use strict';

/**
 * 生成成果画廊：out/showcase.html
 * 每个场景出一篇样章，渲染成单文件 HTML（无外部资源），双击即开。
 * 用法：node scripts/build-gallery.js
 */

const fs = require('fs');
const path = require('path');
const ds = require('../src/engine/datastore');
const { Story } = require('../src/engine/story');
const io = require('../src/util/io');

/** 每场景显式指定卡司与参数：统一男女双人组合（A 为主导方），避免单人跑出「A 把 A 翻过去」 */
const PICK = {
  S01: { cast: ['C11', 'C08'], heat: 4, words: 1800, pacing: 'balanced', seed: 101 },
  S02: { cast: ['C02', 'C12'], heat: 5, words: 2000, pacing: 'slow', seed: 102 },
  S03: { cast: ['C14', 'C03'], heat: 4, words: 1700, pacing: 'fast', seed: 103 },
  S04: { cast: ['C15', 'C04'], heat: 4, words: 1900, pacing: 'slow', seed: 104 },
  S05: { cast: ['C13', 'C05'], heat: 4, words: 1800, pacing: 'balanced', seed: 105 },
  S06: { cast: ['C12', 'C06'], heat: 5, words: 2000, pacing: 'slow', seed: 106 },
  S07: { cast: ['C16', 'C07'], heat: 3, words: 2000, pacing: 'slow', seed: 107 },
  S08: { cast: ['C11', 'C08'], heat: 3, words: 1700, pacing: 'balanced', seed: 108 },
  S09: { cast: ['C09', 'C07'], heat: 4, words: 1800, pacing: 'balanced', seed: 109 },
  S10: { cast: ['C15', 'C10'], heat: 4, words: 1900, pacing: 'slow', seed: 110 },
  S11: { cast: ['C12', 'C02'], heat: 5, words: 1800, pacing: 'fast', seed: 111 },
  S12: { cast: ['C15', 'C04'], heat: 4, words: 1900, pacing: 'balanced', seed: 112 },
  S13: { cast: ['C11', 'C07'], heat: 3, words: 1700, pacing: 'slow', seed: 113 },
  S14: { cast: ['C16', 'C08'], heat: 3, words: 1700, pacing: 'balanced', seed: 114 },
  S15: { cast: ['C14', 'C03'], heat: 3, words: 1600, pacing: 'balanced', seed: 115 },
  S16: { cast: ['C12', 'C02'], heat: 2, words: 1600, pacing: 'slow', seed: 116 },
};

// 启动前自检：卡司必须存在、互不相同、且为男女组合
for (const [id, cfg] of Object.entries(PICK)) {
  const scene = ds.sceneById(id);
  if (!scene) throw new Error(`PICK 里的场景 ${id} 不存在`);
  if (cfg.cast.length < 2) throw new Error(`${id} 需要两个角色（单人场景会让 {A}/{B} 指向同一人）`);
  const uniq = new Set(cfg.cast);
  if (uniq.size !== cfg.cast.length) throw new Error(`${id} 卡司重复：${cfg.cast.join(',')}`);
  const [a, b] = cfg.cast.map((cid) => ds.characterById(cid));
  for (const c of [a, b]) if (!c) throw new Error(`${id} 卡司不存在：${cfg.cast.join(',')}`);
  if ((a.gender || 'female') === (b.gender || 'female')) {
    throw new Error(`${id} 不是男女组合：${a.name}(${a.gender}) × ${b.name}(${b.gender})`);
  }
  if (scene.leadGender && (a.gender || 'female') !== scene.leadGender) {
    throw new Error(`${id} 主导方性别与场景 leadGender 不符：${a.name}(${a.gender}) vs ${scene.leadGender}`);
  }
}

const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

function bodyOf(md) {
  const a = md.indexOf('## 第一幕');
  const b = md.indexOf('## 附录 · 出场角色卡');
  const start = a >= 0 ? a : md.indexOf('---');
  return md.slice(start, b > 0 ? b : undefined).trim();
}

function promptOf(md) {
  const i = md.indexOf('## 附录 · 配图提示词');
  return i >= 0 ? md.slice(i).trim() : '';
}

const storiesDir = path.join(io.OUT_DIR, 'gallery');
io.ensureDir(storiesDir);

const cards = [];
let totalWords = 0;

for (const scene of ds.scenes()) {
  const cfg = PICK[scene.id] || { cast: scene.castHint, heat: scene.heatBase, words: 1500, pacing: 'balanced', seed: 1 };
  const story = new Story({
    scene: scene.id,
    cast: cfg.cast,
    // 单人场景不自动补搭子：{B} 落回主角自己，正文变成第一人称感独白
    autoPartner: cfg.cast.length > 1,
    heat: cfg.heat,
    words: cfg.words,
    pacing: cfg.pacing,
    seed: cfg.seed,
  });
  const md = story.markdown();
  const meta = story.json();

  const file = `${scene.id}-${scene.title}.md`;
  let content = md;
  if (!content.includes('## 附录 · 配图提示词')) {
    const { compilePrompt } = require('../src/engine/prompt');
    const p = compilePrompt({ character: ds.characterById(scene.castHint[0]), scene, heat: cfg.heat, rating: cfg.heat >= 4 ? 'explicit' : 'nsfw', target: 'sdxl', seed: cfg.seed });
    content += `\n\n## 附录 · 配图提示词\n\n**正向**\n\`\`\`\n${p.positive}\n\`\`\`\n**负向**\n\`\`\`\n${p.negative}\n\`\`\`\n`;
  }
  io.writeText(path.join(storiesDir, file), content);

  const body = bodyOf(md);
  const paras = body.split('\n').filter((l) => l.trim() && !l.startsWith('##'));
  const preview = paras.slice(0, 5);
  totalWords += meta.words;

  cards.push({
    id: scene.id,
    title: scene.title,
    kinkFamily: scene.kinkFamily,
    location: scene.location,
    mood: (scene.mood || []).join('、'),
    note: meta.kinkNote,
    heat: cfg.heat,
    pacing: meta.pacing.label,
    words: meta.words,
    paragraphs: meta.paragraphs,
    cast: meta.cast,
    pairing: meta.pairing,
    seed: cfg.seed,
    preview,
    extra: paras.length - preview.length,
    file: `gallery/${encodeURIComponent(file)}`,
    prompt: promptOf(md),
  });

  console.log(`  ✔ ${scene.id} ${scene.title} · ${meta.words} 字 · ${meta.cast.map((c) => c.name).join('×')}`);
}

const heatLabel = { 1: '克制', 2: '暧昧', 3: '缠绵', 4: '直白', 5: '露骨' };
const heatClass = { 1: 'h1', 2: 'h2', 3: 'h3', 4: 'h4', 5: 'h5' };

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>夜织 CialloForge · 成果画廊</title>
<style>
  :root{
    --bg:#0e0d12; --card:#17161d; --card2:#1e1c26; --line:#2c2937;
    --txt:#e8e4f0; --dim:#9b93ad; --accent:#c9a6ff; --accent2:#ff9ec4;
    --h1:#6b7f9e; --h2:#8a7fb0; --h3:#b07fb0; --h4:#d4708f; --h5:#ff5f7e;
  }
  *{box-sizing:border-box}
  body{
    margin:0; background:var(--bg); color:var(--txt);
    font:15px/1.85 "Noto Serif SC","Songti SC","Source Han Serif SC",Georgia,serif;
  }
  header{
    padding:38px 26px 26px; border-bottom:1px solid var(--line);
    background:radial-gradient(900px 320px at 18% -10%, #2a1f3d 0%, transparent 70%);
  }
  h1{margin:0 0 8px; font-size:26px; letter-spacing:.06em}
  h1 small{font-size:13px; color:var(--dim); letter-spacing:0; margin-left:10px; font-weight:400}
  .meta{color:var(--dim); font-size:13px; line-height:2}
  .meta b{color:var(--accent); font-weight:600}
  .warn{
    margin-top:14px; display:inline-block; padding:6px 12px; border-radius:6px;
    background:#2a1520; border:1px solid #55203a; color:#ffa8c4; font-size:12.5px;
    font-family:system-ui,sans-serif;
  }
  .toolbar{
    position:sticky; top:0; z-index:9; padding:12px 26px;
    background:rgba(14,13,18,.94); backdrop-filter:blur(8px); border-bottom:1px solid var(--line);
    display:flex; gap:10px; flex-wrap:wrap; align-items:center;
    font-family:system-ui,sans-serif; font-size:12.5px;
  }
  .toolbar input{
    background:#1b1a22; border:1px solid var(--line); color:var(--txt);
    padding:7px 11px; border-radius:6px; width:230px; font-size:12.5px;
  }
  .toolbar button{
    background:#1b1a22; border:1px solid var(--line); color:var(--dim);
    padding:7px 13px; border-radius:6px; cursor:pointer; font-size:12.5px;
  }
  .toolbar button:hover,.toolbar button.on{color:var(--txt); border-color:var(--accent); color:var(--accent)}
  main{padding:26px; display:grid; gap:22px; grid-template-columns:repeat(auto-fill,minmax(430px,1fr)); max-width:1700px; margin:0 auto}
  @media(max-width:560px){main{grid-template-columns:1fr; padding:16px}}
  .card{
    background:var(--card); border:1px solid var(--line); border-radius:12px;
    padding:20px 22px 22px; display:flex; flex-direction:column;
    transition:border-color .18s, transform .18s;
  }
  .card:hover{border-color:#463f5c; transform:translateY(-2px)}
  .card.over{background:var(--card2)}
  .chead{display:flex; justify-content:space-between; align-items:baseline; gap:10px; flex-wrap:wrap}
  .sid{font-family:ui-monospace,Consolas,monospace; color:var(--dim); font-size:12px}
  h2{margin:2px 0 10px; font-size:19px; letter-spacing:.03em}
  .badges{display:flex; gap:7px; flex-wrap:wrap; margin-bottom:12px; font-family:system-ui,sans-serif; font-size:11.5px}
  .badge{padding:3px 9px; border-radius:20px; border:1px solid var(--line); color:var(--dim)}
  .badge.heat{color:#0e0d12; font-weight:700; border:none}
  .badge.pair{border-color:#4a3a5e; color:#c9a6ff}
  .badge.h1{background:var(--h1)} .badge.h2{background:var(--h2)} .badge.h3{background:var(--h3)}
  .badge.h4{background:var(--h4)} .badge.h5{background:var(--h5)}
  .cast{font-size:13px; color:var(--dim); margin-bottom:10px}
  .cast b{color:var(--txt); font-weight:600}
  .note{
    font-size:13px; color:#bfb3d8; border-left:2px solid #3b3350;
    padding:7px 0 7px 12px; margin-bottom:16px; line-height:1.75;
  }
  .prose{flex:1}
  .prose p{margin:0 0 13px; color:#d6d0e4}
  .prose p:first-child::first-letter{font-size:1.15em}
  .more{color:var(--dim); font-size:12.5px; font-family:system-ui,sans-serif; margin-top:2px}
  .acts{margin-top:6px; margin-bottom:16px}
  .acts summary{cursor:pointer; color:var(--accent); font-size:12.5px; font-family:system-ui,sans-serif; margin-bottom:10px}
  .acts pre{
    white-space:pre-wrap; word-break:break-word; background:#12111a; border:1px solid var(--line);
    border-radius:8px; padding:13px; font-size:11.5px; line-height:1.7; color:#a9a1bd;
    font-family:ui-monospace,Consolas,monospace; max-height:280px; overflow:auto;
  }
  .foot{
    display:flex; gap:10px; align-items:center; flex-wrap:wrap;
    border-top:1px solid var(--line); padding-top:14px; margin-top:auto;
    font-family:system-ui,sans-serif; font-size:12.5px;
  }
  .foot a{color:var(--accent); text-decoration:none}
  .foot a:hover{text-decoration:underline}
  .foot .dim{color:var(--dim)}
  footer{padding:26px; text-align:center; color:var(--dim); font-size:12.5px; font-family:system-ui,sans-serif; border-top:1px solid var(--line); margin-top:20px}
  code{background:#12111a; padding:1px 5px; border-radius:4px; font-size:12px; color:var(--accent)}
</style>
</head>
<body>
<header>
  <h1>夜织 CialloForge <small>成果画廊 · 16 场景样章</small></h1>
  <div class="meta">
    <b>${cards.length}</b> 篇样章 · 合计 <b>${totalWords.toLocaleString()}</b> 字 ·
    全部为<b>男女向</b>配对（${cards.filter((x) => x.pairing === 'mixed').length}/${cards.length} 篇）·
    卡司为原创成年角色（19-34 岁，年龄锁 18+） · seed 固定，可逐字节复现<br>
    生成时间 ${new Date().toLocaleString('zh-CN')} · 引擎：<code>ciallo-forge v1.0.0</code>
  </div>
  <div class="warn">⚠ 本页内容为成人向虚构创作（全员成年），请确认你已满 18 周岁</div>
</header>

<div class="toolbar">
  <input id="q" placeholder="搜场景 / 角色 / 关键词…" autocomplete="off">
  <button data-heat="all" class="on">全部热度</button>
  <button data-heat="1">1 克制</button>
  <button data-heat="2">2 暧昧</button>
  <button data-heat="3">3 缠绵</button>
  <button data-heat="4">4 直白</button>
  <button data-heat="5">5 露骨</button>
  <span id="count" class="dim" style="margin-left:auto"></span>
</div>

<main id="grid">
${cards.map((c) => `
  <article class="card" data-heat="${c.heat}" data-key="${esc([c.id, c.title, c.kinkFamily, c.location, c.cast.map((x) => x.name).join(' ')].join(' '))}">
    <div class="chead">
      <div>
        <div class="sid">${c.id} · ${esc(c.kinkFamily)}</div>
        <h2>${esc(c.title)}</h2>
      </div>
    </div>
    <div class="badges">
      <span class="badge heat ${heatClass[c.heat]}">热度 ${c.heat} · ${heatLabel[c.heat]}</span>
      <span class="badge pair">${c.pairing === 'mixed' ? '男女向' : c.pairing === 'same-sex' ? '同性向' : '单人'}</span>
      <span class="badge">${esc(c.pacing)}</span>
      <span class="badge">${c.words} 字</span>
      <span class="badge">${c.paragraphs} 段</span>
      <span class="badge">seed ${c.seed}</span>
    </div>
    <div class="cast">卡司：${c.cast.map((x) => `${x.gender === 'male' ? '♂' : '♀'} <b>${esc(x.name)}</b>（${x.age} 岁 · ${esc(x.role)}）`).join('　')}</div>
    <div class="cast">场景：${esc(c.location)}　氛围：${esc(c.mood)}</div>
    ${c.note ? `<div class="note">${esc(c.note)}</div>` : ''}
    <div class="prose">
      ${c.preview.map((p) => `<p>${esc(p)}</p>`).join('\n      ')}
    </div>
    ${c.extra > 0 ? `<div class="more">… 还有 ${c.extra} 段，见完整文件</div>` : ''}
    <details class="acts">
      <summary>查看配图提示词（SDXL 正向 / 负向）</summary>
      <pre>${esc(c.prompt || '（本篇未附提示词，可用 CLI 生成）')}</pre>
    </details>
    <div class="foot">
      <a href="${c.file}" target="_blank" rel="noopener">打开完整正文（Markdown）</a>
      <span class="dim">·</span>
      <a href="${c.file}" download>另存为</a>
      <span class="dim" style="margin-left:auto">${c.id}</span>
    </div>
  </article>`).join('\n')}
</main>

<footer>
  夜织 CialloForge · 本地离线生成，无外部请求 · 重新生成：<code>node scripts/build-gallery.js</code>
</footer>

<script>
  const q = document.getElementById('q');
  const cards = [...document.querySelectorAll('.card')];
  const count = document.getElementById('count');
  let heat = 'all';

  function apply(){
    const kw = q.value.trim().toLowerCase();
    let shown = 0;
    for (const el of cards){
      const okHeat = heat === 'all' || el.dataset.heat === heat;
      const okKw = !kw || el.dataset.key.toLowerCase().includes(kw) || el.textContent.toLowerCase().includes(kw);
      const ok = okHeat && okKw;
      el.style.display = ok ? '' : 'none';
      if (ok) shown++;
    }
    count.textContent = shown + ' / ' + cards.length + ' 篇';
  }

  q.addEventListener('input', apply);
  for (const btn of document.querySelectorAll('.toolbar button')){
    btn.addEventListener('click', () => {
      for (const b of document.querySelectorAll('.toolbar button')) b.classList.remove('on');
      btn.classList.add('on');
      heat = btn.dataset.heat;
      apply();
    });
  }
  apply();
</script>
</body>
</html>
`;

io.writeText(path.join(io.OUT_DIR, 'showcase.html'), html);
console.log('');
console.log(`[OK] 画廊已生成 → ${path.join(io.OUT_DIR, 'showcase.html')}`);
console.log(`[OK] 样章 Markdown → ${storiesDir}`);
console.log(`[i]  共 ${cards.length} 篇 / ${totalWords} 字`);
