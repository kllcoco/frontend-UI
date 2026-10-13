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
