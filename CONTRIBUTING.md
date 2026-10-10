# 贡献指南

感谢愿意帮忙。这个项目的特点是：**逻辑都在数据里**，所以大部分贡献其实是改 JSON，而不是写代码。

---

## 一、跑起来需要的

- Node 18+（开发和测试）
- 不需要装任何运行时依赖；只有要打桌面版时才需要 `npm install`（Electron + electron-builder）

```bash
git clone <repo>
cd ciallo-forge
node scripts/verify.js                              # 内容体检
node --test test/engine.test.js test/cli.test.js test/web.test.js   # 测试
node bin/gui.js                                     # 起界面（浏览器访问它打印的地址）
```

---

## 二、内容分级与内容包

仓库本体只带**基础版数据**（热度 1-3 档词库）。更露骨的部分（热度 4-5）放在
**内容包**里，不入库：

```
基础版 data/（入库）  +  content-pack/（不入库）  →  引擎合并后使用
```

- 装了包：`node bin/ciallo.js pack status` 会显示 `● 已启用`
- 想自己生成一份完整包（需要先有完整词库）：`node scripts/export-content-pack.js`
- 关卡：`node bin/ciallo.js pack off`

**提交内容相关改动时请注意**：

| 允许提交 | 不要提交 |
| --- | --- |
| 引擎、界面、脚本、测试 | `content-pack/` 里的露骨词库 |
| 基础版词库（热度 1-3） | 任何真实人物的形象/姓名/身份设定 |
| 原创成年角色卡（`age >= 18` 且 `ageLock: true`） | 未成年或年龄模糊的角色设定 |
| 场景、声线、氛围数据 | 从别处抄来的受版权保护文本 |

**硬性要求**：任何新增角色都必须有显式 `age`（≥18）与 `ageLock: true`。
校验器会拦，但请在提交前自己先跑一遍 `node bin/ciallo.js validate`。

---

## 三、最常见的几种贡献

### 1. 加一张角色卡

编辑 `data/characters.json`，往 `characters` 数组追加。字段说明见《使用指南》第 6 节。
必须提供：`id` / `name` / `gender` / `age` / `ageLock` / `occupation` / `body` /
`appearance.tags`（≥8 条英文绘图标签）/ `appearance.negative` / `personality` /
`voice.register`（必须是 `data/voice-registers.json` 里已有的键）/ `kinks` / `imagery`。

```bash
node bin/ciallo.js validate          # 必须全绿
```

### 2. 加一个场景

编辑 `data/scenes.json`。要点：

- `acts[].beats[].type` 用八种之一：`sensory` / `action` / `pressure` / `climax` / `release` / `afterglow` / `interior` / `dialogue`
- `beat.text` 里用 token，**不要写死「他/她」**：用 `{A}` `{B}`（出名字）或 `{pronA}` `{pronB}`（按性别出代词）
- 新场景必须带 `autoCast`（两人，且为男女组合）与 `leadGender`

### 3. 加词句

编辑 `data/prose.json`。每条词可以带 `min`（生效的最低热度）与 `weight`（抽样权重）：

```json
{ "min": 4, "weight": 3, "text": "…" }
```

**热度 4 及以上的词请加到内容包**（`scripts/export-content-pack.js` 会按 `min` 自动分流）。

### 4. 改引擎 / 界面

- 引擎：`src/engine/`，改完跑 `node scripts/verify.js`（会有 80 篇正文的残留 token 扫描）
- 界面：`src/web/`，改完跑 `node --test test/web.test.js`（会做 HTML/JS 的 id 集合比对）
- 服务端：`src/server/`，改完跑 `node scripts/check-ui.js`

---

## 四、提交前请跑

```bash
node --test test/engine.test.js test/cli.test.js test/web.test.js   # 51 项
node scripts/verify.js                                             # 23 项
node scripts/check-ui.js                                           # 32 项
```

桌面版相关改动再加：

```bash
npm run pack && node scripts/check-desktop.js    # 15 项（需要 Electron）
```

PR 描述里请贴上这几条命令的输出摘要。**测试没过的 PR 不会被合并**。

---

## 五、风格约定

- 代码：CommonJS、两空格缩进、单引号、语句结尾不留空格；中文注释，说明「为什么」而不是「做了什么」
- 提交信息：一句话说清改了什么，中文英文都行。示例：
  - `新增 C17 角色卡：调酒师 · 慢热型`
  - `fix: 修复池子无候选时回退整池导致高热词泄漏`
  - `docs: 补充内容包装载说明`
- **不要**提交：`node_modules/`、`dist/`、`out/` 下的运行产物、任何带本地绝对路径的调试文件

---

## 六、不适合提 PR 的内容

- 真实人物的形象或身份设定（无论是否公众人物）
- 未成年或年龄模糊的角色、幼态性化设定
- 把内容包里的露骨数据提交进仓库
- 绕过年龄门禁（`ageLock`）的代码改动

这些不是风格问题，是项目底线，会被直接关闭。
