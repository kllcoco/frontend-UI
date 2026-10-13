@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion
title Ciro 一键服务器
rem Ciro 一键服务器（懒人版）· Windows 10 / 11
rem 双击运行：自动识别 x64 / ARM64，准备好 Node.js 和最新版 Ciro 服务器，把这台电脑变成服务器。
rem 本机和同一局域网的手机 / 电脑都能打开。数据和设置保存在 %USERPROFILE%\Ciro-Server。
set "REPO=kllcoco/frontend-UI"
set "NODE_VERSION=22.22.0"
if not defined CIRO_SERVER_DIR set "CIRO_SERVER_DIR=%USERPROFILE%\Ciro-Server"
set "HOME_DIR=%CIRO_SERVER_DIR%"
set "APP=%HOME_DIR%\app"
if not exist "%HOME_DIR%" mkdir "%HOME_DIR%"
cd /d "%HOME_DIR%"

where curl >nul 2>nul || (echo 需要 Windows 10 1803 或更新版本（缺少 curl）& goto :fail)
set "ARCH=x64"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "ARCH=arm64"
if /i "%PROCESSOR_ARCHITEW6432%"=="ARM64" set "ARCH=arm64"
echo ==^> 设备：Windows-%ARCH%

rem 1. Node.js 22.5+（系统已有就直接用，否则下载一份只给 Ciro 用的）
set "NODE="
where node >nul 2>nul && node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)" >nul 2>nul && set "NODE=node"
if not defined NODE if exist "%HOME_DIR%\node\node.exe" set "NODE=%HOME_DIR%\node\node.exe"
if not defined NODE (
  set "NAME=node-v%NODE_VERSION%-win-%ARCH%"
  echo ==^> 下载 Node.js %NODE_VERSION%…
  if exist "%HOME_DIR%\node" rmdir /s /q "%HOME_DIR%\node"
  curl -fL --retry 2 "https://nodejs.org/dist/v%NODE_VERSION%/!NAME!.zip" -o node.zip || curl -fL --retry 2 "https://npmmirror.com/mirrors/node/v%NODE_VERSION%/!NAME!.zip" -o node.zip || (echo 下载 Node.js 失败，请检查网络 & goto :fail)
  tar -xf node.zip || (echo 解压 Node.js 失败 & goto :fail)
  del /q node.zip
  move "!NAME!" node >nul
  set "NODE=%HOME_DIR%\node\node.exe"
)

rem 2. 最新版 Ciro 服务器（有新版本时自动更新；离线时用已有的）
set "LATEST="
for /f "usebackq delims=" %%L in (`curl -fsS -o nul -w "%%{redirect_url}" "https://github.com/%REPO%/releases/latest" 2^>nul`) do set "LATEST=%%~nxL"
set "HAVE="
if exist "%APP%\.release" set /p HAVE=<"%APP%\.release"
set "NEED="
if not exist "%APP%\bin\quickstart.mjs" set "NEED=1"
if defined LATEST if /i not "!LATEST!"=="!HAVE!" set "NEED=1"
if defined NEED (
  if not defined LATEST (echo 连不上 GitHub，无法下载 Ciro 服务器 & goto :fail)
  echo ==^> 下载 Ciro 服务器 !LATEST!…
  curl -fL --retry 2 "https://github.com/%REPO%/releases/download/!LATEST!/Server-Ciro-portable.zip" -o ciro.zip || (echo 下载 Ciro 服务器失败 & goto :fail)
  if exist app.new rmdir /s /q app.new
  mkdir app.new
  tar -xf ciro.zip -C app.new || (echo 解压失败 & goto :fail)
  del /q ciro.zip
  if exist "%APP%" rmdir /s /q "%APP%"
  move app.new\Ciro-Server "%APP%" >nul
  rmdir /s /q app.new
  >"%APP%\.release" echo !LATEST!
)

rem 3. 启动（设置 .env 和数据 data\ 都在 Ciro-Server 文件夹，更新不会覆盖）
echo ==^> 启动 Ciro 服务器…
"%NODE%" "%APP%\bin\quickstart.mjs" --dir "%HOME_DIR%" %*
echo.
echo Ciro 服务器已停止。
pause
exit /b 0

:fail
echo.
echo 启动失败。
pause
exit /b 1
