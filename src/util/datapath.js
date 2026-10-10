'use strict';

/**
 * 数据目录解析（三种运行形态都要能写盘）
 *
 * 优先级：
 *   1. 环境变量 CIALLO_DATA_DIR        —— 测试/自定义
 *   2. Electron 桌面版 → app.getPath('userData')
 *      Windows: %APPDATA%\CialloForge · macOS: ~/Library/Application Support/CialloForge
 *   3. exe 同级存在 portable.marker     —— 便携模式，数据放 exe 边上（U 盘可用）
 *   4. 默认：项目目录                    —— 开发 / CLI 使用，行为与以前完全一致
 *
 * 首次使用时会把内置的 data/*.json 释放到目标目录（不覆盖已存在的文件）。
 */

const fs = require('fs');
const path = require('path');

/**
 * 内置资源根目录。默认是代码所在目录（打包后 fs 也能读 asar 内路径）。
 * CIALLO_BUILTIN_ROOT / CIALLO_BUILTIN_DATA 可覆盖 —— 内容包演练与测试用。
 */
const BUILTIN_ROOT = process.env.CIALLO_BUILTIN_ROOT
  ? path.resolve(process.env.CIALLO_BUILTIN_ROOT)
  : path.resolve(__dirname, '..', '..');
const BUILTIN_DATA = process.env.CIALLO_BUILTIN_DATA
  ? path.resolve(process.env.CIALLO_BUILTIN_DATA)
  : path.join(BUILTIN_ROOT, 'data');

let resolved = null;

function isWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.write-probe');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function electronUserData() {
  try {
    // 只在 Electron 主进程里可用；纯 Node 下 require 会返回路径字符串而不是对象
    const electron = require('electron');
    if (electron && typeof electron === 'object' && typeof electron.app?.getPath === 'function') {
      return path.join(electron.app.getPath('userData'), 'data');
    }
  } catch { /* 非 Electron 环境 */ }
  return null;
}

function portableDir() {
  // 便携标记：exe 或项目根目录下放一个 portable.marker，数据就落在旁边
  const roots = [path.dirname(process.execPath), BUILTIN_ROOT];
  for (const r of roots) {
    try {
      if (fs.existsSync(path.join(r, 'portable.marker'))) return path.join(r, 'data');
    } catch { /* ignore */ }
  }
  return null;
}

function resolveDataDir() {
  if (resolved) return resolved;

  const candidates = [];
  if (process.env.CIALLO_DATA_DIR) candidates.push(path.resolve(process.env.CIALLO_DATA_DIR));
  const ud = electronUserData();
  if (ud) candidates.push(ud);
  const pd = portableDir();
  if (pd) candidates.push(pd);
  candidates.push(BUILTIN_DATA);

  for (const dir of candidates) {
    const same = path.resolve(dir) === path.resolve(BUILTIN_DATA);
    if (same) { resolved = dir; return resolved; }
    if (isWritable(dir)) { resolved = dir; return resolved; }
  }
  resolved = BUILTIN_DATA;
  return resolved;
}

/** 首次运行把内置数据释放到目标目录（不覆盖已存在文件） */
function ensureSeed(force = false) {
  const target = resolveDataDir();
  if (path.resolve(target) === path.resolve(BUILTIN_DATA)) {
    return { dir: target, copied: [], mode: 'builtin' };
  }
  fs.mkdirSync(target, { recursive: true });
  const copied = [];
  for (const name of fs.readdirSync(BUILTIN_DATA)) {
    if (!name.endsWith('.json')) continue;
    const dst = path.join(target, name);
    if (!force && fs.existsSync(dst)) continue;
    fs.copyFileSync(path.join(BUILTIN_DATA, name), dst);
    copied.push(name);
  }
  return { dir: target, copied, mode: copied.length ? 'seeded' : 'ready' };
}

function dataDir() {
  return resolveDataDir();
}

function outDir() {
  const dir = path.join(path.dirname(resolveDataDir()), 'out');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = {
  BUILTIN_ROOT,
  BUILTIN_DATA,
  dataDir,
  outDir,
  resolveDataDir,
  ensureSeed,
  isWritable,
};
