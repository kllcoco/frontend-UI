#!/usr/bin/env bash
# Ciro 一键服务器（懒人版）· macOS / Linux
# 双击（macOS 用 .command）或在终端运行：bash Server-oneclick-Linux.sh
# 自动识别系统和芯片，准备好 Node.js 和最新版 Ciro 服务器，然后把这台设备变成服务器：
# 本机和同一局域网的手机 / 电脑都能打开。数据和设置保存在 ~/Ciro-Server。
set -euo pipefail
REPO="kllcoco/frontend-UI"
NODE_VERSION="22.22.0"
HOME_DIR="${CIRO_SERVER_DIR:-$HOME/Ciro-Server}"
APP="$HOME_DIR/app"
say() { printf '\033[1;33m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m启动失败：\033[0m%s\n' "$*" >&2; printf '按回车关闭…'; read -r _ </dev/tty 2>/dev/null || true; exit 1; }
command -v curl >/dev/null 2>&1 || die "需要 curl（Linux：sudo apt install curl）"
mkdir -p "$HOME_DIR"
cd "$HOME_DIR"

case "$(uname -s)" in Darwin) OS=darwin ;; Linux) OS=linux ;; *) die "不支持的系统：$(uname -s)" ;; esac
case "$(uname -m)" in x86_64|amd64) ARCH=x64 ;; arm64|aarch64) ARCH=arm64 ;; armv7l) ARCH=armv7l ;; *) die "不支持的芯片：$(uname -m)" ;; esac
say "设备：$OS-$ARCH"

# 1. Node.js 22.5+（系统已有就直接用，否则下载一份只给 Ciro 用的）
NODE=""
if command -v node >/dev/null 2>&1 && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)' 2>/dev/null; then
  NODE="$(command -v node)"
elif [ -x "$HOME_DIR/node/bin/node" ]; then
  NODE="$HOME_DIR/node/bin/node"
else
  NAME="node-v$NODE_VERSION-$OS-$ARCH"
  say "下载 Node.js $NODE_VERSION…"
  rm -rf "$HOME_DIR/node" "$HOME_DIR/$NAME"
  curl -fL --retry 2 "https://nodejs.org/dist/v$NODE_VERSION/$NAME.tar.gz" -o node.tar.gz \
    || curl -fL --retry 2 "https://npmmirror.com/mirrors/node/v$NODE_VERSION/$NAME.tar.gz" -o node.tar.gz \
    || die "下载 Node.js 失败，请检查网络"
  tar -xzf node.tar.gz && rm -f node.tar.gz && mv "$NAME" node
  NODE="$HOME_DIR/node/bin/node"
fi

# 2. 最新版 Ciro 服务器（有新版本时自动更新；离线时用已有的）
LATEST="$(curl -fsSI "https://github.com/$REPO/releases/latest" 2>/dev/null | tr -d '\r' | sed -n 's#^[Ll]ocation: .*/releases/tag/\(v[^ ]*\)$#\1#p' | tail -1 || true)"
HAVE="$(cat "$APP/.release" 2>/dev/null || true)"
if [ ! -f "$APP/bin/quickstart.mjs" ] || { [ -n "$LATEST" ] && [ "$LATEST" != "$HAVE" ]; }; then
  [ -n "$LATEST" ] || die "连不上 GitHub，无法下载 Ciro 服务器"
  say "下载 Ciro 服务器 $LATEST…"
  curl -fL --retry 2 "https://github.com/$REPO/releases/download/$LATEST/Server-Ciro-portable.zip" -o ciro.zip || die "下载 Ciro 服务器失败"
  rm -rf app.new && mkdir app.new
  if command -v unzip >/dev/null 2>&1; then unzip -q ciro.zip -d app.new; else "$NODE" -e 'require("child_process").execFileSync("tar",["-xf","ciro.zip","-C","app.new"])' || die "需要 unzip（sudo apt install unzip）"; fi
  rm -f ciro.zip && rm -rf "$APP" && mv app.new/Ciro-Server "$APP" && rm -rf app.new
  echo "$LATEST" > "$APP/.release"
fi

# 3. 启动（设置 .env 和数据 data/ 都在 ~/Ciro-Server，更新不会覆盖）
say "启动 Ciro 服务器…"
exec "$NODE" "$APP/bin/quickstart.mjs" --dir "$HOME_DIR" "$@"
