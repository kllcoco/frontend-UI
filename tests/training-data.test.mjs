import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTrainingLog, replyFromSse } from "../server/training-data.mjs";

test("reply text comes out of an SSE stream", () => {
  assert.equal(replyFromSse('data: {"choices":[{"delta":{"content":"你"}}]}\n\ndata: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n'), "你好");
});

test("nothing is kept unless the server has a training folder", async () => {
  const log = createTrainingLog({});
  assert.equal(log.enabled, false);
  assert.equal(await log.record({ user: "u", model: "ciro", messages: [], reply: "x" }), false);
});

test("an opted-in exchange is written with a hashed user id only", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ciro-train-"));
  const log = createTrainingLog({ CIRO_TRAINING_DIR: dir });
  assert.equal(await log.record({ user: "alice@example.com", model: "ciro", reply: "答",
    messages: [{ role: "system", content: "secret notes" }, { role: "user", content: "问" }] }), true);
  const [file] = await readdir(dir);
  const row = JSON.parse((await readFile(join(dir, file), "utf8")).trim());
  assert.equal(row.reply, "答");
  assert.deepEqual(row.messages, [{ role: "user", content: "问" }]);
  assert.match(row.user, /^[0-9a-f]{16}$/);
  assert.ok(!JSON.stringify(row).includes("alice"));
});
