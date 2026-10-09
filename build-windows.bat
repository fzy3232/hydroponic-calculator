@echo off
rem ============================================================
rem  水培营养液配方计算器 - Windows 一键构建
rem  自检 Rust / Node.js / WebView2，然后构建并收集产物
rem ============================================================
setlocal EnableDelayedExpansion
chcp 936 >nul
title 水培营养液配方计算器 - 构建

cd /d "%~dp0"

echo ==================================================
echo   水培营养液配方计算器 - Windows 一键构建
echo ==================================================
echo.

rem ---------- 1/4 Node.js ----------
where node >nul 2>nul
if errorlevel 1 (
    echo [1/4] 未检测到 Node.js ^(需要 18+^)
    echo       请从 https://nodejs.org 安装 LTS 版本后重试
    goto :env_fail
)
for /f "delims=" %%v in ('node -v') do echo [1/4] Node.js: %%v

rem ---------- 2/4 Rust ----------
where cargo >nul 2>nul
if errorlevel 1 (
    echo [2/4] 未检测到 Rust
    echo       请从 https://rustup.rs 安装后重试
    goto :env_fail
)
for /f "delims=" %%v in ('cargo --version') do echo [2/4] Rust: %%v

rem ---------- 3/4 WebView2 运行时 ----------
set "HAS_WV2=0"
reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" /v pv >nul 2>nul && set "HAS_WV2=1"
if "!HAS_WV2!"=="0" reg query "HKLM\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" /v pv >nul 2>nul && set "HAS_WV2=1"
if "!HAS_WV2!"=="0" reg query "HKCU\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" /v pv >nul 2>nul && set "HAS_WV2=1"
if "!HAS_WV2!"=="1" (
    echo [3/4] WebView2 运行时: 已安装
) else (
    echo [3/4] 未检测到 WebView2 运行时 - 目标机可能无法启动
    echo       Windows 11 通常自带；Win10 可装:
    echo       https://go.microsoft.com/fwlink/p/?LinkId=2124703
)

echo [4/4] 安装前端依赖...
call npm install --no-audit --no-fund
if errorlevel 1 goto :build_fail

echo.
echo ==================================================
echo   开始构建 ^(首次约 10 分钟^)
echo ==================================================
echo.

call npm run tauri:build
if errorlevel 1 goto :build_fail

echo.
echo ==================================================
echo   构建成功，正在收集产物
echo ==================================================

copy /y "src-tauri\target\release\hydroponic-calculator.exe" "%~dp0水培营养液配方计算器-便携版.exe" >nul 2>nul
if exist "%~dp0水培营养液配方计算器-便携版.exe" echo   便携版: %~dp0水培营养液配方计算器-便携版.exe

for %%f in ("src-tauri\target\release\bundle\nsis\*.exe") do if exist "%%f" (
    copy /y "%%f" "%~dp0%%~nxf" >nul
    echo   NSIS 安装包: %~dp0%%~nxf
)
for %%f in ("src-tauri\target\release\bundle\msi\*.msi") do if exist "%%f" (
    copy /y "%%f" "%~dp0%%~nxf" >nul
    echo   MSI 安装包: %~dp0%%~nxf
)

echo.
echo 项目目录: %~dp0
echo.
start "" explorer "%~dp0"
pause
exit /b 0

:env_fail
echo.
echo [失败] 环境不满足，请按上面的指引安装后重试。
echo.
pause
exit /b 1

:build_fail
echo.
echo [失败] 构建未完成，请查看上方错误信息。
echo.
pause
exit /b 1