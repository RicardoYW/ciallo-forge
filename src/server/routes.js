'use strict';

/**
 * 路由表：API + 静态资源。
 * 约定：处理器返回 {status?, headers?, body} 或直接返回值（自动包成 {ok:true,data}）。
 */

const api = require('./api');
const { serveStatic } = require('./static');
const { Story } = require('../engine/story');

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function ok(res, data) {
  json(res, 200, { ok: true, data });
}

function fail(res, err) {
  const status = err && err.status ? err.status : 500;
  json(res, status, {
    ok: false,
    error: {
      code: (err && err.code) || 'INTERNAL',
      message: err && err.message ? err.message : String(err),
    },
  });
}

/** 逐段流式生成：NDJSON，每行一个事件 */
async function streamStory(req, res, body) {
  res.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });

  let closed = false;
  req.on('close', () => { closed = true; });
  const send = (obj) => {
    if (closed || res.writableEnded) return false;
    res.write(JSON.stringify(obj) + '\n');
    return true;
  };

  try {
    const opts = {
      scene: body.scene || null,
      cast: Array.isArray(body.cast) ? body.cast : String(body.cast || '').split(',').filter(Boolean),
      heat: body.heat == null || body.heat === '' ? undefined : Math.max(1, Math.min(5, Number(body.heat) || 4)),
      words: Math.max(200, Math.min(8000, Number(body.words) || 1500)),
      pacing: ['slow', 'balanced', 'fast', 'pwp'].includes(body.pacing) ? body.pacing : 'slow',
      seed: body.seed == null || body.seed === '' ? Date.now() : body.seed,
      title: body.title || null,
      lead: ['male', 'female', 'auto'].includes(body.lead) ? body.lead : 'auto',
      autoPartner: body.autoPartner === undefined ? true : body.autoPartner !== false,
    };

    const story = new Story(opts);
    const built = story.build();
    const meta = built.meta;

    send({
      type: 'meta',
      scene: { id: built.scene.id, title: built.scene.title, kinkFamily: built.scene.kinkFamily, location: built.scene.location, mood: built.scene.mood, heatBase: built.scene.heatBase },
      cast: meta.cast,
      pairing: meta.pairing,
      heat: meta.heat,
      pacing: meta.pacing,
      seed: meta.seed,
      targetWords: meta.targetWords,
      sections: built.sections.length,
      kinkNote: meta.kinkNote,
    });

    let sent = '';
    for (let i = 0; i < built.sections.length; i++) {
      const sec = built.sections[i];
      if (!send({ type: 'section', index: i, name: sec.name, total: built.sections.length })) break;
      for (const para of sec.paras) {
        sent += para;
        if (!send({ type: 'paragraph', section: i, text: para, words: sent.length })) break;
        await new Promise((r) => setTimeout(r, 12)); // 让前端能看见逐段刷出
      }
      if (closed) break;
    }

    const finalJson = story.json();
    send({
      type: 'done',
      words: finalJson.words,
      paragraphs: finalJson.paragraphs,
      duplicateParagraphs: finalJson.duplicateParagraphs,
      shortParagraphs: finalJson.shortParagraphs,
      elapsedNote: 'generated locally',
    });
  } catch (err) {
    send({ type: 'error', code: err.code || 'INTERNAL', message: err.message });
  } finally {
    if (!res.writableEnded) res.end();
  }
}

/** 路由表：GET 用 query，POST 用 json body */
const ROUTES = {
  'GET /api/health': () => ({ ok: true, ts: Date.now(), version: require('../../package.json').version }),
  'GET /api/stats': () => api.stats(),
  'GET /api/paths': () => api.paths(),
  'GET /api/content-pack': () => api.contentPack(),
  'POST /api/content-pack': (ctx) => api.setContentPack(ctx.body),
  'GET /api/characters': (ctx) => api.characters(ctx.query),
  'GET /api/scenes': () => api.scenes(),
  'GET /api/kinks': () => api.kinks(),
  'GET /api/prose': () => api.prosePools(),
  'GET /api/validate': () => api.validateAll(),
  'GET /api/settings': () => api.getSettings(),
  'GET /api/out': () => api.listOut(),
  'GET /api/gallery': () => api.listGallery(),
  'POST /api/story/plan': (ctx) => api.planStory(ctx.body),
  'POST /api/story': (ctx) => api.buildStory(ctx.body),
  'POST /api/story/save': (ctx) => api.saveStory(ctx.body),
  'POST /api/prompt': (ctx) => api.compilePrompts(ctx.body),
  'POST /api/prompt/export': (ctx) => api.savePrompts(ctx.body),
  'POST /api/validate': () => api.validateAll(),
  'POST /api/settings': (ctx) => api.saveSettings(ctx.body),
  'POST /api/scene/pairing': (ctx) => api.updatePairing(ctx.body),
  'POST /api/export': () => api.rebuildExport(),
};

async function handle(req, res, ctx) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const pathname = url.pathname;

  // 流式生成：单独走一条分支
  if (req.method === 'POST' && pathname === '/api/story/stream') {
    return streamStory(req, res, ctx.body);
  }

  // 读 out 下的文件
  if (req.method === 'GET' && pathname === '/api/file') {
    try {
      return ok(res, api.readOutFile(url.searchParams.get('p')));
    } catch (err) {
      return fail(res, err);
    }
  }

  // 样例画廊单篇内容
  if (req.method === 'GET' && pathname === '/api/gallery/file') {
    try {
      const name = String(url.searchParams.get('f') || '');
      return ok(res, api.readOutFile('gallery/' + name));
    } catch (err) {
      return fail(res, err);
    }
  }

  const key = `${req.method} ${pathname}`;
  const handler = ROUTES[key];
  if (handler) {
    try {
      ctx.query = Object.fromEntries(url.searchParams.entries());
      const data = await handler(ctx);
      return ok(res, data);
    } catch (err) {
      return fail(res, err);
    }
  }

  if (pathname.startsWith('/api/')) {
    return fail(res, Object.assign(new Error(`未知接口 ${key}`), { code: 'NO_ROUTE', status: 404 }));
  }

  // 静态资源
  const file = serveStatic(pathname);
  if (!file) return fail(res, Object.assign(new Error('静态资源不可用'), { code: 'NO_STATIC', status: 404 }));
  res.writeHead(file.status, file.headers);
  res.end(file.body);
}

module.exports = { handle, ROUTES, json, ok, fail };
