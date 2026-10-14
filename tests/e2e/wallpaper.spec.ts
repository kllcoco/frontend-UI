import { test, expect } from "@playwright/test";
import type { Server } from "node:http";
import { startCiro, startMockModel } from "./mock-upstream";

// Text on a wallpaper must stay readable whatever the app theme: a dark picture gets light text.
let mock: Server, ciro: { url: string; stop: () => void };
test.beforeAll(async () => { mock = await startMockModel(8899); ciro = await startCiro(8798, 8899); });
test.afterAll(() => { ciro?.stop(); mock?.close(); });

const lum = (rgb: string) => { const [r, g, b] = (rgb.match(/\d+/g) || ["0", "0", "0"]).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };

test("light theme on a dark wallpaper: answers and the title bar use light text", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ciro.appearance.v1", JSON.stringify({ preset: "night", scope: "all", brightness: 100, blur: 0, overlay: 0 }));
  });
  await page.goto(ciro.url + "/");
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await page.locator("textarea").first().fill("你好");
  await page.keyboard.press("Enter");
  await expect(page.getByText("来自 ciro 的回答：你好")).toBeVisible();
  await expect(page.locator("main.workspace")).toHaveAttribute("data-wall", "dark");
  const color = await page.locator(".message-prose").last().evaluate((el) => getComputedStyle(el).color);
  expect(lum(color)).toBeGreaterThan(0.6);
});
