# CIRO Studio: 原生模型与多端适配器契约 V1

状态：独立客户端/控制层候选，不是 NCPA/GEN1 权威毕业。未经真实执行器和独立红队复核，UI 页面通过不能宣称 CIRO 自主代理已完成项目。

## 总体结构

Conversation（聊天） + Studio（多功能入口） + Workbench（唯一有权限的代理调度） + Native Runtime（模型/隔离代码执行/硬件） + Billing/Identity（签名计量/支付）。前端不能访问模型密钥、GitHub Token、上传签名私钥或宿主机 Shell。

后端真实接口统一前缀：/api/studio 。所有内置适配器固定 HTTPS 目标，只有 loopback 可使用 HTTP。后台请求携带 Authorization Bearer Token，不接受用户动态传入服务端 URL，不跟随重定向，JSON 650 KB 和 15-20 秒超时上限。状态 configured_unverified 仅说明配置已填，不能当成健康或验收证据。

## 01 Chat 推理模式

POST /api/chat 的可选 reasoning 字段形如：
{ "mode":"deep", "maxSeconds":300, "priority":2 }。

只有配置 CIRO_CHAT_REASONING_MODES=deep 的时候，服务器才会把 ciro_reasoning 对象转发给真实模型的 /chat/completions。它是 CIRO 扩展协议，不是 OpenAI 标准字段；原生模型必须明确支持，未知/非法预算返回 400。默认 fast 维持原有 OpenAI-compatible SSE 协议。

持续思考（可跨前端连接）：
- POST /api/studio/think/jobs 请求 { objective, maxSeconds:30..3600, priority:1|2|5 }。
- 固定向 CIRO_REASONING_URL/v1/reasoning/jobs 发送 { contract:"ciro-reasoning.v1", objective, maxSeconds, priority, allowUnboundedSpending:false, requireEvidence:true }。
- 上游响应 {jobId,status}；GET /api/studio/think/jobs/:id 转发 GET /v1/reasoning/jobs/:id，读取真实 summary/evidence。
- 真正可恢复的暂停/取消/预算硬中断还需 CIRO 原生持久任务队列验收，本客户端不伪造。

## 02 IDE

真实本地草稿 API：POST /projects {name}; GET /projects 和 /projects/:id；
PUT /projects/:id/file {path, content, baseRevision}，使用 workspace-relative 安全路径与 Revision CAS。409 不覆盖较新文件。
POST /projects/:id/checkpoints {label} 冻结文件与 SHA256；POST /projects/:id/restore {checkpointId,baseRevision} 恢复。
文件树、编辑、两版对比、检查点现在可运行；不会运行宿主机代码。

POST /projects/:id/run 只接 task=test|build|lint；需 Workbench policy 已允许 task.run，并配置 CIRO_IDE_RUNNER_URL/TOKEN。
真实执行器固定 POST /v1/ide/jobs，载荷：contract="ciro-ide-run.v1",task,projectId,projectRevision,scope={repo,permission:"task.run"}, files=[{path,content,sha256}]。成功响应 jobId 代表提交，不是通过；GET /v1/ide/jobs/:id 读取日志/实际证据。隔离运行/红队/复算 JUnit/撤销必须交给 Native Runner + 独立 Verifier。

## 03 Knowledge

POST /knowledge/import {title,text,source}；GET /knowledge、GET /knowledge/:id、GET /knowledge/search?q=...、DELETE /knowledge/:id。真实文本内容及 SHA256 保存到单机 studio-state.json，全文关键词搜索带 knowledge:<doc-id>:L<line> 和摘录；限 120 文档，单份最多 60K 字符/125 KB。PDF/OCR、海量语料、Embeddings 与可检索权限图需 CIRO_KNOWLEDGE_INDEX_URL/TOKEN 的原生适配器后续独立接线，不能把上传文本称为 RAG。

## 04 Research

POST /research {query,depth:"quick"|"deep"} 发到 CIRO_RESEARCH_SERVICE_URL/v1/research/jobs：
{ contract:"ciro-research.v1", query, depth, maxSources:6|12, evidenceRequired:true,mode:"user_initiated" }。
必须返回 jobId。GET /research/:id 读 status/summary/sources，仅展示 http(s) URL 和来源；没有来源时标记未验证，不生成假引用。

## 05 Media

浏览器文件选择和 MediaRecorder 录音为真实本机能力，支持 image PNG/JPEG/WebP、音频 WAV/MP3/WebM/MP4 和视频 MP4/WebM（上限 150MB）。
POST /media/jobs {filename,mime,bytes,kind} 到 CIRO_MEDIA_SERVICE_URL/v1/media/jobs 换取 jobId、uploadUrl、uploadHeaders。uploadUrl 必须是 HTTPS 且 origin 在 CIRO_MEDIA_UPLOAD_ORIGINS 白名单里，服务端剔除危险头。
浏览器直接 PUT 媒体到签名对象 URL，成功后 POST /media/jobs/:id/complete，再 GET /media/jobs/:id 获取模型分析或转录；无服务时根本不上传。实时双向语音/WebRTC/TTS 还需原生媒体服务器。

## 06 Compute

GET /compute 显示已记录的可信遥测；没有数据就显示空，禁止 mock CPU/GPU。
POST /compute/ingest 用签名的 Native Runtime 上报：
{eventId,observedAt,source:"training|inference|agent|system",metrics:{gpuPct,gpuMemoryMb,cpuPct,latencyMs,...}}。
签名统一：x-ciro-timestamp=Unix 毫秒字符串，x-ciro-signature=hex HMAC-SHA256(CIRO_BILLING_EVENT_SECRET, timestamp + "." + exactRawJSONBytes)。
时间窗口 24h，签名允许 5 分钟误差，同 ID 重复去重、冲突拒绝。GPU 数值来源于 Runtime，不是用机型估算。CWU/GWU 价格以现有签名计费收据为准，不冒充硬停止算力。

## 07 History

Conversation 可保存 folder、parentId、checkpoints[]，支持本地标题/内容搜索、分支、归档、恢复。同步服务 validateSnapshot 对这些字段和快照消息重新验证，再走 AES-GCM + compare-and-swap；冲突 HTTP 409 而非覆盖新对话。

## 08 Signed Marketplace

官方应用/技能目录仍由 V0.5 管理。外部清单必须从 CIRO_MARKETPLACE_URL/v1/marketplace/catalog 通过服务端 Token 拉取。
Ed25519 detached signature 的签名内容是按顺序 JSON.stringify({id,kind,version,sha256,permissions}) 得到的 UTF8 字节，签名 Base64；用 CIRO_MARKETPLACE_PUBLIC_KEY 验证。仅符合格式+验签通过才列出。
POST /marketplace/select {id,enabled:boolean} 只保存 manifest 选择，始终返回 executable:false。真实代码下载、内容哈希核验、沙盒执行/版本锁、撤销需 Native Skill Runtime，绝不能因 UI 选择就拥有主机权限。

## 09 Devices

浏览器 PWA：/manifest.webmanifest、/sw.js、绿色月亮图标，生产构建安装。只缓存公开 Shell 与静态资源，不缓存 /api、用户私有对话、密钥或非 GET。需要用户在浏览器主动安装。
Windows/macOS/Linux 和 Android/iOS 的真正原生二进制当前未打包，仍需桌面/手机工具链、签名、深链接、设备权限、消息推送和真机验收。不能把 PWA 冒充原生 App。

## 10 Workbench

现有 Workbench 已实现 Goals/Plan、批准策略、真实 GitHub 限权、代理任务状态机、Runner/Verifier Bridge、证据和红队槽位。仍必须等 NCPA 的原生 runner + 独立 verifier 接通并按主仓 W0-W10 完成正式验收；不会因为客户端全绿就宣布模型项目 CLOSED。

## 硬验收顺序

S1 控制层：Node 负例、TS build、桌面/手机真实浏览器、CRUD/CAS、签名篡改。
S2 模型层：真实 SSE、fast/deep 与预算行为、断流/撤销。
S3 自主代理：隔离 worktree、真实代码执行、GitHub 写入、逐项/依赖簇/全仓独立红队。
S4 研究和多模态：可复核来源、媒体实际上传与模型输出、无网络时拒绝。
S5 计量和安全：硬件签名、CWU/GWU 核对、运行中取消/实际硬断算力。
S6 市场和设备：签名包沙盒、真实安装二进制、双设备加密恢复。
S7 商业部署：Stripe 真实测试商户、事务型多租户存储、TLS、日志与备份独立审计。

S1 即使完全通过，也不能写 S2-S7 PASSED。


### V1.1 可用扩展：语义索引与任务控制

- 文档主动建索引：POST /api/studio/knowledge/:id/index，body {confirmExternalUpload:true}。明确征得用户同意后，服务器把 {contract:"ciro-knowledge-index.v1",documentId,title,source,sha256,content} 发给 CIRO_KNOWLEDGE_INDEX_URL/v1/knowledge/documents，要求上游 accepted=true、同一 SHA256 和 indexId。
- POST /api/studio/knowledge/semantic {query} 向 /v1/knowledge/search 发送仅包含已索引文档 indexId、SHA256 和 query 的 corpus；上游返回 matches:[{documentId,line,score}]，客户端服务器只接受存在的本地文档及合法行数，并**重新从本地全文生成摘录和引用行号**。上游伪造的 excerpt 字段被丢弃。
- 持久推理可 POST /api/studio/think/jobs/:id/actions {action:"pause"|"resume"|"cancel"}；接线为 Native POST /v1/reasoning/jobs/:id/actions，只有返回有效 status 才更新页面。取消中算力硬停止、预算释放与回滚仍需原生 Runtime 实证。
- IDE/推理/研究/媒体创建原生作业之前复用工作台配置的月度预算准入门；未接原生计算实时熔断前这仍不是硬性零超支保证。


### Native shell 进阶接线（不冒充已打包）

页面通过 window.ciroNativeBridge.handshake({contract:"ciro-native-shell.v1",origin,nonce}) 侦测未来 Tauri/Capacitor 原生容器，要求回显同一 origin/nonce 并声明平台、版本与允许通知/深链的最小能力。不会暴露任意 host shell、文件系统或密钥。真实通知仅在用户点击后调用受控 notify({title,body})。当前握手仅能表明桥接存在，不能证明原生端已做可信签名/attestation；真正 Windows/macOS/Android/iOS 仍须平台构建和来源隔离审计。前端将状态明确标为未独立验证。
