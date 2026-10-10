---
name: Bug 报告
about: 引擎、界面、数据或桌面版出问题了
title: '[Bug] '
labels: bug
---

## 环境

- 运行形态：命令行 / 浏览器界面 / 桌面版 exe（哪个都行就都写上）
- 系统：Windows 11 / macOS 14 / Ubuntu 24.04 …
- Node 版本（命令行或界面形态）：`node -v` 的输出
- 项目版本：`node bin/ciallo.js stats` 第一行的版本号
- 是否加载了内容包：`node bin/ciallo.js pack status` 的输出

## 复现步骤

1.
2.
3.

## 期望结果

## 实际结果

## 报错与输出

```
把完整报错贴在这里（界面上的话按 F12 看 Console，或菜单「文件 → 开发者工具」）
```

## 自检结果

```
node scripts/verify.js 的输出摘要
node --test test/engine.test.js test/cli.test.js test/web.test.js 的输出摘要
```

## 补充

- [ ] 我确认已看过 README 的「已知限制」一节
- [ ] 这个 bug 在基础版数据下也能复现（`node bin/ciallo.js pack off` 后再试一次）
