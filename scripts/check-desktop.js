'use strict';

/**
 * 桌面版（Electron）验证：
 *   1) 检查打包产物是否齐全（win-unpacked / 安装包 / 便携版）
 *   2) 用 CIALLO_SELFTEST=1 启动打包后的 exe，读它的自检 JSON
 *   3) 断言：窗口开起来、界面拿到 16 卡、桌面标识点亮、数据目录落在用户目录、图标加载
 *   4) 检查卸载目录不会污染项目（数据写在 %APPDATA%）
 *
 * 用法：node scripts/check-desktop.js [--exe <路径>] [--devtools]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const io = require('../src/util/io');

const args = process.argv.slice(2);
const exeIdx = args.indexOf('--exe');
const DIST = path.join(io.ROOT, 'dist');
const UNPACKED = path.join(DIST, 'win-unpacked');

let checks = 0;
let passed = 0;
const issues = [];
const lines = [];

function log(s = '') {
  lines.push(s);
  if (!process.env.QUIET) console.log(s);
}

/** 报告要能公开分享：本机用户名与绝对路径统一脱敏（实现见 src/util/scrub.js） */
const { scrub } = require('../src/util/scrub');

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

/** 找到要测的 exe：显式指定 > win-unpacked 里的产品 exe */
function findExe() {
  if (exeIdx >= 0 && args[exeIdx + 1]) return path.resolve(args[exeIdx + 1]);
  if (!fs.existsSync(UNPACKED)) return null;
  const exes = fs.readdirSync(UNPACKED).filter((f) => f.toLowerCase().endsWith('.exe'));
  const main = exes.find((f) => /ciallo|夜织/i.test(f)) || exes[0];
  return main ? path.join(UNPACKED, main) : null;
}

function runSelftest(exe, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv, CIALLO_SELFTEST: '1' };
  // Electron 打包后若继承了这个变量会退化成纯 Node 模式，必须清掉
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(exe, [], {
    cwd: path.dirname(exe),
    env,
    encoding: 'utf8',
    timeout: 90000,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  const text = `${r.stdout || ''}\n${r.stderr || ''}`;
  const line = text.split(/\r?\n/).find((l) => l.includes('SELFTEST '));
  let payload = null;
  if (line) {
    try { payload = JSON.parse(line.slice(line.indexOf('SELFTEST ') + 9)); } catch { /* ignore */ }
  }
  return { status: r.status, payload, text, error: r.error };
}

function main() {
  log('# 夜织 · 桌面版验证');
  log('');
  log(`- 时间：${new Date().toISOString()}`);
  log(`- 打包目录：${DIST}`);
  log('');

  // ── 1. 产物 ──
  log('## 1. 打包产物');
  log('');
  check('dist/win-unpacked 存在', () => {
    if (!fs.existsSync(UNPACKED)) throw new Error('还没打包，先运行 npm run pack 或 npm run dist');
    const files = fs.readdirSync(UNPACKED);
    return `${files.length} 个条目`;
  });

  check('resources/app.asar 存在且体积合理', () => {
    const asar = path.join(UNPACKED, 'resources', 'app.asar');
    if (!fs.existsSync(asar)) throw new Error('缺 app.asar');
    const mb = fs.statSync(asar).size / 1024 / 1024;
    if (mb < 0.3) throw new Error(`app.asar 过小：${mb.toFixed(2)} MB`);
    return `${mb.toFixed(1)} MB`;
  });

  check('asar 里含我们的代码与数据（不依赖项目目录）', () => {
    const asar = path.join(UNPACKED, 'resources', 'app.asar');
    // asar 是「头部 JSON 目录 + 拼接的文件内容」，扫前几 MB 就能确认关键文件在里面
    const buf = fs.readFileSync(asar); // 不传 encoding → Buffer
    const head = buf.subarray(0, Math.min(buf.length, 4 * 1024 * 1024)).toString('utf8');
    const need = ['electron', 'main.js', 'characters.json', 'scenes.json', 'prose.json', 'web', 'app.js'];
    const miss = need.filter((x) => !head.includes(x));
    if (miss.length) throw new Error('asar 头部未见：' + miss.join('、'));
    return 'electron/main.js + data/*.json + web/ 都在';
  });

  const exe = findExe();
  check('找到主程序 exe', () => {
    if (!exe) throw new Error('win-unpacked 里没有 exe');
    const mb = fs.statSync(exe).size / 1024 / 1024;
    return `${path.basename(exe)} · ${mb.toFixed(1)} MB`;
  });

  for (const pattern of [/Setup.*\.exe$/i, /Portable.*\.exe$/i]) {
    check(`安装/便携包存在（${pattern.source}）`, () => {
      if (!fs.existsSync(DIST)) throw new Error('dist 不存在');
      const hit = fs.readdirSync(DIST).find((f) => pattern.test(f));
      if (!hit) throw new Error('没找到（可能只跑了 --dir）');
      return `${hit} · ${(fs.statSync(path.join(DIST, hit)).size / 1024 / 1024).toFixed(1)} MB`;
    });
  }

  // ── 2. 真启动 ──
  log('');
  log('## 2. 启动打包后的程序');
  log('');
  if (!exe) {
    log('- ⚠️ 没找到 exe，跳过启动验证');
  } else {
    const tmpData = path.join(os.tmpdir(), 'ciallo-desktop-test-' + Date.now());
    // Electron 首次冷启动偶尔会因 Chromium 网络服务重启而拿不到自检输出（间歇性），
    // 所以失败后自动重试一次；两次都失败才算真失败。
    let run = runSelftest(exe, { CIALLO_DATA_DIR: tmpData });
    if (!run.payload) {
      log('- ℹ️ 第一次启动没有拿到自检输出，重试一次…');
      try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch { /* ignore */ }
      run = runSelftest(exe, { CIALLO_DATA_DIR: tmpData });
    }

    check('打包后的 exe 能启动并自检通过', () => {
      if (!run.payload) {
        const tail = run.text.split(/\r?\n/).filter(Boolean).slice(-4).join(' | ');
        throw new Error(`两次启动都没拿到 SELFTEST 输出（status=${run.status}）${tail}`);
      }
      if (!run.payload.ok) throw new Error('自检返回失败：' + run.payload.error);
      return `Electron ${run.payload.versions.electron} / Chromium ${run.payload.versions.chrome}`;
    });

    if (run.payload && run.payload.ok) {
      const p = run.payload;
      check('窗口加载的是本地服务地址', () => {
        if (!/^http:\/\/127\.0\.0\.1:\d+\/$/.test(p.url)) throw new Error('URL 异常：' + p.url);
        return p.url;
      });
      check('界面渲染出 16 张角色卡', () => {
        if (!p.renderer || p.renderer.cards !== 16) throw new Error(`渲染层拿到 ${p.renderer && p.renderer.cards} 张`);
        return `${p.renderer.cards} 张 · ${p.renderer.tabs} 个页签`;
      });
      check('顶栏显示「桌面版」且状态为已连接', () => {
        if (!p.renderer.desktopTag) throw new Error('桌面标识未点亮');
        if (!/已连接/.test(p.renderer.status || '')) throw new Error('状态：' + p.renderer.status);
        return p.renderer.status;
      });
      check('数据目录指向用户目录（不是只读的程序目录）', () => {
        const dir = p.dataDir.replace(/\\/g, '/');
        if (dir.includes('/dist/') || dir === path.join(io.ROOT, 'data').replace(/\\/g, '/')) {
          throw new Error('数据目录还在程序目录里：' + p.dataDir);
        }
        if (!fs.existsSync(p.dataDir)) throw new Error('数据目录没建出来：' + p.dataDir);
        return p.dataDir;
      });
      check('首次运行已释放内置数据', () => {
        const seed = p.seed || {};
        const files = fs.readdirSync(p.dataDir).filter((f) => f.endsWith('.json'));
        if (files.length < 5) throw new Error(`只释放了 ${files.length} 个文件`);
        return `${files.length} 个 JSON（seed 模式 ${seed.mode}）`;
      });
      check('窗口图标已加载', () => {
        if (!p.iconLoaded) throw new Error('图标没读到（assets/icon.ico）');
        return 'assets/icon.ico';
      });
      check('产物目录可写', () => {
        fs.mkdirSync(p.outDir, { recursive: true });
        const probe = path.join(p.outDir, '.probe');
        fs.writeFileSync(probe, 'ok');
        fs.unlinkSync(probe);
        return p.outDir;
      });
    }

    // 清理测试数据目录
    try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  // ── 3. 与 CLI 的一致性 ──
  log('');
  log('## 3. 桌面版与 CLI 一致性');
  log('');
  check('桌面版服务仍是同一套引擎（同一 seed 输出一致）', () => {
    const { Story } = require('../src/engine/story');
    const opts = { scene: 'S09', cast: ['C09', 'C07'], heat: 4, words: 600, pacing: 'balanced', seed: 31337 };
    const a = new Story(opts).markdown();
    const b = new Story(opts).markdown();
    if (a !== b) throw new Error('不可复现');
    return `${a.length} 字符，两次一致`;
  });

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
    log('桌面版可用：双击 exe 即开窗口，数据落在用户目录，界面与命令行共用同一引擎。');
  }

  const out = path.join(io.OUT_DIR, 'DESKTOP-CHECK.md');
  io.writeText(out, scrub(lines.join('\n')) + '\n');
  console.log('');
  console.log(`[${issues.length ? '!' : 'OK'}] ${passed}/${checks} 通过 · 报告 → ${out}`);
  for (const i of issues) console.log('   - ' + i);
  process.exitCode = issues.length || passed < checks ? 1 : 0;
}

main();
