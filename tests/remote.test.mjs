import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAccountService } from "../server/account.mjs";
import { createRemoteRouter } from "../server/remote.mjs";
import { createRemoteAgent, insideFolder } from "../server/remote-agent.mjs";

const env = { CIRO_ACCOUNTS_ENABLED: "true", CIRO_BOOTSTRAP_TOKEN: "bootstrap-secret-of-32-characters-long",
  CIRO_API_KEY_PEPPER: "api-key-hmac-pepper-more-than-24-bytes", CIRO_ACCOUNT_DATA_KEY: randomBytes(32).toString("base64") };
const listen = (app) => new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 60)); } };

test("work mode: pair a computer, run commands, AI task with approvals, folder sandbox", async () => {
  const cloudDir = mkdtempSync(join(tmpdir(), "ciro-cloud-")), pcDir = mkdtempSync(join(tmpdir(), "ciro-pc-")), project = mkdtempSync(join(tmpdir(), "ciro-proj-"));
  // Scripted model for the AI task.
  const script = [
    '{"thought":"先看看目录","action":"list","path":"."}',
    '{"thought":"写入文件","action":"write","path":"notes/hello.txt","content":"你好"}',
    '{"thought":"确认内容","action":"run","command":"node -e \\"process.stdout.write(require(\'fs\').readFileSync(\'notes/hello.txt\',\'utf8\'))\\""}',
    '{"thought":"试图越界","action":"read","path":"../outside.txt"}',
    '{"action":"done","summary":"已创建 notes/hello.txt"}'
  ];
  let step = 0;
  const accounts = createAccountService({ env, dir: cloudDir });
  const cloud = express(); cloud.use(express.json({ limit: "25mb" }));
  cloud.use("/api/account", accounts.router); cloud.use("/api", accounts.guard);
  cloud.use("/api/remote", createRemoteRouter({ dir: cloudDir, enabled: () => true, complete: async () => ({ content: script[step++] || '{"action":"done","summary":"x"}', usage: { cwu: 100 } }) }));
  const cloudServer = await listen(cloud);
  const url = "http://127.0.0.1:" + cloudServer.address().port;
  let cookie = "", csrf = "";
  const call = async (path, method = "GET", body) => {
    const r = await fetch(url + path, { method, headers: { Cookie: cookie, ...(method !== "GET" ? { "X-Ciro-Csrf": csrf } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, json: await r.json().catch(() => null), headers: r.headers };
  };
  const b = await call("/api/account/bootstrap", "POST", { bootstrapToken: env.CIRO_BOOTSTRAP_TOKEN, email: "o@example.com", displayName: "O", password: "a-very-secure-long-password" });
  cookie = b.headers.get("set-cookie").split(";")[0]; csrf = b.json.csrf;

  const agent = createRemoteAgent({ dir: pcDir, version: "test" });
  const pc = express(); pc.use(express.json()); pc.use("/api/remote/local", agent.router);
  const pcServer = await listen(pc);
  const local = (path, body) => fetch("http://127.0.0.1:" + pcServer.address().port + "/api/remote/local" + path, { method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", "X-Ciro-Local": "1" }, ...(body ? { body: JSON.stringify(body) } : {}) }).then(async (r) => ({ status: r.status, json: await r.json() }));
  try {
    // Signed-out callers are rejected. The computer signs in once with the account and appears in the list.
    assert.equal((await fetch(url + "/api/remote/devices")).status, 401);
    assert.equal((await local("/login", { serverUrl: url, email: "o@example.com", password: "wrong-password-123456" })).status, 400);
    const paired = await local("/login", { serverUrl: url, email: "o@example.com", password: "a-very-secure-long-password", name: "家里的电脑" });
    assert.equal(paired.json.paired, true);
    assert.ok(!readFileSync(join(pcDir, "remote-agent.json"), "utf8").includes("a-very-secure-long-password"), "the password is never stored");
    // Cross-site requests to the local API are refused.
    assert.equal((await fetch("http://127.0.0.1:" + pcServer.address().port + "/api/remote/local/enabled", { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json", "X-Ciro-Local": "1" }, body: "{}" })).status, 403);
    assert.equal((await fetch("http://127.0.0.1:" + pcServer.address().port + "/api/remote/local/status", { headers: { "X-Forwarded-For": "203.0.113.9" } })).status, 403, "proxied requests are never local");
    assert.equal((await local("/folders", { folders: ["relative/path"] })).status, 400);
    await local("/folders", { folders: [project] });
    const device = await until(async () => (await call("/api/remote/devices")).json.devices.find((d) => d.online && d.folders.length));
    assert.equal(device.name, "家里的电脑");
    assert.equal(device.connected, false, "visible to the account, but not yet connected");
    const folder = device.folders[0];

    // Without scanning the QR code this phone may look but not command.
    const denied = await call("/api/remote/sessions", "POST", { deviceId: device.id, folder, kind: "shell", text: "ls" });
    assert.equal(denied.status, 403);
    const qr = (await fetch("http://127.0.0.1:" + pcServer.address().port + "/api/remote/local/qr").then((r) => r.json()));
    assert.match(qr.url, /\/remote\/connect\?device=.+&nonce=.+/);
    assert.equal((await call("/api/remote/devices/" + device.id + "/connect", "POST", { nonce: "forged" })).status, 403);
    assert.equal((await call("/api/remote/devices/" + device.id + "/connect", "POST", { nonce: qr.nonce })).json.device.connected, true);
    assert.equal((await call("/api/remote/devices/" + device.id + "/connect", "POST", { nonce: qr.nonce })).status, 403, "a QR code works once");
    assert.equal((await call("/api/remote/devices")).json.devices.find((d) => d.id === device.id).connected, true);

    // Command mode: output streams back; a follow-up command runs in the same folder.
    const bad = await call("/api/remote/sessions", "POST", { deviceId: device.id, folder: "/etc", kind: "shell", text: "ls" });
    assert.equal(bad.status, 400, "only folders allowed on the computer");
    const shell = (await call("/api/remote/sessions", "POST", { deviceId: device.id, folder, kind: "shell", text: "node -e \"console.log('hi from pc')\"" })).json.session;
    const outText = async (id) => (await call("/api/remote/sessions/" + id + "/events?after=0")).json.events.filter((e) => e.type === "stdout").map((e) => e.data.text).join("");
    await until(async () => (await outText(shell.id)).includes("hi from pc"));
    await call("/api/remote/sessions/" + shell.id + "/input", "POST", { text: "node -e \"console.log(process.cwd())\"" });
    await until(async () => (await outText(shell.id)).includes(project.split("/").pop()));

    // AI task: writes and commands wait for approval; escaping the folder fails.
    const task = (await call("/api/remote/sessions", "POST", { deviceId: device.id, folder, kind: "agent", text: "创建一个问候文件" })).json.session;
    const events = async () => (await call("/api/remote/sessions/" + task.id + "/events?after=0")).json.events;
    const approve = async (action) => {
      const req = await until(async () => (await events()).find((e) => e.type === "approval_request" && e.data.action === action && !(e.handled)));
      await call("/api/remote/sessions/" + task.id + "/approve", "POST", { requestId: req.data.requestId, approve: true });
    };
    await approve("write");
    await approve("run");
    const done = await until(async () => { const ev = await events(); return ev.find((e) => e.type === "agent" && e.data.final) ? ev : null; });
    assert.equal(readFileSync(join(project, "notes/hello.txt"), "utf8"), "你好");
    assert.ok(done.some((e) => e.type === "stdout" && e.data.text.includes("你好")));
    assert.ok(done.some((e) => e.type === "stderr" && e.data.text.includes("超出")));
    assert.ok(done.some((e) => e.type === "usage" && e.data.cwu === 100));

    // Sandbox helper refuses symlinks that point outside.
    mkdirSync(join(project, "inner")); writeFileSync(join(cloudDir, "secret.txt"), "x");
    symlinkSync(cloudDir, join(project, "link"));
    assert.throws(() => insideFolder(project, "link/secret.txt"));
    assert.equal(insideFolder(project, "inner"), join(realpath(project), "inner"));

    // The 8-character code under the QR works as well (single use).
    const qr2 = (await fetch("http://127.0.0.1:" + pcServer.address().port + "/api/remote/local/qr").then((r) => r.json()));
    assert.match(qr2.code, /^[A-Z2-9]{8}$/);
    await call("/api/remote/devices/" + device.id + "/disconnect", "POST", {});
    assert.equal((await call("/api/remote/devices")).json.devices.find((d) => d.id === device.id).connected, false);
    assert.equal((await call("/api/remote/connect", "POST", { code: qr2.code.toLowerCase() })).json.device.connected, true);
    assert.equal((await call("/api/remote/connect", "POST", { code: qr2.code })).status, 403);

    // Other direction: a phone makes a pairing code and a second computer types it in — no password there,
    // and that phone is connected to it immediately.
    const { json: { code: pairCode } } = await call("/api/remote/pairing-code", "POST", {});
    const agent2 = createRemoteAgent({ dir: mkdtempSync(join(tmpdir(), "ciro-pc2-")), version: "test" });
    const pc2 = express(); pc2.use(express.json()); pc2.use("/api/remote/local", agent2.router);
    const pc2Server = await listen(pc2);
    const r2 = await fetch("http://127.0.0.1:" + pc2Server.address().port + "/api/remote/local/pair", { method: "POST", headers: { "Content-Type": "application/json", "X-Ciro-Local": "1" }, body: JSON.stringify({ serverUrl: url, code: pairCode, name: "公司电脑" }) });
    assert.equal(r2.status, 200);
    const office = await until(async () => (await call("/api/remote/devices")).json.devices.find((d) => d.name === "公司电脑"));
    assert.equal(office.connected, true);
    agent2.stop(); await new Promise((r) => pc2Server.close(r));

    // A second phone of the same account must scan on its own; the computer can disconnect phones.
    const login2 = await fetch(url + "/api/account/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "o@example.com", password: "a-very-secure-long-password" }) });
    const phone2 = { cookie: login2.headers.get("set-cookie").split(";")[0], csrf: (await login2.json()).csrf };
    const asPhone2 = (path, body) => fetch(url + path, { method: body ? "POST" : "GET", headers: { Cookie: phone2.cookie, "X-Ciro-Csrf": phone2.csrf, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal((await (await asPhone2("/api/remote/devices")).json()).devices.find((d) => d.id === device.id).connected, false);
    assert.equal((await asPhone2("/api/remote/sessions", { deviceId: device.id, folder, kind: "shell", text: "ls" })).status, 403);
    const grants = (await fetch("http://127.0.0.1:" + pcServer.address().port + "/api/remote/local/grants").then((r) => r.json())).grants;
    assert.equal(grants.length, 1);
    await local("/grants/revoke", { id: grants[0].id });
    assert.equal((await call("/api/remote/sessions", "POST", { deviceId: device.id, folder, kind: "shell", text: "ls" })).status, 403, "disconnected from the computer");

    // Removing the computer cuts it off.
    await call("/api/remote/devices/" + device.id, "DELETE");
    await until(async () => (await local("/status")).json.lastError.includes("移除"), 35000);
  } finally {
    agent.stop();
    await new Promise((r) => cloudServer.close(r)); await new Promise((r) => pcServer.close(r));
    for (const d of [cloudDir, pcDir, project]) rmSync(d, { recursive: true, force: true });
  }
});
import { realpathSync as realpath } from "node:fs";
