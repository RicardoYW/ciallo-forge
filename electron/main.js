'use strict';

/**
 * 夜织桌面版 · Electron 主进程
 *
 * 结构：主进程起本地 http 服务（随机端口，只绑 127.0.0.1）→ BrowserWindow 载入该地址。
 * 用 http 而不是 file://，是为了让前端的 fetch('/api/...') 与流式生成原样可用。
 */

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Menu, shell, dialog, clipboard, ipcMain, nativeImage } = require('electron');

// 数据目录必须在 require 服务端代码之前定好
const datapath = require('../src/util/datapath');
const seedInfo = datapath.ensureSeed();
process.env.CIALLO_DATA_DIR = datapath.dataDir();

const { start } = require('../src/server/server');

const isDev = !app.isPackaged;
const ICON = path.join(__dirname, '..', 'assets', 'icon.ico');
const ROOT = datapath.BUILTIN_ROOT;

let mainWindow = null;
let serverInfo = null;
let quitting = false;

function iconFor() {
  try {
    if (fs.existsSync(ICON)) return nativeImage.createFromPath(ICON);
  } catch { /* ignore */ }
  return undefined;
}

function buildMenu() {
  const isWin = process.platform === 'win32';
  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '打开数据目录',
          click: () => shell.openPath(path.dirname(datapath.dataDir())),
        },
        {
          label: '打开产物目录',
          click: () => shell.openPath(datapath.outDir()),
        },
        { type: 'separator' },
        { label: '重新载入界面', accelerator: 'F5', click: () => mainWindow && mainWindow.reload() },
        { label: '开发者工具', accelerator: isWin ? 'Ctrl+Shift+I' : 'Alt+Command+I', click: () => mainWindow && mainWindow.webContents.toggleDevTools() },
        { type: 'separator' },
        { label: '退出', accelerator: isWin ? 'Alt+F4' : 'Command+Q', click: () => app.quit() },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '放大', accelerator: 'CmdOrCtrl+Plus', click: () => zoom(0.1) },
        { label: '缩小', accelerator: 'CmdOrCtrl+-', click: () => zoom(-0.1) },
        { label: '重置缩放', accelerator: 'CmdOrCtrl+0', click: () => mainWindow && mainWindow.webContents.setZoomLevel(0) },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '关于 夜织 CialloForge', click: showAbout },
        { label: '使用说明', click: () => openDoc('使用指南.md') },
        { label: '项目说明 README', click: () => openDoc('README.md') },
        { label: '场景配对表', click: () => openDoc('场景配对表.md') },
        { label: '开发手记', click: () => openDoc('开发手记.md') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function zoom(delta) {
  if (!mainWindow) return;
  const wc = mainWindow.webContents;
  wc.setZoomLevel(Math.max(-3, Math.min(3, wc.getZoomLevel() + delta * 1.5)));
}

function openDoc(name) {
  const p = path.join(ROOT, name);
  if (fs.existsSync(p)) shell.openPath(p);
  else dialog.showMessageBox(mainWindow, { type: 'info', message: '找不到文档', detail: p });
}

function showAbout() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: '关于',
    message: '夜织 CialloForge',
    detail: [
      `版本：${app.getVersion()}（Electron ${process.versions.electron} / Chromium ${process.versions.chrome}）`,
      '',
      '成人向虚构文本 + 绘图提示词双引擎',
      '16 张原创成年角色卡（♂7 / ♀9）· 年龄锁 18+ · 全本地离线',
      '',
      `数据目录：${path.dirname(datapath.dataDir())}`,
      `内置资源：${ROOT}`,
      '',
      '界面本地渲染，不上传任何内容；服务只监听 127.0.0.1。',
    ].join('\n'),
    buttons: ['好'],
    noLink: true,
  });
}

async function createWindow() {
  serverInfo = await start({ port: 0, host: '127.0.0.1' });

  mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1024,
    minHeight: 680,
    title: '夜织 CialloForge',
    backgroundColor: '#0c0b11',
    autoHideMenuBar: false,
    icon: iconFor(),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });

  // 外链一律交给系统浏览器，不在窗口里开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(serverInfo.url)) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  await mainWindow.loadURL(serverInfo.url + '/');
  if (isDev && process.env.CIALLO_DEVTOOLS === '1') mainWindow.webContents.openDevTools({ mode: 'detach' });

  // 自检模式：把启动结果打印到 stdout 然后退出，供脚本验证（CI / check-desktop.js 用）
  if (process.env.CIALLO_SELFTEST === '1') {
    setTimeout(async () => {
      try {
        const title = mainWindow.getTitle();
        const url = mainWindow.webContents.getURL();
        const js = await mainWindow.webContents.executeJavaScript(
          '({ cards: document.querySelectorAll(".pool-item").length, status: (document.getElementById("topStatusText")||{}).textContent, tabs: document.querySelectorAll(".tab").length, desktopTag: !document.getElementById("desktopTag").hidden })',
          true,
        );
        console.log('SELFTEST ' + JSON.stringify({
          ok: true,
          windowTitle: title,
          url,
          serverUrl: serverInfo.url,
          dataDir: datapath.dataDir(),
          outDir: datapath.outDir(),
          seed: seedInfo,
          renderer: js,
          versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
          iconLoaded: !!iconFor(),
        }));
      } catch (err) {
        console.log('SELFTEST ' + JSON.stringify({ ok: false, error: String(err && err.message || err) }));
      } finally {
        app.exit(0);
      }
    }, 2500);
  }
}

// 单实例：第二次启动时聚焦已有窗口
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('com.ciallo.forge');
    buildMenu();

    ipcMain.handle('app-info', () => ({
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      dataDir: path.dirname(datapath.dataDir()),
      outDir: datapath.outDir(),
      root: ROOT,
      seed: seedInfo,
      packaged: app.isPackaged,
    }));
    ipcMain.handle('copy-text', (_e, text) => { clipboard.writeText(String(text == null ? '' : text)); return true; });
    ipcMain.handle('open-path', (_e, p) => shell.openPath(String(p || '')));
    ipcMain.handle('show-item', (_e, p) => { shell.showItemInFolder(String(p || '')); return true; });

    createWindow().catch((err) => {
      dialog.showErrorBox('启动失败', [
        String(err && err.message || err),
        '',
        '界面服务没有起来。可以试着从命令行运行 node bin/gui.js --no-open 看详细报错。',
      ].join('\n'));
      app.quit();
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  quitting = true;
  if (serverInfo && serverInfo.server) {
    try { serverInfo.server.close(); } catch { /* ignore */ }
  }
  app.quit();
});

app.on('before-quit', () => {
  quitting = true;
  if (serverInfo && serverInfo.server) {
    try { serverInfo.server.close(); } catch { /* ignore */ }
  }
});

process.on('uncaughtException', (err) => {
  if (quitting) return;
  dialog.showErrorBox('未处理的错误', String(err && err.stack || err));
});
