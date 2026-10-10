'use strict';

/**
 * 夜织 GUI 启动入口
 *   node bin/gui.js              起服务 + 开窗口（窗口关闭即停服务）
 *   node bin/gui.js --no-open    只起服务（给测试/远程用）
 *   node bin/gui.js --port 8899  指定端口
 */

const http = require('http');
const { start } = require('../src/server/server');
const { openApp, killTree } = require('../scripts/open-app');

function waitHealthy(url, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = () => {
      const req = http.get(url + '/api/health', (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve(true);
        retry();
      });
      req.on('error', retry);
      req.setTimeout(800, () => { req.destroy(); retry(); });
    };
    const retry = () => (Date.now() > deadline ? resolve(false) : setTimeout(tick, 120));
    tick();
  });
}

async function main() {
  const args = process.argv.slice(2);
  const portIdx = args.indexOf('--port');
  const port = portIdx >= 0 ? Number(args[portIdx + 1]) || 0 : Number(process.env.CIallo_PORT || 0) || 0;
  const noOpen = args.includes('--no-open');
  const keepAlive = args.includes('--keep-alive');

  const info = await start({ port });
  console.log('');
  console.log('  ┌──────────────────────────────────────────────┐');
  console.log('  │   夜织 CialloForge · 界面已启动               │');
  console.log('  └──────────────────────────────────────────────┘');
  console.log(`   地址：${info.url}`);
  console.log(`   数据：16 张成年卡 / 16 场景 · 年龄锁 18+`);
  console.log('');

  if (noOpen) {
    console.log('[i] --no-open：不自动开窗口，按 Ctrl+C 停止');
    return;
  }

  const healthy = await waitHealthy(info.url);
  if (!healthy) console.log('[!] 服务自检超时，仍尝试打开窗口');

  const r = openApp(info.url);
  if (r.mode === 'app-window') {
    console.log(`[OK] 已用应用窗口打开（${r.browser}）`);
    console.log('     关闭窗口即停止服务');
    if (!keepAlive && r.child) {
      r.child.on('close', () => {
        console.log('[OK] 窗口已关闭，正在停止服务…');
        killTree(r.child.pid);
        info.server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 1500);
      });
      return;
    }
  } else {
    console.log('[OK] 已用默认浏览器打开（建议安装 Edge/Chrome 以获得独立窗口）');
  }
  console.log('     按 Ctrl+C 停止服务');
}

main().catch((err) => {
  console.error('[X] 启动失败：' + err.message);
  process.exitCode = 1;
});
