# Ciro Client · Moonlight UI

CIRO / NCPA 的独立 AI 聊天客户端。设计：**绿色新月 Logo + 深绿月夜玻璃风格**；布局参照经用户审核的左侧聊天历史、顶部模型选择、居中聊天区、底部输入框和双栏设置中心。

> **当前状态：UI V0.2，Draft PR。** 界面、背景 DIY 和本地对话可用；CIRO 正式推理服务尚未接入。不配置后端时是明确的预览模式，不生成虚假的模型回答。

## 功能清单

- 🌙 Ciro 绿色月亮 + 星芒 SVG 品牌 Logo、浏览器图标、统一主界面样式
- 🏞️ 五套离线背景：青绿月夜、北境极光、远山晨雾、城市夜色、纯色极简
- 🎨 **背景 DIY**：上传 JPG/PNG/WebP/AVIF（最大 8 MB）、亮度/模糊/暗色遮罩滑块、背景应用范围（欢迎页或全客户端）、恢复默认、自定义背景删除
- 🗂️ 双栏设置中心：通用、外观与背景、模型、对话、文件与存储、快捷键、隐私与安全、关于
- 💬 发送/停止生成/重新生成、Markdown/GFM、复制回答、历史搜索/新建/重命名/删除/导出
- 🧠 模型列表只由实际服务端配置提供，**不得把占位项当真实已接入模型**
- 📁 文本或代码附件，每次最多 3 个，每个不超过 80 KB（作为消息内容发送，不是真正文件服务器）
- 🔒 默认本地监听；服务器代理保管密钥；聊天记录 localStorage、背景图片 IndexedDB；支持深浅色主题、发送快捷键、字号/密度、时间显示

## 快速开始

要求 Node.js 20.19+ 或 22.12+。

```bash
npm install
cp .env.example .env
npm run dev:all
```

Windows PowerShell 可以用 `Copy-Item .env.example .env`，然后打开 http://127.0.0.1:5173 。

**未配置真实推理服务时**，客户端会明确提示「界面预览模式」。首次使用默认开启深色月夜和青绿色夜景；在「设置 → 外观与背景」修改后会自动保存。

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
  cinematic.css             # 深绿月夜主题
  settings.css              # 设置中心布局与样式
server/
  index.mjs                 # Node 代理
  validate.mjs              # 请求约束
public/backgrounds/         # 5 个本地 SVG 壁纸
```
