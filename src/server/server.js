'use strict';

/**
 * 夜织 GUI 服务端。
 * 零依赖：只用 node:http。默认绑定 127.0.0.1，仅本机可访问。
 *
 * 作为模块：createServer() / start()
 * 直接运行：node src/server/server.js [--port 0] [--open]
 */

const http = require('http');
const routes = require('./routes');

const MAX_BODY = 8 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('请求体过大'), { code: 'TOO_LARGE', status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('请求体不是合法 JSON'), { code: 'BAD_JSON', status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function createServer() {
  const server = http.createServer(async (req, res) => {
    res.setHeader('x-powered-by', 'ciallo-forge');
    const ctx = { body: {} };
    try {
      if (req.method === 'POST' || req.method === 'PUT') {
        ctx.body = await readBody(req);
      }
    } catch (err) {
      return routes.fail(res, err);
    }
    try {
      await routes.handle(req, res, ctx);
    } catch (err) {
      if (!res.headersSent) routes.fail(res, err);
      else res.end();
    }
  });
  server.on('clientError', (err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });
  return server;
}

function start({ port = 0, host = '127.0.0.1', onListen } = {}) {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const info = { server, host, port: addr.port, url: `http://${host}:${addr.port}` };
      if (onListen) onListen(info);
      resolve(info);
    });
  });
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const portArg = args.indexOf('--port');
  const port = portArg >= 0 ? Number(args[portArg + 1]) || 0 : 0;
  start({ port })
    .then((info) => {
      console.log(`[OK] 夜织 GUI 已启动 → ${info.url}`);
      console.log('     按 Ctrl+C 停止');
      if (args.includes('--open')) {
        try {
          require('../../scripts/open-app').openApp(info.url);
        } catch (err) {
          console.log('[i] 自动打开窗口失败：' + err.message);
        }
      }
    })
    .catch((err) => {
      console.error('[X] 启动失败：' + err.message);
      process.exitCode = 1;
    });
}

module.exports = { createServer, start };
