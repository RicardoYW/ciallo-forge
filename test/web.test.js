'use strict';

/**
 * 前端冒烟测试：用最小假 DOM 真正执行 web/app.js
 * 目的：抓「HTML 里没有这个 id」「启动即抛异常」「事件绑定到不存在的元素」这类问题。
 * 不渲染样式，只验证逻辑能跑通。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const io = require('../src/util/io');

const HTML = fs.readFileSync(path.join(io.WEB_DIR, 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(io.WEB_DIR, 'app.js'), 'utf8');

/** HTML 里出现的所有 id */
function htmlIds() {
  const ids = new Set();
  for (const m of HTML.matchAll(/\bid="([^"]+)"/g)) ids.add(m[1]);
  return ids;
}

/** app.js 里用 $('#x') / querySelector('#x') 取的元素 */
function jsSelectors() {
  const ids = new Set();
  for (const m of APP.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)) ids.add(m[1]);
  for (const m of APP.matchAll(/querySelector(?:All)?\('#([A-Za-z0-9_-]+)'/g)) ids.add(m[1]);
  return ids;
}

// ── 假 DOM ───────────────────────────────────────────────

function makeEl(id, tag = 'DIV') {
  const el = {
    id,
    tagName: tag,
    _children: [],
    _listeners: {},
    className: '',
    value: '',
    textContent: '',
    hidden: false,
    checked: false,
    disabled: false,
    style: {},
    dataset: {},
    options: [],
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      toggle(c, on) { on ? this._set.add(c) : this._set.delete(c); },
      contains(c) { return this._set.has(c); },
    },
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    removeEventListener() {},
    appendChild(c) { this._children.push(c); return c; },
    insertAdjacentHTML(_pos, html) { this._children.push({ html }); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    focus() {},
    remove() {},
    dispatchEvent() {},
    get innerHTML() { return this._html || ''; },
    set innerHTML(v) { this._html = v; },
    get scrollHeight() { return 100; },
    set scrollTop(v) { this._scroll = v; },
    get scrollTop() { return this._scroll || 0; },
    get firstElementChild() { return this._children[0] || null; },
    insertBefore(c) { this._children.unshift(c); return c; },
  };
  return el;
}

function makeFakeDom() {
  const ids = htmlIds();
  const store = new Map();
  for (const id of ids) store.set(id, makeEl(id, /select/i.test(id) ? 'SELECT' : 'DIV'));

  const document = {
    _els: store,
    querySelector(sel) {
      if (sel.startsWith('#')) {
        const id = sel.slice(1);
        if (!store.has(id)) throw new Error(`假 DOM 里没有 #${id}（说明 app.js 取了 HTML 中不存在的元素）`);
        return store.get(id);
      }
      return makeEl('tmp');
    },
    querySelectorAll(sel) {
      if (sel === '.tab') return [...store.values()].filter((e) => e.classList.contains('tab'));
      if (sel.startsWith('#')) {
        const root = document.querySelector(sel);
        return typeof root.querySelectorAll === 'function' ? root.querySelectorAll() : [];
      }
      return [];
    },
    createElement: (tag) => makeEl('created-' + tag, tag.toUpperCase()),
    addEventListener() {},
    body: makeEl('body', 'BODY'),
    activeElement: { tagName: 'BODY' },
    execCommand() { return true; },
  };

  const window = {
    document,
    addEventListener() {},
    open() {},
    prompt: () => null,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (t) => clearTimeout(t),
    performance: { now: () => Date.now() },
  };

  const calls = [];
  const fetch = async (url, opt) => {
    calls.push({ url: String(url), method: (opt && opt.method) || 'GET' });
    throw new Error('offline-test'); // 前端应优雅处理失败，不崩
  };

  return { document, window, fetch, calls, store };
}

// ── 测试 ────────────────────────────────────────────────

test('HTML 与 app.js 的元素 id 一一对应', () => {
  const inHtml = htmlIds();
  const inJs = jsSelectors();
  const missing = [...inJs].filter((id) => !inHtml.has(id));
  assert.deepEqual(missing, [], `app.js 引用了 HTML 里不存在的 id：${missing.join(', ')}`);
  assert.ok(inHtml.size > 40, `HTML id 数量偏少：${inHtml.size}`);
});

test('app.js 能在假 DOM 中启动且不抛异常', () => {
  const dom = makeFakeDom();
  const sandbox = {
    document: dom.document,
    window: dom.window,
    fetch: dom.fetch,
    navigator: { clipboard: { writeText: async () => {} } },
    performance: { now: () => Date.now() },
    setTimeout,
    clearTimeout,
    console,
    TextDecoder,
    AbortController,
    Promise,
    JSON,
    Math,
    Date,
    Object,
    Array,
    String,
    Number,
    Error,
    Event: class Event { constructor(type) { this.type = type; } },
  };
  sandbox.globalThis = sandbox;
  sandbox.window.__ciallo = undefined;

  assert.doesNotThrow(() => {
    vm.createContext(sandbox);
    vm.runInContext(APP, sandbox, { filename: 'app.js' });
  }, 'app.js 启动即抛异常');

  assert.ok(sandbox.window.__ciallo, '未挂载 window.__ciallo');
  assert.ok(sandbox.window.__ciallo.S, '缺少状态对象');
});

test('启动后确实调用了后端接口', async () => {
  const dom = makeFakeDom();
  const sandbox = {
    document: dom.document, window: dom.window, fetch: dom.fetch,
    navigator: { clipboard: { writeText: async () => {} } },
    performance: { now: () => Date.now() },
    setTimeout, clearTimeout, console, TextDecoder, AbortController,
    Promise, JSON, Math, Date, Object, Array, String, Number, Error,
    Event: class Event { constructor(type) { this.type = type; } },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(APP, sandbox, { filename: 'app.js' });
  await new Promise((r) => setTimeout(r, 60));
  const urls = dom.calls.map((c) => c.url);
  for (const need of ['/api/stats', '/api/characters', '/api/scenes']) {
    assert.ok(urls.includes(need), `启动时未请求 ${need}（已请求：${urls.join(', ')}）`);
  }
});

test('前端离线时不崩：失败被 catch 住', async () => {
  const dom = makeFakeDom();
  let uncaught = null;
  const sandbox = {
    document: dom.document, window: dom.window, fetch: dom.fetch,
    navigator: { clipboard: { writeText: async () => {} } },
    performance: { now: () => Date.now() },
    setTimeout, clearTimeout, console, TextDecoder, AbortController,
    Promise, JSON, Math, Date, Object, Array, String, Number, Error,
    Event: class Event { constructor(type) { this.type = type; } },
  };
  sandbox.globalThis = sandbox;
  process.once('unhandledRejection', (e) => { uncaught = e; });
  vm.createContext(sandbox);
  vm.runInContext(APP, sandbox, { filename: 'app.js' });
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(uncaught, null, '出现了未处理的 Promise 拒绝：' + (uncaught && uncaught.message));
});

test('HTML 含全部七个页签与关键容器', () => {
  for (const t of ['create', 'roles', 'scenes', 'prompts', 'gallery', 'check', 'settings']) {
    assert.ok(HTML.includes(`data-view="${t}"`), `缺页签 ${t}`);
    assert.ok(HTML.includes(`id="view-${t}"`), `缺视图容器 view-${t}`);
  }
  for (const id of ['app', 'tabs', 'charPool', 'previewBody', 'roleCards', 'sceneCards', 'promptList', 'galleryBody', 'checkGrid', 'settingsInfo', 'toasts', 'modal']) {
    assert.ok(HTML.includes(`id="${id}"`), `缺容器 #${id}`);
  }
});

test('CSS 无外部依赖（不引用网络资源）', () => {
  const css = fs.readFileSync(path.join(io.WEB_DIR, 'app.css'), 'utf8');
  assert.doesNotMatch(css, /@import\s+url\(['"]?https?:/i, 'CSS 里有远程 @import');
  assert.doesNotMatch(HTML, /<script[^>]+src=["']https?:/i, 'HTML 引用了远程脚本');
  assert.doesNotMatch(HTML, /<link[^>]+href=["']https?:/i, 'HTML 引用了远程样式');
});
