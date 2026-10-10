@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 夜织 CialloForge · 界面

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [!] 没找到 Node.js。装一个 Node 18 以上版本后重试。
  echo       下载地址: https://nodejs.org
  echo.
  pause
  exit /b 1
)

echo.
echo   正在启动 夜织 CialloForge 界面...
echo   （独立窗口打开；关闭该窗口即停止服务）
echo.

node bin\gui.js

if errorlevel 1 (
  echo.
  echo   [!] 启动失败。可以试试命令行排查：node bin\gui.js --no-open
  echo       然后浏览器访问它打印出来的地址。
  echo.
  pause
)
