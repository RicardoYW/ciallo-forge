/* 夜织 CialloForge · 界面逻辑（原生 ES2020，零依赖） */
'use strict';

// ───────────────────────── 状态 ─────────────────────────

const S = {
  stats: null,
  characters: [],
  scenes: [],
  kinks: null,
  gallery: [],
  settings: null,
  cast: { lead: null, partner: null, manualPartner: false },
  genderFilter: '',
  roleFilter: '',
  roleQuery: '',
  sceneQuery: '',
  galleryFilter: '',
  galleryPick: null,
  lastStory: null,
  lastPromptPayload: null,
  stream: null,
  running: false,
  previewMode: 'text',
  scene: null,
};

const HEAT_NAME = { 1: '克制', 2: '暧昧', 3: '缠绵', 4: '直白', 5: '露骨' };
const PACING_NAME = { slow: '慢燃', balanced: '均速', fast: '快进', pwp: '直入' };
const GENDER_ICON = { male: '♂', female: '♀' };

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

// ───────────────────────── 基础设施 ─────────────────────────

async function api(method, path, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) {
    opt.headers['content-type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  const res = await fetch(path, opt);
  let json = null;
  try { json = await res.json(); } catch { /* 非 JSON */ }
  if (!res.ok || !json || json.ok === false) {
    const msg = json && json.error ? `${json.error.message}（${json.error.code}）` : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json.data;
}

function toast(msg, kind = '', ms = 3200) {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .25s'; }, ms - 300);
  setTimeout(() => el.remove(), ms);
}

function setStatus(text, kind = '') {
  $('#topStatusText').textContent = text;
  $('#topStatus').className = 'status ' + kind;
}

function openModal(title, content) {
  $('#modalTitle').textContent = title;
  $('#modalBody').textContent = content;
  $('#modal').hidden = false;
}
function closeModal() { $('#modal').hidden = true; }

async function copyText(text, okMsg = '已复制') {
  const native = window.cialloNative;
  if (native && native.copyText) {
    try {
      await native.copyText(text);
      toast(okMsg, 'ok');
      return;
    } catch { /* 落到下面的浏览器路径 */ }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg, 'ok');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast(okMsg + '（回退方式）', 'ok');
  }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

/** 极简 Markdown：标题 / 段落 / 引用块 / 代码块 / 粗体 / 行内码 */
function mdToHtml(md) {
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let inCode = false, buf = [], metaBlock = false;
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');

  for (const line of lines) {
    if (/^```/.test(line)) {
      if (inCode) { out.push('<pre>' + esc(buf.join('\n')) + '</pre>'); buf = []; inCode = false; }
      else inCode = true;
      continue;
    }
    if (inCode) { buf.push(line); continue; }
    if (/^#\s+/.test(line)) { out.push('<h1>' + inline(line.slice(2)) + '</h1>'); continue; }
    if (/^##\s+/.test(line)) { out.push('<h2>' + inline(line.slice(3)) + '</h2>'); continue; }
    if (/^>\s?/.test(line)) {
      if (!metaBlock) { out.push('<div class="meta-block">'); metaBlock = true; }
      out.push(inline(line.replace(/^>\s?/, '')) + '<br>');
      continue;
    }
    if (/^\*\*/.test(line)) {
      if (!metaBlock) { out.push('<div class="meta-block">'); metaBlock = true; }
      out.push(inline(line) + '<br>');
      continue;
    }
    if (metaBlock) { out.push('</div>'); metaBlock = false; }
    if (/^---+$/.test(line.trim())) { out.push('<hr>'); continue; }
    if (!line.trim()) continue;
    out.push('<p>' + inline(line) + '</p>');
  }
  if (metaBlock) out.push('</div>');
  if (inCode && buf.length) out.push('<pre>' + esc(buf.join('\n')) + '</pre>');
  return out.join('\n');
}

// ───────────────────────── 数据加载 ─────────────────────────

async function bootstrap() {
  try {
    setStatus('连接中…');
    const [stats, characters, scenes] = await Promise.all([
      api('GET', '/api/stats'),
      api('GET', '/api/characters'),
      api('GET', '/api/scenes'),
    ]);
    S.stats = stats;
    S.characters = characters;
    S.scenes = scenes;

    $('#topTag').textContent = `${stats.characters} 卡（♂${stats.male}/♀${stats.female}） · ${stats.scenes} 场景 · 全员 18+`;
    const native = window.cialloNative;
    if (stats.desktop || (native && native.isElectron)) {
      $('#desktopTag').hidden = false;
      $('#desktopTag').title = `Electron ${stats.electron || ''} · 数据目录 ${(stats.paths && stats.paths.data) || ''}`;
    }
    setStatus(`已连接 · v${stats.version}${stats.desktop ? ' · 桌面版' : ''}`, 'ok');

    initCreateView();
    initPromptView();
    initGalleryView();
    initCheckView();
    initSettingsView();
    renderRoles();
    renderScenes();

    // 其余数据按需加载，避免首屏卡顿
    api('GET', '/api/settings').then((s) => { S.settings = s; applySettingsToForm(s); fillSettingsInfo(s); }).catch(() => {});
    api('GET', '/api/gallery').then((g) => { S.gallery = g; renderGalleryList(); }).catch(() => {});
  } catch (err) {
    setStatus('连接失败', 'bad');
    toast('无法连接后端：' + err.message, 'bad', 6000);
  }
}

// ───────────────────────── 创作页 ─────────────────────────

function initCreateView() {
  const sceneSel = $('#sceneSelect');
  sceneSel.innerHTML = S.scenes.map((s) => `<option value="${s.id}">${s.id} · ${esc(s.title)}（${esc(s.kinkFamily)}）</option>`).join('');
  sceneSel.value = S.scenes[0].id;
  S.scene = S.scenes[0];

  // 默认选场景配对的 A 作为主导方
  const def = S.scenes[0].autoCast[0];
  S.cast.lead = def;
  S.cast.partner = null;
  S.cast.manualPartner = false;

  sceneSel.addEventListener('change', () => {
    S.scene = S.scenes.find((x) => x.id === sceneSel.value);
    S.cast.lead = S.scene.autoCast[0];
    S.cast.partner = null;
    S.cast.manualPartner = false;
    renderPool();
    renderCastSelects();
    updatePairHint();
  });

  renderPool();

  $('#charSearch').addEventListener('input', (e) => { renderPool(e.target.value.trim().toLowerCase()); });
  $('#genderFilter').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    $$('#genderFilter button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    S.genderFilter = b.dataset.gender;
    renderPool($('#charSearch').value.trim().toLowerCase());
  });

  $('#btnClearCast').addEventListener('click', () => {
    S.cast = { lead: null, partner: null, manualPartner: false };
    renderPool(); renderCastSelects(); updatePairHint();
  });
  $('#btnAutoCast').addEventListener('click', () => {
    S.cast.lead = S.scene.autoCast[0];
    S.cast.partner = null;
    S.cast.manualPartner = false;
    renderPool(); renderCastSelects(); updatePairHint();
    toast('已套用场景默认配对', 'ok');
  });

  // 参数
  const heat = $('#heatRange');
  heat.addEventListener('input', () => {
    $('#heatVal').textContent = heat.value;
    $('#heatName').textContent = HEAT_NAME[heat.value];
  });

  $('#btnDice').addEventListener('click', () => {
    $('#seedInput').value = String(Math.floor(Math.random() * 900000) + 100000);
  });

  $('#leadSelect').addEventListener('change', (e) => {
    S.cast.lead = e.target.value || null;
    if (S.cast.partner === S.cast.lead) S.cast.partner = null;
    renderPool(); renderCastSelects(); updatePairHint();
  });
  $('#partnerSelect').addEventListener('change', (e) => {
    S.cast.partner = e.target.value || null;
    S.cast.manualPartner = !!S.cast.partner;
    renderPool(); updatePairHint();
  });

  $('#previewMode').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    $$('#previewMode button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    S.previewMode = b.dataset.mode;
    if (S.lastStory) renderPreview(S.lastStory.md, S.lastStory.meta, true);
  });

  $('#btnGenerate').addEventListener('click', () => generate());
  $('#btnStop').addEventListener('click', () => stopStream());
  $('#btnSave').addEventListener('click', () => saveStory());
  $('#btnCopyMd').addEventListener('click', () => {
    if (!S.lastStory) return toast('还没有正文', 'warn');
    copyText(S.lastStory.md, '正文已复制');
  });
  $('#btnPromptFromHere').addEventListener('click', () => {
    switchView('prompts');
    $('#pChar').value = S.cast.lead || '';
    $('#pScene').value = S.scene ? S.scene.id : '';
    $('#pHeat').value = $('#heatRange').value;
    compilePrompts(false);
  });
}

function renderPool(query) {
  const q = query != null ? query : $('#charSearch').value.trim().toLowerCase();
  const list = S.characters.filter((c) => {
    if (S.genderFilter && c.gender !== S.genderFilter) return false;
    if (!q) return true;
    return [c.id, c.name, c.role, c.occupation, ...(c.kinks || [])].join(' ').toLowerCase().includes(q);
  });

  const leadId = S.cast.lead;
  const partnerId = S.cast.partner || (S.scene ? (S.scene.autoCast || []).find((id) => id !== leadId) : null);

  $('#charPool').innerHTML = list.map((c) => {
    const isLead = c.id === leadId;
    const isPartner = c.id === partnerId;
    const cls = 'pool-item' + (isLead || isPartner ? ' sel' : '');
    const slot = isLead ? '<span class="badge-slot">A</span>' : isPartner ? '<span class="badge-slot">B</span>' : '';
    return `<div class="${cls}" data-id="${c.id}" title="${esc(c.name)} · ${c.age} 岁 · ${esc(c.role)} · 声线 ${esc(c.voice.register)}">
      <span class="g ${c.gender}">${GENDER_ICON[c.gender]}</span>
      <div class="info">
        <div class="nm">${esc(c.name)}${slot} <span style="color:var(--dim);font-weight:400">${c.age}</span></div>
        <div class="ag">${esc(c.role)}</div>
      </div>
      <span class="rl">${esc(c.voice.register)}</span>
    </div>`;
  }).join('') || '<div class="empty">没有匹配的角色</div>';

  $('#charPool').querySelectorAll('.pool-item').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      if (!S.cast.lead || (S.cast.lead && S.cast.partner)) {
        if (S.cast.lead === id && !S.cast.partner) { S.cast.lead = null; }
        else if (S.cast.partner === id) { S.cast.partner = null; S.cast.manualPartner = false; }
        else { S.cast.lead = id; S.cast.partner = null; S.cast.manualPartner = false; }
      } else if (S.cast.lead === id) {
        S.cast.lead = null;
      } else {
        S.cast.partner = id;
        S.cast.manualPartner = true;
      }
      renderPool(); renderCastSelects(); updatePairHint();
    });
  });

  const total = (S.cast.lead ? 1 : 0) + (S.cast.partner ? 1 : 0);
  $('#poolInfo').textContent = `已选 ${total}/2 · A ${nameOf(S.cast.lead) || '未选'}${S.cast.partner ? ' · B ' + nameOf(S.cast.partner) : ''}`;
}

function nameOf(id) {
  const c = S.characters.find((x) => x.id === id);
  return c ? c.name : null;
}

function renderCastSelects() {
  const opts = (sel, placeholder) =>
    `<option value="">${placeholder}</option>` +
    S.characters.map((c) => `<option value="${c.id}"${sel === c.id ? ' selected' : ''}>${GENDER_ICON[c.gender]} ${esc(c.name)}（${c.age}·${esc(c.role)}）</option>`).join('');

  $('#leadSelect').innerHTML = opts(S.cast.lead, '— 按场景默认 —');
  const scenePartner = S.scene ? (S.scene.autoCast || []).find((id) => id !== S.cast.lead) : null;
  $('#partnerSelect').innerHTML =
    `<option value=""${!S.cast.manualPartner ? ' selected' : ''}>— 自动补对方${scenePartner ? '（' + nameOf(scenePartner) + '）' : ''} —</option>` +
    S.characters.filter((c) => c.id !== S.cast.lead)
      .map((c) => `<option value="${c.id}"${S.cast.manualPartner && S.cast.partner === c.id ? ' selected' : ''}>${GENDER_ICON[c.gender]} ${esc(c.name)}（${c.age}·${esc(c.role)}）</option>`).join('');
}

function currentCastIds() {
  const ids = [];
  if (S.cast.lead) ids.push(S.cast.lead);
  if (S.cast.manualPartner && S.cast.partner) ids.push(S.cast.partner);
  return ids;
}

function updatePairHint() {
  const cast = currentCastIds();
  if (cast.length === 2) {
    const [a, b] = cast.map((id) => S.characters.find((c) => c.id === id));
    const mixed = a.gender !== b.gender;
    $('#pairHint').innerHTML = `${GENDER_ICON[a.gender]} ${esc(a.name)} × ${GENDER_ICON[b.gender]} ${esc(b.name)} · <b style="color:${mixed ? 'var(--ok)' : 'var(--warn)'}">${mixed ? '男女向' : '同性向'}</b>`;
  } else if (cast.length === 1) {
    const a = S.characters.find((c) => c.id === cast[0]);
    const partner = S.scene ? (S.scene.autoCast || []).find((id) => id !== a.id) : null;
    $('#pairHint').innerHTML = `${GENDER_ICON[a.gender]} ${esc(a.name)} × 自动补 ${nameOf(partner) || '对方'}`;
  } else {
    $('#pairHint').textContent = '按场景默认配对';
  }
}

function storyRequest() {
  return {
    scene: $('#sceneSelect').value,
    cast: currentCastIds(),
    heat: Number($('#heatRange').value),
    words: Number($('#wordsInput').value) || 1500,
    pacing: $('#pacingSelect').value,
    seed: $('#seedInput').value,
    autoPartner: $('#autoPartner').checked,
  };
}

function stopStream() {
  if (S.stream) {
    S.stream.abort();
    S.stream = null;
  }
  S.running = false;
  $('#btnGenerate').disabled = false;
  $('#btnStop').disabled = true;
  setStatus('已停止', '');
}

async function generate() {
  if (S.running) return;
  const req = storyRequest();
  S.running = true;
  $('#btnGenerate').disabled = true;
  $('#btnStop').disabled = false;
  const body = $('#previewBody');
  body.innerHTML = '<div class="empty"><span class="spinner"></span> 生成中…</div>';
  $('#previewTitle').textContent = '预览';
  $('#previewMeta').textContent = '连接中…';

  const ctrl = new AbortController();
  S.stream = ctrl;
  const t0 = performance.now();

  try {
    const res = await fetch('/api/story/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let md = '';
    let meta = null;
    let paraCount = 0;

    const flush = () => {
      body.innerHTML = '';
      $('#previewTitle').textContent = meta ? meta.scene.title : '预览';
      body.insertAdjacentHTML('beforeend', mdToHtml(md));
      const cur = document.createElement('span');
      cur.className = 'cursor';
      body.appendChild(cur);
      if ($('#autoScroll').checked) body.scrollTop = body.scrollHeight;
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }

        if (ev.type === 'meta') {
          meta = ev;
          md = `# ${ev.scene.title}\n\n> 全员成年（年龄锁 18+）· 场景 ${ev.scene.id} ${ev.scene.title} · 热度 ${ev.heat}/5 · 节奏 ${(PACING_NAME[ev.pacing.key] || ev.pacing.key)} · seed ${ev.seed}\n\n` +
            `**卡司**：${ev.cast.map((c) => `${c.name}（${c.age} 岁 · ${c.gender === 'male' ? '男' : '女'} · ${c.role}）`).join('、')}\n\n` +
            `**配对**：${ev.pairing === 'mixed' ? '男女向' : ev.pairing === 'same-sex' ? '同性向' : '单人'}（主导方 ${ev.cast[0].name}）\n\n` +
            `**场景**：${ev.scene.location} · 关键词 ${ev.scene.kinkFamily} · 氛围 ${(ev.scene.mood || []).join('、')}\n\n` +
            (ev.kinkNote ? `**基调**：${ev.kinkNote}\n\n` : '') + '---\n\n';
          flush();
          $('#previewMeta').innerHTML = `<span class="spinner"></span> 流式生成中… 0 段`;
        } else if (ev.type === 'section') {
          md += `## ${ev.name}\n\n`;
          flush();
        } else if (ev.type === 'paragraph') {
          md += ev.text + '\n\n';
          paraCount++;
          flush();
          $('#previewMeta').innerHTML = `<span class="spinner"></span> ${paraCount} 段 · ${md.replace(/\s/g, '').length} 字`;
        } else if (ev.type === 'done') {
          const secs = ((performance.now() - t0) / 1000).toFixed(2);
          body.querySelector('.cursor')?.remove();
          S.lastStory = { md, meta, req };
          $('#previewMeta').innerHTML = `✅ ${ev.words} 字 · ${ev.paragraphs} 段 · ${secs}s · seed ${meta.seed}`;
          setStatus(`生成完成 · ${ev.words} 字`, 'ok');
          toast(`生成完成：${ev.words} 字 / ${ev.paragraphs} 段`, 'ok');
        } else if (ev.type === 'error') {
          throw new Error(ev.message);
        }
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      $('#previewMeta').textContent = '已停止';
    } else {
      body.innerHTML = `<div class="empty" style="color:var(--bad)">生成失败：${esc(err.message)}</div>`;
      setStatus('生成失败', 'bad');
      toast('生成失败：' + err.message, 'bad', 6000);
    }
  } finally {
    S.running = false;
    S.stream = null;
    $('#btnGenerate').disabled = false;
    $('#btnStop').disabled = true;
  }
}

function renderPreview(md, meta, keepMode) {
  const body = $('#previewBody');
  if (S.previewMode === 'meta') {
    body.innerHTML = `<pre>${esc(JSON.stringify(meta, null, 2))}</pre>`;
    $('#previewMeta').textContent = `${meta.words} 字 · ${meta.paragraphs} 段`;
    return;
  }
  body.innerHTML = mdToHtml(md);
  $('#previewTitle').textContent = meta.scene.title;
  $('#previewMeta').textContent = `${meta.words} 字 · ${meta.paragraphs} 段 · ${meta.pairing === 'mixed' ? '男女向' : meta.pairing} · seed ${meta.seed}`;
}

async function saveStory() {
  if (!S.lastStory) return toast('还没有正文可存', 'warn');
  const defName = `${(S.lastStory.meta.scene.id || 'story')}-${S.lastStory.meta.scene.title}-seed${S.lastStory.meta.seed}`;
  const name = prompt('保存文件名（落在 out/stories/）', defName);
  if (name == null) return;
  try {
    const r = await api('POST', '/api/story/save', { name, md: S.lastStory.md, dir: 'stories' });
    toast('已保存 → ' + r.rel, 'ok', 4200);
  } catch (err) {
    toast('保存失败：' + err.message, 'bad');
  }
}

// ───────────────────────── 角色页 ─────────────────────────

function renderRoles() {
  const q = S.roleQuery;
  const list = S.characters.filter((c) => {
    if (S.roleFilter && c.gender !== S.roleFilter) return false;
    if (!q) return true;
    return [c.id, c.name, c.role, c.occupation, c.personality.core, ...(c.kinks || [])].join(' ').toLowerCase().includes(q);
  });
  $('#roleCount').textContent = `${list.length} / ${S.characters.length} 张`;

  $('#roleCards').innerHTML = list.map((c) => `
    <article class="card" data-id="${c.id}">
      <h3><span class="badge ${c.gender === 'male' ? 'm' : 'f'}">${GENDER_ICON[c.gender]} ${c.age} 岁</span>${esc(c.name)}</h3>
      <div class="sub2">${esc(c.role)} · ${esc(c.occupation)} · ${c.height}cm · ${esc(c.voice.register)}</div>
      <div class="kv-mini">
        <i>定位</i><span>${esc(c.personality.core)}</span>
        <i>表层</i><span>${esc(c.personality.surface)}</span>
        <i>阴影</i><span>${esc(c.personality.shadow)}</span>
        <i>台词</i><span>「${esc((c.voice.samples || [])[0] || '')}」</span>
      </div>
      <div class="row-badges">${(c.kinks || []).slice(0, 6).map((k) => `<span class="badge">${esc(k)}</span>`).join('')}</div>
      <div class="tags">${(c.appearance.tags || []).slice(0, 12).map((t) => `<span class="tag-chip">${esc(t)}</span>`).join('')}</div>
      <div class="card-actions">
        <button class="btn tiny" data-act="use">用它创作</button>
        <button class="btn tiny ghost" data-act="prompt">配图提示词</button>
        <button class="btn tiny ghost" data-act="copy">复制绘图标签</button>
      </div>
    </article>`).join('') || '<div class="empty">没有匹配的角色</div>';

  $('#roleCards').querySelectorAll('.card').forEach((el) => {
    const c = S.characters.find((x) => x.id === el.dataset.id);
    el.querySelectorAll('button[data-act]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const act = btn.dataset.act;
        if (act === 'use') {
          S.cast.lead = c.id;
          S.cast.partner = null;
          S.cast.manualPartner = false;
          switchView('create');
          renderPool(); renderCastSelects(); updatePairHint();
          toast(`已把 ${c.name} 放到 A 位`, 'ok');
        } else if (act === 'copy') {
          copyText((c.appearance.tags || []).join(', '), '绘图标签已复制');
        } else if (act === 'prompt') {
          switchView('prompts');
          $('#pChar').value = c.id;
          compilePrompts(false);
        }
      });
    });
  });
}

// ───────────────────────── 场景页 ─────────────────────────

function renderScenes() {
  const q = S.sceneQuery;
  const list = S.scenes.filter((s) => !q || [s.id, s.title, s.kinkFamily, s.location, ...(s.mood || [])].join(' ').toLowerCase().includes(q));
  $('#sceneCount').textContent = `${list.length} / ${S.scenes.length} 个`;

  $('#sceneCards').innerHTML = list.map((s) => {
    const [a, b] = s.cast;
    const opts = (sel) => S.characters.map((c) => `<option value="${c.id}"${c.id === sel ? ' selected' : ''}>${GENDER_ICON[c.gender]} ${esc(c.name)}（${c.age}）</option>`).join('');
    return `<article class="card" data-id="${s.id}">
      <h3><span class="badge heat h${s.heatBase}">热度 ${s.heatBase}</span>${s.id} ${esc(s.title)}</h3>
      <div class="sub2">${esc(s.kinkFamily)} · ${esc(s.location)} · ${s.beats} beats${s.leadGender ? ` · 主导 ${s.leadGender === 'male' ? '♂' : '♀'}` : ''}</div>
      <div class="kv-mini">
        <i>氛围</i><span>${(s.mood || []).map(esc).join('、')}</span>
        <i>幕结构</i><span>${s.acts.map((x) => esc(x.name)).join(' / ')}</span>
      </div>
      <div class="pair-edit">
        <span>A</span><select class="input" data-role="a">${opts(a.id)}</select>
        <span>B</span><select class="input" data-role="b">${opts(b.id)}</select>
        <button class="btn tiny" data-act="savePair">存为默认</button>
        <button class="btn tiny ghost" data-act="use">去创作</button>
      </div>
      <div class="tags">${(s.tags || []).slice(0, 8).map((t) => `<span class="tag-chip">${esc(t)}</span>`).join('')}</div>
    </article>`;
  }).join('') || '<div class="empty">没有匹配的场景</div>';

  $('#sceneCards').querySelectorAll('.card').forEach((el) => {
    const id = el.dataset.id;
    const selA = el.querySelector('select[data-role="a"]');
    const selB = el.querySelector('select[data-role="b"]');
    const sync = () => {
      const a = S.characters.find((c) => c.id === selA.value);
      const b = S.characters.find((c) => c.id === selB.value);
      const bad = a && b && a.gender === b.gender;
      selA.style.borderColor = bad ? 'var(--bad)' : '';
      selB.style.borderColor = bad ? 'var(--bad)' : '';
    };
    selA.addEventListener('change', sync);
    selB.addEventListener('change', sync);
    sync();

    el.querySelectorAll('button[data-act]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (btn.dataset.act === 'use') {
          switchView('create');
          $('#sceneSelect').value = id;
          $('#sceneSelect').dispatchEvent(new Event('change'));
        } else {
          try {
            const r = await api('POST', '/api/scene/pairing', { scene: id, cast: [selA.value, selB.value] });
            const idx = S.scenes.findIndex((x) => x.id === id);
            S.scenes[idx] = { ...S.scenes[idx], autoCast: r.autoCast, leadGender: r.leadGender, cast: r.cast };
            toast(`${id} 默认配对已更新：${r.cast.map((c) => c.name).join(' × ')}`, 'ok', 4200);
            if (S.scene && S.scene.id === id) {
              S.scene = S.scenes[idx];
              renderCastSelects();
              updatePairHint();
            }
          } catch (err) {
            toast('保存配对失败：' + err.message, 'bad', 5000);
          }
        }
      });
    });
  });
}

// ───────────────────────── 提示词页 ─────────────────────────

function initPromptView() {
  $('#pChar').innerHTML = S.characters.map((c) => `<option value="${c.id}">${GENDER_ICON[c.gender]} ${esc(c.name)}（${c.age}·${esc(c.role)}）</option>`).join('');
  $('#pScene').innerHTML = '<option value="">（不带场景）</option>' +
    S.scenes.map((s) => `<option value="${s.id}">${s.id} · ${esc(s.title)}</option>`).join('');
  $('#pChar').value = S.characters[0].id;

  $('#btnCompile').addEventListener('click', () => compilePrompts(false));
  $('#btnCompileAll').addEventListener('click', () => compilePrompts(true));
  $('#btnExportPrompts').addEventListener('click', () => exportPrompts());
  $('#btnCopyAllPrompts').addEventListener('click', () => {
    if (!S.lastPromptPayload) return toast('先编译一次', 'warn');
    const text = S.lastPromptPayload.items.map((i) =>
      `# ${i.character}${i.scene ? ' × ' + i.scene : ''} → ${i.target}\n正向：${i.positive}\n负向：${i.negative}\n`).join('\n');
    copyText(text, `已复制 ${S.lastPromptPayload.items.length} 条提示词`);
  });
}

async function compilePrompts(all) {
  const body = all
    ? { char: 'all', scene: 'all', target: 'sdxl', heat: Number($('#pHeat').value) || 4, rating: $('#pRating').value, extra: $('#pExtra').value }
    : {
      char: $('#pChar').value,
      scene: $('#pScene').value || null,
      target: $('#pTarget').value,
      heat: Number($('#pHeat').value) || 4,
      rating: $('#pRating').value,
      extra: $('#pExtra').value,
    };
  $('#promptMeta').innerHTML = '<span class="spinner"></span> 编译中…';
  $('#promptList').classList.add('busy');
  try {
    const data = await api('POST', '/api/prompt', body);
    S.lastPromptPayload = data;
    renderPrompts(data);
  } catch (err) {
    $('#promptList').innerHTML = `<div class="empty" style="color:var(--bad)">编译失败：${esc(err.message)}</div>`;
    $('#promptMeta').textContent = '失败';
  } finally {
    $('#promptList').classList.remove('busy');
  }
}

function renderPrompts(data) {
  $('#promptMeta').textContent = `${data.count} 条 · heat ${data.heat} · ${data.rating}`;
  const shown = data.items.slice(0, 200);
  $('#promptList').innerHTML = shown.map((it) => `
    <div class="prompt-card">
      <h4>${esc(it.character)}${it.scene ? ' <span style="color:var(--dim)">× ' + esc(it.scene) + '</span>' : ''} → ${esc(it.target)}
        <span class="sp">${it.validation && it.validation.ok ? '<span class="val-ok">✔ 校验通过</span>' : '<span class="val-bad">✘ ' + esc((it.validation.errors || []).join('；')) + '</span>'}
        · 正向 ${it.tokenCount.positive} / 负向 ${it.tokenCount.negative} token</span></h4>
      <div class="prompt-block"><div class="lbl">正向 <button class="btn tiny ghost" data-copy="pos" data-id="${it.id}">复制</button></div><pre>${esc(it.positive)}</pre></div>
      <div class="prompt-block"><div class="lbl">负向 <button class="btn tiny ghost" data-copy="neg" data-id="${it.id}">复制</button></div><pre>${esc(it.negative)}</pre></div>
      ${it.mjCommand ? `<div class="prompt-block"><div class="lbl">Midjourney 命令 <button class="btn tiny ghost" data-copy="mj" data-id="${it.id}">复制</button></div><pre>${esc(it.mjCommand)}</pre></div>` : ''}
      ${it.nai ? `<div class="prompt-block"><div class="lbl">NovelAI payload <button class="btn tiny ghost" data-copy="nai" data-id="${it.id}">复制</button></div><pre>${esc(JSON.stringify(it.nai, null, 2))}</pre></div>` : ''}
      ${it.workflow ? `<div class="prompt-block"><div class="lbl">ComfyUI workflow <button class="btn tiny ghost" data-copy="flow" data-id="${it.id}">复制</button></div><pre>${esc(JSON.stringify(it.workflow, null, 2))}</pre></div>` : ''}
      <div class="lbl" style="color:var(--dim);font-size:11px">参数 ${esc(JSON.stringify(it.params))}</div>
    </div>`).join('') + (data.items.length > shown.length ? `<div class="empty">仅显示前 ${shown.length} 条，全部 ${data.items.length} 条请用「导出」或 CLI。</div>` : '');

  $('#promptList').querySelectorAll('button[data-copy]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const it = data.items.find((x) => x.id === btn.dataset.id);
      if (!it) return;
      const kind = btn.dataset.copy;
      const val = kind === 'pos' ? it.positive : kind === 'neg' ? it.negative : kind === 'mj' ? it.mjCommand :
        kind === 'nai' ? JSON.stringify(it.nai, null, 2) : JSON.stringify(it.workflow, null, 2);
      copyText(val, '已复制');
    });
  });
}

async function exportPrompts() {
  try {
    const payload = S.lastPromptPayload || (await api('POST', '/api/prompt', {
      char: $('#pChar').value, scene: $('#pScene').value || null, target: $('#pTarget').value,
      heat: Number($('#pHeat').value) || 4, rating: $('#pRating').value,
    }));
    S.lastPromptPayload = payload;
    const r = await api('POST', '/api/prompt/export', { payload, name: `prompts-${$('#pChar').value}` });
    toast(`已导出 ${r.count} 条 → ${r.json}（含 md/csv）`, 'ok', 5000);
  } catch (err) {
    toast('导出失败：' + err.message, 'bad');
  }
}

// ───────────────────────── 画廊页 ─────────────────────────

function initGalleryView() {
  $('#btnReloadGallery').addEventListener('click', async () => {
    S.gallery = await api('GET', '/api/gallery');
    renderGalleryList();
    toast(`已扫描 ${S.gallery.length} 篇`, 'ok');
  });
  $('#btnOpenShowcase').addEventListener('click', () => {
    window.open('/../out/showcase.html', '_blank');
    toast('若没打开，请直接双击 out/showcase.html', 'warn', 5000);
  });
  $('#gallerySearch').addEventListener('input', (e) => {
    S.galleryFilter = e.target.value.trim().toLowerCase();
    renderGalleryList();
  });
}

function renderGalleryList() {
  const q = S.galleryFilter;
  const list = S.gallery.filter((g) => !q || [g.title, g.cast, g.scene].join(' ').toLowerCase().includes(q));
  $('#galleryCount').textContent = `${list.length} / ${S.gallery.length} 篇`;
  $('#galleryList').innerHTML = list.map((g) => `
    <div class="gallery-item${S.galleryPick === g.file ? ' on' : ''}" data-file="${esc(g.file)}">
      <div class="t">${esc(g.scene)} ${esc(g.title)}</div>
      <div class="s">${esc(g.cast)}${g.heat ? ' · 热度 ' + g.heat : ''} · ${(g.size / 1024).toFixed(1)} KB</div>
    </div>`).join('') || '<div class="empty">没有样章（到设置页点「重建导出包」）</div>';

  $('#galleryList').querySelectorAll('.gallery-item').forEach((el) => {
    el.addEventListener('click', async () => {
      S.galleryPick = el.dataset.file;
      renderGalleryList();
      try {
        const r = await api('GET', '/api/gallery/file?f=' + encodeURIComponent(el.dataset.file));
        $('#galleryBody').innerHTML = mdToHtml(r.content);
      } catch (err) {
        $('#galleryBody').innerHTML = `<div class="empty" style="color:var(--bad)">读取失败：${esc(err.message)}</div>`;
      }
    });
  });
}

// ───────────────────────── 校验页 ─────────────────────────

function initCheckView() {
  $('#btnRunValidate').addEventListener('click', runValidate);
}

async function runValidate() {
  $('#checkMeta').innerHTML = '<span class="spinner"></span> 校验中…';
  $('#checkGrid').classList.add('busy');
  try {
    const d = await api('GET', '/api/validate');
    const items = [];
    items.push({ ok: d.ok, nm: '全库校验', dt: `${d.summary.charactersPass}/${d.summary.characters} 卡 · ${d.summary.scenesPass}/${d.summary.scenes} 场景 · 最小年龄 ${d.summary.minAge}`, lvl: d.ok ? 'ok' : 'bad' });
    items.push({ ok: d.gate.minorRejected, nm: '门禁：17 岁卡被拒', dt: d.gate.minorReason, lvl: d.gate.minorRejected ? 'ok' : 'bad' });
    items.push({ ok: d.gate.engineThrows, nm: '门禁：绘图引擎对未成年卡抛错', dt: d.gate.engineThrows ? '[age-gate] 已抛出' : '未抛错', lvl: d.gate.engineThrows ? 'ok' : 'bad' });
    items.push({ ok: d.gate.scanRejected, nm: '文本扫描：幼态词无锚点被拒', dt: d.gate.scanReason, lvl: d.gate.scanRejected ? 'ok' : 'bad' });
    items.push({ ok: d.gate.adultStylingPassed, nm: '文本扫描：成年+幼态造型词放行', dt: d.gate.adultReason, lvl: d.gate.adultStylingPassed ? 'ok' : 'bad' });
    for (const c of d.characters) {
      items.push({ ok: c.ok, nm: `${c.id} ${c.name} · ${c.age} 岁`, dt: [c.ageLock ? 'ageLock ✔' : 'ageLock ✘', ...(c.warnings || []), ...(c.errors || [])].join(' · ') || '无异常', lvl: c.ok ? (c.warnings && c.warnings.length ? 'warn' : 'ok') : 'bad' });
    }
    for (const s of d.scenes) {
      items.push({ ok: s.ok, nm: `${s.id} ${s.title}`, dt: `heat ${s.heatBase} · ${s.beats} beats${(s.errors || []).length ? ' · ' + s.errors.join('；') : ''}`, lvl: s.ok ? 'ok' : 'bad' });
    }
    for (const st of d.structural || []) {
      items.push({ ok: st.level !== 'error', nm: `[${st.code}] ${st.target}`, dt: st.msg, lvl: st.level === 'error' ? 'bad' : 'warn' });
    }
    $('#checkGrid').innerHTML = items.map((i) => `
      <div class="check-item ${i.lvl}"><div class="nm">${i.ok ? '✔' : '✘'} ${esc(i.nm)}</div><div class="dt">${esc(i.dt)}</div></div>`).join('');
    $('#checkMeta').textContent = d.ok ? '全部通过' : `${d.failed.length} 项未通过`;
  } catch (err) {
    $('#checkGrid').innerHTML = `<div class="empty" style="color:var(--bad)">校验失败：${esc(err.message)}</div>`;
  } finally {
    $('#checkGrid').classList.remove('busy');
  }
}

// ───────────────────────── 设置页 ─────────────────────────

function applySettingsToForm(s) {
  if (!s || !s.generation) return;
  $('#sHeat').value = s.generation.defaultHeat || 4;
  $('#sWords').value = s.generation.defaultWords || 1500;
  $('#sPacing').value = s.generation.defaultPacing || 'slow';
  $('#sMin').value = s.generation.minWords || 200;
  $('#sMax').value = s.generation.maxWords || 8000;
}

function fillSettingsInfo(s) {
  const st = S.stats || {};
  const p = st.paths || {};
  const rows = [
    ['项目版本', st.version],
    ['运行形态', st.desktop ? `桌面版（Electron ${st.electron}）` : `命令行 / 浏览器（Node ${st.node}）`],
    ['项目路径', st.root],
    ['角色卡', `${st.characters} 张（♂${st.male} / ♀${st.female}）`],
    ['场景', `${st.scenes} 个 / ${st.beats} beats`],
    ['声线寄存器', `${(st.registers || []).length} 种`],
    ['绘图标签', `${st.tags} 条`],
    ['年龄锁', `最小 ${st.minAge} 岁 · 上限 ${st.maxAge} 岁`],
    ['安全词表', `幼态词 ${s.safety.wordCounts.minor} / 成年锚点 ${s.safety.wordCounts.adult}`],
  ];
  $('#settingsInfo').innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');

  if (p.data) {
    const pathRows = [
      ['数据目录', p.data],
      ['产物目录', p.out],
      ['界面资源', p.web],
      ['写入状态', p.writable ? '可写 ✔' : '只读 ✘（设置与产物无法保存）'],
      ['数据来源', p.mode === 'builtin' ? '程序目录内（开发/命令行形态）' : '用户数据目录（桌面版）'],
    ];
    $('#settingsPaths').innerHTML = pathRows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
    $('#dataDirHint').textContent = st.desktop
      ? '桌面版把数据放在用户目录：升级或重装程序不会丢配置与产物，卸载时也保留。'
      : '当前是命令行/浏览器形态，数据就在项目目录里；打成桌面版后会自动切到用户数据目录。';
  }
  loadPackInfo();
}

/** 内容包状态面板 */
async function loadPackInfo() {
  try {
    const pack = await api('GET', '/api/content-pack');
    S.pack = pack;
    const badge = $('#packBadge');
    if (badge) {
      badge.textContent = pack.active ? '● 已启用' : pack.available ? '○ 已关闭' : '未安装';
      badge.style.color = pack.active ? 'var(--ok)' : pack.available ? 'var(--warn)' : 'var(--dim)';
    }
    const rows = [
      ['状态', pack.active ? '已启用' : pack.available ? '已关闭（可启用）' : '未发现内容包'],
      ['名称', pack.name || '—'],
      ['版本', pack.version || '—'],
      ['评级', pack.rating || '—'],
      ['位置', pack.dir || '（把 content-pack 文件夹放进项目根目录或数据目录）'],
      ['规模', `部位词 ${(pack.counts && pack.counts.bodyPart) || 0} · 体液词 ${(pack.counts && pack.counts.fluid) || 0}`],
    ];
    $('#packInfo').innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
    $('#packHint').textContent = pack.active
      ? '已解锁 heat 4-5 档词库。关闭后数据目录会恢复成基础版（heat ≤ 3）。'
      : pack.available
        ? '内容包已找到但被关闭。点「启用 / 关闭」重新加载。'
        : '仓库本体只带基础版（heat 1-3）。把内容包文件夹放到 content-pack/ 或设置 CIALLO_PACK_DIR 后点刷新。';
  } catch (err) {
    const hint = $('#packHint');
    if (hint) hint.textContent = '读取内容包状态失败：' + err.message;
  }
}

function initSettingsView() {
  $('#btnSaveSettings').addEventListener('click', async () => {
    try {
      const s = await api('POST', '/api/settings', {
        generation: {
          defaultHeat: Number($('#sHeat').value) || 4,
          defaultWords: Number($('#sWords').value) || 1500,
          defaultPacing: $('#sPacing').value,
          minWords: Number($('#sMin').value) || 200,
          maxWords: Number($('#sMax').value) || 8000,
        },
      });
      S.settings = s;
      applySettingsToForm(s);
      toast('设置已保存到 data/config.json', 'ok');
    } catch (err) {
      toast('保存失败：' + err.message, 'bad');
    }
  });
  $('#btnReloadSettings').addEventListener('click', async () => {
    S.settings = await api('GET', '/api/settings');
    applySettingsToForm(S.settings);
    toast('已重载', 'ok');
  });
  $('#btnReloadData').addEventListener('click', async () => {
    [S.characters, S.scenes] = await Promise.all([api('GET', '/api/characters'), api('GET', '/api/scenes')]);
    renderRoles(); renderScenes(); renderPool(); renderCastSelects();
    toast('数据文件已重载', 'ok');
  });

  // 目录操作：桌面版走原生（资源管理器里高亮），浏览器版尽力而为
  const native = window.cialloNative;
  const pathsOf = () => (S.stats && S.stats.paths) || {};
  $('#btnOpenData').addEventListener('click', async () => {
    const p = pathsOf().data;
    if (!p) return toast('还没拿到目录信息', 'warn');
    if (native) native.openPath(p); else copyText(p, '数据目录已复制（浏览器里无法直接打开文件夹）');
  });
  $('#btnOpenOut').addEventListener('click', async () => {
    const p = pathsOf().out;
    if (!p) return toast('还没拿到目录信息', 'warn');
    if (native) native.openPath(p); else copyText(p, '产物目录已复制');
  });
  $('#btnCopyPaths').addEventListener('click', () => {
    const p = pathsOf();
    copyText([`数据目录：${p.data || ''}`, `产物目录：${p.out || ''}`].join('\n'), '路径已复制');
  });

  // 内容包开关
  $('#btnPackReload').addEventListener('click', () => loadPackInfo());
  $('#btnPackToggle').addEventListener('click', async () => {
    const want = !(S.pack && S.pack.active);
    try {
      const r = await api('POST', '/api/content-pack', { enabled: want });
      S.pack = r;
      await loadPackInfo();
      // 数据变了：角色/场景/词库都要重取
      [S.characters, S.scenes] = await Promise.all([api('GET', '/api/characters'), api('GET', '/api/scenes')]);
      renderRoles(); renderScenes(); renderPool(); renderCastSelects();
      toast(want ? `内容包已启用（部位词 ${r.counts.bodyPart} 条）` : '内容包已关闭，回到基础版', 'ok', 4200);
    } catch (err) {
      toast('切换失败：' + err.message, 'bad', 5000);
    }
  });
  $('#btnRebuildExport').addEventListener('click', async () => {
    $('#btnRebuildExport').disabled = true;
    $('#btnRebuildExport').innerHTML = '<span class="spinner"></span> 重建中…';
    try {
      const r = await api('POST', '/api/export');
      toast(`导出完成：${r.characters} 卡 / ${r.prompts} 提示词 / ${r.stories} 篇`, 'ok', 6000);
      S.gallery = await api('GET', '/api/gallery');
      renderGalleryList();
    } catch (err) {
      toast('导出失败：' + err.message, 'bad');
    } finally {
      $('#btnRebuildExport').disabled = false;
      $('#btnRebuildExport').textContent = '重建导出包（out/export）';
    }
  });
}

// ───────────────────────── 视图切换 / 快捷键 ─────────────────────────

function switchView(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  if (name === 'gallery' && !S.gallery.length) {
    api('GET', '/api/gallery').then((g) => { S.gallery = g; renderGalleryList(); }).catch(() => {});
  }
  if (name === 'check' && $('#checkGrid').querySelector('.empty')) runValidate();
  if (name === 'prompts' && !$('#pChar').options.length) initPromptView();
}

function initTabs() {
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) switchView(b.dataset.view);
  });
}

function initShortcuts() {
  document.addEventListener('keydown', (e) => {
    const inField = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
    if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); if ($('#view-create').classList.contains('active')) generate(); return; }
    if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); if (S.lastStory) saveStory(); return; }
    if (e.key === 'Escape') {
      if (!$('#modal').hidden) return closeModal();
      if (S.running) return stopStream();
      return;
    }
    if (e.key === '/' && !inField) {
      e.preventDefault();
      switchView('create');
      $('#charSearch').focus();
    }
  });
}

function initModal() {
  $('#modalClose').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  $('#modalCopy').addEventListener('click', () => copyText($('#modalBody').textContent, '已复制'));
}

// ───────────────────────── 启动（等数据到位后再初始化各视图） ─────────────────────────

initTabs();
initModal();
initShortcuts();
bootstrap();

window.__ciallo = { S, api, switchView, generate };
