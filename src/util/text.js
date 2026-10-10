'use strict';

/** 文本小工具：标点收束、空白归一、CJK 计数、大小写、截断 */

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff]/;

function hasCJK(s) {
  return CJK.test(String(s || ''));
}

/** 词数：CJK 按字计，拉丁按空格分词 */
function wordCount(s) {
  const t = String(s || '');
  const cjk = (t.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) || []).length;
  const latin = (t.replace(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g, ' ')
    .match(/[A-Za-z0-9][A-Za-z0-9'’\-]*/g) || []).length;
  return cjk + latin;
}

function squeeze(s) {
  return String(s || '').replace(/[ \t]{2,}/g, ' ').replace(/\s+\n/g, '\n').trim();
}

/** 把末尾标点统一成给定符号（不重复叠加） */
function endWith(s, mark) {
  const t = String(s || '').trim().replace(/[。！？!?，,、；;：:…~～\s]+$/u, '');
  return t + mark;
}

/** 归一化逗号（中英混排时统一用给定的分隔符） */
function joinTags(tags, sep = ', ') {
  const seen = new Set();
  const out = [];
  for (const raw of tags) {
    if (raw == null) continue;
    const t = String(raw).trim().replace(/^,+|,+$/g, '');
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out.join(sep);
}

function truncate(s, n) {
  const t = String(s || '');
  return t.length <= n ? t : t.slice(0, Math.max(0, n - 1)) + '…';
}

function titleCase(s) {
  return String(s || '').replace(/\b[a-z]/g, (m) => m.toUpperCase());
}

/** 简易模板：{{ path.to.value }} + {{fn:arg}} 由调用方注入函数表 */
function interpolate(tpl, scope, fns = {}) {
  return String(tpl || '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, expr) => {
    const raw = String(expr).trim();
    const fnMatch = raw.match(/^([a-zA-Z_][\w]*)\s*:\s*(.*)$/);
    if (fnMatch && typeof fns[fnMatch[1]] === 'function') {
      const args = fnMatch[2].split('|').map((x) => x.trim());
      const val = fns[fnMatch[1]](...args, scope);
      return val == null ? '' : String(val);
    }
    const val = getPath(scope, raw);
    return val == null ? '' : String(val);
  });
}

function getPath(obj, path) {
  if (!obj) return undefined;
  let cur = obj;
  for (const part of String(path).split('.')) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

module.exports = {
  hasCJK,
  wordCount,
  squeeze,
  endWith,
  joinTags,
  truncate,
  titleCase,
  interpolate,
  getPath,
};
