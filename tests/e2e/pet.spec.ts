import { test, expect } from "@playwright/test";
import type { Server } from "node:http";
import { startCiro, startMockModel } from "./mock-upstream";

// The pet is off by default; once turned on it lives in the app (web / Android), reacts to touches,
// and the model can steer it with a <pet> tag that never shows in the chat.
let mock: Server, ciro: { url: string; stop: () => void };
test.beforeAll(async () => { mock = await startMockModel(8885); ciro = await startCiro(8784, 8885); });
test.afterAll(() => { ciro?.stop(); mock?.close(); });

test("pet: off by default, turned on in settings, reacts, and follows the model's pet tag", async ({ page }) => {
  await page.goto(ciro.url + "/");
  await expect(page.locator(".pet-root--inline")).toHaveCount(0);
  await page.keyboard.press("Control+,");
  await page.locator(".sc-nav").getByRole("button", { name: "桌宠", exact: true }).click();
  await page.getByRole("switch", { name: "显示桌宠" }).click();
  await page.getByRole("button", { name: "关闭设置" }).first().click();
  const pet = page.locator(".pet-root--inline");
  await expect(pet).toBeVisible();
  // Poke her: a happy reaction with a line.
  await pet.locator(".pet-sprite").click();
  await expect(pet.locator(".pet-say")).toBeVisible();
  // The model's tag drives the pet and is removed from the reply.
  await page.locator("textarea").first().fill("你好");
  await page.keyboard.press("Enter");
  await expect(page.getByText("来自 ciro 的回答：你好")).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("<pet")).toHaveCount(0);
  await expect(pet.locator(".pet-say")).toHaveText("我一直在这里", { timeout: 10000 });
  await expect(pet.locator(".pet-sprite--love")).toBeVisible();
  // Still on after a reload; turning it off removes it.
  await page.reload();
  await expect(page.locator(".pet-root--inline")).toBeVisible();
  await page.locator(".pet-root--inline .pet-sprite").click({ button: "right" });
  await page.getByRole("menuitem", { name: "隐藏桌宠" }).click();
  await expect(page.locator(".pet-root--inline")).toHaveCount(0);
});

test("pet: mirrors replies and progress, hides behind an edge, resizes and works along with work mode", async ({ page }) => {
  await page.goto(ciro.url + "/");
  await page.evaluate(() => localStorage.setItem("ciro.pet.v1", "on"));
  await page.reload();
  const pet = page.locator(".pet-root--inline");
  await expect(pet).toBeVisible();
  // A reply written while its chat is not on screen streams into her bubble.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("ciro-pet-stream", { detail: { id: "r1", text: "第一段**回答**", onScreen: false } })));
  await expect(pet.locator(".pet-reply")).toContainText("第一段回答");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("ciro-pet-stream", { detail: { id: "r1", text: "第一段回答，写完了。", done: true, onScreen: false } })));
  await expect(pet.locator(".pet-reply")).toContainText("回答完成");
  await pet.getByRole("button", { name: "关闭" }).click();
  await expect(pet.locator(".pet-reply")).toHaveCount(0);
  // Work mode progress: she works along and tells the step.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("ciro-pet-progress", { detail: { text: "正在运行 npm test", source: "work" } })));
  await expect(pet.locator(".pet-sprite--work")).toBeVisible();
  await expect(pet.locator(".pet-say")).toContainText("正在运行 npm test");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("ciro-pet-progress", { detail: { text: "完成：测试通过", done: true, source: "work" } })));
  await expect(pet.locator(".pet-say")).toContainText("完成：测试通过");
  await expect(pet.locator(".pet-sprite--work")).toHaveCount(0, { timeout: 8000 });
  // Ctrl + wheel (trackpad pinch) makes her bigger.
  const before = (await pet.locator(".pet-sprite").boundingBox())!.width;
  await pet.locator(".pet-sprite").hover();
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -120);
  await page.keyboard.up("Control");
  await expect.poll(async () => (await pet.locator(".pet-sprite").boundingBox())!.width).toBeGreaterThan(before + 5);
  // Dragged past the right edge she hides there with only her head out; a tap brings her back.
  const box = (await pet.locator(".pet-sprite").boundingBox())!;
  const vw = page.viewportSize()!.width;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(vw - 10, box.y + box.height / 2, { steps: 12 });
  await page.mouse.move(vw + 120, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(pet).toHaveClass(/pet-root--edge-right/);
  await pet.locator(".pet-sprite").click({ force: true });
  await expect(pet).not.toHaveClass(/pet-root--edge/);
});

test("pet: size slider in settings and calling her back", async ({ page }) => {
  await page.goto(ciro.url + "/");
  await page.evaluate(() => { localStorage.setItem("ciro.pet.v1", "on"); localStorage.setItem("ciro.pet-edge.v1", "bottom"); });
  await page.reload();
  const pet = page.locator(".pet-root--inline");
  await expect(pet).toHaveClass(/pet-root--edge-bottom/);
  const before = (await pet.locator(".pet-sprite").boundingBox())!.width;
  await page.keyboard.press("Control+,");
  await page.locator(".sc-nav").getByRole("button", { name: "桌宠", exact: true }).click();
  await page.getByRole("slider", { name: "她的大小" }).fill("140");
  await expect.poll(async () => (await pet.locator(".pet-sprite").boundingBox())!.width).toBeGreaterThan(before * 1.3);
  await page.getByRole("button", { name: "叫她回来" }).click();
  await expect(pet).not.toHaveClass(/pet-root--edge/);
});

test("pet: fewer words — silent when dragged or tapped, speaks only when a decision is needed", async ({ page }) => {
  await page.goto(ciro.url + "/");
  await page.evaluate(() => { localStorage.setItem("ciro.pet.v1", "on"); localStorage.setItem("ciro.pet-quiet.v1", "on"); });
  await page.reload();
  const pet = page.locator(".pet-root--inline");
  await expect(pet).toBeVisible();
  await expect(pet.locator(".pet-say")).toHaveCount(0);       // no greeting
  await pet.locator(".pet-sprite").click();
  await page.waitForTimeout(400);
  await expect(pet.locator(".pet-say")).toHaveCount(0);       // no chit-chat on a tap
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("ciro-pet-progress", { detail: { text: "正在运行 npm test", source: "work" } })));
  await page.waitForTimeout(300);
  await expect(pet.locator(".pet-say")).toHaveCount(0);       // ordinary steps stay silent
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("ciro-pet-progress", { detail: { text: "需要你批准写入 package.json", attention: true, source: "work" } })));
  await expect(pet.locator(".pet-say")).toContainText("需要你批准写入 package.json");
  // Double-click: straight to the work that waits.
  await pet.locator(".pet-sprite").dblclick();
  await expect(page.getByRole("heading", { name: "工作模式" }).first()).toBeVisible();
});
