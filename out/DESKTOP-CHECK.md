# 夜织 · 桌面版验证

- 时间：2026-10-10T08:15:13.029Z
- 打包目录：<project>\dist

## 1. 打包产物

- ✅ dist/win-unpacked 存在 — 18 个条目
- ✅ resources/app.asar 存在且体积合理 — 0.6 MB
- ✅ asar 里含我们的代码与数据（不依赖项目目录） — electron/main.js + data/*.json + web/ 都在
- ✅ 找到主程序 exe — 夜织CialloForge.exe · 234.9 MB
- ✅ 安装/便携包存在（Setup.*\.exe$） — CialloForge-Setup-1.0.0.exe · 106.7 MB
- ✅ 安装/便携包存在（Portable.*\.exe$） — CialloForge-Portable-1.0.0.exe · 106.4 MB

## 2. 启动打包后的程序

- ✅ 打包后的 exe 能启动并自检通过 — Electron 44.7.0 / Chromium 152.0.7977.130
- ✅ 窗口加载的是本地服务地址 — http://127.0.0.1:64481/
- ✅ 界面渲染出 16 张角色卡 — 16 张 · 7 个页签
- ✅ 顶栏显示「桌面版」且状态为已连接 — 已连接 · v1.0.0 · 桌面版
- ✅ 数据目录指向用户目录（不是只读的程序目录） — %USERPROFILE%\AppData\Local\Temp\ciallo-desktop-test-1791620113126
- ✅ 首次运行已释放内置数据 — 5 个 JSON（seed 模式 seeded）
- ✅ 窗口图标已加载 — assets/icon.ico
- ✅ 产物目录可写 — %USERPROFILE%\AppData\Local\Temp\out

## 3. 桌面版与 CLI 一致性

- ✅ 桌面版服务仍是同一套引擎（同一 seed 输出一致） — 3306 字符，两次一致

## 结论

- 检查项：**15/15 通过**

桌面版可用：双击 exe 即开窗口，数据落在用户目录，界面与命令行共用同一引擎。
