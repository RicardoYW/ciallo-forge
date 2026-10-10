# 夜织 · CialloForge

> 成人虚构文本 + 绘图提示词双引擎 · 16 张原创成年角色卡（♂7 / ♀9）· **默认男女向配对** · 年龄锁 18+ · 运行时零依赖 · 全本地离线

一个把「角色卡 → 分幕 beat → 正文」和「角色卡 × 场景 → SD/NovelAI/MJ/ComfyUI 提示词」
两条流水线打通的生成工厂。所有随机都由 seed 驱动，同 seed 逐字节复现；所有角色卡
必须显式声明 `age >= 18` 且 `ageLock: true`，否则校验器与引擎同时拒收。

16 个场景每个都带 `autoCast`（A 主导方 / B 对方）与 `leadGender`，不带参数直接跑就是男女向；
想换成同性或调换主次，见 [场景配对表.md](场景配对表.md)。

---

## 项目简介

**夜织 CialloForge** 是一个面向成人向创作的本地生成工具，把两条流水线打通：

- **文本**：角色卡 → 分幕 beat → 热度分级词库 → 声线改写 → 成稿（Markdown，含角色卡与配图提示词附录）
- **绘图提示词**：角色 × 场景 × 六种目标格式（SDXL / Pony / NovelAI / Midjourney / ComfyUI / 通用包）

**四条设计原则**

1. **全员成年锁 18+** —— 角色卡必须显式声明 `age >= 18` 且 `ageLock: true`，
   卡层 / 引擎层 / 文本层三道闸拦截；提示词负向固定包含幼态排除词。
   规则是「ageLock 优先于造型词」：成年角色写娇小、白发、幼态妆属于造型选择，放行；
   只有年龄字段未成年、或年龄缺失且幼态体型词占主导时才拒收。
2. **运行时零依赖** —— 引擎、界面、命令行只用 Node 内置模块（`http` / `fs` / `child_process`），
   无任何网络请求，`node_modules` 不存在也能跑，断网可用。
   桌面版外壳（Electron）是**可选构建依赖**，只有要打 exe 时才需要装。
3. **可复现** —— 同一输入（场景 / 卡司 / 热度 / 节奏 / 种子）逐字节一致，
   这也是它能写回归测试的前提。
4. **界面与命令行同源** —— 后端端点直接调用引擎，不复制任何生成逻辑，
   所以图形界面与 CLI 的输出必然一致（自检里有一条专门验证：同一输入 3753 字符完全相同）。

**规模**

| 项 | 数量 |
| --- | --- |
| 原创成年角色卡 | 16 张（♂7 / ♀9，19-34 岁） |
| 场景 / beat | 16 个 / 148 个 |
| 声线寄存器 | 14 种改写管线 |
| 绘图标签 | 354 条 |
| 散文池 | 8 族 × 5 档热度 |
| 本地 HTTP 端点 | 19 条（另有流式生成、文件读取等 3 条特殊分支） |

**交付形态**

- 双击 `启动界面.bat` → 图形界面（七个页签：创作 / 角色 / 场景 / 提示词 / 画廊 / 校验 / 设置）
- 双击 `启动.bat` → 中文命令行菜单
- 直接命令行调用 → 批量生成、导出、接入脚本

**验证**：51 项测试 + 23 项内容自检 + 32 项界面接口自检 + 7 项真浏览器渲染校验，四层全绿；
明细见 [out/RUN-REPORT.md](out/RUN-REPORT.md)、[out/UI-CHECK.md](out/UI-CHECK.md)、[out/UI-RENDER.md](out/UI-RENDER.md)。
开发过程中的 12 个真 bug 与已知限制记录在 [开发手记.md](开发手记.md)。

> English introduction: [README.en.md](README.en.md)

---

## 内容分级与年龄门禁

这个项目**默认只带基础版内容**（热度 1-3 档词库），更露骨的部分（热度 4-5）以**内容包**形式单独分发。
这样仓库本体保持功能性工具的定位，露骨数据由使用者自行决定是否加载。

**三层门禁**

1. **卡层**：每张角色卡必须显式声明 `age >= 18` 且 `ageLock: true`，缺失或不达标直接拒收
2. **引擎层**：绘图提示词编译器遇到未成年角色直接抛错（`[age-gate]`）
3. **文本层**：幼态词扫描 —— 规则是 **ageLock 优先于造型词**：成年角色写娇小、白发、幼态妆属于造型选择，放行；
   只有年龄字段未成年、或年龄缺失且幼态体型词占主导时才拒收

绘图提示词的负向提示词**固定包含**幼态排除标签（`child` / `loli` / `underage` 等），不可关闭。

**内容包怎么用**

```bash
# 1. 拿到内容包（一个 content-pack 文件夹），放到以下任一位置：
#    · 项目根目录 content-pack/
#    · 桌面版数据目录 %APPDATA%\ciallo-forge\content-pack/
#    · 任意位置 + 设置环境变量 CIALLO_PACK_DIR
# 2. 确认生效
node bin/ciallo.js pack status     # 应显示 ● 已启用
# 3. 想回到基础版
node bin/ciallo.js pack off
```

界面里也有开关：**设置 → 内容包 → 启用 / 关闭**。

自己生成一份完整包（需要有完整词库）：

```bash
node scripts/export-content-pack.js --zip
# → content-pack/（完整词库）
# → dist/open-source-data/（降级版基础数据，开源仓库用这份）
# → dist/CialloForge-ContentPack-1.0.0.zip（可分发的包）
```

**注意**：内容包是**数据包，不含任何代码**，MIT 许可只覆盖代码；
使用者对生成内容的合规性、年龄分级与分发渠道负全部责任。

---

```
ciallo-forge/
├── 启动界面.bat              ← 双击这个：图形界面（推荐）
├── 启动.bat                  ← 双击这个：全中文命令行菜单
├── bin/
│   ├── ciallo.js             CLI 入口
│   └── gui.js                界面启动入口（起服务 + 开窗口）
├── src/
│   ├── engine/
│   │   ├── datastore.js      数据访问 + 结构校验 + 统计
│   │   ├── tokens.js         {A}/{body}/{prop} 分级 token 解析器
│   │   ├── prompt.js         绘图提示词编译器（6 种目标格式）
│   │   ├── story.js          分幕叙事引擎（beat 规划 + 字数控制）
│   │   ├── voice.js          声线寄存器改写管线
│   │   └── validate.js       年龄锁把关 + 文本扫描 + 提示词合规
│   ├── server/               界面后端（node:http，零依赖）
│   │   ├── server.js         服务与请求体解析
│   │   ├── routes.js         路由表 + NDJSON 流式生成
│   │   ├── api.js            端点实现（直接调 engine，不复制逻辑）
│   │   └── static.js         静态资源 + 路径穿越防护
│   ├── web/                  界面前端（原生 HTML/CSS/JS，无框架无 CDN）
│   │   ├── index.html        七页签外壳
│   │   ├── app.css           暗紫主题 · 响应式
│   │   └── app.js            状态 / 渲染 / 流式接收 / 快捷键
│   └── util/                 Rng（splitmix32）· text · io
├── data/
│   ├── characters.json       16 张成年角色卡（♂7 / ♀9）
│   ├── scenes.json           16 个场景 / 148 个 beat（含 autoCast 配对）
│   ├── prose.json            8 族散文池 · 5 档热度词库 + 中性声线侧写
│   ├── voice-registers.json  14 种声线改写管线
│   └── config.json           默认参数 + 安全词表
├── test/                     51 项测试（引擎 37 + CLI 8 + 前端 6）
├── scripts/
│   ├── verify.js             内容自检（23 项）→ out/RUN-REPORT.md
│   ├── check-ui.js           界面/接口自检（32 项）→ out/UI-CHECK.md
│   ├── check-render.js       真浏览器渲染校验（7 项）→ out/UI-RENDER.md
│   ├── shoot-ui.js           无头截图（CDP，改界面后重拍图片）
│   ├── open-app.js           Edge/Chrome --app 窗口启动器
│   ├── build-gallery.js      成果画廊 → out/showcase.html
│   ├── build-docs-html.js    说明书 HTML → out/指南.html
│   ├── check-html.js         HTML 结构自检
│   ├── normalize-eol.js      行尾规范化（bat 用 CRLF）
│   ├── smoke.js              快速冒烟
│   └── _migrations/          数据迁移与治理工具（幂等，可选）
├── 使用指南.md
├── 场景配对表.md             16 场景 × 卡司配对表 + 换配方法
├── 开发手记.md               真 bug 的成因与修法 + 已知限制
├── README.en.md              English introduction / overview
└── out/                      产物（画廊 / 说明书 / 导出包 / 报告）
```

---

## 怎么打开它（Windows 双击党）

**方式零：桌面版 exe** ← 最省事，对方什么都不用装

| 文件 | 说明 |
| --- | --- |
| `dist\CialloForge-Setup-1.0.0.exe` | 安装包（约 107 MB）：可选安装目录、建桌面与开始菜单快捷方式、可在控制面板卸载 |
| `dist\CialloForge-Portable-1.0.0.exe` | 便携版（约 106 MB）：双击即用，不写注册表 |
| `dist\win-unpacked\夜织CialloForge.exe` | 免安装目录版（调试/自用） |

自己打一份：双击 `打包桌面版.bat`（有快速/完整/只出便携版/验证四档），
或者命令行 `npm run dist`。图标重生成：`python scripts/make-icon.py`。

> ⚠️ 未做代码签名。别人第一次运行会看到 **Windows SmartScreen「已保护你的电脑」**提示，
> 需要点「更多信息 → 仍要运行」。想消掉这个提示得买代码签名证书（一年几百到上千元）。
> 另外部分杀软对未签名的 Electron 打包程序会误报，可加白名单解决。

**方式一：双击 `启动界面.bat`** ← 图形界面（需要对方装 Node 18+）

弹出一个**独立窗口**（Edge 应用模式，无地址栏无标签页，看起来就是个桌面软件），
七个页签：创作 / 角色 / 场景 / 提示词 / 画廊 / 校验 / 设置。关窗即停服务，零依赖不联网。

**方式二：双击 `启动.bat`** —— 全中文命令行菜单

```
[U] 打开图形界面（推荐）      [5] 生成一篇正文（命令行交互版）
[1] 看数据规模               [6] 编译绘图提示词
[2] 看角色卡（16 张）         [7] 导出全套（16 卡 + 1536 提示词 + 16 篇样例）
[3] 看场景库（16 场景）       [8] 跑测试（51 项）
[4] 校验年龄锁               [9] 跑全量自检（23 项）   [C] 跑界面自检（32 项）
[G] 打开成果画廊  [H] 打开说明书  [O] 打开成果文件夹  [0] 退出
```

**方式二：直接看成果（不用跑任何命令）**

| 双击这个 | 看到什么 |
| --- | --- |
| [out/showcase.html](out/showcase.html) | **成果画廊**：16 篇样章全文预览 + 热度筛选 + 搜索 + 每篇的 SDXL 配图提示词 |
| [out/指南.html](out/指南.html) | README + 使用指南 + 开发手记 + 运行报告，排版好的网页版 |
| [out/export/INDEX.md](out/export/INDEX.md) | 导出包索引（10 卡 / 960 提示词 / 16 篇故事） |
| [out/gallery](out/gallery) | 16 篇样章的 Markdown 原文 |
| [out/RUN-REPORT.md](out/RUN-REPORT.md) | 23 项体检实证报告 |

画廊或说明书删了也能重建：

```bash
node scripts/build-gallery.js      # 重建 out/showcase.html
node scripts/build-docs-html.js    # 重建 out/指南.html
```

**方式三：命令行（想批量或嵌进脚本时）**

```bash
cd ciallo-forge
node bin/gui.js --no-open                     # 只起界面服务，手动用浏览器开
node bin/ciallo.js stats
node bin/ciallo.js story --scene S12 --cast C15,C04 --heat 4 --words 2000 --out out/试读.md
node bin/ciallo.js prompt --char C12 --scene S11 --target all --heat 5 --out out/p12.json
```

---

## 图形界面

界面是**本地 Web UI**：Node 内置 http 起服务（只绑 `127.0.0.1`），前端原生 HTML/CSS/JS，
无框架、无构建步骤、无 CDN 请求。Edge 的 `--app=` 模式把它包成独立窗口；
机器上没 Edge/Chrome 时自动回退系统默认浏览器。

| 页签 | 能干什么 |
| --- | --- |
| **创作** | 左：卡池（♂♀ 筛选、搜索、点选 A/B 位）；中：场景 + 主导方/对方 + 热度滑杆 + 节奏/字数/种子 + 快捷键；右：**流式**刷出的正文预览（逐段出现，带字数与耗时） |
| **角色** | 16 张卡：定位/表层/阴影、台词种子、癖好、绘图标签；一键「用它创作」/「配图提示词」/「复制绘图标签」 |
| **场景** | 每个场景可就地换配对并「存为默认」（写回 `data/scenes.json` 的 autoCast），同性组合会被拦 |
| **提示词** | 单条或全矩阵编译，六种目标格式，逐条校验状态，复制正向/负向/MJ 命令/NAI payload/ComfyUI workflow，导出 json+md+csv |
| **画廊** | 浏览 out/gallery 的样章，搜索 + 全文阅读 |
| **校验** | 一键跑年龄锁三道闸 + 门禁演练 + 结构校验，逐项着色 |
| **设置** | 默认热度/字数/节奏、运行信息、重建导出包、重载数据文件 |

快捷键：`Ctrl+Enter` 生成 · `Ctrl+S` 存盘 · `Esc` 停止/关弹层 · `/` 聚焦搜索。

**API 一览**（界面与 CLI 共用同一套引擎，结果逐字节一致）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` `/api/stats` `/api/characters` `/api/scenes` `/api/kinks` `/api/prose` | 数据与统计 |
| GET | `/api/validate` `/api/gallery` `/api/out` `/api/file?p=` | 校验 / 样章 / 产物 / 读文件（防越界） |
| POST | `/api/story` `/api/story/plan` `/api/story/stream` `/api/story/save` | 生成 / 预演 / **流式生成** / 存盘 |
| POST | `/api/prompt` `/api/prompt/export` | 编译 / 导出提示词 |
| POST | `/api/scene/pairing` `/api/settings` `/api/export` | 改默认配对 / 设置 / 重建导出包 |

自检：`node scripts/check-ui.js`（32 项，起真服务打真接口）、
`node scripts/check-render.js`（7 项，无头浏览器渲染后校验 DOM 里真有数据）、
`node --test test/web.test.js`（6 项，假 DOM 里真跑 app.js）。

界面截图（`node scripts/shoot-ui.js` 自动生成）：[创作页](out/screenshots/界面-创作页.png) ·
[已生成](out/screenshots/界面-已生成.png) · [角色页](out/screenshots/界面-角色页.png) ·
[场景页](out/screenshots/界面-场景页.png) · [提示词页](out/screenshots/界面-提示词页.png) ·
[校验页](out/screenshots/界面-校验页.png)

---

## 桌面版（Electron）

同一个界面可以打成 Windows 桌面程序，对方**不需要装 Node**：双击 exe 就开窗口。

**技术形态**：Electron 主进程起本地 http 服务（随机端口，只绑 `127.0.0.1`），
`BrowserWindow` 载入该地址。用 http 而不是 `file://`，是为了让前端的 `fetch('/api/...')`
与流式生成原样可用 —— 界面代码一行没改。

**数据放在哪**（这是打包最容易踩的坑：程序目录通常只读）

| 运行形态 | 数据目录 | 产物目录 |
| --- | --- | --- |
| 桌面版（Electron） | `%APPDATA%\ciallo-forge\data` | `%APPDATA%\ciallo-forge\out` |
| 开发 / 命令行 | 项目内 `data/` | 项目内 `out/` |
| 便携模式（exe 旁放 `portable.marker`） | exe 同级 `data/` | exe 同级 `out/` |

首次运行会把内置的 5 个 JSON（角色卡/场景/词库/声线/配置）释放到数据目录；
升级或重装程序不会覆盖用户数据，卸载时也保留（`deleteAppDataOnUninstall: false`）。

**原生能力**：菜单栏（打开数据目录 / 产物目录 / 缩放 / 全屏 / 帮助文档）、
系统剪贴板（`Ctrl+C` 复制提示词走原生通道）、单实例锁（再点一次聚焦已有窗口）、
外链交给系统浏览器、窗口图标。

**验证**：`node scripts/check-desktop.js`（15 项）会真的启动打包后的 exe，
读它的自检 JSON，断言窗口开起来、界面拿到 16 卡、桌面标识点亮、数据目录落在用户目录、
内置数据已释放、图标已加载、产物目录可写。报告 → [out/DESKTOP-CHECK.md](out/DESKTOP-CHECK.md)。

**已知限制**：桌面版目前**不暴露命令行入口**（asar 里带了 `bin/ciallo.js`，但没做控制台 shim）——
需要批量生成请在开发机用 CLI。打包体积约 107 MB（Electron + Chromium 就是这个量级）。

---

## 快速开始

```bash
cd ciallo-forge

node bin/gui.js                              # 图形界面（推荐）
node bin/ciallo.js stats                     # 看规模
node bin/ciallo.js chars --verbose           # 看卡池
node bin/ciallo.js scenes                    # 看场景库
node bin/ciallo.js validate --gate           # 年龄锁校验 + 门禁演练

# 出正文（写到文件）
node bin/ciallo.js story --scene S05 --lead male --heat 5 --words 2000 --pacing fast --out out/gym.md

# 出绘图提示词
node bin/ciallo.js prompt --char C12 --scene S11 --target all --heat 5 --out out/p12.json

# 一键导出全套
node bin/ciallo.js export --out out/export

# 自检（四层）
node --test test/engine.test.js test/cli.test.js test/web.test.js
node scripts/verify.js
node scripts/check-ui.js
node scripts/check-render.js
```

---

## 两条流水线

### 一、文本流水线

```
场景(scene) ─→ 幕(act) ─→ beat(type + 模板) ─→ token 解析 ─→ 声线改写 ─→ Markdown
                                  ↑
                          角色卡(cast) / 热度(heat) / 节奏(pacing) / seed
```

- **beat 类型**：`sensory` 感官 / `action` 动作 / `pressure` 施压 / `climax` 高潮 /
  `release` 释放 / `afterglow` 余韵 / `interior` 内心 / `dialogue` 台词
- **热度 1-5**：1 克制 → 3 缠绵（身体描写，无器官名词）→ 5 露骨（全词库开放）。
  池子里每条词带 `min` 字段，低于该热度不会被选中；无候选时只放宽到该池最低档，
  **绝不回退到全池**（这条是早期 bug 的教训）
- **节奏档**：`slow` 慢燃 / `balanced` 均速 / `fast` 快进 / `pwp` 直入，
  用 word 数倍率 + 铺垫 beat 跳过率控制
- **字数控制**：目标字数 × 节奏倍率，不足时循环补 `pressure/action/climax/afterglow/sensory`
- **声线**：台词种子经过寄存器管线改写 —— `truncate` 压短 / `stutter` 结巴 /
  `particle` 助词 / `echo` 口气词前插 / `breath` 停顿符 / `terminal` 收束。
  同一句「你要是疼就说，别忍着」在 10 个角色口中是 10 种写法

### 二、提示词流水线

```
角色卡(appearance.tags + body + negative + loraAnchors)
   × 场景(tags + camera) × 姿势(heat × kinkFamily) × 评级(safe/suggestive/nsfw/explicit)
   → SDXL / Pony / NovelAI / Midjourney / ComfyUI / 通用包
```

输出内容：正向前缀（评级）→ 质量词 → 年龄锚点 → 造型标签 → 身体细节 → 场景 →
姿势 → 双人标记 → 自定义 → LoRA 权重；负向固定含基础瑕疵词 + 幼态排除词 + 角色专属负向。

---

## 命令参考

| 命令 | 关键参数 | 说明 |
| --- | --- | --- |
| `chars` | `--verbose` | 列卡池，逐卡校验状态 |
| `scenes` | `--verbose` | 列场景库，含幕结构与卡司提示 |
| `prompt` | `--char C01\|all`、`--scene S01`、`--target sdxl\|pony\|novelai\|midjourney\|comfyui\|generic\|all`、`--heat 1-5`、`--rating`、`--extra "a;b"`、`--out` | 编译提示词；`--out` 同时写 json + md |
| `story` | `--scene S01,S02`、`--cast C01,C08`、`--heat`、`--words`、`--pacing`、`--seed 7,8`、`--out`、`--print` | 单篇写文件；多篇写目录 + INDEX.md |
| `validate` | `--gate`、`--json out/r.json` | 年龄锁 + 结构校验；`--gate` 附门禁演练 |
| `export` | `--out out/export`、`--char`、`--heat` | 卡 + 提示词(json/md/csv) + 16 篇样例故事 + INDEX |
| `stats` | — | 规模统计 |
| `help` | — | 帮助 |

---

## 年龄锁机制（三道闸）

1. **卡层**：`age` 必须是数字且 `>= 18`，`ageLock` 必须为 `true`。缺失或不达标 → 校验失败
2. **引擎层**：`compilePrompt` 遇到未成年卡直接 `throw`；`gateCharacter` 供外部复用
3. **文本层**：`scanText` 扫幼态词表。规则是 **ageLock 优先于造型词** ——
   成年角色写「娇小 / 白发 / 幼态妆 / 150cm」只是造型选择，放行并标记 `review`；
   只有「年龄字段是未成年」或「无成年锚点且幼态体型词占主导」才 `reject`

`validate --gate` 会现场构造一张 17 岁卡与一段幼态文本，验证两处都被拦下。

---

## 扩展

**加角色**：往 `data/characters.json` 的 `characters` 数组追加一张卡，字段照着现有卡写。
`voice.register` 必须已存在于 `voice-registers.json`，否则校验报错。

**加场景**：往 `data/scenes.json` 追加，`acts[].beats[].type` 用 8 种类型之一。
beat 模板里可用 token：

| token | 含义 |
| --- | --- |
| `{A}` `{B}` / `{who}` `{target}` | 主导方 / 对方的名字 |
| `{loc}` `{prop}` `{sensory}` `{light}` | 场景地点 / 道具 / 气味 / 光源 |
| `{body}` `{garment}` `{fluid}` `{verb}` | 身体部位 / 衣物 / 体液 / 动作词（按热度分级） |
| `{reaction}` `{aftermath}` `{intent}` `{intensityWord}` | 反应 / 余韵 / 内心 / 强度词（按热度分级） |
| `{voice}` `{line}` | 声线侧写 / 当前台词 |
| `{mood}` `{moodColor}` `{kink}` | 氛围词 / 氛围注脚 / 癖好注脚 |

**加热度档 / 词库**：`data/prose.json` 里改 `heat`、`bodyPart`、`fluid`、`reaction` 等族，
每条带 `min`（生效最低热度）与 `weight`（抽样权重）。

**嵌入代码**：

```js
const forge = require('./src/index');

// 提示词
const p = forge.prompt.compilePrompt({
  character: forge.datastore.characterById('C02'),
  scene: forge.datastore.sceneById('S02'),
  heat: 5, rating: 'explicit', target: 'novelai', seed: 7,
});
console.log(p.positive, p.nai);

// 正文
const md = new forge.story.Story({ scene: 'S07', cast: ['C07'], heat: 3, words: 3000, pacing: 'slow', seed: 12 }).markdown();
```

---

## 实证

`node scripts/verify.js` 会跑 23 项体检并写出 `out/RUN-REPORT.md`：

- 1536 条提示词全矩阵编译并逐条校验（16 卡 × 16 场景 × 6 目标）
- 16 场景 × 5 热度档 = 80 篇正文，token 残留 0 处
- 复现性：同 seed 逐字节一致
- 热度分级：低热 0 漏词 / 高热命中直白词库
- 节奏档字数单调：`pwp ≤ fast ≤ balanced ≤ slow`
- 声线：同一句种子多角色不同改写；台词侧写不串声线
- 代词治理：数据层无裸代词、抽样段 0 泄漏
- 文本质量：重复段 0、短残句 0、无空插槽
- 配对：16 场景自动配对全部为男女向，A 位符合 leadGender
- CLI 退出码、导出包完整性

`node --test test/engine.test.js test/cli.test.js test/web.test.js` → 51 项全绿。

开发过程中踩的真 bug（token 只解析一层、heat 掉默认值、池子回退整池、
补写循环复用旧句、命名空间 token 查不到键、性别代词打架、场景服饰与性别绑死等）
与已知限制记录在 [开发手记.md](开发手记.md)。

---

## 约定

- 生成内容全部为成年角色的虚构创作，角色为原创设定（非真实人物）
- 项目不联网、不调用任何外部服务、不引入任何依赖
- 提示词负向固定排除幼态特征，导出包内每条都带 `validation` 字段
- 本地项目，自行取用
