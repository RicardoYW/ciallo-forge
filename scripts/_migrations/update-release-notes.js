'use strict';

/**
 * 更新 Release 说明：解释分块下载与拼接方式。
 * 用法：node scripts/_migrations/update-release-notes.js
 */
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
    '## ⚠️ 附件为什么是分块的（27 块 × 2）',
    '',
    '发布者的网络到 GitHub 上传服务器只有约 0.04 MB/s，单次上传超过 20 MB 就会超时中断。',
    '所以把两个 exe 各切成 27 块（每块 4 MB）分开上传 —— **这是上传通道的限制，不是程序问题**。',
    '下载后按下面的方法拼回完整 exe，拼出来的文件与原始 exe 逐字节相同（已验证）。',
    '',
    '## 怎么拼回完整程序',
    '',
    '### 方法一：一条命令（推荐）',
    '',
    '把某个程序的 27 个分块下载到同一个文件夹，然后在那个文件夹里打开 PowerShell：',
    '',
    '```powershell',
    '# 安装版',
    'cmd /c copy /b CialloForge-Setup-1.0.0.part*.exe CialloForge-Setup-1.0.0.exe',
    '',
    '# 便携版',
    'cmd /c copy /b CialloForge-Portable-1.0.0.part*.exe CialloForge-Portable-1.0.0.exe',
    '```',
    '',
    '⚠️ `copy /b` 的拼接顺序按文件名升序，所以下载后**不要改分块文件名**。',
    '（附件的真实扩展名是 `.partNNofNN`，GitHub 可能给它们附加 `.exe` 后缀，按上面通配符写就行。）',
    '',
    '### 方法二：用仓库里的脚本',
    '',
    '下载仓库里的 [`拼接下载分块.bat`](https://github.com/RicardoYW/ciallo-forge/blob/main/%E6%8B%BC%E6%8E%A5%E4%B8%8B%E8%BD%BD%E5%88%86%E5%9D%97.bat)，',
    '和分块文件放同一个文件夹，双击即可 —— 它会自动拼接并校验 SHA256。',
    '',
    '### 拼完必须校验',
    '',
    '```powershell',
    'Get-FileHash .\\CialloForge-Setup-1.0.0.exe -Algorithm SHA256',
    'Get-FileHash .\\CialloForge-Portable-1.0.0.exe -Algorithm SHA256',
    '```',
    '',
    '| 文件 | 完整大小 | SHA256 |',
    '| --- | --- | --- |',
    `| \`CialloForge-Setup-1.0.0.exe\` | 106.7 MB | \`${setupSum}\` |`,
    `| \`CialloForge-Portable-1.0.0.exe\` | 106.4 MB | \`${portSum}\` |`,
    '',
    '不一致就说明有块没下全或顺序错了，重新下载缺的那块即可。',
    '',
    '## 下载哪个',
    '',
    '| 程序 | 说明 |',
    '| --- | --- |',
    '| **Setup**（安装版） | 可选安装目录，自动建桌面与开始菜单快捷方式，可在控制面板卸载 |',
    '| **Portable**（便携版） | 双击即用，不写注册表 |',
    '',
    '## ⚠️ 首次运行会被 Windows 拦一下',
    '',
    '这两个程序**没有代码签名**，所以 Windows SmartScreen 会提示「已保护你的电脑」。',
    '处理方式：点 **更多信息** → **仍要运行**。部分杀软对未签名的 Electron 打包程序也可能误报，加白名单即可。',
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
  const text = await res.text();
  console.log(`PATCH release → HTTP ${res.status}`);
  if (!res.ok) { console.log(text.slice(0, 400)); process.exit(1); }
  const j = JSON.parse(text);
  console.log('✔ 说明已更新：' + j.html_url);
  console.log('  说明长度: ' + body.length + ' 字符');
})();
