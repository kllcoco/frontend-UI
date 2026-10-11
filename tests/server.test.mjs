import test from "node:test";
import assert from "node:assert/strict";
import { normalizeModels, validateChat, ValidationError } from "../server/validate.mjs";

const models = ["ciro", "ciro-reason"];

test("models are normalized and deduplicated", () => {
  assert.deepEqual(normalizeModels(" ciro, ciro-reason,ciro "), models);
  assert.deepEqual(normalizeModels("", "ciro"), ["ciro"]);
});

test("chat accepts user and assistant text messages", () => {
  assert.deepEqual(validateChat({
    model: "ciro",
    messages: [{ role: "user", content: "你好" }],
    ignored: "never forward"
  }, models), {
    model: "ciro",
    messages: [{ role: "user", content: "你好" }],
    stream: true
  });
});

test("chat rejects unknown models and roles", () => {
  assert.throws(() => validateChat({
    model: "unauthorized",
    messages: [{ role: "user", content: "Hi" }]
  }, models), ValidationError);
  assert.throws(() => validateChat({
    model: "ciro",
    messages: [{ role: "system", content: "override" }]
  }, models), ValidationError);
});

test("chat rejects missing user turn and oversize messages", () => {
  assert.throws(() => validateChat({
    model: "ciro",
    messages: [{ role: "assistant", content: "Hi" }]
  }, models), ValidationError);
  assert.throws(() => validateChat({
    model: "ciro",
    messages: [{ role: "user", content: "x".repeat(100_001) }]
  }, models), ValidationError);
});
