import { test, expect } from "@playwright/test";
import type { Server } from "node:http";
import { startCiro, startMockModel } from "./mock-upstream";

// 协作空间 → 多模型协作: the user picks connected models; they draft, review each other, and the lead merges.
let mock: Server, ciro: { url: string; stop: () => void };
test.beforeAll(async () => { mock = await startMockModel(8904); ciro = await startCiro(8803, 8904); });
test.afterAll(() => { ciro?.stop(); mock?.close(); });

test("picked models work on one task together and the lead writes the final result", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ciro.custom-models.v1", JSON.stringify([
    { id: "a1", name: "模型甲", baseUrl: "http://127.0.0.1:8904/v1", apiKey: "k", model: "alpha", api: "openai" },
    { id: "b2", name: "模型乙", baseUrl: "http://127.0.0.1:8904/v1", apiKey: "k", model: "beta", api: "openai" }])));
  await page.goto(ciro.url + "/?view=studio");
  await page.goto(ciro.url + "/");
  await page.locator(".cx-nav").getByRole("button", { name: "协作空间" }).click();
  await page.locator(".wb-nav").getByRole("button", { name: "多模型协作" }).click();
  const go = page.getByRole("button", { name: "开始协作" });
  await page.getByLabel("协作任务").fill("写一句口号");
  await expect(go).toBeDisabled(); // nothing picked up front
  await page.getByRole("button", { name: "模型甲" }).click();
  await page.getByRole("button", { name: "模型乙" }).click();
  await go.click();
  await expect(page.locator(".crew-final")).toContainText("来自", { timeout: 20000 });
  await expect(page.locator(".crew-card")).toHaveCount(4); // two drafts + two reviews
  await expect(page.locator(".crew-history")).toContainText("写一句口号");
});
