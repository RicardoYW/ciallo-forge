'use strict';

/**
 * GUI 后端 API。
 * 全部端点都调用既有 engine —— 不复制任何生成逻辑，界面与 CLI 必然一致。
 */

const fs = require('fs');
const path = require('path');
const io = require('../util/io');
const ds = require('../engine/datastore');
const promptEngine = require('../engine/prompt');
const { Story } = require('../engine/story');
const V = require('../engine/validate');

const GALLERY_DIR = path.join(io.OUT_DIR, 'gallery');
const EXPORT_DIR = path.join(io.OUT_DIR, 'export');

class ApiError extends Error {
  constructor(message, code = 'BAD_REQUEST', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function num(v, dflt) {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

function str(v, dflt = '') {
  return v == null ? dflt : String(v);
}

function bool(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (v == null || v === '') return [];
  return String(v).split(',').map((x) => x.trim()).filter(Boolean);
}

/** 文件名净化：只允许单层、白名单字符 */
function safeName(name, ext = '.md') {
  const base = str(name, 'untitled')
    .replace(/[\\/]/g, '-')
    .replace(/[<>:"|?*\u0000-\u001f]/g, '')
    .replace(/\.\./g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 80);
  const clean = base || 'untitled';
  return clean.toLowerCase().endsWith(ext.toLowerCase()) ? clean : clean + ext;
}

function withinOut(abs) {
  const out = path.resolve(io.OUT_DIR);
  const target = path.resolve(abs);
  return target === out || target.startsWith(out + path.sep);
}

// ───────────────────────── 只读 ─────────────────────────

function stats() {
  const st = ds.stats();
  const chars = ds.characters();
  const p = io.paths();
  return {
    ...st,
    male: chars.filter((c) => c.gender === 'male').length,
    female: chars.filter((c) => c.gender === 'female').length,
    registers: (ds.voiceRegisters().registers ? Object.keys(ds.voiceRegisters().registers) : []),
    scenes: ds.scenes().length,
    beats: st.beats,
    version: require('../../package.json').version,
    node: process.version,
    root: p.root,
    paths: p,
    desktop: !!process.versions.electron,
    electron: process.versions.electron || null,
    chrome: process.versions.chrome || null,
  };
}

/** 数据与产物目录（桌面版与程序目录分开，界面要能展示给用户） */
function paths() {
  return io.paths();
}

/** 内容包状态 */
function contentPack() {
  return {
    ...ds.contentPackStatus(),
    counts: {
      characters: ds.characters().length,
      scenes: ds.scenes().length,
      bodyPart: (ds.prose().bodyPart || []).length,
      fluid: (ds.prose().fluid || []).length,
    },
  };
}

/** 开关内容包（关掉会把数据目录恢复成基础版） */
function setContentPack(body = {}) {
  const on = body.enabled === true || body.enabled === 'true' || body.on === true;
  const st = ds.setContentPack(on);
  return {
    ...st,
    counts: {
      characters: ds.characters().length,
      scenes: ds.scenes().length,
      bodyPart: (ds.prose().bodyPart || []).length,
      fluid: (ds.prose().fluid || []).length,
    },
  };
}

function characters(query) {
  const gender = str(query.gender || query.g, '');
  const q = str(query.q, '').toLowerCase();
  const kink = str(query.kink, '').toLowerCase();
  let list = ds.characters();
  if (gender === 'male' || gender === 'female') list = list.filter((c) => (c.gender || 'female') === gender);
  if (kink) list = list.filter((c) => (c.kinks || []).some((k) => k.toLowerCase() === kink));
  if (q) {
    list = list.filter((c) =>
      [c.id, c.name, c.role, c.occupation, ...(c.alias || []), ...(c.kinks || [])]
        .join(' ').toLowerCase().includes(q));
  }
  return list.map((c) => ({
    id: c.id,
    name: c.name,
    alias: c.alias || [],
    role: c.role,
    gender: c.gender || 'female',
    age: c.age,
    ageLock: c.ageLock === true,
    occupation: c.occupation,
    height: c.height,
    body: c.body,
    appearance: c.appearance,
    personality: c.personality,
    voice: c.voice,
    background: c.background,
    kinks: c.kinks || [],
    limits: c.limits || [],
    relations: c.relations || {},
    imagery: c.imagery,
    validation: V.validateCharacter(c),
  }));
}

function scenes() {
  return ds.scenes().map((s) => {
    const cast = (s.autoCast || []).map((id) => {
      const c = ds.characterById(id);
      return c ? { id: c.id, name: c.name, gender: c.gender || 'female', age: c.age, role: c.role } : null;
    }).filter(Boolean);
    return {
      id: s.id,
      title: s.title,
      kinkFamily: s.kinkFamily,
      heatBase: s.heatBase,
      location: s.location,
      mood: s.mood || [],
      castHint: s.castHint || [],
      autoCast: s.autoCast || [],
      cast,
      leadGender: s.leadGender || null,
      tags: s.tags || [],
      camera: s.camera || [],
      beats: s.acts.reduce((n, a) => n + (a.beats || []).length, 0),
      acts: s.acts.map((a) => ({
        name: a.name,
        beats: a.beats.map((b) => ({ type: b.type, tags: b.tags || [], text: b.text || null, dialogue: b.dialogue || [] })),
      })),
    };
  });
}

function prosePools() {
  const p = ds.prose();
  const pools = {};
  for (const [k, arr] of Object.entries(p.pool || {})) {
    pools[k] = {
      count: arr.length,
      sample: arr.slice(0, 3).map((x) => String(x)),
    };
  }
  const tier = {};
  for (const [k, list] of Object.entries(p.bodyPart || {})) void k;
  const heatDist = {};
  for (const arr of [p.bodyPart, p.garment, p.fluid]) {
    for (const item of arr || []) {
      const m = item && item.min ? item.min : 1;
      heatDist[m] = (heatDist[m] || 0) + 1;
    }
  }
  return {
    pools,
    heat: p.heat,
    intensityWord: p.intensityWord,
    bodyPart: p.bodyPart,
    garment: p.garment,
    fluid: p.fluid,
    reactionTiers: Object.keys(p.reaction || {}),
    intentTiers: Object.keys(p.intent || {}),
    dialogueVoices: Object.keys(p.dialogueVoice || {}),
    dialogueNeutral: (p.dialogueNeutral || []).map((x) => x.text),
    kinkNote: p.kinkNote || {},
    heatDistribution: heatDist,
  };
}

function kinks() {
  const set = new Map();
  for (const s of ds.scenes()) set.set(s.kinkFamily, (set.get(s.kinkFamily) || 0) + 1);
  const charKinks = new Set();
  for (const c of ds.characters()) for (const k of c.kinks || []) charKinks.add(k);
  return {
    sceneFamilies: [...set.entries()].map(([name, count]) => ({ name, count })),
    characterKinks: [...charKinks].sort(),
  };
}

// ───────────────────────── 生成 ─────────────────────────

function normalizeStoryOpts(body = {}) {
  const cast = asArray(body.cast);
  const words = Math.max(200, Math.min(8000, num(body.words, 1500)));
  const heatRaw = body.heat;
  return {
    scene: str(body.scene, '') || null,
    cast,
    heat: heatRaw == null || heatRaw === '' ? undefined : Math.max(1, Math.min(5, num(heatRaw, 4))),
    words,
    pacing: ['slow', 'balanced', 'fast', 'pwp'].includes(str(body.pacing)) ? str(body.pacing) : 'slow',
    seed: body.seed == null || body.seed === '' ? Date.now() : (typeof body.seed === 'number' ? body.seed : str(body.seed)),
    title: str(body.title, '') || null,
    lead: ['male', 'female', 'auto'].includes(str(body.lead)) ? str(body.lead) : 'auto',
    autoPartner: body.autoPartner === undefined ? true : bool(body.autoPartner),
  };
}

function buildStory(body) {
  const opts = normalizeStoryOpts(body);
  const story = new Story(opts);
  const md = story.markdown();
  const json = story.json();
  return { md, meta: json, opts };
}

function planStory(body) {
  const opts = normalizeStoryOpts(body);
  const story = new Story(opts);
  const built = story.build();
  return {
    scene: {
      id: built.scene.id, title: built.scene.title, kinkFamily: built.scene.kinkFamily,
      heatBase: built.scene.heatBase, location: built.scene.location, mood: built.scene.mood,
    },
    cast: built.cast.map((c) => ({ id: c.id, name: c.name, gender: c.gender, age: c.age, role: c.role })),
    leadGender: built.cast[0] ? built.cast[0].gender : null,
    heat: built.heat,
    words: built.meta.words,
    targetWords: built.meta.targetWords,
    pacing: built.meta.pacing,
    pairing: built.meta.pairing,
    sections: built.sections.length,
    seed: built.meta.seed,
  };
}

function compilePrompts(body = {}) {
  const chars = asArray(body.char || body.chars);
  const sceneIds = asArray(body.scene || body.scenes);
  const targets = asArray(body.target || body.targets);
  const heat = Math.max(1, Math.min(5, num(body.heat, 4)));
  const rating = ['safe', 'suggestive', 'nsfw', 'explicit'].includes(str(body.rating))
    ? str(body.rating)
    : (heat >= 4 ? 'explicit' : heat >= 3 ? 'nsfw' : 'suggestive');
  const seedBase = num(body.seed, 1000);
  const extras = asArray(body.extra);

  const targetList = (() => {
    const wanted = targets.length ? targets : ['sdxl'];
    if (wanted.includes('all')) return Object.keys(promptEngine.TARGETS);
    for (const t of wanted) {
      if (!promptEngine.TARGETS[t]) throw new ApiError(`未知目标格式 ${t}`, 'BAD_TARGET');
    }
    return wanted;
  })();
  let charList = chars.length ? ds.resolveCharacters(chars).hit : [ds.characters()[0]];
  if (String(body.char || '').toLowerCase() === 'all' || body.all) charList = ds.characters();
  if (!charList.length) throw new ApiError('找不到指定角色', 'NO_CHARACTER', 404);

  const sceneList = (() => {
    if (!sceneIds.length) return [null];
    if (sceneIds.map((x) => String(x).toLowerCase()).includes('all')) return ds.scenes();
    const found = sceneIds.map((id) => ds.sceneById(id)).filter(Boolean);
    if (!found.length) throw new ApiError('找不到指定场景', 'NO_SCENE', 404);
    return found;
  })();

  const items = [];
  for (const ch of charList) {
    for (const scene of sceneList) {
      for (const target of targetList) {
        const partnerId = scene && scene.autoCast ? scene.autoCast.find((id) => id !== ch.id) : null;
        const partner = partnerId ? ds.characterById(partnerId) : null;
        const p = promptEngine.compilePrompt({
          character: ch,
          scene,
          cast: partner ? [ch, partner] : [ch],
          heat: scene && scene.heatBase ? Math.max(heat, scene.heatBase) : heat,
          rating,
          target,
          seed: seedBase + items.length,
          extras,
        });
        items.push({ ...p, validation: V.validatePrompt(p) });
      }
    }
  }
  return { count: items.length, heat, rating, targets: targetList, items };
}

function validateAll() {
  const report = V.validateAll();
  return {
    ok: report.ok,
    summary: report.summary,
    characters: report.characters,
    scenes: report.scenes,
    structural: report.structural,
    failed: report.failed,
    gate: (() => {
      const minor = { id: 'X99', name: '门禁样本', age: 17, ageLock: true, appearance: { tags: ['x'] }, body: {}, personality: { core: 'x' }, voice: { register: 'slow-tease' } };
      const r = V.validateCharacter(minor);
      const scan = V.scanText('loli, elementary school, flat child', { hasAgeLock: false });
      const pass = V.scanText('adult, 18 years old, petite, 幼态妆', { hasAgeLock: true });
      let engineThrows = false;
      try {
        promptEngine.compilePrompt({ character: { ...minor, age: 15 }, target: 'sdxl' });
      } catch { engineThrows = true; }
      return { minorRejected: !r.ok, minorReason: r.errors.join('；'), scanRejected: !scan.ok, scanReason: scan.reason, adultStylingPassed: pass.ok, adultReason: pass.reason, engineThrows };
    })(),
  };
}

// ───────────────────────── 文件 ─────────────────────────

function listOut() {
  const entries = [];
  const root = io.OUT_DIR;
  if (!fs.existsSync(root)) return entries;
  for (const name of fs.readdirSync(root)) {
    const p = path.join(root, name);
    const st = fs.statSync(p);
    if (st.isFile() && /\.(md|json|csv|html|log)$/i.test(name)) {
      entries.push({ rel: name, size: st.size, mtime: st.mtimeMs, kind: 'file' });
    } else if (st.isDirectory()) {
      const inner = fs.readdirSync(p).filter((f) => /\.(md|json|csv|html)$/i.test(f));
      entries.push({ rel: name + '/', size: inner.length, mtime: st.mtimeMs, kind: 'dir', files: inner.slice(0, 200) });
    }
  }
  return entries.sort((a, b) => b.mtime - a.mtime);
}

function readOutFile(rel) {
  const abs = path.resolve(io.OUT_DIR, str(rel));
  if (!withinOut(abs)) throw new ApiError('路径越界', 'FORBIDDEN', 403);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new ApiError('文件不存在', 'NOT_FOUND', 404);
  const st = fs.statSync(abs);
  if (st.size > 4 * 1024 * 1024) throw new ApiError('文件过大（>4MB）', 'TOO_LARGE', 413);
  return { rel: str(rel), size: st.size, mtime: st.mtimeMs, content: fs.readFileSync(abs, 'utf8') };
}

function saveStory(body = {}) {
  const md = str(body.md);
  if (!md) throw new ApiError('没有可保存的内容', 'EMPTY');
  const name = safeName(body.name || `story-${Date.now()}`, '.md');
  const dir = str(body.dir, 'stories').replace(/[\\/]/g, '');
  const target = path.join(io.OUT_DIR, dir || 'stories', name);
  if (!withinOut(target)) throw new ApiError('目标路径越界', 'FORBIDDEN', 403);
  io.writeText(target, md);
  return { path: path.relative(io.ROOT, target), rel: path.relative(io.OUT_DIR, target).replace(/\\/g, '/'), bytes: Buffer.byteLength(md, 'utf8') };
}

function savePrompts(body = {}) {
  const payload = body.payload || compilePrompts(body);
  const stamp = new Date().toISOString().slice(0, 10);
  const base = safeName(body.name || `prompts-${stamp}`, '').replace(/\.$/, '');
  const dir = path.join(io.OUT_DIR, 'prompts');
  io.ensureDir(dir);
  const jsonPath = path.join(dir, `${base}.json`);
  const mdPath = path.join(dir, `${base}.md`);
  const csvPath = path.join(dir, `${base}.csv`);
  io.writeJSON(jsonPath, { generatedAt: new Date().toISOString(), ...payload });

  const fmt = typeof body.format === 'string' && body.format ? body.format.split(',') : ['md', 'csv'];
  if (fmt.includes('md')) io.writeText(mdPath, promptsToMarkdown(payload));
  if (fmt.includes('csv')) io.writeText(csvPath, promptsToCsv(payload));
  return {
    json: path.relative(io.ROOT, jsonPath),
    md: fmt.includes('md') ? path.relative(io.ROOT, mdPath) : null,
    csv: fmt.includes('csv') ? path.relative(io.ROOT, csvPath) : null,
    count: payload.count || (payload.items || []).length,
  };
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function promptsToCsv(payload) {
  const rows = [['id', 'character', 'scene', 'target', 'heat', 'rating', 'tokens_pos', 'tokens_neg', 'positive', 'negative']];
  for (const it of payload.items || []) {
    rows.push([it.id, it.character, it.scene || '', it.target, it.heat, it.rating,
      it.tokenCount && it.tokenCount.positive, it.tokenCount && it.tokenCount.negative, it.positive, it.negative]);
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function promptsToMarkdown(payload) {
  const L = ['# 夜织 · 提示词包', '', `> 生成时间 ${payload.generatedAt || new Date().toISOString()} · heat ${payload.heat} · 评级 ${payload.rating} · 共 ${(payload.items || []).length} 条`, ''];
  for (const it of payload.items || []) {
    L.push(`## ${it.character}${it.scene ? ' × ' + it.scene : ''} → ${it.target}`);
    L.push('', '**正向**', '```', it.positive, '```', '**负向**', '```', it.negative, '```');
    L.push(`**参数**：\`${JSON.stringify(it.params)}\``);
    if (it.mjCommand) L.push('', '**Midjourney**', '```', it.mjCommand, '```');
    if (it.nai) L.push('', '**NovelAI**', '```json', JSON.stringify(it.nai, null, 2), '```');
    if (it.workflow) L.push('', '**ComfyUI**', '```json', JSON.stringify(it.workflow, null, 2), '```');
    L.push('');
  }
  return L.join('\n');
}

function listGallery() {
  if (!fs.existsSync(GALLERY_DIR)) return [];
  return fs.readdirSync(GALLERY_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const abs = path.join(GALLERY_DIR, f);
      const st = fs.statSync(abs);
      const content = fs.readFileSync(abs, 'utf8');
      const m = f.match(/^(S\d+)-(.*)\.md$/);
      const title = (content.match(/^# (.+)$/m) || [, m ? m[2] : f])[1];
      const cast = (content.match(/^\*\*卡司\*\*：(.+)$/m) || [, ''])[1];
      const pair = (content.match(/^\*\*配对\*\*：(.+)$/m) || [, ''])[1];
      const heatTag = (content.match(/热度 (\d)\/5/) || [, ''])[1];
      const words = content.replace(/\s/g, '').length;
      return { file: f, scene: m ? m[1] : '', title, cast, pairing: pair, heat: Number(heatTag) || null, size: st.size, chars: words, mtime: st.mtimeMs };
    })
    .sort((a, b) => (a.scene > b.scene ? 1 : -1));
}

// ───────────────────────── 设置 / 配对 ─────────────────────────

function getSettings() {
  const cfg = ds.config();
  const c = JSON.parse(JSON.stringify(cfg));
  return {
    generation: c.generation || {},
    pacing: c.pacing || {},
    prompt: c.prompt || {},
    safety: { ageLock: (c.safety || {}).ageLock, requireAgeLock: (c.safety || {}).requireAgeLock, wordCounts: { minor: ((c.safety || {}).minorCodeWords || []).length, adult: ((c.safety || {}).adultCodeWords || []).length } },
    ui: c.ui || { theme: 'dark', lastScene: null },
  };
}

function saveSettings(body = {}) {
  const file = io.dataFile('config.json');
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const allow = ['generation', 'pacing', 'prompt', 'ui'];
  for (const key of allow) {
    if (body[key] && typeof body[key] === 'object') {
      cfg[key] = { ...(cfg[key] || {}), ...body[key] };
    }
  }
  if (cfg.generation) {
    cfg.generation.minWords = Math.max(100, Math.min(8000, num(cfg.generation.minWords, 200)));
    cfg.generation.maxWords = Math.max(cfg.generation.minWords, Math.min(20000, num(cfg.generation.maxWords, 8000)));
    cfg.generation.defaultWords = Math.max(cfg.generation.minWords, Math.min(cfg.generation.maxWords, num(cfg.generation.defaultWords, 1500)));
    cfg.generation.defaultHeat = Math.max(1, Math.min(5, num(cfg.generation.defaultHeat, 4)));
  }
  io.writeJSON(file, cfg);
  ds.load(true);
  return getSettings();
}

/** 就地修改场景默认配对（写回 data/scenes.json） */
function updatePairing(body = {}) {
  const sceneId = str(body.scene, '');
  const next = asArray(body.cast);
  const scene = ds.sceneById(sceneId);
  if (!scene) throw new ApiError(`场景 ${sceneId} 不存在`, 'NO_SCENE', 404);
  if (next.length !== 2) throw new ApiError('配对必须是两个角色', 'BAD_CAST');
  const [a, b] = next.map((id) => ds.characterById(id));
  if (!a || !b) throw new ApiError('配对里有不存在的角色', 'NO_CHARACTER', 404);
  if (a.id === b.id) throw new ApiError('配对不能是同一个人', 'SAME_CHARACTER');
  if ((a.gender || 'female') === (b.gender || 'female')) {
    throw new ApiError('默认配对必须是男女组合（想配同性请用 --cast 显式指定）', 'SAME_GENDER');
  }

  const file = io.dataFile('scenes.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const target = data.scenes.find((s) => s.id === scene.id);
  if (!target) throw new ApiError('数据文件里找不到该场景', 'NO_SCENE', 404);
  target.autoCast = [a.id, b.id];
  target.leadGender = a.gender || 'female';
  io.writeJSON(file, data);
  ds.load(true);
  return {
    scene: target.id,
    autoCast: target.autoCast,
    leadGender: target.leadGender,
    cast: [a, b].map((c) => ({ id: c.id, name: c.name, gender: c.gender, age: c.age, role: c.role })),
  };
}

async function rebuildExport() {
  const promptEngineTargets = Object.keys(promptEngine.TARGETS);
  const chars = ds.characters();
  const scenes = ds.scenes();
  io.ensureDir(EXPORT_DIR);

  // 1) 角色卡
  io.writeJSON(path.join(EXPORT_DIR, 'characters.json'), {
    exportedAt: new Date().toISOString(),
    characters: chars.map((c) => ({ ...c, validation: V.validateCharacter(c) })),
  });

  // 2) 提示词全矩阵
  const items = [];
  for (const ch of chars) {
    for (const scene of scenes) {
      for (const target of promptEngineTargets) {
        const partnerId = (scene.autoCast || []).find((id) => id !== ch.id);
        const partner = partnerId ? ds.characterById(partnerId) : null;
        const p = promptEngine.compilePrompt({
          character: ch, scene, cast: partner ? [ch, partner] : [ch],
          heat: Math.max(4, scene.heatBase), rating: 'explicit', target, seed: 1000 + items.length,
        });
        items.push({ ...p, validation: V.validatePrompt(p) });
      }
    }
  }
  const payload = { generatedAt: new Date().toISOString(), count: items.length, heat: 4, rating: 'explicit', items };
  io.writeJSON(path.join(EXPORT_DIR, 'prompts.json'), payload);
  io.writeText(path.join(EXPORT_DIR, 'prompts.md'), promptsToMarkdown({ ...payload, items: items.filter((i) => i.target === 'sdxl') }));
  io.writeText(path.join(EXPORT_DIR, 'prompts.csv'), promptsToCsv({ items: items.filter((i) => i.target === 'sdxl') }));

  // 3) 样例故事（按场景 autoCast）
  const storyDir = path.join(EXPORT_DIR, 'stories');
  io.ensureDir(storyDir);
  const galleryIndex = [];
  for (const scene of scenes) {
    const story = new Story({
      scene: scene.id,
      cast: scene.autoCast || [],
      heat: Math.max(4, scene.heatBase),
      words: 1200,
      pacing: 'balanced',
      seed: 20250101,
    });
    const meta = story.json();
    const file = `${scene.id}-${scene.title}.md`;
    io.writeText(path.join(storyDir, file), story.markdown());
    galleryIndex.push(`- [${scene.id} ${scene.title}](stories/${encodeURIComponent(file)}) — ${meta.words} 字 · ${meta.cast.map((c) => c.name).join(' × ')} · ${meta.pairing === 'mixed' ? '男女向' : meta.pairing}`);
  }

  io.writeText(path.join(EXPORT_DIR, 'INDEX.md'), [
    '# 夜织 CialloForge · 导出包', '',
    `导出时间：${new Date().toISOString()}`, '',
    `- 角色卡：${chars.length} 张（♂${chars.filter((c) => c.gender === 'male').length} / ♀${chars.filter((c) => c.gender === 'female').length}）`,
    `- 绘图提示词：${items.length} 条（${chars.length} 卡 × ${scenes.length} 场景 × ${promptEngineTargets.length} 目标）`,
    `- 样例故事：${galleryIndex.length} 篇`, '',
    '## 样例故事', '', ...galleryIndex, '',
    '## 文件', '',
    '- characters.json — 角色卡 + 逐卡校验',
    '- prompts.json / prompts.md / prompts.csv — 提示词三份形态',
    '- stories/ — 每场景一篇样例', '',
  ].join('\n'));

  return { dir: path.relative(io.ROOT, EXPORT_DIR), characters: chars.length, prompts: items.length, stories: galleryIndex.length };
}

module.exports = {
  ApiError,
  stats,
  paths,
  contentPack,
  setContentPack,
  characters,
  scenes,
  prosePools,
  kinks,
  planStory,
  buildStory,
  compilePrompts,
  validateAll,
  listOut,
  readOutFile,
  saveStory,
  savePrompts,
  promptsToMarkdown,
  promptsToCsv,
  listGallery,
  getSettings,
  saveSettings,
  updatePairing,
  rebuildExport,
  safeName,
};
