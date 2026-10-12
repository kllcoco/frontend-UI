import test from "node:test";
import assert from "node:assert/strict";
import {safeReadRef,safeBranch,safeFilePath} from "../server/agent-policy.mjs";
test("CIRO reads exact development branch safely without granting write access",()=>{
 assert.equal(safeReadRef("main"),"main");
 assert.equal(safeReadRef("feat/ciro-chat-client-v1"),"feat/ciro-chat-client-v1");
 assert.equal(safeReadRef("ciro/source-inspection"),"ciro/source-inspection");
 assert.throws(()=>safeBranch("main"),/non-protected branch/);
 assert.throws(()=>safeBranch("feat/ciro-chat-client-v1"),/non-protected branch/);
 assert.equal(safeBranch("ciro/fix-1"),"ciro/fix-1");
});
test("CIRO refuses path traversal and dangerous repo ref patterns",()=>{
 for(const item of ["", "../main", "refs/heads/main", "foo//bar", "foo/../bar", "main.lock", "main@", "/main", "main/"])
  assert.throws(()=>safeReadRef(item),/Invalid read-only/);
 for(const item of [".env",".github/workflows/ci.yml","secrets/config.json","foo/../bar"])
  assert.throws(()=>safeFilePath(item),/Invalid repository path/);
});
