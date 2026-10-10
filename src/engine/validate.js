'use strict';

/**
 * 校验器：年龄锁把关 + 数据完整性 + 提示词合规扫描。
 * 规则：ageLock 优先于造型词。成年角色 + 娇小/白发/幼态妆 = 造型选择，放行；
 *      只有 (a) age 缺失/非数字/小于 18，或 (b) 年龄缺失且幼态体型词占主导，才拦。
 */

const ds = require('./datastore');
const { compilePrompt } = require('./prompt');

function configWords() {
  const s = (ds.config().safety) || {};
  return {
    minor: (s.minorCodeWords || []).map((w) => w.toLowerCase()),
    adult: (s.adultCodeWords || []).map((w) => w.toLowerCase()),
    ageLock: s.ageLock || 18,
  };
}

function hitWords(text, words) {
  const low = String(text || '').toLowerCase();
  return words.filter((w) => low.includes(w));
}

/**
 * 文本扫描。
 * @returns {{ok:boolean,level:'pass'|'review'|'reject',hits:string[],adultHits:string[],reason:string}}
 */
function scanText(text, { hasAgeLock = false } = {}) {
  const { minor, adult, ageLock } = configWords();
  const numericMinor = /(?<!\d)(1[0-7]|[0-9])\s*(岁|years old|yo)(?!\d)/i.test(String(text || ''));
  const hits = hitWords(text, minor);
  const adultHits = hitWords(text, adult);
  const validAgeAnchor = hasAgeLock || adultHits.length > 0;

  if (numericMinor) {
    return { ok: false, level: 'reject', hits, adultHits, reason: `出现未成年年龄字段（<${ageLock} 岁）` };
  }
  if (hits.length && !validAgeAnchor) {
    return { ok: false, level: 'reject', hits, adultHits, reason: `出现幼态词且缺少成年锚点：${hits.join('、')}` };
  }
  if (hits.length && validAgeAnchor) {
    return { ok: true, level: 'review', hits, adultHits, reason: `命中造型类词（${hits.join('、')}），但存在成年锚点，判定为造型选择` };
  }
  return { ok: true, level: 'pass', hits, adultHits, reason: '无幼态词命中' };
}

/** 单张角色卡 */
function validateCharacter(c) {
  const errors = [];
  const warnings = [];

  if (typeof c.age !== 'number' || !Number.isFinite(c.age)) {
    errors.push(`age 不是数字（${JSON.stringify(c.age)}）`);
  } else if (c.age < 18) {
    errors.push(`age=${c.age} 小于 18`);
  }
  if (c.ageLock !== true) errors.push('ageLock 未设为 true');
  if (!c.appearance || !Array.isArray(c.appearance.tags)) errors.push('appearance.tags 缺失');
  else if (c.appearance.tags.length < 8) warnings.push(`appearance.tags 仅 ${c.appearance.tags.length} 条，提示词信息量偏薄`);
  if (!c.body) errors.push('body 块缺失');
  if (!c.personality || !c.personality.core) errors.push('personality.core 缺失');
  if (!c.voice || !c.voice.register) errors.push('voice.register 缺失');
  else if (!ds.registerByName(c.voice.register)) errors.push(`voice.register=${c.voice.register} 未在 voice-registers.json 注册`);
  if (!Array.isArray(c.kinks) || !c.kinks.length) warnings.push('未声明 kinks，场景匹配会走默认');

  const blob = JSON.stringify(c);
  const scan = scanText(blob, { hasAgeLock: c.ageLock === true && typeof c.age === 'number' && c.age >= 18 });
  if (!scan.ok) errors.push(scan.reason);

  return {
    id: c.id,
    name: c.name,
    age: c.age,
    ageLock: c.ageLock === true,
    ok: errors.length === 0,
    level: errors.length ? 'reject' : warnings.length ? 'review' : 'pass',
    errors,
    warnings,
    scanLevel: scan.level,
    scanHits: scan.hits,
  };
}

/** 全库 */
function validateAll() {
  const structural = ds.structuralIssues();
  const characters = ds.characters().map(validateCharacter);
  const scenes = ds.scenes().map((s) => {
    const errs = [];
    const warns = [];
    if (typeof s.heatBase !== 'number' || s.heatBase < 1 || s.heatBase > 5) errs.push('heatBase 越界');
    if (!Array.isArray(s.acts) || !s.acts.length) errs.push('acts 为空');
    const beats = (s.acts || []).reduce((n, a) => n + (a.beats || []).length, 0);
    if (beats < 6) warns.push(`beat 数 ${beats} 偏少`);
    if (!s.castHint || !s.castHint.length) warns.push('castHint 为空，卡司需显式指定');
    for (const h of s.castHint || []) {
      const c = ds.characterById(h);
      if (!c) errs.push(`castHint ${h} 不存在`);
      else if (!(c.age >= 18)) errs.push(`castHint ${h} 年龄未锁`);
    }
    for (const a of s.acts || []) {
      for (const b of a.beats || []) {
        if (b.type === 'dialogue' && (!b.dialogue || !b.dialogue.length) && !b.text) errs.push('存在无内容的 dialogue beat');
      }
    }
    return { id: s.id, title: s.title, heatBase: s.heatBase, beats, ok: errs.length === 0, level: errs.length ? 'reject' : warns.length ? 'review' : 'pass', errors: errs, warnings: warns };
  });

  const failed = [
    ...characters.filter((c) => !c.ok).map((c) => ({ kind: 'character', id: c.id, errors: c.errors })),
    ...scenes.filter((s) => !s.ok).map((s) => ({ kind: 'scene', id: s.id, errors: s.errors })),
    ...structural.filter((i) => i.level === 'error').map((i) => ({ kind: 'data', id: i.target, errors: [i.msg] })),
  ];

  return {
    ok: failed.length === 0,
    summary: {
      characters: characters.length,
      charactersPass: characters.filter((c) => c.ok).length,
      scenes: scenes.length,
      scenesPass: scenes.filter((s) => s.ok).length,
      minAge: Math.min(...ds.characters().map((c) => c.age)),
      structuralErrors: structural.filter((i) => i.level === 'error').length,
      structuralWarnings: structural.filter((i) => i.level === 'warn').length,
    },
    characters,
    scenes,
    structural,
    failed,
  };
}

/** 提示词校验：显式评级必须带成年锚点与幼态负向 */
function validatePrompt(prompt) {
  const errors = [];
  const warnings = [];
  const { ageLock } = configWords();
  const pos = prompt.positive || '';
  const neg = prompt.negative || '';
  const explicit = prompt.rating === 'explicit' || prompt.rating === 'nsfw' || prompt.heat >= 4;

  if (!new RegExp(`\\b${ageLock}\\b|years old`).test(pos)) errors.push('正向缺少显式年龄锚点（如 "26 years old"）');
  if (!prompt.character || typeof prompt.character !== 'string') errors.push('缺少主角色名');
  if (explicit && !/child|loli|shota|underage|minor|petite child/i.test(neg)) errors.push('显式评级下负向缺少幼态排除词');
  if (prompt.heat >= 5 && prompt.rating !== 'explicit') warnings.push('heat=5 但评级不是 explicit');
  if ((pos.split(',').length) < 20) warnings.push('正向 token 少于 20 条，画面控制力可能不足');
  if (!neg) errors.push('缺少负向提示词');

  return { ok: errors.length === 0, level: errors.length ? 'reject' : warnings.length ? 'review' : 'pass', errors, warnings, id: prompt.id };
}

/** 门禁：不合格直接抛，供引擎/CLI 调用 */
function gateCharacter(c) {
  const r = validateCharacter(c);
  if (!r.ok) throw new Error(`[age-gate] 角色 ${c.id || c.name} 未通过：${r.errors.join('；')}`);
  return true;
}

function gatePromptOptions({ character, cast = [], rating = 'explicit', heat = 4, target = 'sdxl', scene = null }) {
  const all = [character, ...cast].filter(Boolean);
  for (const c of all) gateCharacter(c);
  const prompt = compilePrompt({ character, cast, scene, heat, rating, target });
  const v = validatePrompt(prompt);
  if (!v.ok) throw new Error(`[prompt-gate] ${v.errors.join('；')}`);
  return { prompt, validation: v };
}

module.exports = {
  scanText,
  validateCharacter,
  validateAll,
  validatePrompt,
  gateCharacter,
  gatePromptOptions,
  configWords,
  hitWords,
};
