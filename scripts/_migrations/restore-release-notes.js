'use strict';

/** 换网成功后：把 Release 说明改回「整文件直接下载」版本 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOKEN = process.env.GH_TOKEN;
const OWNER = 'RicardoYW';
const REPO = 'ciallo-forge';
const REL_ID = '408863820';
const H = { authorization: `token ${TOKEN}`, 'user-agent': 'ciallo-notes', accept: 'application/vnd.github+json', 'content-type': 'application/json' };
const DIST = path.resolve(__dirname, '..', '..', 'dist');

const sha = (f) => new Promise((res) => {
  const h = crypto.createHash('sha256');
  fs.createReadStream(f).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex')));
});

(async () => {
  const setupSum = await sha(path.join(DIST, 'CialloForge-Setup-1.0.0.exe'));
  const portSum = await sha(path.join(DIST, 'CialloForge-Portable-1.0.0.exe'));

  const body = [
    '## 夜织 CialloForge v1.0.0',
    '',
    '成人虚构文本 + 绘图提示词双引擎的 Windows 桌面版。运行时零依赖，全离线。',
    '',
    '## 下载哪个',
    '',
    '| 程序 | 大小 | 说明 |',
    '| --- | --- | --- |',
    '| **`CialloForge-Setup-1.0.0.exe`** | 106.7 MB | 安装版：可选安装目录，自动建桌面与开始菜单快捷方式，可在控制面板卸载 |',
    '| **`CialloForge-Portable-1.0.0.exe`** | 106.4 MB | 便携版：双击即用，不写注册表 |',
    '',
    '直接点下载就行，下载完双击运行。',
    '',
    '## ⚠️ 首次运行会被 Windows 拦一下',
    '',
    '这两个程序**没有代码签名**，所以 Windows SmartScreen 会提示「已保护你的电脑」。',
    '处理方式：点 **更多信息** → **仍要运行**。',
    '',
    '部分杀软对未签名的 Electron 打包程序也可能误报（典型误报是几十个杀软同时报同一个文件），',
    '加白名单即可。想自己确认文件没被动过，用下面的 SHA256 对比。',
    '',
    '## 校验下载完整性',
    '',
    '```powershell',
    'Get-FileHash .\\CialloForge-Setup-1.0.0.exe -Algorithm SHA256',
    'Get-FileHash .\\CialloForge-Portable-1.0.0.exe -Algorithm SHA256',
    '```',
    '',
    '| 文件 | SHA256 |',
    '| --- | --- |',
    `| \`CialloForge-Setup-1.0.0.exe\` | \`${setupSum}\` |`,
    `| \`CialloForge-Portable-1.0.0.exe\` | \`${portSum}\` |`,
    '',
    '## 数据存在哪',
    '',
    '- 程序本体：安装目录（便携版解压到临时目录）',
    '- 数据与产物：`%APPDATA%\\ciallo-forge\\`（升级、重装、卸载都不会丢）',
    '',
    '## 内容分级',
    '',
    '程序内置**基础版内容（热度 1-3 档）**。更露骨的部分（热度 4-5）以**内容包**形式单独提供，',
    '放到 `%APPDATA%\\ciallo-forge\\content-pack\\` 后重启即可解锁 —— 内容包不随本 Release 分发。',
    '',
    '## 功能一览',
    '',
    '- 七个页签：创作（流式生成）/ 角色 / 场景 / 提示词 / 画廊 / 校验 / 设置',
    '- 16 张原创成年角色卡（7 男 9 女，19-34 岁）+ 16 场景 / 148 beats',
    '- 6 种提示词格式：SDXL / Pony / NovelAI / Midjourney / ComfyUI / 通用包',
    '- 同 seed 逐字节可复现；全员 18+ 三道年龄闸',
    '',
    '## 许可',
    '',
    '代码 MIT（见仓库 LICENSE）。全部角色为原创虚构成年人；生成内容的合规性、年龄分级与分发渠道由使用者负责。',
    '',
  ].join('\n');

  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/${REL_ID}`, {
    method: 'PATCH',
    headers: H,
    body: JSON.stringify({ body }),
  });
  console.log(`PATCH → HTTP ${res.status}`);
  if (!res.ok) { console.log((await res.text()).slice(0, 400)); process.exit(1); }
  const j = await res.json();
  console.log('✔ 说明已更新：' + j.html_url);
  console.log('  长度: ' + body.length + ' 字符');
})();
