import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createShareStore, validateShare, ShareError } from "../server/share.mjs";

test("share snapshots are validated, stored, owner-scoped and removable", () => {
  const dir = mkdtempSync(join(tmpdir(), "ciro-share-"));
  try {
    const store = createShareStore(dir);
    const id = store.create(validateShare({ title: "Hello", messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "yo", extra: 1 }] }), "u1");
    assert.match(id, /^[A-Za-z0-9_-]{16,40}$/);
    const entry = createShareStore(dir).get(id);
    assert.equal(entry.title, "Hello");
    assert.deepEqual(entry.messages[1], { role: "assistant", content: "yo" });
    assert.throws(() => store.remove(id, "someone-else"), ShareError);
    assert.equal(store.remove(id, "u1"), true);
    assert.equal(store.get(id), null);
    assert.equal(store.get("../etc/passwd"), null);
    assert.throws(() => validateShare({ title: "", messages: [] }), ShareError);
    assert.throws(() => validateShare({ title: "x", messages: [{ role: "system", content: "x" }] }), ShareError);
    assert.throws(() => validateShare({ title: "x", messages: [{ role: "user", content: "a".repeat(400_001) }] }), ShareError);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
