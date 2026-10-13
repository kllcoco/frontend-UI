import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
const src = transformSync(readFileSync(new URL("../src/lib/phone.ts", import.meta.url), "utf8"), { loader: "ts", format: "esm" }).code;
test("phone tags: whitelist, JSON only, at most three, stripped from the spoken text", async () => {
  const mod = await import("data:text/javascript," + encodeURIComponent(src));
  const text = '好的，七点半叫你。<phone>{"action":"alarm","hour":7,"minute":30}</phone><phone>{"action":"rm -rf"}</phone><phone>not json</phone>' +
    '<phone>{"action":"timer","seconds":60}</phone><phone>{"action":"flashlight","on":true}</phone><phone>{"action":"volume","level":"up"}</phone>';
  const list = mod.phoneActions(text);
  assert.deepEqual(list.map((a) => a.action), ["alarm", "timer", "flashlight"]);
  assert.equal(mod.stripPhoneTags(text), "好的，七点半叫你。");
  assert.equal(mod.stripPhoneTags('好的<phone>{"action":"ala'), "好的");
});
