import { createServer, type Server } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** OpenAI-compatible mock model: echoes the model name and reports native CWU usage in the last chunk. */
export function startMockModel(port: number): Promise<Server> {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const payload = JSON.parse(body || "{}") as { model?: string; messages?: { content: string }[] };
      const model = payload.model || "ciro";
      const last = payload.messages?.at(-1)?.content || "";
      // Auxiliary prompts (titles, follow-ups) get short answers.
      // Work-mode agent protocol: write a file, run a command (both need approval), then finish.
      const all = payload.messages || [];
      if (all[0]?.content?.includes("You act through tools")) {
        const done = all.filter((m) => m.content.startsWith("RESULT of")).length;
        const steps = ['{"thought":"写入问候文件","action":"write","path":"hello.txt","content":"你好，来自手机"}',
          '{"thought":"确认内容","action":"run","command":"node -e \\"process.stdout.write(require(\'fs\').readFileSync(\'hello.txt\',\'utf8\'))\\""}',
          '{"action":"done","summary":"已在项目里创建 hello.txt"}'];
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content: steps[Math.min(done, 2)] } }], usage: { cwu: 50 } }));
        return;
      }
      const memory = /记忆助手|memory assistant/i.test(last);
      const cite = /注明出处/.test(last) ? /附件：(\S+)/.exec(last)?.[1] : undefined;
      const text = cite ? "付款期限是 30 天［" + cite + " 第 2 页］，违约金为合同金额的 5%［" + cite + " 第 3 页］。" : memory ? (/我喜欢简洁/.test(last) ? '["用户喜欢简洁的回答"]' : "[]") : /JSON|标题|title/i.test(last) ? (/JSON/.test(last) ? '["追问一","追问二"]' : "测试标题") : "来自 " + model + " 的回答：" + last.slice(0, 40) + (last.includes("附件：") ? "（已收到附件）" : "");
      const cwu = model === "ciro-pro" ? 2500 : 1234;
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const part of [text.slice(0, 6), text.slice(6)]) res.write("data: " + JSON.stringify({ choices: [{ delta: { content: part } }] }) + "\n\n");
      res.write("data: " + JSON.stringify({ choices: [], usage: { prompt_tokens: 99, completion_tokens: 77, cwu, gwu: model === "ciro-pro" ? 40 : 0 } }) + "\n\n");
      res.end("data: [DONE]\n\n");
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

/** A Ciro server wired to the mock model. */
export async function startCiro(port: number, upstreamPort: number, extraEnv: Record<string, string> = {}): Promise<{ url: string; stop: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), "ciro-e2e-"));
  const child: ChildProcess = spawn(process.execPath, ["server/index.mjs"], { stdio: "ignore", env: {
    ...process.env, PORT: String(port), HOST: "127.0.0.1", NODE_ENV: "production", CIRO_WORKSPACE_DATA_DIR: dir,
    CIRO_API_BASE_URL: "http://127.0.0.1:" + upstreamPort + "/v1", CIRO_MODEL: "ciro", CIRO_MODELS: "ciro,ciro-pro", ...extraEnv } });
  const url = "http://127.0.0.1:" + port;
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(url + "/api/status")).ok) break; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { url, stop: () => { child.kill(); rmSync(dir, { recursive: true, force: true }); } };
}
