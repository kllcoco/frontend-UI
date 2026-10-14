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
  await expect(page.getByRole("main").getByText("来自 ciro 的回答：你好")).toBeVisible({ timeout: 15000 });
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

test("pet: Android overlay drag sends total screen displacement, never accumulated ticks", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as typeof window & { CiroPetHost: unknown; petNativeEvents: { type: string; dx?: number; dy?: number }[] };
    w.petNativeEvents = [];
    w.CiroPetHost = {
      beginDrag: () => w.petNativeEvents.push({ type: "start" }),
      dragTo: (dx: number, dy: number) => w.petNativeEvents.push({ type: "move", dx, dy }),
      dragEnd: () => w.petNativeEvents.push({ type: "end" }),
      moveBy: () => {}, resize: () => {}, expand: () => {}, edge: () => {}, action: () => {},
    };
  });
  await page.goto(ciro.url + "/?pet=1&overlay=1");
  const b = (await page.locator(".pet-sprite").boundingBox())!;
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (const delta of [12, 24, 36, 48]) await page.mouse.move(x + delta, y, { steps: 2 });
  await page.mouse.up();
  const events = await page.evaluate(() => (window as typeof window & {
    petNativeEvents: { type: string; dx?: number; dy?: number }[]
  }).petNativeEvents);
  expect(events.filter((e) => e.type === "start")).toHaveLength(1);
  const moves = events.filter((e) => e.type === "move");
  expect(moves.length).toBeGreaterThan(2);
  expect(moves.at(-1)!.dx).toBeGreaterThan(35);
  expect(moves.at(-1)!.dx).toBeLessThan(60);
  expect(moves.every((e, i) => i === 0 || e.dx! >= moves[i - 1].dx! - 1)).toBeTruthy();
  expect(events.at(-1)?.type).toBe("end");
});

test("pet: mobile dock is flush to the viewport, not inset by gesture gutters", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  try {
    const page = await context.newPage();
    await page.goto(ciro.url + "/");
    await page.evaluate(() => {
      localStorage.setItem("ciro.pet.v1", "on");
      localStorage.setItem("ciro.pet-edge.v1", "right");
    });
    await page.reload();
    const pet = page.locator(".pet-root--inline");
    await expect(pet).toHaveClass(/pet-root--edge-right/);
    await expect.poll(() => pet.evaluate((el) => Math.round(window.innerWidth - el.getBoundingClientRect().right))).toBe(0);
    await page.evaluate(() => localStorage.setItem("ciro.pet-edge.v1", "bottom"));
    await page.reload();
    await expect(pet).toHaveClass(/pet-root--edge-bottom/);
    await expect.poll(() => pet.evaluate((el) => Math.round(window.innerHeight - el.getBoundingClientRect().bottom))).toBe(0);
  } finally { await context.close(); }
});

test("home: a reachable unconfigured model is not a network outage, and a true outage can be dismissed", async ({ page }) => {
  await page.route("**/api/status", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ configured: false, model: "ciro", models: ["ciro"] }),
  }));
  await page.goto(ciro.url + "/");
  await expect(page.locator(".cx-connect--down")).toHaveCount(0);
  await page.unroute("**/api/status");
  await page.route("**/api/status", (route) => route.abort("failed"));
  await page.reload();
  const warning = page.locator(".cx-connect--down");
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("暂时连不上 Ciro 服务");
  await warning.getByRole("button", { name: "关闭" }).click();
  await expect(warning).toHaveCount(0);
});

test("pet: the menu acts where she is — asleep hanging at the edge, a long press is not a tap", async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem("ciro.pet.v1", "on"); localStorage.setItem("ciro.pet-edge.v1", "bottom"); });
  await page.goto(ciro.url + "/");
  const pet = page.locator(".pet-root--inline");
  await expect(pet).toHaveClass(/pet-root--edge-bottom/);
  await pet.locator(".pet-sprite").click({ button: "right" });
  await page.getByRole("menuitem", { name: "让她睡一会儿" }).click();
  await expect(pet).toHaveClass(/pet-root--edge-bottom/);
  await expect(pet.locator(".pet-sprite--sleep")).toBeVisible();
  await pet.locator(".pet-sprite").click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "叫醒她" })).toBeVisible();
  // A tap elsewhere closes the menu without moving her.
  await page.mouse.click(20, 20);
  await expect(page.locator(".pet-menu")).toHaveCount(0);
  await expect(pet).toHaveClass(/pet-root--edge-bottom/);
});

test("pet window: transparent from the first frame, never the launch logo", async ({ page }) => {
  await page.goto(ciro.url + "/?pet=1&overlay=1", { waitUntil: "commit" });
  await expect(page.locator("html")).toHaveClass(/pet-page/);
  await expect(page.locator("#ciro-boot")).toBeHidden();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
});
