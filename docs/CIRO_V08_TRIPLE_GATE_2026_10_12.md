# CIRO v0.8: 三关收尾验收状态（2026-10-12）

**当前决定：NOT GRADUATED。** 本文件是当前候选 PR #5 的验收进度，而不是对 NCPA 模型基础科研毕业的结论。

## 当前真实执行

| 门禁 | 状态 | 证据范围 |
|---|---|---|
| 1. 完整 Node 测试、TypeScript/Vite、Playwright | **NOT RUN** | 私有仓库完整检出与构建依赖在当前 Linux 容器不可用（无法解析 GitHub/npm 域名） |
| 2. Windows NSIS EXE、安装、启动、卸载 | **NOT RUN** | 当前仅 Linux 容器，无 Windows 图形主机；已有正式可执行的本机脚本，**尚未在 Windows 执行** |
| 3. CIRO 内真实 GitHub PAT、模型流式推理与自修复 PR | **NOT RUN** | 已有只读真实联调探针，未获得 CIRO 本机服务/登录会话/原生 NCPA 端点；写/草稿 PR 还必须人工批准 |

### 已通过的局部证据

- **20/20 scoped offline Node tests PASS**：原有 16 项桌面/权限/预检测试，加上 4 项真实联调探针的 *mock transport contract* 测试。详见 `docs/CIRO_V08_DESKTOP_CORE_LOCAL_RECEIPT_2026-10-12.json`（该收据只代表先前 16 项），新增四项直接对应 `tests/verify-ciro-desktop-live.test.mjs`。这不是 `npm test` 全仓结果。
- 真实 CIRO 联调探针文件 `scripts/verify-ciro-desktop-live.mjs` 的 Git blob 为 `5ea5261bd24b8073ce42d4491b4128dc8690c340`，测试文件 `tests/verify-ciro-desktop-live.test.mjs` 为 `d94d15591e4febdc19475dd4565d361df78a2f09`；本地重放与这些 blob 一致。
- GitHub PR #5 保持 Draft；不会自动合并，没有为本轮主动派发 GitHub Actions 或使用收费云构建。

## Windows 上的零付费收尾入口

对**已具备本地依赖**的信任工作树（先确保仓库工作区无修改），使用 Windows PowerShell：

```powershell
npm run accept:desktop-windows
```

上述命令只在本机依次运行 `npm test`、`npm run build`、`npm run test:e2e`、`npm run desktop:win`，若任何一关失败立即停止；产生成功的 Setup.exe 后记录 SHA256 与签名状态。绝不启动 GitHub-hosted Windows runner。若缺少依赖，脚本明确中止，不能将其计为 PASS。

在**全新独立 Windows 测试账户/虚拟机**中，允许实机安装测试才执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/accept-ciro-windows.ps1 -InstallInDisposableSession
```

脚本会拒绝覆盖已有 Ciro 用户数据或安装，检查首次启动密钥文件、实际窗口、正常退出、卸载和用户数据保留。**该脚本还没有在 Windows 实机运行过，输出的假定通过结果一律不能算证据。** 这些环境要求不是购买付费资源的授权。

## 内部账号与 NCPA 联调

只在所有凭据都**保存在本人本机的环境变量**时运行：`npm run verify:desktop-live`。需要 `CIRO_ACCEPTANCE_BASE_URL`（本机 127.0.0.1 的 CIRO API 地址）、`CIRO_ACCEPTANCE_EMAIL`、`CIRO_ACCEPTANCE_PASSWORD` 和 `CIRO_ACCEPTANCE_REPO`。禁止把这些凭据或 GitHub PAT 贴在聊天、日志或 GitHub。

真实探针完成 CIRO 单所有者登录，验证 GitHub 插件真实安装/连接/仓库作用域，从 CIRO 后端实际读取 `README.md` 并核验 SHA，再调用 CIRO 已配置的聊天接口核对 SSE 结束符。**探针不会自动写仓库或批准 PR**。

重要区分：

1. CIRO GitHub 的 **PASS_LIVE_READ** 只证明真实授权后的只读路径，不代表修改/PR 端到端已经通过。
2. 模型 **PASS_HTTP_STREAM** 只证明代理和服务通信，不代表后端确实是 NCPA 原生模型。后者仍须精确运行时来源、模型版本/权重及独立复核证据。
3. 写入、创建草稿 PR 和最终合入，仍需人工逐次审阅，验收日志不能替代授权。

## 商业交付红线

没有完整全仓测试 + Windows 安装器真机证据 + 原生 NCPA/自修复真实联动，不得标记 desktop、模型整机或商业版 graduated。可在这个候选分支继续测试，不触碰 NCPA 模型主线。
