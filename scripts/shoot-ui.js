'use strict';

/**
 * 用 Chrome DevTools Protocol 截图（不依赖 --screenshot 开关）。
 * 流程：起服务 → 无头 Edge 带 --remote-debugging-port → 连页面 WebSocket →
 *       Emulation.setDeviceMetricsOverride → Page.captureScreenshot → 存 PNG。
 *
 * 用法：node scripts/shoot-ui.js [页面路径] [--out out/_shots/ui.png] [--keep-server]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { start } = require('../src/server/server');
const { findBrowser } = require('./open-app');
const io = require('../src/util/io');

const args = process.argv.slice(2);
const pagePath = args.find((a) => !a.startsWith('--')) || '/';
const outIdx = args.indexOf('--out');
const outFile = path.resolve(io.ROOT, outIdx >= 0 ? args[outIdx + 1] : 'out/_shots/ui.png');
const widthIdx = args.indexOf('--size');
const [W, H] = (widthIdx >= 0 ? args[widthIdx + 1] : '1600x980').split('x').map(Number);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevtools(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return await res.json();
    } catch { /* 还没起来 */ }
    await sleep(300);
  }
  throw new Error('DevTools 端口没起来');
}

async function listPages(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  const list = await res.json();
  return list.filter((t) => t.type === 'page');
}

/** 极简 CDP 客户端：Node 24 自带 WebSocket */
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const events = [];
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', (e) => reject(new Error('WebSocket 连接失败')));
  });
  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) {
      events.push(msg);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const myId = ++id;
      pending.set(myId, { resolve, reject });
      ws.send(JSON.stringify({ id: myId, method, params }));
      setTimeout(() => {
        if (pending.has(myId)) { pending.delete(myId); reject(new Error(method + ' 超时')); }
      }, 20000);
    });
  return { ws, ready, send, events };
}

async function main() {
  const browser = findBrowser();
  if (!browser) {
    console.log('[i] 没找到 Edge/Chrome，跳过截图');
    return;
  }
  const debugPort = 9000 + Math.floor(Math.random() * 900);
  const profile = path.join(os.tmpdir(), 'ciallo-cdp-' + Date.now());
  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  const info = await start({ port: 0 });
  const url = info.url + pagePath;
  console.log(`[i] 服务：${info.url}  目标页：${pagePath}`);

  const proc = spawn(browser, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    `--window-size=${W},${H}`,
    url,
  ], { stdio: 'ignore', windowsHide: true });

  let shotBytes = 0;
  try {
    const version = await waitForDevtools(debugPort);
    console.log(`[i] 浏览器：${version.Browser}`);

    // 等页面出现
    let page = null;
    for (let i = 0; i < 40 && !page; i++) {
      const pages = await listPages(debugPort);
      page = pages.find((p) => p.url.startsWith(info.url)) || pages[0] || null;
      if (!page) await sleep(250);
    }
    if (!page) throw new Error('没有可用的页面目标');
    console.log(`[i] 页面目标：${page.url}`);

    const cdp = connect(page.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: W, height: H, deviceScaleFactor: 1, mobile: false,
    });

    // 等前端把数据画上去（轮询 DOM 里的角色卡数量）
    let cards = 0;
    for (let i = 0; i < 40; i++) {
      const r = await cdp.send('Runtime.evaluate', {
        expression: 'document.querySelectorAll(\'.pool-item\').length',
        returnByValue: true,
      });
      cards = r.result.value || 0;
      if (cards >= 16) break;
      await sleep(300);
    }
    console.log(`[i] 渲染就绪：角色卡 ${cards} 条`);

    const statusText = await cdp.send('Runtime.evaluate', {
      expression: 'document.getElementById("topStatusText").textContent',
      returnByValue: true,
    });
    console.log(`[i] 顶栏状态：${statusText.result.value}`);

    // 可选：先切到某个页签（--tab roles / scenes / prompts / gallery / check / settings）
    const tabIdx = args.indexOf('--tab');
    if (tabIdx >= 0) {
      const name = args[tabIdx + 1];
      const r = await cdp.send('Runtime.evaluate', {
        expression: `(() => { const b = document.querySelector('.tab[data-view=${JSON.stringify(name)}]'); if (!b) return 'no-tab'; b.click(); return 'switched'; })()`,
        returnByValue: true,
      });
      console.log(`[i] 切页签 ${name} → ${r.result.value}`);
      await sleep(1200); // 等该页按需加载（校验页会自动跑、提示词页会初始化）
    }

    // 可选：点击某个元素（例如「生成正文」），用于截取真实交互后的画面
    const clickIdx = args.indexOf('--click');
    if (clickIdx >= 0) {
      const sel = args[clickIdx + 1] || '#btnGenerate';
      const waitIdx = args.indexOf('--after');
      const afterMs = waitIdx >= 0 ? Number(args[waitIdx + 1]) || 3500 : 3500;
      const r = await cdp.send('Runtime.evaluate', {
        expression: `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'no-element'; el.click(); return 'clicked'; })()`,
        returnByValue: true,
      });
      console.log(`[i] 点击 ${sel} → ${r.result.value}`);
      await sleep(afterMs);
      const peek = await cdp.send('Runtime.evaluate', {
        expression: 'document.getElementById("previewMeta").textContent + " | 段落数 " + document.querySelectorAll("#previewBody p").length',
        returnByValue: true,
      });
      console.log(`[i] 预览状态：${peek.result.value}`);
    }

    // 让过场动画/字体稳定一下再截
    await sleep(700);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const buf = Buffer.from(shot.data, 'base64');
    fs.writeFileSync(outFile, buf);
    shotBytes = buf.length;
    console.log(`[OK] 截图 → ${outFile}  ${(buf.length / 1024).toFixed(1)} KB  ${W}×${H}`);

    try { cdp.ws.close(); } catch { /* ignore */ }
  } catch (err) {
    console.log('[X] 截图失败：' + err.message);
    process.exitCode = 1;
  } finally {
    try { proc.kill(); } catch { /* ignore */ }
    info.server.close();
  }

  if (!args.includes('--keep-server')) {
    setTimeout(() => process.exit(shotBytes ? 0 : 1), 300);
  }
}

main().catch((err) => {
  console.error('[X] ' + err.stack);
  process.exitCode = 1;
});
