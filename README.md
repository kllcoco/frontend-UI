# Ciro Client · White-first UI

CIRO / NCPA 的独立 AI 聊天客户端。设计：**绿色新月 Logo + 默认纯白界面，深绿月夜等背景可由用户选择**；布局参照经用户审核的左侧聊天历史、顶部模型选择、居中聊天区、底部输入框和双栏设置中心。

> **当前状态：UI V0.3，Draft PR。** 界面、背景 DIY 和本地对话可用；CIRO 正式推理服务尚未接入。不配置后端时是明确的预览模式，不生成虚假的模型回答。

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
