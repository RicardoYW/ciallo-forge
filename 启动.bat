@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 夜织 CialloForge

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [!] 没找到 Node.js。装一个 Node 18 以上的版本，然后重新双击本文件。
  echo       下载地址: https://nodejs.org
  echo.
  pause
  exit /b 1
)

:menu
cls
echo.
echo   ================================================================
echo      夜织 CialloForge  ·  成人虚构 + 绘图提示词双引擎
echo      全员成年锁 18+  ·  本地离线  ·  零依赖
echo   ================================================================
echo.
echo      [U]  >>> 打开界面（图形界面，推荐）<<<
echo.
echo      [1]  看数据规模          (stats)
echo      [2]  看角色卡            (16 张成年卡)
echo      [3]  看场景库            (16 场景 / 148 beats)
echo      [4]  校验年龄锁          (三道闸 + 门禁演练)
echo.
echo      [5]  生成一篇正文        (命令行交互版)
echo      [6]  编译绘图提示词      (命令行交互版)
echo      [7]  导出全套            (16 卡 + 1536 提示词 + 16 篇样例)
echo      [8]  跑测试              (45 项)
echo      [9]  跑全量自检          (23 项体检, 写出报告)
echo      [C]  跑界面自检          (32 项端点体检)
echo.
echo      [G]  打开成果画廊        (16 篇样章, 浏览器直接看)
echo      [H]  打开说明书          (使用指南 / 报告, 浏览器读)
echo      [O]  打开成果文件夹      (out)
echo      [D]  打开项目文件夹
echo      [R]  看说明书            (Markdown 原文)
echo      [0]  退出
echo.

set "opt="
set /p "opt=     请选择: "
if /i "%opt%"=="u" goto gui
if "%opt%"=="1" goto stats
if "%opt%"=="2" goto chars
if "%opt%"=="3" goto scenes
if "%opt%"=="4" goto validate
if "%opt%"=="5" goto story
if "%opt%"=="6" goto prompt
if "%opt%"=="7" goto exportall
if "%opt%"=="8" goto tests
if "%opt%"=="9" goto verify
if /i "%opt%"=="c" goto uicheck
if /i "%opt%"=="g" goto gallery
if /i "%opt%"=="h" goto handbook
if /i "%opt%"=="o" goto openout
if /i "%opt%"=="d" goto opendir
if /i "%opt%"=="r" goto docs
if "%opt%"=="0" exit /b 0
goto menu

:stats
cls
node bin\ciallo.js stats
goto done

:chars
cls
node bin\ciallo.js chars --verbose
goto done

:scenes
cls
node bin\ciallo.js scenes --verbose
goto done

:validate
cls
node bin\ciallo.js validate --gate
goto done

:exportall
cls
node bin\ciallo.js export --out out\export
goto done

:tests
cls
node --test test\engine.test.js test\cli.test.js
goto done

:verify
cls
node scripts\verify.js
goto done

:story
cls
echo.
echo   ---- 生成正文 ----
echo.
echo   场景:  S01 夜班查房之后   S02 落地窗前的契约   S03 终点线之后
echo          S04 松节油与台灯   S05 镜子是给我看的   S06 学姐的规矩
echo          S07 闭馆之后       S08 草莓糖的协议     S09 雨夜引擎
echo          S10 古籍修复室的午后  S11 走廊尽头的声控灯  S12 毕业画室的最后一夜
echo          S13 冬夜的暖炉与毛毯  S14 深夜便利店遇见  S15 器材室的三十七度
echo          S16 跨年夜的最后一支舞
echo.
set "s="
set /p "s=   场景编号 [回车=S05]: "
if "%s%"=="" set "s=S05"
echo.
set "c="
set /p "c=   卡司编号, 逗号分隔 [回车=按场景自动配]: "
echo.
echo   热度 1-5:  1 克制 / 2 暧昧 / 3 缠绵 / 4 直白 / 5 露骨
set "h="
set /p "h=   热度 [回车=4]: "
if "%h%"=="" set "h=4"
echo.
set "w="
set /p "w=   目标字数 [回车=1500]: "
if "%w%"=="" set "w=1500"
echo.
echo   节奏: slow 慢燃 / balanced 均速 / fast 快进 / pwp 直入
set "p="
set /p "p=   节奏 [回车=slow]: "
if "%p%"=="" set "p=slow"
echo.
if "%c%"=="" (
  node bin\ciallo.js story --scene %s% --heat %h% --words %w% --pacing %p% --out out\%s%-demo.md
) else (
  node bin\ciallo.js story --scene %s% --cast %c% --heat %h% --words %w% --pacing %p% --out out\%s%-demo.md
)
echo.
echo   如果成功, 正文在上面那个 out 文件夹里。
goto done

:prompt
cls
echo.
echo   ---- 编译绘图提示词 ----
echo.
echo   角色: C01 苏晚  C02 沈芷  C03 林小满  C04 白棠  C05 黎漾
echo         C06 姜雪  C07 阿沅  C08 夏栖  C09 罗砚  C10 顾清欢
echo         也可以输 all 表示全部
echo.
set "ch="
set /p "ch=   角色编号 [回车=C01]: "
if "%ch%"=="" set "ch=C01"
echo.
echo   格式: sdxl / pony / novelai / midjourney / comfyui / generic / all
set "t="
set /p "t=   目标格式 [回车=all]: "
if "%t%"=="" set "t=all"
echo.
set "ph="
set /p "ph=   热度 1-5 [回车=4]: "
if "%ph%"=="" set "ph=4"
echo.
node bin\ciallo.js prompt --char %ch% --target %t% --heat %ph% --out out\prompts-%ch%.json
echo.
echo   提示词包已写到 out 文件夹 (json + md 两份)。
goto done

:gallery
cls
if not exist "out\showcase.html" (
  echo   首次打开, 正在生成画廊...
  node scripts\build-gallery.js
)
start "" "out\showcase.html"
goto menu

:handbook
cls
if not exist "out\指南.html" (
  echo   首次打开, 正在生成说明书...
  node scripts\build-docs-html.js
)
start "" "out\指南.html"
goto menu

:openout
start "" "out"
goto menu

:gui
cls
echo.
echo   正在启动图形界面...
echo.
node bin\gui.js
goto menu

:uicheck
cls
node scripts\check-ui.js
goto done

:opendir
start "" "."
goto menu

:docs
start "" "使用指南.md"
start "" "README.md"
goto menu

:done
echo.
echo   ----------------------------------------------------------------
pause
goto menu
