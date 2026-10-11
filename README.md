# Ciro Client

面向 **CIRO / NCPA** 的独立对话客户端。视觉和交互参考现代 AI 聊天产品，品牌和代码均为 Ciro 自有实现；与 NCPA 主仓库完全分离。

## 功能

- ChatGPT 式响应式界面：侧栏、新对话、历史搜索、重命名、删除、对话导出
- 流式消息显示、Markdown / 代码块、复制回答、停止生成、重新生成
- 浅色 / 深色主题，桌面和移动端布局
- 本地对话保存（浏览器 localStorage），无配置时明确显示 **预览模式**，不伪造模型回答
- 轻量 Node 代理：兼容 OpenAI Chat Completions 风格的 SSE 流，无需在前端暴露模型密钥
- 本地文本附件（.txt/.md/.json/.csv/源码等），内容随用户消息发送；不包含图片识别或在线文件存储

## 快速启动

要求 Node.js 20.19+ 或 22.12+。

\`\`\`bash
npm install
cp .env.example .env
npm run dev:all
\`\`\`

打开 http://127.0.0.1:5173 。没有 CIRO 后端时进入预览模式，页面和本地历史可用，**不会生成真实 AI 回答**。

连接兼容 Chat Completions 的推理服务时，在根目录 .env 中填写：

\`\`\`dotenv
CIRO_API_BASE_URL=http://127.0.0.1:8000/v1
CIRO_API_PATH=/chat/completions
CIRO_MODEL=ciro
CIRO_MODELS=ciro
CIRO_API_KEY=
\`\`\`

然后重启 \`npm run dev:all\`。CIRO 原生推理 API 的正式消息格式目前未在此仓库确认；如果与 OpenAI-compatible Chat Completions 不同，只需适配 \`server/index.mjs\`，不要在 UI 中硬编码虚构的能力或端点。

## 构建与运行

\`\`\`bash
npm run test
npm run build
npm start
\`\`\`

默认 http://127.0.0.1:8787 。生产构建会由同一 Node 进程托管静态资源和 API 代理，避免浏览器跨域及密钥暴露。

## 安全边界

- **默认只监听本机**。此 MVP 没有账号系统、用户鉴权、配额和限流，切勿直接将它作为公网可访问的付费模型网关。
- 公网部署前，必须先在反向代理/网关增加登录、访问控制、HTTPS、限流与计费保护。
- \`.env\` 和 API Key 仅在服务端使用。不要使用 Vite 的 \`VITE_\` 变量保存密钥。
- 本地聊天记录保存在当前浏览器设备中；清空站点数据会删除记录。目前没有多设备同步。
- 当前版本不是 CIRO 训练完成、推理服务上线或正式模型能力认证的证据。

## 代码结构

- \`src/App.tsx\`：会话 UI、历史及用户交互
- \`src/lib/api.ts\`：SSE 客户端解析
- \`src/lib/storage.ts\`：本地会话持久化
- \`src/styles.css\`：响应式 UI
- \`server/index.mjs\`：安全配置层与推理 API 代理
- \`server/validate.mjs\`：请求约束
- \`tests/\`：协议校验单测

正式接入完成前，建议在此项目自己的分支内迭代，不触碰 NCPA 的 R01–R87 验收主线。
