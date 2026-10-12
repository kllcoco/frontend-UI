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

test("code blocks run Python (with matplotlib-free stdout), JavaScript and HTML previews", async ({ page }) => {
  test.setTimeout(120_000);
  await fresh(page);
  await page.getByRole("button", { name: "添加附件与模式" }).click();
  await page.getByRole("menuitem", { name: /新建画布/ }).click();
  const canvas = page.getByRole("complementary", { name: "画布" });
  await canvas.getByRole("textbox", { name: "画布内容" }).fill(
    "```python\nimport math\nprint('平方根', math.sqrt(16))\nsum(range(5))\n```\n\n```javascript\nconsole.log('js', [1,2].map(x => x * 3))\n```\n\n```html\n<h1 id=t>Hi</h1>\n```");
  await canvas.getByRole("tab", { name: "预览" }).click();
  const blocks = canvas.locator(".cx-code");
  await blocks.nth(1).getByRole("button", { name: "运行代码" }).click();
  await expect(blocks.nth(1).locator(".cx-run-out")).toContainText('js [\n  3,\n  6\n]');
  await blocks.nth(2).getByRole("button", { name: "预览" }).click();
  await expect(blocks.nth(2).frameLocator("iframe").locator("#t")).toHaveText("Hi");
  await blocks.nth(0).getByRole("button", { name: "运行代码" }).click();
  await expect(blocks.nth(0).locator(".cx-run-out")).toContainText("平方根 4.0", { timeout: 90_000 });
  await expect(blocks.nth(0).locator(".cx-run-value")).toHaveText("10");
});

test("content shared from another app opens a new chat with text and images filled in", async ({ page }) => {
  await fresh(page);
  // PWA share target (GET)
  await page.goto("/?share=1&title=" + encodeURIComponent("文章标题") + "&url=" + encodeURIComponent("https://example.com/a"));
  await expect(page.getByRole("textbox", { name: "向 Ciro 发送消息" })).toHaveValue("文章标题\n\nhttps://example.com/a");
  expect(page.url()).not.toContain("share=1");
  // Android bridge: CiroShare.take() then window.ciroReceiveShare()
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  await page.evaluate((img) => {
    let pending: string | null = JSON.stringify({ subject: "", text: "帮我看看这张图", images: [img] });
    (window as unknown as { CiroShare: { take: () => string | null } }).CiroShare = { take: () => { const v = pending; pending = null; return v; } };
    (window as unknown as { ciroReceiveShare: () => void }).ciroReceiveShare();
  }, png);
  await expect(page.getByRole("textbox", { name: "向 Ciro 发送消息" })).toHaveValue("帮我看看这张图");
  await expect(page.locator(".attachment-chip")).toHaveCount(1);
});
