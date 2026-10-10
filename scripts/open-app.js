'use strict';

/**
 * 桌面窗口启动器（零依赖）
 * 优先用 Edge/Chrome 的 --app= 模式开一个无地址栏的独立窗口；找不到浏览器就回退系统默认浏览器。
 *
 * 用法：
 *   node scripts/open-app.js http://127.0.0.1:PORT
 *   const {openApp} = require('./open-app'); openApp(url)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.EDGE_PATH,
  path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
].filter(Boolean);

function findBrowser() {
  for (const p of CANDIDATES) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch { /* ignore */ }
  }
  return null;
}

function openDefault(url) {
  const platform = process.platform;
  try {
    if (platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else if (platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
    return { mode: 'default-browser', browser: null };
  } catch (err) {
    return { mode: 'failed', browser: null, error: err.message };
  }
}

/**
 * @param {string} url
 * @param {{wait?: boolean}} [opts] wait=true 时返回子进程（可监听 close）
 */
function openApp(url, opts = {}) {
  const browser = findBrowser();
  if (!browser) return openDefault(url);

  const profile = path.join(os.tmpdir(), 'ciallo-forge-profile');
  const args = [
    `--app=${url}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate,MediaRouter',
    '--window-size=1440,960',
    '--window-position=80,60',
  ];

  const child = spawn(browser, args, { detached: false, stdio: 'ignore' });
  child.on('error', () => {
    // 启动失败就退回默认浏览器
    openDefault(url);
  });
  return { mode: 'app-window', browser, child, profile };
}

function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(pid, 'SIGTERM');
    }
  } catch { /* ignore */ }
}

module.exports = { openApp, openDefault, findBrowser, killTree };

if (require.main === module) {
  const url = process.argv[2] || 'http://127.0.0.1:8787';
  const r = openApp(url);
  console.log(`[OK] 打开方式：${r.mode}${r.browser ? ' → ' + r.browser : ''}`);
}
