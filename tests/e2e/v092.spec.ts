import { test, expect, type Page } from "@playwright/test";
import { go } from "./helpers";

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

test("Traditional Chinese converts the whole interface and persists", async ({ page }) => {
  await fresh(page);
  await page.keyboard.press("Control+,");
  await page.getByRole("button", { name: "繁體中文" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-TW");
  await expect(page.getByRole("heading", { name: "通用設定" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".cx-welcome h1")).toContainText("讓每一個想法");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".cx-nav")).toContainText("新對話");
});

test("find in chat highlights and steps through matches", async ({ page }) => {
  await fresh(page);
  await send(page, "苹果 香蕉 苹果");
  await page.keyboard.press("Control+f");
  const bar = page.getByRole("search", { name: "在对话中查找" });
  await bar.getByRole("textbox").fill("苹果");
  await expect(bar.locator(".fb-count")).toHaveText("1 / 2");
  await page.keyboard.press("Enter");
  await expect(bar.locator(".fb-count")).toHaveText("2 / 2");
  await page.keyboard.press("Escape");
  await expect(bar).toHaveCount(0);
});

test("regenerate and edit keep switchable versions", async ({ page }) => {
  await fresh(page);
  await send(page, "原始问题");
  await page.getByRole("button", { name: "重新生成" }).click();
  const nav = page.locator(".message--assistant .cx-version");
  await expect(nav).toContainText("2 / 2");
  await nav.getByRole("button", { name: "上一个版本" }).click();
  await expect(nav).toContainText("1 / 2");
  await page.locator(".message--user").hover();
  await page.getByRole("button", { name: "编辑消息" }).click();
  await page.getByRole("textbox", { name: "编辑消息" }).fill("修改后的问题");
  await page.keyboard.press("Enter");
  await expect(page.locator(".user-bubble")).toHaveText("修改后的问题");
  const userNav = page.locator(".message--user .cx-version");
  await page.locator(".message--user").hover();
  await userNav.getByRole("button", { name: "上一个版本" }).click();
  await expect(page.locator(".user-bubble")).toHaveText("原始问题");
  await expect(page.locator(".message--assistant .cx-version")).toContainText("1 / 2");
});

test("accent colour and interface font apply instantly", async ({ page }) => {
  await fresh(page);
  await page.keyboard.press("Control+,");
  await page.locator(".sc-nav").getByRole("button", { name: "外观与背景", exact: true }).click();
  await page.getByRole("radio", { name: "紫罗兰" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-accent", "violet");
  await page.getByRole("button", { name: "衬线阅读体" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-font-family", "serif");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-accent", "violet");
});

test("canvas opens beside the chat with live markdown preview and download", async ({ page }) => {
  await fresh(page);
  await page.getByRole("button", { name: "添加附件与模式" }).click();
  await page.getByRole("menuitem", { name: /新建画布/ }).click();
  const canvas = page.getByRole("complementary", { name: "画布" });
  await expect(canvas).toBeVisible();
  await canvas.getByRole("tab", { name: "代码" }).click();
  await canvas.getByRole("textbox", { name: "画布内容" }).fill("# 标题\n\n正文 **加粗**");
  await canvas.getByRole("tab", { name: "预览" }).click();
  await expect(canvas.locator(".cv-doc h1")).toHaveText("标题");
  // headless Chromium drops non-ASCII download names, so read the anchor's filename directly
  await page.evaluate(() => { const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { (window as unknown as { lastDownload: string }).lastDownload = this.download; return click.call(this); }; });
  const download = page.waitForEvent("download");
  await canvas.getByRole("button", { name: "下载" }).click();
  await download;
  expect(await page.evaluate(() => (window as unknown as { lastDownload: string }).lastDownload)).toMatch(/画布\.md$/);
  await canvas.getByRole("button", { name: "关闭画布" }).click();
  await expect(page.locator(".cx-share").filter({ hasText: "画布" })).toBeVisible();
});

test("remember a message, see it in settings, undo it", async ({ page }) => {
  await fresh(page);
  await send(page, "我喜欢简洁的回答");
  await page.locator(".message--user").hover();
  await page.getByRole("button", { name: "记住这条信息" }).click();
  await expect(page.locator(".cx-memory-chip")).toContainText("已记住");
  await page.keyboard.press("Control+,");
  await page.locator(".sc-nav").getByRole("button", { name: "自定义指令", exact: true }).click();
  await expect(page.locator(".mm-item")).toContainText("我喜欢简洁的回答");
  await page.locator('button[aria-label="关闭设置"]:visible').click();
  await page.locator(".cx-memory-chip").getByRole("button", { name: "撤销" }).click();
  await expect(page.locator(".cx-memory-chip")).toHaveCount(0);
});

test("image mode explains the missing server switch instead of failing silently", async ({ page }) => {
  await fresh(page);
  await page.getByRole("button", { name: "添加附件与模式" }).click();
  await page.getByRole("menuitemradio", { name: /生成图片/ }).click();
  await page.getByRole("textbox", { name: "向 Ciro 发送消息" }).fill("一只猫");
  await page.keyboard.press("Enter");
  await expect(page.locator(".message--assistant")).toContainText("CIRO_IMAGES=on");
});

test("team page explains setup and project export/import round-trips", async ({ page }) => {
  await fresh(page);
  await page.getByRole("button", { name: "新建项目" }).first().click();
  await page.getByRole("textbox", { name: "项目名称" }).fill("共享项目");
  await page.keyboard.press("Enter");
  await page.getByRole("textbox", { name: "项目指令" }).fill("团队约定");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出项目" }).click();
  const file = await (await download).path();
  await go(page, "团队");
  await expect(page.getByText("团队服务尚未接入")).toBeVisible();
  await page.locator(".tm-share input[type=file]").setInputFiles(file!);
  await expect(page.locator(".cx-project-row").filter({ hasText: "共享项目" })).toHaveCount(2);
  await expect(page.getByRole("textbox", { name: "项目指令" })).toHaveValue("团队约定");
});

test("voice mode opens full screen and closes with Escape; Alt+arrows switch chats", async ({ page }) => {
  await fresh(page);
  await send(page, "第一条");
  await page.getByRole("button", { name: "新对话", exact: true }).click();
  await send(page, "第二条");
  await page.keyboard.press("Alt+ArrowDown");
  await expect(page.locator(".user-bubble")).toHaveText("第一条");
  await page.keyboard.press("Alt+ArrowUp");
  await expect(page.locator(".user-bubble")).toHaveText("第二条");
  await page.getByRole("button", { name: "语音对话" }).click();
  await expect(page.getByRole("dialog", { name: "语音对话" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "语音对话" })).toHaveCount(0);
});
