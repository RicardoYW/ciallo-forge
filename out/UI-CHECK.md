# 夜织 GUI 自检报告

- 时间：2026-10-10T08:14:54.570Z
- 服务：http://127.0.0.1:55302（临时端口，检查结束后关闭）
- Node：v24.13.1

## 1. 静态资源

- ✅ GET / 返回 index.html — 12.1 KB
- ✅ 静态资源带防穿越（/../package.json 拿不到源码） — 状态 404
- ✅ GET /app.css — 15.3 KB
- ✅ GET /app.js — 40.1 KB

## 2. 只读端点

- ✅ GET /api/health — v1.0.0
- ✅ GET /api/stats — 16 卡 / 16 场景 / ♂7 ♀9 / 148 beats
- ✅ GET /api/characters 全量 + 筛选 — 16 卡 / ♂7 ♀9 / 搜索命中 2
- ✅ GET /api/scenes 带男女配对 — 16 场景全部男女向，共 148 beats
- ✅ GET /api/prose 词库概览 — 8 族 / 5 档热度 / 中性侧写 5 条
- ✅ GET /api/gallery 样章清单 — 16 篇

## 3. 生成端点

- ✅ POST /api/story/plan 预演配对 — 罗砚 × 阿沅 · mixed · 目标 600 字
- ✅ POST /api/story 出稿且无残留 token — 800 字
- ✅ POST /api/story 非法热度被夹取 — heat 99 → 5
- ✅ POST /api/story 未知场景回退第一个场景 — 回退到 S01
- ✅ POST /api/story/stream 流式事件序列完整 — 25 段 / 907 字
- ✅ POST /api/story/save 存盘并落位 out/ — stories/__ui-check.md
- ✅ POST /api/story/save 拒绝空内容 — 状态 400 · EMPTY

## 4. 提示词端点

- ✅ POST /api/prompt 单条（6 目标） — 6 目标 / 正向 76 token
- ✅ POST /api/prompt 批量（16 卡 × 16 场景 × sdxl） — 256 条全部通过
- ✅ POST /api/prompt 未知角色返回 404 — NO_CHARACTER
- ✅ POST /api/prompt 未知目标返回 400 — BAD_TARGET
- ✅ POST /api/prompt/export 落盘 json+md+csv — 1 条 → json/md/csv

## 5. 校验 · 配对 · 设置

- ✅ GET /api/validate 全库通过 — 16 卡 / 16 场景 · 门禁四项全过
- ✅ POST /api/scene/pairing 改配对并即时生效 — C04+C15 → 已还原 C15+C04
- ✅ POST /api/scene/pairing 拒绝同性配对 — 默认配对必须是男女组合（想配同性请用 --cas…
- ✅ POST /api/scene/pairing 拒绝同一人 — SAME_CHARACTER
- ✅ GET/POST /api/settings 读写一致 — defaultWords 往返正常（1200）
- ✅ GET /api/file 读 out 文件 + 拒绝越界 — 越界状态 403 · FORBIDDEN

## 6. 健壮性

- ✅ 未知 API 返回 404 JSON — NO_ROUTE
- ✅ 非法 JSON 请求体返回 400 — BAD_JSON
- ✅ POST /api/export 重建导出包 — 16 卡 / 1536 提示词 / 16 篇

## 7. 界面与 CLI 一致性

- ✅ 同一输入：API 生成 == CLI 引擎生成（逐字节） — 3751 字符完全一致

## 结论

- 检查项：**32/32 通过**
- 静态资源：index.html + app.css + app.js
- 端点覆盖：只读 7 / 生成 6 / 提示词 4 / 校验配对设置 5 / 健壮性 3

无遗留问题。
