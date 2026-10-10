'use strict';

/**
 * 引擎数据访问层：角色卡 / 场景库 / 散文池 / 语音寄存器。
 * 全局单例缓存，避免每次 CLI 调用重复读盘。
 */

const io = require('../util/io');
const { readJSONAnywhere } = io;
const pack = require('../util/content-pack');

let cache = null;
let lastPackError = null;
let lastPackSync = null;

/**
 * 有内容包时，先把「基础数据 + 包」的合并结果固化到数据目录一次。
 * 之后所有读写都发生在数据目录里 —— 用户在界面上的改动（改配对、改设置）不会被包覆盖。
 */
function syncContentPack() {
  let dir = null;
  try {
    dir = pack.activeDir();
  } catch {
    return null;
  }
  if (!dir) return null;
  try {
    if (pack.isDisabledByPointer()) return null;
    const manifest = pack.readManifest(dir) || {};
    const stamp = `${dir}@${manifest.version || '0'}`;
    const pointer = pack.readPointer() || {};
    if (pointer.mergedStamp === stamp) return null; // 同一个包已经固化过
    const r = pack.materialize();
    io.writeJSON(pack.pointerPath(), {
      enabled: true, dir, packs: r.packs, mergedStamp: stamp, mergedAt: new Date().toISOString(),
    });
    lastPackSync = r;
    lastPackError = null;
    return r;
  } catch (err) {
    // 包坏了不能让整个程序起不来：退回基础数据，把原因挂到 status 上
    lastPackError = String((err && err.message) || err);
    return null;
  }
}

function load(force = false) {
  if (cache && !force) return cache;
  syncContentPack();
  // 可写数据目录优先，缺失时退回内置数据（打包后内置数据在 asar 内，只读）
  cache = {
    characters: readJSONAnywhere('characters.json'),
    scenes: readJSONAnywhere('scenes.json'),
    prose: readJSONAnywhere('prose.json'),
    voice: readJSONAnywhere('voice-registers.json'),
    config: readJSONAnywhere('config.json'),
  };
  return cache;
}

/** 内容包状态（界面 / CLI / 自检都读它） */
function contentPackStatus() {
  const st = pack.status();
  return { ...st, error: lastPackError, lastSync: lastPackSync };
}

/** 开关内容包：off 时把数据目录恢复成基础版；on 时强制重新合并 */
function setContentPack(on) {
  pack.setEnabled(on);
  if (on) {
    const p = pack.readPointer() || {};
    io.writeJSON(pack.pointerPath(), { ...p, enabled: true, mergedStamp: null }); // 清掉固化标记，强制重合并
  } else {
    pack.restoreBase();
  }
  lastPackSync = null;
  load(true);
  return contentPackStatus();
}

function characters() {
  return load().characters.characters;
}

function characterById(id) {
  return characters().find((c) => c.id === id);
}

/**
 * 按 id / 名字 / 别名 / 角色标签 解析，全部大小写不敏感。
 * 返回 { hit, misses }
 */
function resolveCharacters(specs) {
  const list = characters();
  const hit = [];
  const misses = [];
  for (const raw of [].concat(specs || [])) {
    const s = String(raw).trim();
    if (!s) continue;
    const low = s.toLowerCase();
    const found = list.find(
      (c) =>
        c.id.toLowerCase() === low ||
        c.name === s ||
        (c.alias || []).some((a) => a.toLowerCase() === low) ||
        (c.role || '').toLowerCase() === low ||
        (c.kinks || []).some((k) => k.toLowerCase() === low),
    );
    if (found) {
      if (!hit.includes(found)) hit.push(found);
    } else {
      misses.push(s);
    }
  }
  return { hit, misses };
}

/** 按 kink / 标签 / 热度 反查角色 */
function charactersByKink(kink, { minAge = 18 } = {}) {
  return characters().filter(
    (c) => (c.age || 0) >= minAge && (c.kinks || []).some((k) => k.toLowerCase() === String(kink).toLowerCase()),
  );
}

function scenes() {
  return load().scenes.scenes;
}

function sceneById(id) {
  const key = String(id || '').toLowerCase();
  return scenes().find(
    (s) => s.id.toLowerCase() === key || s.title.toLowerCase() === key || s.kinkFamily.toLowerCase() === key,
  );
}

function prose() {
  return load().prose;
}

function voiceRegisters() {
  return load().voice;
}

function registerByName(name) {
  const regs = voiceRegisters().registers || {};
  return regs[name] || null;
}

function config() {
  return load().config;
}

/** 全量校验：返回问题清单（不抛异常，交给 validator 决定严重级） */
function structuralIssues() {
  const issues = [];
  const d = load();

  for (const c of d.characters.characters) {
    if (typeof c.age !== 'number' || !Number.isFinite(c.age)) {
      issues.push({ level: 'error', code: 'AGE_MISSING', target: c.id, msg: `角色 ${c.id} 的 age 不是数字` });
    } else if (c.age < 18) {
      issues.push({ level: 'error', code: 'AGE_MINOR', target: c.id, msg: `角色 ${c.id} age=${c.age} < 18` });
    }
    if (c.ageLock !== true) {
      issues.push({ level: 'error', code: 'AGE_UNLOCKED', target: c.id, msg: `角色 ${c.id} 未设置 ageLock:true` });
    }
    if (!c.appearance || !Array.isArray(c.appearance.tags) || c.appearance.tags.length < 8) {
      issues.push({ level: 'error', code: 'TAGS_THIN', target: c.id, msg: `角色 ${c.id} 的 appearance.tags 少于 8 条，绘图提示词质量不足` });
    }
    if (!c.voice || !c.voice.register) {
      issues.push({ level: 'error', code: 'VOICE_MISSING', target: c.id, msg: `角色 ${c.id} 缺 voice.register` });
    } else if (!(d.voice.registers || {})[c.voice.register]) {
      issues.push({ level: 'error', code: 'VOICE_UNKNOWN', target: c.id, msg: `角色 ${c.id} 的 register=${c.voice.register} 在 voice-registers.json 里不存在` });
    }
    for (const lv of ['appearance', 'body']) {
      if (!c[lv]) issues.push({ level: 'error', code: 'BLOCK_MISSING', target: c.id, msg: `角色 ${c.id} 缺 ${lv} 块` });
    }
  }

  for (const s of d.scenes.scenes) {
    if (!Array.isArray(s.acts) || s.acts.length === 0) {
      issues.push({ level: 'error', code: 'SCENE_NO_ACT', target: s.id, msg: `场景 ${s.id} 没有 acts` });
      continue;
    }
    let beats = 0;
    for (const a of s.acts) {
      beats += (a.beats || []).length;
      for (const b of a.beats || []) {
        if (!d.scenes.beatTypes.includes(b.type)) {
          issues.push({ level: 'warn', code: 'BEAT_TYPE', target: s.id, msg: `场景 ${s.id} 出现非常规 beat.type=${b.type}` });
        }
        if (b.type === 'dialogue' && (!b.dialogue || !b.dialogue.length)) {
          issues.push({ level: 'warn', code: 'DIALOGUE_EMPTY', target: s.id, msg: `场景 ${s.id} 有空的 dialogue beat` });
        }
      }
    }
    if (beats < 6) {
      issues.push({ level: 'warn', code: 'SCENE_THIN', target: s.id, msg: `场景 ${s.id} 只有 ${beats} 个 beat` });
    }
    if (typeof s.heatBase !== 'number' || s.heatBase < 1 || s.heatBase > 5) {
      issues.push({ level: 'error', code: 'HEAT_RANGE', target: s.id, msg: `场景 ${s.id} heatBase 越界` });
    }
  }

  const pools = Object.keys((d.prose.pool || {}));
  for (const need of ['sensory', 'action', 'pressure', 'climax', 'release', 'afterglow', 'interior', 'dialogue']) {
    if (!pools.includes(need)) {
      issues.push({ level: 'error', code: 'POOL_MISSING', target: need, msg: `散文池缺少 ${need}` });
    }
  }

  return issues;
}

function stats() {
  const d = load();
  const chars = d.characters.characters;
  const sc = d.scenes.scenes;
  const beats = sc.reduce((n, s) => n + s.acts.reduce((m, a) => m + (a.beats || []).length, 0), 0);
  const kinks = new Set();
  for (const c of chars) for (const k of c.kinks || []) kinks.add(k);
  for (const s of sc) kinks.add(s.kinkFamily);
  return {
    characters: chars.length,
    scenes: sc.length,
    beats,
    kinkFamilies: sc.map((s) => s.kinkFamily),
    kinkCount: kinks.size,
    tags: chars.reduce((n, c) => n + (c.appearance.tags || []).length, 0),
    registers: Object.keys((d.voice.registers || {})),
    prosePools: Object.keys(d.prose.pool || {}).length,
    heatTiers: Object.keys(d.prose.heat || {}).length,
    minAge: Math.min(...chars.map((c) => c.age)),
    maxAge: Math.max(...chars.map((c) => c.age)),
  };
}

module.exports = {
  load,
  contentPackStatus,
  setContentPack,
  characters,
  characterById,
  resolveCharacters,
  charactersByKink,
  scenes,
  sceneById,
  prose,
  voiceRegisters,
  registerByName,
  config,
  structuralIssues,
  stats,
};
