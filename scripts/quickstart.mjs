// "Lazy" one-click server: asks for the model connection once, then serves Ciro to this device and the
// local network, prints the addresses and opens the browser. Started by the Server-oneclick-* launchers (deploy/oneclick).
//   node bin/quickstart.mjs [--dir FOLDER] [--port 8787] [--local]
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { createServer } from "node:net";
import { networkInterfaces, platform } from "node:os";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const dir = resolve(flag("--dir") || ".");
mkdirSync(dir, { recursive: true });
process.chdir(dir);
const envFile = resolve(dir, ".env");

const readEnv = () => {
  const out = {};
  if (!existsSync(envFile)) return out;
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
};

let env = readEnv();
if (!existsSync(envFile)) {
  console.log("\n第一次启动：填写模型连接（直接回车可跳过，之后可编辑 " + envFile + "）\n");
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (q, def = "") => {
    process.stdout.write(q + (def ? " [" + def + "]" : "") + "： ");
    const { value, done } = await lines.next();
    if (!process.stdin.isTTY) process.stdout.write("\n");
    return (done ? "" : String(value).trim()) || def;
  };
  const base = await ask("API 地址（OpenAI 兼容，到 /v1 为止）");
  const model = await ask("默认模型", "ciro");
  const key = await ask("API Key（只保存在这台设备）");
  rl.close();
  writeFileSync(envFile, [
    "# Created by the Ciro one-click server. Edit and restart to change.",
    "CIRO_API_BASE_URL=" + base, "CIRO_MODEL=" + model, "CIRO_API_KEY=" + key,
    "CIRO_WEB_SEARCH=off", "CIRO_VOICE=off", "CIRO_IMAGES=off", ""
  ].join("\n"));
  try { chmodSync(envFile, 0o600); } catch { /* Windows */ }
  env = readEnv();
}

const accounts = /^(1|true|on|yes)$/i.test(env.CIRO_ACCOUNTS_ENABLED || "");
// Without accounts anyone who can reach the port can use it: fine on a home / office network, never the internet.
const host = args.includes("--local") || accounts ? "127.0.0.1" : "0.0.0.0";
const free = (port) => new Promise((ok) => {
  const s = createServer().once("error", () => ok(false)).once("listening", () => s.close(() => ok(true)));
  s.listen(port, host);
});
let port = Number(flag("--port") || env.PORT || 8787);
for (let i = 0; i < 20 && !(await free(port)); i += 1) port += 1;

process.env.PORT = String(port);
process.env.HOST = host;
process.env.CIRO_WORKSPACE_DATA_DIR = process.env.CIRO_WORKSPACE_DATA_DIR || resolve(dir, "data");

const lan = Object.values(networkInterfaces()).flat()
  .filter((a) => a && a.family === "IPv4" && !a.internal && !/^169\.254\./.test(a.address))
  .map((a) => "http://" + a.address + ":" + port);
const local = "http://127.0.0.1:" + port;

await import("../server/index.mjs");

const line = "─".repeat(52);
console.log("\n" + line + "\n  Ciro 服务器已启动（关闭这个窗口即停止）\n");
console.log("  本机打开：  " + local);
if (host === "0.0.0.0" && lan.length) {
  console.log("  同一 Wi-Fi / 局域网的手机、电脑打开：");
  for (const u of lan) console.log("              " + u);
  console.log("\n  手机 App：设置 → 连接服务器，填上面的地址。");
  if (platform() === "win32") console.log("  Windows 弹出防火墙提示时请选“允许”（专用网络）。");
  console.log("  没有开启账户：只在自己家里 / 公司内网使用，不要暴露到公网。");
}
console.log("  设置文件：  " + envFile + "\n" + line + "\n");

if (!args.includes("--no-open")) {
  const [cmd, cmdArgs] = platform() === "win32" ? ["cmd", ["/c", "start", "", local]]
    : platform() === "darwin" ? ["open", [local]] : ["xdg-open", [local]];
  setTimeout(() => { try { spawn(cmd, cmdArgs, { stdio: "ignore", detached: true }).on("error", () => {}).unref(); } catch { /* no browser */ } }, 800);
}
