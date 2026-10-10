'use strict';

/**
 * 夜织 GUI 服务端 · 静态资源
 * 只暴露 src/web 目录，路径穿越一律拒绝。
 */

const fs = require('fs');
const path = require('path');
const { WEB_DIR } = require('../util/io');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function safeJoin(base, rel) {
  const cleaned = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const abs = path.resolve(base, cleaned);
  if (!abs.startsWith(path.resolve(base))) return null;
  return abs;
}

/** @returns {{status:number, headers:object, body:Buffer|string}|null} */
function serveStatic(urlPath) {
  let rel = decodeURIComponent(String(urlPath || '/').split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const abs = safeJoin(WEB_DIR, rel);
  if (!abs) return { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: '403 路径越界' };
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: `404 找不到 ${rel}` };
  }
  const ext = path.extname(abs).toLowerCase();
  const body = fs.readFileSync(abs);
  return {
    status: 200,
    headers: {
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-length': body.length,
      'cache-control': 'no-cache',
    },
    body,
  };
}

module.exports = { serveStatic, safeJoin, MIME };
