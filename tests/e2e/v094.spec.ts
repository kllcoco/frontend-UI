import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

async function fresh(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("当前为客户端预览，尚未连接真实 CIRO 推理服务")).toBeVisible();
}
async function send(page: Page, text: string) {
  await page.getByRole("textbox", { name: "向 Ciro 发送消息" }).fill(text);
  await page.keyboard.press("Enter");
  await expect(page.locator(".user-bubble").filter({ hasText: text })).toBeVisible();
}
async function openData(page: Page) {
  await page.keyboard.press("Control+,");
  await page.locator(".sc-nav").getByRole("button", { name: "文件与存储", exact: true }).click();
}

test("full backup exports everything and restores it on a new device", async ({ page, browser }) => {
  await fresh(page);
  await send(page, "需要备份的对话");
  await page.getByRole("button", { name: "新建项目" }).first().click();
  await page.getByRole("textbox", { name: "项目名称" }).fill("备份项目");
  await page.keyboard.press("Enter");
  await openData(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出完整备份" }).click();
  const file = await (await download).path();
  const backup = JSON.parse(readFileSync(file!, "utf8"));
  expect(backup.format).toBe("ciro-backup");
  expect(JSON.parse(backup.storage["ciro.chats.v1"])).toHaveLength(1);

  page = await (await browser.newContext()).newPage();
  await fresh(page);
  await openData(page);
  await page.locator(".bk-root input[type=file]").setInputFiles(file!);
  await expect(page.getByRole("dialog", { name: "恢复备份" })).toContainText("1 个对话");
  await page.getByRole("button", { name: "合并（推荐）" }).click();
  await expect(page.locator(".cx-row").filter({ hasText: "需要备份的对话" })).toBeVisible();
  await expect(page.locator(".cx-project-row").filter({ hasText: "备份项目" })).toBeVisible();
});
