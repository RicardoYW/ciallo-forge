'use strict';

/**
 * 故事引擎：场景 → 分幕 → beat 展开 → 散文/台词 → Markdown。
 * 同一 seed + 同一场景 + 同一卡司 = 同一篇，可复现。
 */

const { Rng } = require('../util/rng');
const { squeeze, wordCount } = require('../util/text');
const ds = require('./datastore');
const { resolve, makeScope, fromPool } = require('./tokens');
const { renderLine, sampleByVoice } = require('./voice');
const { compilePrompt } = require('./prompt');

const PROSE_TYPES = ['sensory', 'action', 'interior', 'pressure', 'climax', 'release', 'afterglow'];
const DIALOGUE_TYPES = ['dialogue'];

function clampHeat(h) {
  const n = Math.round(Number(h));
  if (!Number.isFinite(n)) return 4;
  return Math.max(1, Math.min(5, n));
}

function resolveScene(sceneRef) {
  const scenes = ds.scenes();
  if (!sceneRef) return null;
  if (typeof sceneRef === 'object') return sceneRef;
  return ds.sceneById(sceneRef) || null;
}

/**
 * 组装卡司。
 * 优先级：
 *   1) 显式 --cast 的顺序即 A/B 顺序
 *   2) 场景 autoCast（默认配对，A 为主导方）
 *   3) 场景 castHint 里挑符合 leadGender 的角色当 A，再补一个异性
 *   4) 全库第一个符合 leadGender 的角色
 * leadGender：A 位应该是 male 还是 female；显式指定顺序时不强制换位。
 * autoPartner：显式只给了单人时，是否按 autoCast/异性补一个对方。
 */
function resolveCast(castRefs, scene, { autoPartner = true } = {}) {
  const all = ds.characters();
  const want = scene && scene.leadGender;
  const explicit = !!(castRefs && castRefs.length);
  const { hit, misses } = ds.resolveCharacters(castRefs || []);
  const cast = [...hit];

  const genderOf = (c) => (c && c.gender) || 'female';
  const matchesLead = (c) => !want || genderOf(c) === want;
  const byId = (id) => ds.characterById(id);

  if (!cast.length && scene) {
    const preset = (scene.autoCast || []).map(byId).filter(Boolean);
    if (preset.length) {
      cast.push(...preset);
    } else {
      const hinted = (scene.castHint || []).map(byId).filter(Boolean);
      const lead = hinted.find(matchesLead) || hinted[0] || all.find(matchesLead) || all[0];
      if (lead) {
        cast.push(lead);
        const partner = hinted.find((c) => c.id !== lead.id && genderOf(c) !== genderOf(lead))
          || hinted.find((c) => c.id !== lead.id)
          || all.find((c) => c.id !== lead.id && genderOf(c) !== genderOf(lead));
        if (partner) cast.push(partner);
      }
    }
  }

  if (!cast.length) cast.push(all.find(matchesLead) || all[0]);

  // 未显式指定卡司时，若场景预置配对的 A 位性别与期望不符，换成同组的异性
  if (!explicit && want && cast.length >= 2 && genderOf(cast[0]) !== want) {
    const idx = cast.findIndex((c, i) => i > 0 && genderOf(c) === want);
    if (idx > 0) {
      const [lead] = cast.splice(idx, 1);
      cast.unshift(lead);
    }
  } else if (!explicit && want && cast.length === 1 && genderOf(cast[0]) !== want) {
    const partner = all.find((c) => c.id !== cast[0].id && genderOf(c) === want);
    if (partner) cast.unshift(partner);
  }

  // 显式单人：按场景 autoCast 补对方（跳过自己）
  if (autoPartner && explicit && scene && cast.length === 1) {
    const lead = cast[0];
    const preset = (scene.autoCast || []).map(byId).filter((c) => c && c.id !== lead.id);
    const hinted = (scene.castHint || []).map(byId).filter((c) => c && c.id !== lead.id);
    const partner = preset.find((c) => genderOf(c) !== genderOf(lead))
      || preset[0]
      || hinted.find((c) => genderOf(c) !== genderOf(lead))
      || all.find((c) => c.id !== lead.id && genderOf(c) !== genderOf(lead));
    if (partner) cast.push(partner);
  }
  return { cast, misses, all };
}

function shareKink(c, scene) {
  if (!scene) return false;
  const fam = String(scene.kinkFamily || '').toLowerCase();
  return (c.kinks || []).some((k) => k.toLowerCase() === fam) || (c.imagery && c.imagery.scenes && c.imagery.scenes.length > 0);
}

const TOKEN_ANY = /[{｛][^{}｛｝]*[}｝]/g;
// 只剩多字符 token 才算真残留：{A}/{B} 是变量占位，不能被当残留删掉
const TOKEN_RESIDUE = /[{｛][^{}｛｝]{2,}[}｝]/g;
const PUNCT_FIX = [
  [/[ \t]{2,}/g, ' '],
  [/，{2,}/g, '，'],
  [/。{2,}/g, '。'],
  [/^[，、。；：]+/u, ''],
  [/[，、；：]+([。！？…])/gu, '$1'],
  [/[（(]\s*[)）]/g, ''],
];

function hasResidue(text) {
  TOKEN_RESIDUE.lastIndex = 0;
  return TOKEN_RESIDUE.test(String(text || ''));
}

function sanitize(text) {
  let s = squeeze(String(text || ''));
  for (const [re, rep] of PUNCT_FIX) s = s.replace(re, rep);
  if (hasResidue(s)) {
    s = s.replace(TOKEN_RESIDUE, '').replace(/[ \t]{2,}/g, ' ');
    for (const [re, rep] of PUNCT_FIX) s = s.replace(re, rep);
  }
  return squeeze(s);
}

function makeBeatScope(ctx, cast = ctx.cast) {
  const scope = makeScope({
    rng: ctx.rng,
    heat: ctx.heat,
    scene: ctx.scene,
    cast,
    prose: ctx.prose,
    index: ctx.scopeBase,
  });
  // 整篇共享的「已用句子」集合：保证补写循环不会把同一句抽两次
  if (ctx.usedGlobal) scope.used.__global = ctx.usedGlobal;
  return scope;
}

/**
 * beat → 段落文本。
 * 关键：先整段 resolve，再对残留 token 做第二轮（覆盖池子条目里嵌套的 {A}/{prop} 等）。
 */
function expandBeat(beat, ctx) {
  const { rng, heat, scene, cast, prose, scopeBase } = ctx;

  if (DIALOGUE_TYPES.includes(beat.type)) {
    const scope = makeBeatScope(ctx);
    const seedPool = beat.dialogue && beat.dialogue.length ? beat.dialogue : [];
    let speaker = cast[0];
    if (beat.speaker && beat.speaker !== 'auto') {
      const found = cast.find((c) => c.id === beat.speaker || c.name === beat.speaker);
      if (found) speaker = found;
    } else if (cast.length > 1 && rng.chance(0.45)) {
      speaker = cast[1];
    }
    const seed = seedPool.length ? rng.pick(seedPool) : sampleByVoice(speaker.voice, rng);
    if (!seed) return '';
    const line = renderLine(seed, speaker.voice, rng);
    if (!line) return '';

    // 说话人代入 V 位；A/B 保持「主导方/对方」不变
    scope.V = speaker;
    scope.speaker = speaker;
    scope.line = line;

    const explicit = beat.text && String(beat.text).trim() ? String(beat.text) : null;
    const tpl = explicit || (cast.length > 1 ? '{V}：『{line}』{voice}。' : '『{line}』{voice}。');
    const out = sanitize(resolve(tpl, scope));
    if (out) return out;

    const pool = (prose.pool && prose.pool.dialogue) || [];
    const fallback = rng.pick(pool) || (cast.length > 1 ? '{A}：『{line}』' : '『{line}』');
    return sanitize(resolve(fallback, scope));
  }

  const scope = makeBeatScope(ctx);
  const tpl = beat.text || '';
  let body = tpl ? resolve(tpl, scope) : '';
  if (!String(body).trim()) {
    const pool = (prose.pool && prose.pool[beat.type]) || (prose.pool && prose.pool.action) || [];
    const line = fromPool(scope, pool, { uniqueKey: 'beat:' + beat.type, unique: true }) || '';
    if (!line) return '';
    body = resolve(line, scope);
  }
  return sanitize(body);
}

/** 密度：空拍跳过概率（fast/pwp 会砍掉铺垫型 beat） */
const TYPE_WEIGHT = {
  sensory: 1.0,
  action: 1.15,
  interior: 0.85,
  dialogue: 1.0,
  pressure: 1.2,
  climax: 1.35,
  release: 1.0,
  afterglow: 0.9,
};

class Story {
  constructor(opts = {}) {
    const cfg = ds.config();
    const g = cfg.generation || {};
    this.opts = {
      sceneRef: opts.scene || null,
      castRefs: opts.cast || [],
      heat: opts.heat,
      words: Math.max(g.minWords || 200, Math.min(g.maxWords || 8000, Number(opts.words) || g.defaultWords || 1200)),
      pacing: opts.pacing || g.defaultPacing || 'slow',
      seed: opts.seed != null ? opts.seed : Date.now(),
      title: opts.title || null,
      kink: opts.kink || null,
      autoPartner: opts.autoPartner !== false,
      lead: opts.lead || 'auto',
    };
    this.cfg = cfg;
  }

  /** 选定场景：显式指定 > kink 匹配 > 第一个 */
  pickScene() {
    const explicit = resolveScene(this.opts.sceneRef);
    if (explicit) return explicit;
    if (this.opts.kink) {
      const found = ds.scenes().find((s) => s.kinkFamily.toLowerCase() === String(this.opts.kink).toLowerCase());
      if (found) return found;
    }
    return ds.scenes()[0];
  }

  /**
   * 生成/调整卡司顺序。
   * lead 参数：'male' / 'female' / 'auto'（默认 auto = 听场景的 leadGender）
   */
  resolveCastFor(scene, lead = 'auto') {
    const sceneForCast = scene && lead && lead !== 'auto' && lead !== scene.leadGender
      ? { ...scene, leadGender: lead }
      : scene;
    const { cast, misses } = resolveCast(this.opts.castRefs, sceneForCast, { autoPartner: this.opts.autoPartner });
    return { cast, misses, sceneForCast };
  }

  build() {
    const scene = this.pickScene();
    const prose = ds.prose();
    const { cast, misses } = this.resolveCastFor(scene, this.opts.lead);
    const heat = clampHeat(this.opts.heat != null ? this.opts.heat : scene ? scene.heatBase : 4);
    const pacing = (this.cfg.pacing || {})[this.opts.pacing] || { label: this.opts.pacing, proseRatio: 0.4, expand: 1.0 };

    const rng = new Rng(`story:${this.opts.seed}`);
    const target = Math.round(this.opts.words * (pacing.expand || 1));
    const ctx = { rng, heat, scene, cast, prose, scopeBase: 0, usedGlobal: new Set() };

    const sections = [];
    let idx = 0;
    let words = 0;

    for (const act of scene.acts) {
      const paras = [];
      for (const beat of act.beats || []) {
        ctx.scopeBase = idx++;
        // 快节奏档位：砍掉部分铺垫型 beat
        if ((this.opts.pacing === 'fast' || this.opts.pacing === 'pwp') && beat.type === 'interior' && rng.chance(0.7)) continue;
        if ((this.opts.pacing === 'pwp') && (beat.type === 'sensory' || beat.type === 'interior') && rng.chance(0.8)) continue;
        const text = expandBeat(beat, ctx);
        if (text) {
          paras.push(text);
          words += wordCount(text);
        }
      }
      if (paras.length) sections.push({ name: act.name, paras: paras.slice() });
    }

    // 补足字数：循环扩展 pressure / action / climax / afterglow / sensory / release，
    // 池子里的句子整篇只用一次（unique），抽空即结束，绝不整段复用。
    const fillTypes = ['pressure', 'action', 'climax', 'afterglow', 'sensory', 'release'];
    let guard = 0;
    let emptyStreak = 0;
    while (words < target && guard < 600 && emptyStreak < fillTypes.length * 2) {
      const t = fillTypes[guard % fillTypes.length];
      guard++;
      ctx.scopeBase = idx++;
      const text = expandBeat({ type: t, text: null }, ctx);
      if (!text) {
        emptyStreak++;
        continue;
      }
      emptyStreak = 0;
      const last = sections[sections.length - 1];
      if (last) last.paras.push(text);
      words += wordCount(text);
    }

    // 质量指标：重复段比例 + 短句段比例 + 泄漏的性别代词
    const allParas = sections.flatMap((s) => s.paras);
    const uniq = new Set(allParas);
    const shortParas = allParas.filter((p) => p.length < 12).length;
    const genderLeak = allParas.filter((p) => /[他她]/.test(p)).length;

    const meta = {
      title: this.opts.title || scene.title,
      scene: { id: scene.id, title: scene.title, kinkFamily: scene.kinkFamily, heatBase: scene.heatBase, location: scene.location },
      heat,
      pacing: { key: this.opts.pacing, ...pacing },
      seed: this.opts.seed,
      words: wordCount(allParas.join('')),
      targetWords: this.opts.words,
      paragraphs: allParas.length,
      duplicateParagraphs: allParas.length - uniq.size,
      shortParagraphs: shortParas,
      genderPronounParagraphs: genderLeak,
      cast: cast.map((c) => ({
        id: c.id,
        name: c.name,
        age: c.age,
        gender: c.gender || 'female',
        role: c.role,
        ageLock: c.ageLock === true,
        register: c.voice && c.voice.register,
      })),
      lead: cast[0] ? cast[0].gender || 'female' : null,
      pairing: cast.length >= 2
        ? (cast.slice(0, 2).every((c) => (c.gender || 'female') === (cast[0].gender || 'female')) ? 'same-sex' : 'mixed')
        : 'solo',
      sceneLeadGender: scene.leadGender || null,
      unresolvedCast: misses,
      mood: scene.mood || [],
      kinkNote: (prose.kinkNote || {})[scene.kinkFamily] || '',
    };

    return { meta, sections, scene, cast, heat, rng };
  }

  markdown() {
    const built = this.build();
    return renderMarkdown(built, this.opts);
  }

  json() {
    const built = this.build();
    return { ...built.meta, sections: built.sections };
  }
}

function renderMarkdown(built, opts = {}) {
  const { meta, sections, scene, cast, heat } = built;
  const L = [];
  L.push(`# ${meta.title}`);
  L.push('');
  L.push(`> 全员成年（年龄锁 18+）· 场景 ${meta.scene.id} ${meta.scene.title} · 热度 ${meta.heat}/5 · 节奏 ${meta.pacing.label} · seed ${meta.seed}`);
  L.push('');
  L.push(`**卡司**：${cast.map((c) => `${c.name}（${c.age} 岁${c.gender === 'male' ? ' · 男' : c.gender === 'female' ? ' · 女' : ''} · ${c.role}）`).join('、')}`);
  if (meta.pairing) L.push(`**配对**：${meta.pairing === 'mixed' ? '男女向' : meta.pairing === 'same-sex' ? '同性向' : '单人'}（主导方 ${cast[0] ? cast[0].name : '—'}）`);
  L.push('');
  L.push(`**场景**：${meta.scene.location} · 关键词 ${meta.scene.kinkFamily} · 氛围 ${meta.mood.join('、')}`);
  if (meta.kinkNote) L.push(`**基调**：${meta.kinkNote}`);
  if (meta.unresolvedCast && meta.unresolvedCast.length) {
    L.push(`**未识别的卡司参数**：${meta.unresolvedCast.join('、')}（已忽略）`);
  }
  L.push('');
  L.push('---');
  L.push('');

  for (const sec of sections) {
    L.push(`## ${sec.name}`);
    L.push('');
    for (const p of sec.paras) {
      L.push(p);
      L.push('');
    }
  }

  L.push('---');
  L.push('');
  L.push('## 附录 · 出场角色卡');
  L.push('');
  for (const c of cast) {
    L.push(`### ${c.name} · ${c.role} · ${c.age} 岁（成年锁）`);
    L.push('');
    L.push(`- 定位：${c.personality.core}`);
    L.push(`- 表层：${c.personality.surface}`);
    L.push(`- 阴影：${c.personality.shadow}`);
    L.push(`- 声线：${c.voice.register} — ${(c.voice.samples || [])[0] || ''}`);
    L.push(`- 癖好：${(c.kinks || []).join('、')}`);
    L.push('');
  }

  L.push('## 附录 · 配图提示词');
  L.push('');
  const p = compilePrompt({ character: cast[0], scene, cast, heat, rating: heat >= 4 ? 'explicit' : 'nsfw', target: 'sdxl', seed: meta.seed });
  L.push('**正向**');
  L.push('```');
  L.push(p.positive);
  L.push('```');
  L.push('**负向**');
  L.push('```');
  L.push(p.negative);
  L.push('```');
  L.push(`**参数**：\`${JSON.stringify(p.params)}\``);
  L.push('');
  L.push(`_字数：${meta.words} / 目标 ${meta.targetWords}（+${Math.max(0, meta.words - meta.targetWords)}）_`);

  return L.join('\n');
}

/** 便捷入口 */
function generate(opts) {
  const s = new Story(opts);
  return s.markdown();
}

function generateJSON(opts) {
  const s = new Story(opts);
  return s.json();
}

/** 批量：一次跑多场景 / 多 seed */
function generateBatch({ scenes: sceneRefs = [], cast = [], heat, words, pacing, seeds = [1], ...rest } = {}) {
  const out = [];
  const list = sceneRefs.length ? sceneRefs : ds.scenes().map((s) => s.id);
  for (const sc of list) {
    for (const seed of seeds) {
      const s = new Story({ scene: sc, cast, heat, words, pacing, seed, ...rest });
      out.push({ scene: typeof sc === 'string' ? sc : sc.id, seed, markdown: s.markdown() });
    }
  }
  return out;
}

module.exports = { Story, generate, generateJSON, generateBatch, renderMarkdown, PROSE_TYPES };
