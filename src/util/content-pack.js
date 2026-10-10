'use strict';

/**
 * 内容包（content pack）机制
 *
 * 设计目标：让「引擎」与「露骨内容」在仓库层面解耦。
 *   - 仓库本体（base）：引擎 + 界面 + 示例角色/场景 + heat 1-3 词库
 *   - 内容包（pack）  ：叠加在 base 之上，补上完整成人向词库与角色设定
 *
 * 查找顺序（找到第一个有效包就用）：
 *   1. 环境变量 CIALLO_PACK_DIR
 *   2. 数据目录下的 content-pack/            ← 用户放到 %APPDATA%\ciallo-forge\content-pack
 *   3. 项目根目录下的 content-pack/          ← 开发与本地分发
 *
 * 包结构：<packDir>/pack.json + 可选同名 JSON 文件（与 data/ 里的文件一一对应）
 *
 *   pack.json
 *   {
 *     "id": "adult-full",
 *     "name": "完整成人向内容包",
 *     "version": "1.0.0",
 *     "rating": "explicit",
 *     "requires": ">=1.0.0",
 *     "replaceArrays": ["characters", "scenes"],   // 这些顶层键的数组按 id 覆盖而非合并
 *     "note": "…"
 *   }
 *
 * 合并规则：
 *   - 对象：递归深合并（包优先）
 *   - 数组：'replace' 策略 → 按 id/name 匹配覆盖，新条目追加；否则整体替换
 *   - 其他：包优先
 */

const fs = require('fs');
const path = require('path');
const io = require('./io');

const PACK_FILES = ['characters.json', 'scenes.json', 'prose.json', 'voice-registers.json', 'config.json'];
const POINTER = 'content-pack.json';

function isDir(p) {
  try { return !!p && fs.statSync(p).isDirectory(); } catch { return false; }
}

function hasManifest(dir) {
  try { return fs.existsSync(path.join(dir, 'pack.json')); } catch { return false; }
}

/** 候选目录列表（按优先级） */
function candidates() {
  const list = [];
  if (process.env.CIALLO_PACK_DIR) list.push(path.resolve(process.env.CIALLO_PACK_DIR));
  list.push(path.join(path.dirname(io.DATA_DIR), 'content-pack'));
  list.push(path.join(io.ROOT, 'content-pack'));
  return [...new Set(list)];
}

/** 当前启用的内容包目录（没有则 null） */
function activeDir() {
  for (const dir of candidates()) {
    if (isDir(dir) && hasManifest(dir)) return dir;
  }
  return null;
}

function readManifest(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

/** 状态摘要：给界面/CLI 展示 */
function status() {
  const dir = activeDir();
  const disabled = isDisabledByPointer();
  if (!dir) {
    return {
      active: false,
      available: false,
      disabled: false,
      dir: null,
      candidates: candidates(),
      hint: '把内容包解压到 content-pack/（或设置 CIALLO_PACK_DIR 环境变量）后重载即可生效。',
    };
  }
  const manifest = readManifest(dir) || {};
  const files = {};
  for (const f of PACK_FILES) {
    const p = path.join(dir, f);
    if (fs.existsSync(p)) {
      try {
        const j = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
        files[f] = Array.isArray(j) ? j.length : Object.keys(j).length;
      } catch {
        files[f] = 'parse-error';
      }
    }
  }
  return {
    active: !disabled,          // 指针关掉时，即使文件夹在也不算启用
    available: true,            // 找到了包（可能被关着）
    disabled,
    dir,
    manifest,
    id: manifest.id || path.basename(dir),
    name: manifest.name || manifest.id || path.basename(dir),
    version: manifest.version || null,
    rating: manifest.rating || null,
    files,
    pointer: pointerPath(),
    hint: disabled ? '内容包已被关闭（可用 pack on 或界面开关重新启用）。' : null,
  };
}

function pointerPath() {
  return io.dataFile(POINTER);
}

function readPointer() {
  try {
    return JSON.parse(fs.readFileSync(pointerPath(), 'utf8'));
  } catch {
    return null;
  }
}

/** 打开/关闭内容包（写指针文件；关闭时写 disabled:true，用于覆盖自动发现的包） */
function setEnabled(on) {
  const dir = activeDir();
  if (on && !dir) throw new Error('没有找到内容包（把包放到 content-pack/ 或设置 CIALLO_PACK_DIR）');
  io.writeJSON(pointerPath(), {
    enabled: !!on,
    dir: on ? dir : (readPointer() || {}).dir || null,
    at: new Date().toISOString(),
  });
  return status();
}

/**
 * 是否处于「已关闭」状态。
 * 关掉之后仍然要认账：哪怕内容包文件夹还在（数据目录里也已经固化过合并结果），
 * 也不能再自动合并回来 —— 否则用户永远关不掉。
 * 判定依据：指针文件 enabled:false（本级优先），或环境变量显式禁用。
 */
function isDisabledByPointer() {
  if (String(process.env.CIALLO_PACK_DISABLE || '') === '1') return true;
  const p = readPointer();
  return !!(p && p.enabled === false);
}

// ───────────────────────── 合并 ─────────────────────────

function keyOf(item, i) {
  if (item && typeof item === 'object') return String(item.id || item.name || item.register || i);
  return String(i);
}

/** 按 id 覆盖 + 追加 */
function mergeById(base, over) {
  const out = Array.isArray(base) ? base.slice() : [];
  const idx = new Map();
  out.forEach((it, i) => idx.set(keyOf(it, i), i));
  over.forEach((it, i) => {
    const k = keyOf(it, i);
    if (idx.has(k)) out[idx.get(k)] = deepMerge(out[idx.get(k)], it);
    else out.push(it);
  });
  return out;
}

/** 顶层键 → 是否按 id 合并数组 */
function arrayIsIdKeyed(key, replaceArrays) {
  const k = String(key).toLowerCase();
  if (replaceArrays.map((x) => String(x).toLowerCase()).includes(k)) return true;
  return ['characters', 'scenes', 'registers'].includes(k);
}

/** 默认「追加而非替换」的数组字段：这些是按 `min` 分级叠加的词库 */
const DEFAULT_ADDITIVE = ['bodyPart', 'garment', 'fluid', 'verb', 'aftermath', 'dialogueNeutral'];

function isAdditiveKey(key, additive) {
  return additive.map((x) => String(x).toLowerCase()).includes(String(key).toLowerCase());
}

function deepMerge(base, over, opts = {}) {
  const { replaceArrays = [], additiveArrays = DEFAULT_ADDITIVE } = opts;
  if (over === undefined) return base;
  if (Array.isArray(base) && Array.isArray(over)) return over.slice(); // 普通数组：整体替换

  if (base && over && typeof base === 'object' && typeof over === 'object' && !Array.isArray(over)) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
        out[k] = deepMerge(out[k], v, opts);
      } else if (Array.isArray(v) && Array.isArray(out[k]) && arrayIsIdKeyed(k, replaceArrays)) {
        out[k] = mergeById(out[k], v);
      } else if (Array.isArray(v) && Array.isArray(out[k]) && isAdditiveKey(k, additiveArrays)) {
        // 分级词库：叠加（基础 1-3 档 + 包的 4-5 档），按 text 去重
        const seen = new Set(out[k].map((x) => (x && typeof x === 'object' ? x.text : x)));
        const extra = v.filter((x) => !seen.has(x && typeof x === 'object' ? x.text : x));
        out[k] = [...out[k], ...extra];
      } else {
        out[k] = v;
      }
    }
    return out;
  }
  return over;
}

/**
 * 读取合并后的数据（引擎用）
 * @returns {{data:object, packs:string[]}}
 */
function loadMergedData() {
  const names = PACK_FILES;
  const base = {};
  for (const f of names) {
    base[f] = io.readJSONAnywhere(f);
  }
  if (isDisabledByPointer()) return { data: base, packs: [] };

  const dir = activeDir();
  if (!dir) return { data: base, packs: [] };

  const manifest = readManifest(dir) || {};
  const opts = { replaceArrays: manifest.replaceArrays || [] };
  const applied = [];
  for (const f of names) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) continue;
    let patch;
    try {
      patch = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
    } catch (err) {
      throw new Error(`内容包文件解析失败 ${p}: ${err.message}`);
    }
    base[f] = deepMerge(base[f], patch, opts);
    applied.push(f);
  }
  return { data: base, packs: applied.length ? [manifest.id || path.basename(dir)] : [] };
}

/** 数据目录与内置数据目录是否同一个（开发/命令行形态下就是项目内的 data/） */
function isDataDirBuiltin() {
  try {
    return path.resolve(io.DATA_DIR) === path.resolve(io.BUILTIN_DATA);
  } catch {
    return false;
  }
}

/**
 * 把内容包写进数据目录（固化合并结果）。
 *
 * 注意：如果数据目录就是随代码分发的内置目录（开发形态下的 data/），
 * 合并结果会被写进**将要提交的文件** —— 那等于把露骨词库推上仓库。
 * 这种情况下拒绝执行，并提示改用用户数据目录（桌面版默认就是这样）。
 */
function materialize() {
  const dir = activeDir();
  if (!dir) throw new Error('没有找到内容包');
  if (isDisabledByPointer()) throw new Error('内容包被指针标记为关闭，先执行 pack on');

  if (isDataDirBuiltin()) {
    const err = new Error(
      '当前的写入目标是随代码分发的数据目录（<项目>/data），拒绝把内容包合并进去 —— '
      + '否则露骨词库会被提交到仓库。请改用用户数据目录：桌面版自动使用 %APPDATA%\\ciallo-forge；'
      + '命令行可设置环境变量 CIALLO_DATA_DIR 指向一个可写目录后再启用。',
    );
    err.code = 'PACK_REFUSES_BUILTIN';
    throw err;
  }

  const { data, packs } = loadMergedData();
  for (const f of PACK_FILES) {
    if (!data[f]) continue;
    io.writeJSON(io.dataFile(f), data[f]);
  }
  io.writeJSON(pointerPath(), { enabled: true, dir, mergedAt: new Date().toISOString(), packs });
  return { dir, packs, files: PACK_FILES.filter((f) => data[f]) };
}

/**
 * 把数据目录恢复成内置基础版（用于「关闭内容包」时把固化的合并结果撤掉）。
 * 只覆盖上游提供的这 5 个 JSON，不碰用户自建的其他文件。
 */
function restoreBase() {
  const restored = [];
  for (const f of PACK_FILES) {
    const base = path.join(io.BUILTIN_DATA, f);
    if (!fs.existsSync(base)) continue;
    const raw = JSON.parse(fs.readFileSync(base, 'utf8').replace(/^\uFEFF/, ''));
    io.writeJSON(io.dataFile(f), raw);
    restored.push(f);
  }
  return restored;
}

module.exports = {
  PACK_FILES,
  DEFAULT_ADDITIVE,
  candidates,
  activeDir,
  readManifest,
  status,
  setEnabled,
  loadMergedData,
  materialize,
  isDataDirBuiltin,
  restoreBase,
  pointerPath,
  readPointer,
  isDisabledByPointer,
  deepMerge,
  mergeById,
};
