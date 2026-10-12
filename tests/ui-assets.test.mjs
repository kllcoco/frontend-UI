import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const file = (path) => readFileSync(join(root, path), "utf8");
test("five offline wallpaper assets are present", () => {
  for (const item of ["night-lake", "aurora", "summit", "city", "minimal"]) {
    const content = file("public/backgrounds/" + item + ".svg");
    assert.match(content, /<svg\b/);
    assert.match(content, /viewBox="0 0 1600 900"/);
    assert.doesNotMatch(content, /<script\b|<foreignObject\b|<image\b|<use\b|(?:href|xlink:href)\s*=\s*["\x27]https?:\/\//i);
  }
});
test("Ciro orbit-C logo uses gradient ring with star and sets favicon", () => {
  const logo = file("public/ciro-mark.svg");
  assert.match(logo, /linearGradient/);
  assert.match(logo, /stroke-linecap="round"/);
  assert.match(logo, /<circle\b/);
  assert.match(file("index.html"), /ciro-mark\.svg/);
});
test("settings UI contains eight configured views and indexedDB DIY controls", () => {
  const source = file("src/SettingsCenter.tsx");
  for (const name of ["通用设置", "外观与背景", "模型设置", "对话设置", "文件与存储", "快捷键", "隐私与安全", "关于 Ciro"]) {
    assert.ok(source.includes(name), "Missing settings tab: " + name);
  }
  assert.match(file("src/lib/appearance.ts"), /indexedDB\.open/);
  assert.match(source, /type="range"/);
});
