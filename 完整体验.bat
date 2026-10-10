@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 夜织 · 完整体验（内容包已加载）

rem ─────────────────────────────────────────────────────────────
rem  作用：把数据目录指到用户目录，并加载 content-pack/，拿到 heat 4-5 档内容。
rem  为什么要这样绕：仓库本体只带基础版（heat 1-3），
rem  而「合并内容包」会写数据文件 —— 如果写进项目里的 data/，
rem  露骨词库就会被 git 跟踪。所以这里改用用户数据目录。
rem ─────────────────────────────────────────────────────────────

set "CIALLO_DATA_DIR=%APPDATA%\ciallo-forge\data"
set "CIALLO_PACK_DIR=%~dp0content-pack"

if not exist "%CIALLO_PACK_DIR%\pack.json" (
  echo.
  echo   [!] 没找到内容包：%CIALLO_PACK_DIR%\pack.json
  echo       先生成一份：node scripts\export-content-pack.js
  echo       不加载内容包也能用，只是最大尺度停在 heat 3。
  echo.
)

echo.
echo   数据目录：%CIALLO_DATA_DIR%
echo   内容包  ：%CIALLO_PACK_DIR%
echo.
echo   [1] 打开界面（浏览器窗口）
echo   [2] 打开桌面版（Electron）
echo   [3] 生成一篇正文
echo   [4] 内容包状态
echo   [0] 退出
echo.
set "opt="
set /p "opt= 请选择: "
if "%opt%"=="0" exit /b 0
if "%opt%"=="1" node bin\gui.js
if "%opt%"=="2" node "node_modules\electron\cli.js" .
if "%opt%"=="3" (
  set "SC="
  set /p "SC= 场景编号 [回车=S09]: "
  if "!SC!"=="" set "SC=S09"
  node bin\ciallo.js story --scene !SC! --heat 5 --words 1800 --out out\完整体验.md
)
if "%opt%"=="4" node bin\ciallo.js pack status
echo.
pause
