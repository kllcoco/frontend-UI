# Ciro Client

CIRO / NCPA 的 AI 对话客户端：网页、Windows / macOS / Linux 桌面端与 Android 端。

> **v0.9.1**：全新界面与个人菜单、项目、思考深度滑杆、⌘K 搜索、图片/PDF 附件、公式与代码高亮、分享链接、提示词库，以及桌面（自动更新）与 Android 安装包。下载见 [Releases](https://github.com/kllcoco/frontend-UI/releases/latest)，更新说明见 [docs/RELEASE_NOTES.md](docs/RELEASE_NOTES.md)。

## 安装与运行

| 方式 | 说明 |
| --- | --- |
| 桌面客户端 | 从 Releases 下载对应平台安装包；首次运行后在“文件 → 编辑模型连接配置 (.env)”填写 `CIRO_API_BASE_URL` 等并重启 |
| Android | 安装 `Ciro-*-android.apk`；“设置 → 模型设置 → 连接 Ciro 服务器”填写服务器地址 |
| Docker | `docker run -d --name ciro -p 8787:8787 --env-file .env -v ciro-data:/data ghcr.io/kllcoco/ciro-client:latest`（详见 [服务器部署教程](docs/INSTALL_SERVER.md)） |
| npm | `npm i -g @kllcoco/ciro-client` → `ciro-client init` → `ciro-client`（需先配置 GitHub Packages 令牌，详见 [服务器部署教程](docs/INSTALL_SERVER.md)） |
| 源码开发 | `npm install && cp .env.example .env && npm run dev:all`，打开 http://127.0.0.1:5173 |

常用脚本：`npm test`（单元）· `npm run test:e2e`（浏览器）· `npm run desktop`（本地运行桌面版）· `npm run dist:linux|dist:win|dist:mac`（打包）· `npx cap sync android && cd android && ./gradlew assembleRelease`（Android）。

推送 `v*` 标签会触发 `.github/workflows/release.yml`：运行全部测试，构建三大桌面平台安装包与 Android APK，发布 Release，并推送 Docker 镜像与 npm 包。Android 正式签名可通过仓库 Secrets 提供：`CIRO_ANDROID_KEYSTORE_BASE64`、`CIRO_ANDROID_KEYSTORE_PASSWORD`、`CIRO_ANDROID_KEY_ALIAS`、`CIRO_ANDROID_KEY_PASSWORD`（未提供时使用调试签名）。

### 安装包签名

发布工作流会在检测到对应 Secrets 时自动签名，未配置时照常构建未签名版本：

| 平台 | 需要的仓库 Secrets | 获取方式 |
| --- | --- | --- |
| Android | `CIRO_ANDROID_KEYSTORE_BASE64`、`CIRO_ANDROID_KEYSTORE_PASSWORD`、`CIRO_ANDROID_KEY_ALIAS`、`CIRO_ANDROID_KEY_PASSWORD` | 自建 keystore（`keytool -genkeypair ...`），务必离线备份 |
| Windows | `WIN_CSC_LINK`（.pfx 的 base64）、`WIN_CSC_KEY_PASSWORD` | 向 CA 购买代码签名证书（OV/EV）；开源项目可申请 SignPath Foundation 免费签名 |
| macOS | `MAC_CSC_LINK`（Developer ID Application .p12 的 base64）、`MAC_CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` | Apple Developer Program（99 美元/年）；配置后自动签名并公证 |

### 思考深度

输入框中的“思考深度”五档会以 OpenAI 兼容的 `reasoning_effort`（low / medium / high）发送；服务端 `CIRO_REASONING_EFFORT=off` 可关闭透传。若原生 CIRO 模型声明 `CIRO_CHAT_REASONING_MODES=deep`，还会附带时间预算与优先级。流式返回中的 `reasoning_content` 会显示为可折叠的“思考过程”。

---

## 历史版本说明

## 功能清单

- 🌙 Ciro 绿色月亮 + 星芒 SVG 品牌 Logo、浏览器图标、统一主界面样式
- 🏞️ **默认纯白背景**，另附五套离线场景：青绿月夜、北境极光、远山晨雾、城市夜色、纯色极简
- 🎨 **背景 DIY**：上传 JPG/PNG/WebP/AVIF（最大 8 MB）、亮度/模糊/暗色遮罩滑块、背景应用范围（欢迎页或全客户端）、恢复默认、自定义背景删除
- 🗂️ 双栏设置中心：通用、外观与背景、模型、对话、文件与存储、快捷键、隐私与安全、关于
- 💬 发送/停止生成/重新生成、Markdown/GFM、复制回答、历史搜索/新建/重命名/删除/导出
- 🧠 模型列表只由实际服务端配置提供，**不得把占位项当真实已接入模型**
- 📁 文本或代码附件，每次最多 3 个，每个不超过 80 KB（作为消息内容发送，不是真正文件服务器）
- 🔒 默认本地监听；服务器代理保管密钥；聊天记录 localStorage、背景图片 IndexedDB；支持深浅色主题、**简体中文/English 即时切换（默认中文）**、发送快捷键、字号/密度、时间显示

## 快速开始

要求 Node.js 20.19+ 或 22.12+。

```bash
npm install
cp .env.example .env
npm run dev:all
```

Windows PowerShell 可以用 `Copy-Item .env.example .env`，然后打开 http://127.0.0.1:5173 。

**未配置真实推理服务时**，客户端会明确提示「界面预览模式」。首次使用默认展示**纯白背景和简体中文**。在「设置 → 通用设置 → 界面语言」选择 **简体中文 / English**，全界面立即切换，刷新后仍然保留；在「设置 → 外观与背景」切换月夜壁纸或 DIY 上传图。先前已保存的个性化选择会继续保留，用户也可恢复默认外观。

## 接入 CIRO 模型

服务端根目录 `.env`：

```dotenv
CIRO_API_BASE_URL=http://127.0.0.1:8000/v1
CIRO_API_PATH=/chat/completions
CIRO_MODEL=ciro
CIRO_MODELS=ciro
CIRO_API_KEY=
```

重启开发服务。Node 代理目前兼容 **OpenAI Chat Completions SSE / JSON** 响应。这里没有证明 CIRO 原生推理 ABI 符合该接口，如果不兼容，请在 `server/index.mjs` 添加已验证适配层；不得假装连通或编造模型。

浏览器通过 `/api/status` 获取可选模型和配置状态；`/api/chat` 经 Node 代理到后端。不应把 CIRO_API_KEY 设置成 `VITE_` 变量。

## 验证与生产构建

```bash
npm test
npm run build
npm run test:e2e
npm start
```

访问 http://127.0.0.1:8787 ，默认只监听本机。请实际用浏览器验证：主界面、侧栏、八个设置分类、换背景后刷新恢复、图片超限拒绝、夜间/日间模式、移动端、聊天的预览模式；配置真实后端后再验流式输出及中断。

## 数据和安全边界

- **DIY 背景不会上传到 CIRO 模型服务**：图片 Blob 存在当前浏览器 IndexedDB；切换/清除只操作本设备。
- 对话历史在 localStorage，可导出 JSON；清除站点数据会永久失去本地记录，没有多设备同步/自动备份。
- 聊天内容在点击发送后会被发送到**你实际配置**的后端。不要将浏览器本地存储误解为端到端加密或后端不留痕。
- 没有用户鉴权、HTTPS、限流、用量计费或正式文件存储。**禁止将此开发网关直接向公网开放。**
- 此独立前端仓库**不修改 NCPA 的 R01–R87 验收逻辑**，也不代表模型本体已经正式毕业。

## 目录

```
src/
  App.tsx                   # 欢迎页 / 聊天页 / 会话与推理流
  SettingsCenter.tsx        # 八页设置中心
  components/CiroMark.tsx   # 绿色新月
  lib/appearance.ts         # 背景偏好 + IndexedDB 自定义图片
  lib/preferences.ts        # 聊天显示及键盘偏好
  lib/api.ts                # SSE 客户端
  lib/storage.ts            # 本地对话
  styles.css                # 旧版布局基础
  cinematic.css             # 可选深绿月夜主题
  white.css                 # 默认白色主题与语言切换控件
  settings.css              # 设置中心布局与样式
server/
  index.mjs                 # Node 代理
  validate.mjs              # 请求约束
public/backgrounds/         # 6 个本地 SVG 壁纸（含纯白）
```

## 纯白主题与中英文验收（2026-10-11）

- 默认未保存偏好时：`lang=zh-CN`、`data-theme=light`，主工作区实际像素背景为白色；选择壁纸前不叠加夜景
- 设置中心支持“简体中文 / English”，切换时聊天界面与八类设置同步更新，刷新保持所选语言
- 纯白默认不取消深色主题、自定义上传背景或背景效果调节；已保存的旧偏好仍受尊重
- 通过 `npm test` **7/7**、`npm run build` 和 Playwright `npm run test:e2e` **8/8**
- [浏览器测试与截图结果](https://github.com/kllcoco/frontend-UI/actions/runs/38118999697)（包含中英文页面与移动端截图）

## 中 / English 语言切换

默认简体中文，默认白色主题；右上角 **EN / 中** 可快速切换语言，或进入「通用设置 → 界面语言」。界面文字即时改变，语言选择保存在当前浏览器，刷新后保持。用户聊天内容与真实模型回答不会被自动翻译。背景 DIY 与深色模式仍可选择。


## CIRO Workbench V0.4：目标、计划、协作空间

入口：侧栏「协作空间」，聊天输入框提供「普通对话 / 目标模式 / 计划模式」，还支持 /goal、/plan、/work、/agent、/github、/schedule、/plugins、/permissions、/help 斜杠指令。

### 已有能力与边界

- **持久任务**：真实服务端状态保存到 .ciro-runtime/state.json，不提交仓库。任务按 Planner、Builder/Integrator、独立 Tester、独立 Red Team、Auditor 阶段递进，提供任务列表、代理指派、事件日志与 SHA256 摘要。测试/红队失败最多三轮自动修复及重验；最后没有三类证据则状态为 needs_evidence，绝不报完成。
- **计划模式**：只调用规划阶段，形成计划，不直接改动仓库。用户确认/授权后可从工作台恢复计划并执行。
- **权限**：请求批准 / 自动审批 / 有边界的完全访问 / 自定义。选择新的 GitHub 仓库会把权限自动重置回请求批准；不允许 host.exec、读取服务器机密、生产部署、强推或删除仓库。这是工作区和 GitHub API 的授权门，**不等于操作系统级沙箱**。
- **GitHub**：目前是服务端凭据+仓库白名单接入，不是完整 GitHub OAuth UI。配置 CIRO_GITHUB_TOKEN 和 CIRO_GITHUB_REPOS=owner/repo（逗号分隔）后，用户在设置界面选择仓库并验证；允许在后端真实读取文件。写入还需 CIRO_GITHUB_WRITES=true，并只能提交到 ciro/、feature/、repair/ 开头的工作分支；其他权限模式决定是否需要逐项审批。
- **审批**：审批项及其不可变参数存在本地，用户批准才会实际使用服务器凭据写入 GitHub，拒绝则不执行。
- **插件**：支持启用/禁用 GitHub、定时器和 CIRO Agent 原生执行器三个内置适配器。暂无第三方任意 MCP 插件安装/隔离，界面不能冒充安装成功。
- **定时**：服务器运行时按时区执行每小时/每日/每周任务，每个时间槽只触发一次，受权限门和实际执行器配置限制。机器关闭时不会运行任务；重启不补跑错过的任务。
- **额外安全约束**：默认只监听本机，跨站 Origin 检查，GitHub 令牌永不下发浏览器，文件路径和分支做严格约束；没有账号体系或生产多租户隔离，不能公网开放。

### 连接原生 CIRO Agent Runtime

前端仓库尚未包含 CIRO/NCPA 原生多代理 Runtime、受保护沙盒和权威红队接口，因此无法仅凭本仓库完成项目。通过服务端环境变量对接：

    CIRO_AGENT_RUNNER_URL=https://agent-runtime.example
    CIRO_AGENT_RUNNER_TOKEN=(server-side secret)
    CIRO_VERIFIER_URL=https://independent-verifier.example
    CIRO_VERIFIER_TOKEN=(server-side secret)

两个受控适配器必须提供带 Bearer 身份验证的 POST /workbench/step。请求包含 jobId、goal、mode、phase、repo、plan、attempt、policy、context。阶段按 plan、implement、repair、test、redteam、audit 变化。plan 返回至多 20 个已分配 role、title、acceptance 的子任务；implement 为每个子任务指定 role 执行。验收响应必须包含布尔 ok、文字 summary，以及具有 type、SHA256 digest（64 位小写十六进制）和 location 的 evidence 数组。test、redteam、audit 由另一个独立配置的 verifier 实际产生可审计结果；没有证据就停在 needs_evidence。

注意：**这一桥协议是前端约定，不是已经验证兼容的 CIRO 原生 ABI。** 原生 Runner 还必须在真实工具执行边界严格实施权限门、独立执行空间、凭证最小化、终止/取消，以及权威收据复验。将 Model 的 ok:true 当作已验收是禁止的。正式 0→1 商用前仍需账户登录、授权、单/多租户分离、稳定任务队列、计费预算和强制沙盒。


### 自定义指令（Custom instructions）

设置 → 自定义指令中可以填写「关于你」和「希望 Ciro 如何回答」，最长分别 2000 字。默认关闭，用户开启后随普通聊天请求发送到配置的 CIRO API，由服务端验证大小后作为用户主动设置的个人偏好传递；不开启时只存储在当前浏览器。自定义指令不会作为沙盒、插件或 GitHub 操作的授权凭据，也不会覆盖服务端权限政策。此功能不是持久模型记忆或多设备同步。


## CIRO V0.5：账单、官方应用和技能

入口：侧栏 / 协作空间 / 设置里的「账单与用量」「官方应用」「技能中心」，支持 /billing、/apps、/skills 快捷指令。新功能均保留中文默认、英文切换、白色主题和背景 DIY。

### 账单与用量

- 只能记录 CIRO Runtime 通过 HMAC-SHA256 签名的实际计量收据；浏览器不允许创建计费事件，未连接时展示「暂无真实用量」而非虚假已支付账单。
- POST /api/workbench/commercial/billing/ingest：服务端配置 CIRO_BILLING_EVENT_SECRET（至少 24 UTF-8 字节）；请求头 x-ciro-timestamp（Unix 毫秒）、x-ciro-signature（十六进制 SHA256 HMAC）；签名内容为时间戳 + 英文点号 + 原始 JSON 字节。拒绝超过五分钟的时间戳，按 eventId 去重，并对同 ID 冲突拒绝。
- 收据字段：eventId、unit（CWU/GWU）、units（整数）、category（chat/agent/tool/training）、model、observedAt（ISO8601）与 receiptSha256（64 字符），其他敏感输入不入账本。签名表明来自受信持钥服务，**不等于测量证据已经独立验真**。
- 配置 CIRO_BILLING_CWU_USD_PER_MILLION / CIRO_BILLING_GWU_USD_PER_MILLION 后才根据每条收据快照费率估算费用；未配置定价的用量被标成「未计价」，不能当零费用。用户曾提出的 3 美元每百万 CWU/GWU 只是可选价格配置，未作正式生效费率。
- 展示当前 UTC 月使用量、分类、费率、明细摘要、CSV 导出、月度预算与百分比预警。设有月度预算时，代理任务开始前进行准入检查；不能计价或计量未接入时 fail-closed。
- **不具备交易级硬上限**：运行中的请求可能在阈值到达后继续产生费用。预算为「暂停新任务」门禁而非财务实时余额控制。容量达到 20,000 条则拒绝新记录，不静默丢弃，需要外接可持久化账本。
- **尚未接入**支付机构、充值、订阅、发票结算、跨设备账单或退款；界面明确提示不可用，绝不虚构发票。
- 本地默认监听 127.0.0.1。公网发布前还需要用户登录、租户隔离、强 CSRF/RBAC、计量独立复算和金融结算审计。

### Ciro 官方应用中心

内置白名单为 Chat、Workbench、GitHub、Scheduler、Skills 和待接线的 Research、Files、Code。支持中英目录、分类搜索、收藏、取消收藏、快捷打开已开发界面；用户的收藏保存到本地服务端，下次刷新保留。目录中「已配置」只表示存在服务器设置，不代表已验证完整实际可用性。没有外部 App Store 下载或执行不可信代码。

### Ciro 技能中心

内置静态 manifest 目录包括 Repository Review、Test Design、Adversarial Review、Architecture Planning、Cost Analysis、Documentation、Research Workflow。支持搜索、筛选、启停、版本查看及权限需求。启用后的技能标识 id/version/scope 通过 Agent Runner 的桥协议传递，**必须先接入原生运行时**；没有 CIRO 原生执行器时只保存用户选择，不会虚构执行结果。技能本身不能提升 GitHub、沙盒及系统权限。不安装未经审查的任意第三方 skill 文件。

### 独立验收

现阶段验收范围是前端展示、本地状态、签名校验、预算准入、价格计算、浏览器交互。不能把这些自动测试等同于真实商业付款、原生技能运行、CIRO 真实模型能力或 POST_GEN1_PROJECT_WORKSPACE_MODE_V1 的 W0-W10 权威验收。继续保留 Draft PR，不合入 main，不动 NCPA 主线。


## CIRO V0.6 — Accounts, subscriptions, keys, spending, notifications, memory and sync

New Chinese/English client pages: Account & security, Subscription, API keys, Spending limits, Notifications, Memory, Device sync. All UI actions use server routes rather than fictional local success values.

### Enable authentication

Set CIRO_ACCOUNTS_ENABLED=true in a private .env file on the running server. Provide unique high-entropy CIRO_BOOTSTRAP_TOKEN (24+ bytes), CIRO_API_KEY_PEPPER (24+ bytes) and a stable CIRO_ACCOUNT_DATA_KEY (32 random bytes encoded using Base64). Do not put secrets into ChatGPT or a Git repository. Using Account & security, the operator creates the single owner account with the bootstrap token. The bootstrap cannot register another account after initialization.

Passwords use salted scrypt hashes. HttpOnly SameSite=Lax sessions expire in 30 days; write requests require a CSRF token and trusted Origin; API keys have separate scoped access and can be revoked immediately. A password change invalidates all API keys and other sessions. The original client continues local-only by default until accounts are enabled. The local JSON store is SINGLE OWNER / SINGLE PROCESS ONLY; a public multi-tenant commercial service requires transactional storage, proper tenant isolation, backups, external secrets and key rotation.

### API contracts implemented

GET /api/account/session: live account readiness, logged-in user status and CSRF token for first-party session.
POST /api/account/bootstrap, /login, /logout, /password; GET/POST /profile; POST /sessions/revoke: account lifecycle and security.
GET/POST /api/account/api-keys and POST /api/account/api-keys/:id/revoke: one-time visible random secret; only HMAC digest stored. Allowed scopes are chat:invoke, sync:read and sync:write. API keys cannot manage accounts or payment settings.
GET /api/account/notifications; POST /notifications/:id/read and /notifications/read-all: durable notifications created by real server events, currently refreshed while the app is open.
GET/POST /api/account/memories, POST /memories/preferences, DELETE /memories/:id: explicit, encrypted AES-256-GCM memories. Enabled memories are passed to the future chat inference service as UNTRUSTED user background, not as tool authorization or weight training.
GET /api/account/sync; PUT /api/account/sync: AES-GCM encrypted snapshots with version compare-and-swap and HTTP 409 on conflicts. Manual upload/recovery and opt-in automatic synchronization are wired to the actual shared server. The client batches local changes and checks server changes; conflicts stop overwriting until resolved. Custom wallpaper binary assets remain device-local.
GET/POST /api/workbench/commercial/billing/spending: live daily/monthly/per-run limits.
POST /billing/reservations and POST /billing/reservations/:id/release: HMAC-signed metering service authorization and release. Real usage ingestion can settle a reservation. Budget admission fails closed when complete CWU/GWU rates or trusted metering are missing. This needs an actual runtime to reserve BEFORE consuming compute: the GUI alone cannot enforce a financial hard-stop against work already running.

### Real Stripe integration

Configure CIRO_STRIPE_SECRET_KEY, CIRO_STRIPE_PRICE_ID, CIRO_STRIPE_WEBHOOK_SECRET and HTTPS CIRO_PUBLIC_ORIGIN. The hosted Checkout URL comes from a real request to Stripe's checkout session API. The subscription portal comes from Stripe's portal session API. POST /api/account/subscription/webhook uses exact raw body, Stripe-Signature time and HMAC verification and duplicate-id protection, and binds events to the owner/customer. Redirecting back from payment is NOT proof of payment. Subscription state changes only after trusted Stripe webhook events; an unconfigured provider returns a real 503.

### Security and delivery limits

CIRO_ACCOUNT_DATA_KEY must be backed up and remain stable; losing it makes encrypted memories/snapshots undecryptable. Never expose HTTP on a public interface: deploy only behind a well-configured HTTPS reverse proxy with account and rate-limit protections. The local first-party store has no multi-tenant data model, no horizontal consistency and no job queue; do not use it as a public SaaS billing ledger.

The Stripe network integration is a real production API contract but cannot be end-to-end charged without the operator's own Stripe account and keys. Likewise CIRO model/agent verification requires the actual NCPA native Runtime and independent verifier. The PR remains DRAFT and does not modify NCPA GEN1.


## Ciro V0.7 — Chat + Unified Studio + Workbench

Studio now includes ten integrated domains: conversation with explicit fast/deep reasoning, native-ready persistent thinking jobs, IDE scratch projects (real file edits / CAS / SHA256 snapshots and restore), local full-text knowledge with reproducible citations, research adapter, presigned image/audio/video analysis, signed compute telemetry plus CWU/GWU, chat folders/branches/checkpoints, an Ed25519 signed app/skill registry (selection only), and a browser PWA shell ready for device installation. Workbench remains the single controlled autonomous multi-agent execution space.

Local functions work without CIRO inference. Remote/native functions have real, fail-closed HTTP adapter contracts; configuring a URL does not prove the CIRO runtime or independent verifier has passed acceptance. No fake tokens, GPU utilization, Stripe charges, third-party skill execution or autonomous coding are shown. See the separate native adapter contract for activation, security, schemas, and staged acceptance.
