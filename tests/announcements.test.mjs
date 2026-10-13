import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applies, cleanAnnouncement, createAnnouncements } from "../server/announcements.mjs";

test("announcements: owner publishes, central feed merges, targeting by platform/version/time, unsafe links dropped", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ann-"));
  let feedCalls = 0;
  const fetchFn = async () => { feedCalls += 1; return { ok: true, json: async () => [
    { id: "plan-pro", title: "专业版限时 8 折", body: "本周内订阅", level: "promo", link: { label: "了解", url: "https://ciro.example.com/pro" } },
    { id: "old", title: "旧版本提示", maxVersion: "0.9.5" },
    { id: "evil", title: "x", link: { url: "javascript:alert(1)" } }] }; };
  const ann = createAnnouncements({ dir, env: { CIRO_ANNOUNCEMENTS_URL: "https://feed.example.com/a.json" }, fetchFn, canEdit: (req) => req.get("x-owner") === "1" });
  const app = express(); app.use(express.json()); app.use("/a", ann.router);
  const server = http.createServer(app); await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port + "/a";
  try {
    assert.equal((await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "hi" }) })).status, 403);
    const posted = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-owner": "1" },
      body: JSON.stringify({ title: "服务器维护", body: "今晚 23:00", level: "warning", platforms: ["android"] }) });
    assert.equal(posted.status, 201);
    const android = await (await fetch(url + "?platform=android&version=0.9.7")).json();
    assert.deepEqual(android.announcements.map((a) => a.title), ["服务器维护", "专业版限时 8 折", "x"]);
    assert.equal(android.announcements[2].link, null, "javascript: links are dropped");
    const web = await (await fetch(url + "?platform=web&version=0.9.5")).json();
    assert.deepEqual(web.announcements.map((a) => a.title), ["专业版限时 8 折", "旧版本提示", "x"]);
    await fetch(url + "?platform=web");
    assert.equal(feedCalls, 1, "central feed is cached");
    // Persisted for the next start.
    const again = createAnnouncements({ dir, env: { CIRO_ANNOUNCEMENTS_URL: "off" }, canEdit: () => false });
    const app2 = express(); app2.use("/a", again.router);
    const s2 = http.createServer(app2); await new Promise((r) => s2.listen(0, "127.0.0.1", r));
    const list = await (await fetch("http://127.0.0.1:" + s2.address().port + "/a?platform=android")).json();
    assert.deepEqual(list.announcements.map((a) => a.title), ["服务器维护"]);
    s2.close();
  } finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("time windows", () => {
  const a = cleanAnnouncement({ title: "t", start: "2026-10-10T00:00:00Z", end: "2026-10-12T00:00:00Z" }, "x");
  assert.equal(applies(a, { platform: "web", appVersion: "1.0.0", now: new Date("2026-10-11T00:00:00Z") }), true);
  assert.equal(applies(a, { platform: "web", appVersion: "1.0.0", now: new Date("2026-10-13T00:00:00Z") }), false);
});
