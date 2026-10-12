# 服务器部署教程（ciro-client）

`ciro-client` 是 Ciro 的网页版 + 后端服务（模型代理、账户、分享、语音/图片接口）。部署到服务器后，用浏览器、Android 客户端或 iPhone“添加到主屏幕”访问。
有两种安装方式，**任选其一**：

| | Docker 镜像 | npm 包 |
| --- | --- | --- |
| 名称 | `ghcr.io/kllcoco/ciro-client` | `@kllcoco/ciro-client` |
| 适合 | Linux 服务器、NAS（推荐） | 已装 Node.js 的电脑/服务器，不想用 Docker |
| 数据位置 | Docker 卷 `ciro-data` | 运行目录下的 `.ciro-runtime/` |
| 升级 | 拉新镜像、重建容器 | `npm i -g` 覆盖安装 |

> 只想自己在电脑上用？直接下载上方的桌面客户端即可，它已内置同一套服务，无需本教程。

---

## 准备：模型配置

两种方式都使用同一份配置文件 `.env`，最少填三项：

```ini
# OpenAI 兼容接口地址（到 /v1 为止）
CIRO_API_BASE_URL=https://api.example.com/v1
# 默认模型
CIRO_MODEL=gpt-4o
# 模型服务的密钥（只保存在服务器，不会发给浏览器）
CIRO_API_KEY=sk-...
```

常用可选项：

```ini
# 模型下拉列表
CIRO_MODELS=gpt-4o,gpt-4o-mini
# 联网搜索开关（模型服务需支持）
CIRO_WEB_SEARCH=on
# 语音对话（语音识别 + 朗读）
CIRO_VOICE=on
# 图片生成（模型服务需支持 /images/generations）
CIRO_IMAGES=on
# 团队服务地址（有团队后端时再填）
CIRO_TEAM_URL=
```

完整说明见安装包内的 `.env.example`。

> ⚠️ **安全提醒**：未开启账户时，任何能访问这个网址的人都能用你的模型密钥。公网部署请务必按下文“开启账户 + HTTPS”操作；只在家里/公司内网使用可以不开。

---

## 方式一：Docker（推荐）

### 1. 安装 Docker

```bash
curl -fsSL https://get.docker.com | sh
```

### 2. 登录 GitHub 镜像仓库（仅当拉取提示 `denied` / `unauthorized` 时需要）

到 GitHub → Settings → Developer settings → Personal access tokens (classic) 新建令牌，只勾选 `read:packages`，然后：

```bash
echo 你的令牌 | docker login ghcr.io -u 你的GitHub用户名 --password-stdin
```

### 3. 写配置

```bash
mkdir -p ~/ciro && cd ~/ciro
nano .env        # 填入上面“准备”中的内容，保存（注释请单独占一行，不要写在值后面）
```

### 4. 启动

**内网 / 自己使用（不开账户）：**

```bash
docker run -d --name ciro --restart unless-stopped \
  -p 8787:8787 --env-file ~/ciro/.env \
  -v ciro-data:/data \
  ghcr.io/kllcoco/ciro-client:latest
```

浏览器打开 `http://服务器IP:8787`。

**公网（开启账户 + HTTPS）：** 账户模式要求服务只监听本机，由反向代理提供 HTTPS。在 `.env` 追加：

```ini
CIRO_ACCOUNTS_ENABLED=true
CIRO_PUBLIC_ORIGIN=https://ciro.你的域名.com
# 填 openssl rand -base64 32 的结果（首次创建管理员用）
CIRO_BOOTSTRAP_TOKEN=
# 填 openssl rand -base64 32 的结果
CIRO_API_KEY_PEPPER=
# 填 openssl rand -base64 32 的结果；之后永远不要改，否则已加密数据无法读取
CIRO_ACCOUNT_DATA_KEY=
```

```bash
docker run -d --name ciro --restart unless-stopped \
  --network host -e HOST=127.0.0.1 --env-file ~/ciro/.env \
  -v ciro-data:/data \
  ghcr.io/kllcoco/ciro-client:latest
```

再装 Caddy 自动申请 HTTPS 证书（域名需先解析到服务器）：

```bash
sudo apt install -y caddy
echo 'ciro.你的域名.com {
  reverse_proxy 127.0.0.1:8787
}' | sudo tee /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

打开 `https://ciro.你的域名.com`，用 `CIRO_BOOTSTRAP_TOKEN` 创建管理员账户。

### 5. 常用命令

```bash
docker logs -f ciro        # 查看日志
docker restart ciro        # 改了 .env 之后重启生效
docker stop ciro           # 停止
```

### 6. 升级（覆盖旧版，数据保留）

```bash
docker pull ghcr.io/kllcoco/ciro-client:latest
docker rm -f ciro
# 再执行一次第 4 步中你用过的 docker run 命令
docker image prune -f      # 可选：清理旧镜像
```

数据都在 `ciro-data` 卷里，删除容器不会丢失。想固定某个版本，把 `latest` 换成版本号，例如 `ghcr.io/kllcoco/ciro-client:0.9.2`。

---

## 方式二：npm 包

### 1. 安装 Node.js 22.5 或更高版本

```bash
# Linux / macOS（使用 nvm）
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc && nvm install 22
node -v     # 确认 ≥ v22.5
```

Windows 到 https://nodejs.org 下载 22 LTS 安装包。

### 2. 配置 GitHub Packages（只需一次）

GitHub Packages 安装任何包都需要令牌：GitHub → Settings → Developer settings → Personal access tokens (classic)，只勾选 `read:packages`，然后：

```bash
npm config set @kllcoco:registry https://npm.pkg.github.com
npm config set //npm.pkg.github.com/:_authToken 你的令牌
```

### 3. 安装

```bash
npm install -g @kllcoco/ciro-client
ciro-client --version
```

### 4. 初始化并启动

```bash
mkdir -p ~/ciro && cd ~/ciro
ciro-client init      # 生成 .env 模板（已存在则不会覆盖）
nano .env             # 填入“准备”中的内容
ciro-client           # 启动，默认 http://127.0.0.1:8787
```

常用参数：

```bash
ciro-client --host 0.0.0.0 --port 8787   # 允许局域网访问（未开账户时请勿暴露到公网）
ciro-client --env /path/to/.env          # 指定配置文件
ciro-client --data /path/to/data         # 指定数据目录（默认 ./.ciro-runtime）
```

公网部署：按方式一第 4 步在 `.env` 中开启账户，保持默认 `127.0.0.1` 监听，并用同样的 Caddy 配置提供 HTTPS。

### 5. 开机自启（Linux，可选）

```bash
sudo tee /etc/systemd/system/ciro.service >/dev/null <<EOF
[Unit]
Description=Ciro
After=network.target
[Service]
WorkingDirectory=$HOME/ciro
ExecStart=$(which node) $(npm root -g)/@kllcoco/ciro-client/bin/ciro-client.mjs
Restart=always
User=$USER
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now ciro
journalctl -u ciro -f      # 查看日志
```

### 6. 升级（覆盖旧版，数据保留）

```bash
npm install -g @kllcoco/ciro-client@latest
sudo systemctl restart ciro      # 用了开机自启时；否则重新运行 ciro-client
```

`.env` 和 `.ciro-runtime/` 都在你自己的 `~/ciro` 目录里，覆盖安装不会影响它们。

---

## 连接客户端

- **浏览器**：直接打开部署地址。
- **Android**：安装 `Ciro-*-android.apk` → 设置 → 模型设置 → 连接 Ciro 服务器，填 `https://ciro.你的域名.com`。
- **iPhone / iPad**：用 Safari 打开部署地址 → 分享 → 添加到主屏幕。

## 常见问题

- **页面提示“尚未连接真实 CIRO 推理服务”**：`.env` 中 `CIRO_API_BASE_URL` 为空或没有生效。Docker 需要 `docker restart ciro`，npm 需要在 `.env` 所在目录运行，或使用 `--env` 指定。
- **启动报 “Authenticated Ciro must bind to loopback”**：开启账户后必须监听 `127.0.0.1`。Docker 请使用 `--network host -e HOST=127.0.0.1`。
- **端口被占用**：Docker 改成 `-p 9000:8787`，npm 用 `--port 9000`。
- **检查服务是否正常**：`curl http://127.0.0.1:8787/api/status`
