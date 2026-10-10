@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"
title 夜织 CialloForge · 下载分块拼接

echo.
echo   ================================================================
echo      把 Release 下载的分块文件拼回完整 exe
echo   ================================================================
echo.
echo   用法：把下载到的那一堆 .partNNofNN 文件和本脚本放在同一个文件夹里，
echo         然后双击本脚本。它会自动识别是哪两个程序并拼好、校验 SHA256。
echo.
echo   文件夹：%CD%
echo.

set "SETUP_SHA=f6753089823e8a483808c343b1af675fc110b26dc2ea3e352d2e0801339c7f4f"
set "PORT_SHA=550db7dbdb0793cd50eda852bf1f31d88e0b9b213b007243cbeb3ade0a298b0d"

set "found=0"

for %%B in ("CialloForge-Setup-1.0.0" "CialloForge-Portable-1.0.0") do (
  set "base=%%~B"
  set "first="
  set "n=0"
  for %%F in ("!base!.part*of*") do (
    set "n=1"
    if not defined first set "first=%%F"
  )
  if defined n (
    if not "!n!"=="0" (
      set "found=1"
      echo   ----------------------------------------------------------------
      echo   发现分块：!base!
      set "list="
      for /f "delims=" %%F in ('dir /b /on "!base!.part*of*"') do set "list=!list!+%%F"
      set "list=!list:~1!"
      echo   合并 !base!.exe ...
      cmd /c copy /b "!list!" "!base!.exe" >nul
      if exist "!base!.exe" (
        for /f "skip=1 tokens=*" %%H in ('certutil -hashfile "!base!.exe" SHA256') do (
          if not defined hash set "hash=%%H"
        )
        set "hash=!hash: =!"
        echo   合并完成：!base!.exe
        echo   SHA256: !hash!
        if /i "%%~B"=="CialloForge-Setup-1.0.0" (
          if /i "!hash!"=="%SETUP_SHA%" (echo   校验：✔ 与发布值一致) else (echo   校验：✘ 不一致，建议重新下载)
        ) else (
          if /i "!hash!"=="%PORT_SHA%" (echo   校验：✔ 与发布值一致) else (echo   校验：✘ 不一致，建议重新下载)
        )
      ) else (
        echo   合并失败：没找到分块文件
      )
      set "hash="
    )
  )
)

if "%found%"=="0" (
  echo   [!] 当前文件夹里没有找到 .partNNofNN 分块文件。
  echo       请把所有分块和本脚本放在同一个文件夹后再运行。
)

echo.
echo   ----------------------------------------------------------------
echo   提示：完整文件也可以用 PowerShell 一步校验
echo     Get-FileHash .\CialloForge-Setup-1.0.0.exe -Algorithm SHA256
echo.
pause
endlocal
