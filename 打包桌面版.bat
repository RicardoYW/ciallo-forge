@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 夜织 CialloForge · 打包桌面版

echo.
echo   ================================================================
echo      打包 夜织 CialloForge 桌面版（Windows exe）
echo   ================================================================
echo.
echo      [1]  快速打包（--dir，只出免安装目录，约 30 秒）
echo      [2]  完整打包（安装包 + 便携版，约 2-5 分钟，各约 106 MB）
echo      [3]  只出便携版 exe（单文件，双击即用）
echo      [4]  验证已打包的程序（跑桌面版自检）
echo      [5]  重新生成图标（需 Python + Pillow）
echo      [0]  退出
echo.

set "opt="
set /p "opt=     请选择: "

if "%opt%"=="0" exit /b 0
if "%opt%"=="1" goto packfast
if "%opt%"=="2" goto packfull
if "%opt%"=="3" goto packportable
if "%opt%"=="4" goto verify
if "%opt%"=="5" goto icon
goto end

:prep
rem Electron 打包时继承这个变量会退化成纯 Node 模式，必须清掉
set "ELECTRON_RUN_AS_NODE="
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
where node >nul 2>nul || (echo   [!] 没找到 Node.js & pause & exit /b 1)
if not exist "node_modules\electron-builder" (
  echo   [!] 还没装打包依赖。先执行：
  echo       node "D:\node_modules\npm\bin\npm-cli.js" install --registry=https://registry.npmmirror.com
  pause
  exit /b 1
)
exit /b 0

:packfast
call :prep
echo.
echo   打包中（快速模式）...
node "node_modules\electron-builder\cli.js" --dir
echo.
echo   产物：dist\win-unpacked\夜织CialloForge.exe
goto done

:packfull
call :prep
echo.
echo   打包中（安装包 + 便携版）...
node "node_modules\electron-builder\cli.js" --win --x64
echo.
echo   产物：dist\CialloForge-Setup-1.0.0.exe（安装包）
echo         dist\CialloForge-Portable-1.0.0.exe（便携版）
goto done

:packportable
call :prep
echo.
echo   打包中（只出便携版）...
node "node_modules\electron-builder\cli.js" --win portable --x64
echo.
echo   产物：dist\CialloForge-Portable-1.0.0.exe
goto done

:verify
set "ELECTRON_RUN_AS_NODE="
node scripts\check-desktop.js
goto done

:icon
python scripts\make-icon.py
goto done

:done
echo.
echo   ----------------------------------------------------------------
pause
goto end

:end
