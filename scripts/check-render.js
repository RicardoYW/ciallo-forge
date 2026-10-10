'use strict';

/**
 * 界面渲染校验（真浏览器）：
 *   1) 起真服务
 *   2) 无头 Edge/Chrome 打开首页并 --dump-dom
 *   3) 断言渲染后的 DOM 里真的有后端数据（角色名 / 场景选项 / 已连接状态 / 卡池计数）
 *   4) 顺带尝试 --screenshot（部分环境该开关不产图，只作为信息项，不计入通过与否）
 *
 * 用法：node scripts/check-render.js [--keep]   （--keep 保留 DOM 与截图到 out/_shots/）
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { start } = require('../src/server/server');
const { findBrowser } = require('./open-app');
const io = require('../src/util/io');

const KEEP = process.argv.includes('--keep');
const SHOT_DIR = path.join(io.OUT_DIR, '_shots');

let checks = 0;
let passed = 0;
const issues = [];
const lines = [];

function log(s = '') {
  lines.push(s);
  if (!process.env.QUIET) console.log(s);
}

function check(name, fn) {
  checks++;
  try {
    const d = fn();
    passed++;
    log(`- ✅ ${name}${d ? ` — ${d}` : ''}`);
  } catch (err) {
    issues.push(`${name}: ${err.message}`);
    log(`- ❌ ${name} — ${err.message}`);
  }
}

function info(s) {
  lines.push(s);
  if (!process.env.QUIET) console.log(s);
}

function waitFor(fn, timeoutMs, stepMs = 400) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      let ok = false;
      try { ok = fn(); } catch { ok = false; }
      if (ok) return resolve(true);
      if (Date.now() > deadline) return resolve(false);
      setTimeout(tick, stepMs);
    };
    tick();
  });
}

/** 后台启动浏览器（不阻塞），返回子进程 */
function launch(browser, args) {
  const child = spawn(browser, args, { stdio: 'ignore', windowsHide: true, detached: false });
  return child;
}

function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function main() {
  const browser = findBrowser();
  log('# 夜织 · 界面渲染校验（真浏览器）');
  log('');
  log(`- 时间：${new Date().toISOString()}`);
  log(`- 浏览器：${browser || '（未找到 Edge/Chrome）'}`);
  log('');

  if (!browser) {
    log('本机没有 Chromium 内核浏览器，渲染检查跳过。界面仍可用系统默认浏览器打开。');
    io.writeText(path.join(io.OUT_DIR, 'UI-RENDER.md'), lines.join('\n') + '\n');
    console.log('[i] 跳过（无浏览器）');
    return;
  }

  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const domFile = path.join(SHOT_DIR, 'dom.html');
  const shotFile = path.join(SHOT_DIR, 'create.png');
  for (const f of [domFile, shotFile]) { try { fs.rmSync(f, { force: true }); } catch { /* ignore */ } }

  const info0 = await start({ port: 0 });
  log(`- 服务：${info0.url}`);
  log('');

  // ── 无头渲染：dump-dom 写临时文件，轮询等待前端把数据画上去 ──
  const prof1 = path.join(os.tmpdir(), 'ciallo-dom-' + Date.now());
  const fd = fs.openSync(domFile, 'w');
  const child = spawn(browser, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    `--user-data-dir=${prof1}`, '--virtual-time-budget=6000',
    '--dump-dom', info0.url + '/',
  ], { stdio: ['ignore', fd, 'ignore'], windowsHide: true });

  const ok = await waitFor(() => {
    if (!fs.existsSync(domFile)) return false;
    const s = fs.readFileSync(domFile, 'utf8');
    return s.includes('pool-item') && s.includes('topStatusText');
  }, 25000);

  try { child.kill(); } catch { /* ignore */ }
  try { fs.closeSync(fd); } catch { /* ignore */ }
  info0.server.close();

  const dom = fs.existsSync(domFile) ? fs.readFileSync(domFile, 'utf8') : '';

  check('无头浏览器渲染完成并拿到 DOM', () => {
    if (!ok || !dom) throw new Error('25 秒内没有拿到渲染后的 DOM');
    return `${(dom.length / 1024).toFixed(1)} KB`;
  });

  check('后端数据已渲染进页面：16 张角色卡', () => {
    // 选中项的 class 是 "pool-item sel"，所以不能写死 class="pool-item"
    const n = (dom.match(/class="pool-item[^"]*"\s+data-id="C\d\d"/g) || []).length;
    if (n !== 16) throw new Error(`实际 ${n} 个（前端可能没拿到 /api/characters）`);
    const names = ['苏晚', '江彻', '沈聿', '裴野'].filter((x) => dom.includes(x));
    if (names.length < 4) throw new Error('角色名未出现：' + names.join('、'));
    const sel = (dom.match(/class="pool-item sel"/g) || []).length;
    return `16 条（选中 ${sel} 条）· 含 ${names.join('/')}`;
  });

  check('16 个场景填充进下拉框', () => {
    const n = (dom.match(/<option value="S\d\d"/g) || []).length;
    if (n < 16) throw new Error(`实际 ${n} 个`);
    if (!dom.includes('夜班查房之后')) throw new Error('场景标题未出现');
    return `${n} 个选项（含标题）`;
  });

  check('顶栏状态显示已连接', () => {
    const m = dom.match(/id="topStatusText"[^>]*>([^<]*)</);
    const text = m ? m[1].trim() : '';
    if (!/已连接/.test(text)) throw new Error(`状态为「${text}」`);
    return text;
  });

  check('卡池计数与默认选角已生效（男女向主导方）', () => {
    const m = dom.match(/id="poolInfo"[^>]*>([^<]*)</);
    const text = m ? m[1].trim() : '';
    if (!/已选\s*\d\/2/.test(text) || !/A\s/.test(text)) throw new Error(`未填充：「${text}」`);
    return text;
  });

  check('七个页签全部渲染', () => {
    const need = ['创作', '角色', '场景', '提示词', '画廊', '校验', '设置'];
    const miss = need.filter((x) => !new RegExp(`class="tab[^"]*"[^>]*>${x}<`).test(dom));
    if (miss.length) throw new Error('缺页签：' + miss.join('、'));
    return '7 / 7';
  });

  check('预览区与卡池容器结构完整', () => {
    for (const id of ['previewBody', 'promptList', 'galleryBody', 'checkGrid', 'settingsInfo']) {
      if (!dom.includes(`id="${id}"`)) throw new Error(`缺 #${id}`);
    }
    return '关键容器齐备';
  });

  // ── 截图：部分环境该开关不产图，只作信息项 ──
  const prof2 = path.join(os.tmpdir(), 'ciallo-shot-' + Date.now());
  const shotProc = launch(browser, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    `--user-data-dir=${prof2}`, '--window-size=1680,1000',
    `--screenshot=${shotFile}`, info0.url + '/',
  ]);
  const shotOk = await waitFor(() => fs.existsSync(shotFile) && fs.statSync(shotFile).size > 3072, 15000);
  try { shotProc.kill(); } catch { /* ignore */ }
  if (shotOk) {
    const buf = fs.readFileSync(shotFile);
    const size = pngSize(buf);
    info(`- ℹ️ 截图：${size ? size.width + '×' + size.height : '尺寸未知'} · ${(buf.length / 1024).toFixed(1)} KB → ${path.relative(io.ROOT, shotFile)}`);
  } else {
    info('- ℹ️ 截图：当前环境 --screenshot 未产图（DOM 校验已覆盖渲染正确性，此项不影响功能）');
  }

  if (!KEEP) {
    try { fs.rmSync(SHOT_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
    info('');
    info('（临时文件已清理；加 --keep 保留 DOM 与截图供查看）');
  }

  log('');
  log('## 结论');
  log('');
  log(`- 检查项：**${passed}/${checks} 通过**`);
  if (issues.length) {
    log('');
    log('### 待修');
    for (const i of issues) log(`- ${i}`);
  } else {
    log('');
    log('界面在真浏览器里从后端拉到数据并正确渲染。');
  }

  const out = path.join(io.OUT_DIR, 'UI-RENDER.md');
  io.writeText(out, lines.join('\n') + '\n');
  console.log('');
  console.log(`[${issues.length ? '!' : 'OK'}] ${passed}/${checks} 通过 · 报告 → ${out}`);
  for (const i of issues) console.log('   - ' + i);
  process.exitCode = issues.length || passed < checks ? 1 : 0;
}

main().catch((err) => {
  console.error('[X] 渲染校验崩溃：' + err.stack);
  process.exitCode = 1;
});
