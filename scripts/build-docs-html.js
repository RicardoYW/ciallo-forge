'use strict';

/**
 * 生成 out/指南.html —— 使用指南 / 开发手记 的 HTML 版。
 * 给没装 Markdown 阅读器的机器兜底：双击就能在浏览器里读。
 * 用法：node scripts/build-docs-html.js
 */

const fs = require('fs');
const path = require('path');
const io = require('../src/util/io');

const DOCS = [
  { file: 'README.md', title: '项目说明 README' },
  { file: 'README.en.md', title: 'English Overview' },
  { file: '使用指南.md', title: '使用指南' },
  { file: '开发手记.md', title: '开发手记（真 bug + 已知限制）' },
  { file: '场景配对表.md', title: '场景 × 卡司配对表（男女向）' },
  { file: 'out/RUN-REPORT.md', title: '运行报告（体检实证）' },
];

const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

/** 极简 Markdown 渲染：够用即可（标题/表格/代码块/列表/粗体/行内码/链接/引用） */
function md2html(md) {
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let inCode = false;
  let codeBuf = [];
  let listOpen = false;
  let tableBuf = [];

  const inline = (s) =>
    esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  const flushTable = () => {
    if (!tableBuf.length) return;
    const rows = tableBuf.filter((r) => !/^\s*\|?[\s:|-]+\|?\s*$/.test(r));
    if (!rows.length) { tableBuf = []; return; }
    const cells = (r) => r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((x) => x.trim());
    out.push('<table><thead><tr>' + cells(rows[0]).map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>');
    for (const r of rows.slice(1)) out.push('<tr>' + cells(r).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>');
    out.push('</tbody></table>');
    tableBuf = [];
  };

  const closeList = () => { if (listOpen) { out.push('</ul>'); listOpen = false; } };

  for (const line of lines) {
    if (/^```/.test(line)) {
      if (inCode) { out.push('<pre>' + esc(codeBuf.join('\n')) + '</pre>'); codeBuf = []; inCode = false; }
      else { flushTable(); closeList(); inCode = true; }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }

    if (/^\s*\|.*\|\s*$/.test(line)) { closeList(); tableBuf.push(line); continue; }
    flushTable();

    if (!line.trim()) { closeList(); continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeList(); const lv = Math.min(6, h[1].length + 1); out.push(`<h${lv}>${inline(h[2])}</h${lv}>`); continue; }

    if (/^\s*[-*]\s+/.test(line)) {
      if (!listOpen) { out.push('<ul>'); listOpen = true; }
      out.push('<li>' + inline(line.replace(/^\s*[-*]\s+/, '')) + '</li>');
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      if (!listOpen) { out.push('<ul class="num">'); listOpen = true; }
      out.push('<li>' + inline(line.replace(/^\s*\d+\.\s+/, '')) + '</li>');
      continue;
    }
    if (/^>\s?/.test(line)) { closeList(); out.push('<blockquote>' + inline(line.replace(/^>\s?/, '')) + '</blockquote>'); continue; }
    if (/^---+$/.test(line.trim())) { closeList(); out.push('<hr>'); continue; }

    closeList();
    out.push('<p>' + inline(line) + '</p>');
  }
  if (inCode && codeBuf.length) out.push('<pre>' + esc(codeBuf.join('\n')) + '</pre>');
  flushTable();
  closeList();
  return out.join('\n');
}

const sections = DOCS.map((d) => {
  const p = path.join(io.ROOT, d.file);
  const md = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : `（未找到 ${d.file}）`;
  const id = d.file.replace(/[^\w]/g, '-').toLowerCase();
  return { ...d, id, html: md2html(md) };
});

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>夜织 CialloForge · 说明书</title>
<style>
  :root{--bg:#0e0d12;--panel:#17161d;--line:#2c2937;--txt:#e8e4f0;--dim:#9b93ad;--accent:#c9a6ff}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--txt);font:15.5px/1.85 "Noto Sans SC","Microsoft YaHei",system-ui,sans-serif}
  header{padding:30px 26px 20px;border-bottom:1px solid var(--line);background:radial-gradient(800px 280px at 15% -20%,#2a1f3d,transparent 70%)}
  h1{margin:0;font-size:24px;letter-spacing:.05em}
  header p{margin:8px 0 0;color:var(--dim);font-size:13.5px}
  nav{padding:12px 26px;border-bottom:1px solid var(--line);display:flex;gap:10px;flex-wrap:wrap;font-size:13px;position:sticky;top:0;background:rgba(14,13,18,.95);backdrop-filter:blur(8px);z-index:5}
  nav a{color:var(--dim);text-decoration:none;padding:5px 12px;border:1px solid var(--line);border-radius:20px}
  nav a:hover{color:var(--accent);border-color:var(--accent)}
  main{max-width:1000px;margin:0 auto;padding:8px 26px 60px}
  section{padding:26px 0;border-bottom:1px solid var(--line)}
  h2{font-size:20px;margin:0 0 14px;color:var(--accent);letter-spacing:.04em}
  h3{font-size:16.5px;margin:26px 0 10px;color:#dcd3f0}
  h4,h5,h6{font-size:15px;margin:20px 0 8px;color:#c8bfe0}
  p{margin:0 0 12px}
  a{color:var(--accent)}
  code{background:#12111a;border:1px solid var(--line);padding:1px 5px;border-radius:4px;font-size:13px;font-family:ui-monospace,Consolas,monospace;color:#c9a6ff}
  pre{background:#12111a;border:1px solid var(--line);border-radius:8px;padding:14px;overflow:auto;font-size:12.5px;line-height:1.7;font-family:ui-monospace,Consolas,monospace;color:#b9b1cd}
  pre code{background:none;border:none;padding:0;color:inherit}
  ul{margin:0 0 12px;padding-left:22px}
  li{margin:4px 0}
  ul.num{list-style:decimal}
  blockquote{margin:0 0 12px;padding:8px 14px;border-left:3px solid #3b3350;color:#bfb3d8;background:#141320;border-radius:0 6px 6px 0}
  table{border-collapse:collapse;width:100%;margin:8px 0 16px;font-size:13.5px}
  th,td{border:1px solid var(--line);padding:7px 10px;text-align:left;vertical-align:top}
  th{background:#1b1a22;color:#cfc6e6;font-weight:600}
  hr{border:none;border-top:1px solid var(--line);margin:22px 0}
  .top{position:fixed;right:20px;bottom:20px;background:#1b1a22;border:1px solid var(--line);color:var(--dim);border-radius:50%;width:42px;height:42px;display:grid;place-items:center;text-decoration:none;font-size:18px}
  .top:hover{color:var(--accent);border-color:var(--accent)}
  footer{padding:22px 26px;text-align:center;color:var(--dim);font-size:12.5px;border-top:1px solid var(--line)}
</style>
</head>
<body>
<header>
  <h1>夜织 CialloForge · 说明书</h1>
  <p>成人虚构文本 + 绘图提示词双引擎 · 全员成年锁 18+ · 本地离线 · 零依赖 · 生成时间 ${new Date().toLocaleString('zh-CN')}</p>
</header>
<nav>
${sections.map((s) => `<a href="#${s.id}">${esc(s.title)}</a>`).join('\n')}
</nav>
<main>
${sections.map((s) => `<section id="${s.id}">\n<h2>${esc(s.title)} <span style="font-size:12.5px;color:#6f6880">${esc(s.file)}</span></h2>\n${s.html}\n</section>`).join('\n')}
</main>
<a class="top" href="#" title="回到顶部">↑</a>
<footer>夜织 CialloForge v1.0.0 · 重新生成：<code>node scripts/build-docs-html.js</code></footer>
</body>
</html>
`;

const target = path.join(io.OUT_DIR, '指南.html');
io.writeText(target, html);
console.log(`[OK] 说明书已生成 → ${target}`);
for (const s of sections) console.log(`     · ${s.title}（${s.html.length} 字符 HTML）`);
