'use strict';

/**
 * 文件与路径访问层。
 *
 * 打包成桌面版后，代码在只读的 asar 里，数据必须落在可写目录 —— 所以分成两套路径：
 *   BUILTIN_ROOT / BUILTIN_DATA  代码与内置数据（只读，随程序走；来源可能是 asar）
 *   WEB_DIR                      界面静态资源（只读，随程序走）
 *   DATA_DIR                     可变数据（用户设置、改过的角色卡/场景/词库）
 *   OUT_DIR                      产物（正文、提示词、导出包、截图）
 *
 * 开发/CLI 形态下 DATA_DIR/OUT_DIR 仍等于项目内的 data/ 与 out/，行为与以前完全一致；
 * 桌面版由 electron/main.js 通过 CIALLO_DATA_DIR 指向用户数据目录。
 */

const fs = require('fs');
const path = require('path');
const datapath = require('./datapath');

const ROOT = datapath.BUILTIN_ROOT;
const BUILTIN_DATA = datapath.BUILTIN_DATA;
const WEB_DIR = path.join(ROOT, 'src', 'web');

const DATA_DIR = datapath.dataDir();
const OUT_DIR = datapath.outDir();

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 只读资源：先找可写数据目录，找不到再退回内置数据（支持 asar） */
function readJSONAnywhere(name) {
  const primary = path.join(DATA_DIR, name);
  const fallback = path.join(BUILTIN_DATA, name);
  const target = fs.existsSync(primary) ? primary : fallback;
  const raw = fs.readFileSync(target, 'utf8').replace(/^\uFEFF/, '');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`JSON 解析失败 ${target}: ${err.message}`);
  }
}

function readJSON(file) {
  const abs = path.isAbsolute(file) ? file : path.join(ROOT, file);
  if (fs.existsSync(abs)) {
    const raw = fs.readFileSync(abs, 'utf8').replace(/^\uFEFF/, '');
    try {
      return JSON.parse(raw);
    } catch (err) {
      throw new Error(`JSON 解析失败 ${abs}: ${err.message}`);
    }
  }
  // 相对路径按名字到数据目录里再找一次
  const byName = path.join(DATA_DIR, path.basename(file));
  if (fs.existsSync(byName)) return readJSONAnywhere(path.basename(file));
  const builtin = path.join(BUILTIN_DATA, path.basename(file));
  if (fs.existsSync(builtin)) return readJSONAnywhere(path.basename(file));
  throw new Error(`找不到文件 ${file}`);
}

function writeText(file, text) {
  const abs = path.isAbsolute(file) ? file : path.join(ROOT, file);
  ensureDir(path.dirname(abs));
  fs.writeFileSync(abs, text, 'utf8');
  return abs;
}

function writeJSON(file, obj) {
  return writeText(file, JSON.stringify(obj, null, 2) + '\n');
}

/** 可变数据文件（读写都在这） */
function dataFile(name) {
  ensureDir(DATA_DIR);
  return path.join(DATA_DIR, name);
}

function outFile(name) {
  return path.join(OUT_DIR, name);
}

function listData() {
  const dir = fs.existsSync(DATA_DIR) ? DATA_DIR : BUILTIN_DATA;
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
}

/** 供界面展示：数据与产物到底在哪儿 */
function paths() {
  return {
    root: ROOT,
    builtinData: BUILTIN_DATA,
    web: WEB_DIR,
    data: DATA_DIR,
    out: OUT_DIR,
    writable: (() => {
      try {
        const probe = path.join(DATA_DIR, '.probe');
        fs.writeFileSync(probe, 'ok');
        fs.unlinkSync(probe);
        return true;
      } catch {
        return false;
      }
    })(),
    mode: path.resolve(DATA_DIR) === path.resolve(BUILTIN_DATA) ? 'builtin' : 'userdata',
  };
}

module.exports = {
  ROOT,
  DATA_DIR,
  BUILTIN_DATA,
  OUT_DIR,
  WEB_DIR,
  ensureDir,
  readJSON,
  readJSONAnywhere,
  writeText,
  writeJSON,
  dataFile,
  outFile,
  listData,
  paths,
};
