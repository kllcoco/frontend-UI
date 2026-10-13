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

test("prompt library seeds, saves the draft, inserts and deletes prompts", async ({ page }) => {
  await fresh(page);
  await page.getByRole("textbox", { name: "向 Ciro 发送消息" }).fill("帮我写周报");
  await page.getByRole("button", { name: "添加附件与模式" }).click();
  await page.getByRole("menuitem", { name: /提示词库/ }).click();
  const dialog = page.getByRole("dialog", { name: "提示词库" });
  await expect(dialog.locator(".pl-item")).toHaveCount(4);
  await dialog.getByRole("button", { name: "保存当前输入" }).click();
  await dialog.getByRole("textbox", { name: "标题" }).fill("周报模板");
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(dialog.locator(".pl-item")).toHaveCount(5);
  await dialog.getByRole("textbox", { name: "搜索提示词" }).fill("翻译");
  await dialog.locator(".pl-use").first().click();
  await expect(page.getByRole("textbox", { name: "向 Ciro 发送消息" })).toHaveValue(/帮我写周报[\s\S]*英文/);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.keyboard.press("Control+k");
  await page.getByRole("dialog", { name: "搜索对话" }).getByRole("textbox").fill("提示词");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "提示词库" }).locator(".pl-item").filter({ hasText: "周报模板" })).toBeVisible();
});

test("archive hides chats, the manager restores, exports and bulk-deletes, and JSON import merges", async ({ page }) => {
  await fresh(page);
  await send(page, "第一条对话");
  await page.getByRole("button", { name: "新对话", exact: true }).click();
  await send(page, "第二条对话");
  const row = page.locator(".cx-row").filter({ hasText: "第一条对话" });
  await row.getByRole("button", { name: /管理对话/ }).click();
  await page.getByRole("menuitem", { name: "归档" }).click();
  await expect(page.locator(".cx-history .cx-row").filter({ hasText: "第一条对话" })).toHaveCount(0);
  await page.keyboard.press("Control+,");
  await page.locator(".sc-nav").getByRole("button", { name: "文件与存储", exact: true }).click();
  await page.locator(".cm-filter").getByRole("button", { name: "已归档" }).click();
  await page.locator(".cm-row").filter({ hasText: "第一条对话" }).locator("input").check();
  await page.getByRole("button", { name: "取消归档" }).click();
  await page.locator(".cm-filter").getByRole("button", { name: "全部" }).click();
  await expect(page.locator(".cm-row")).toHaveCount(2);
  await page.getByRole("checkbox", { name: "全选" }).check();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出所选" }).click();
  const file = await (await download).path();
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "删除所选" }).click();
  await expect(page.locator(".cm-row")).toHaveCount(0);
  await page.locator(".cm-root input[type=file]").setInputFiles(file!);
  await expect(page.locator(".cm-row")).toHaveCount(2);
  await page.locator(".cm-root input[type=file]").setInputFiles(file!);
  await expect(page.locator(".cm-row")).toHaveCount(2);
  await page.getByRole("button", { name: "完成" }).click();
  await expect(page.locator(".cx-history .cx-row")).toHaveCount(2);
});

test("share links create a public read-only page and can be revoked", async ({ page, browser }) => {
  await fresh(page);
  await send(page, "分享这条对话");
  await page.getByRole("button", { name: "分享对话" }).click();
  await page.getByRole("button", { name: "创建分享链接" }).click();
  const link = await page.getByRole("textbox", { name: "分享链接" }).inputValue();
  expect(link).toMatch(/\/share\/[A-Za-z0-9_-]{16,40}$/);
  const other = await browser.newPage();
  await other.goto(link);
  await expect(other.locator(".shv-title")).toHaveText("分享这条对话");
  await expect(other.locator(".user-bubble")).toHaveText("分享这条对话");
  await page.getByRole("button", { name: "停止分享" }).click();
  await other.reload();
  await expect(other.getByRole("heading", { name: "分享链接不存在或已停止分享" })).toBeVisible();
  await other.close();
});

test("image attachments show thumbnails, open in a viewer and persist after reload", async ({ page }) => {
  await fresh(page);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAJUlEQVR42mNgGAWjYBSMglEwCkbBKBgFgx8wMjL+Z2BgYGBgAAAhPwE/gXy9AAAAAElFTkSuQmCC", "base64");
  await page.getByRole("button", { name: "添加附件与模式" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: /添加附件/ }).click();
  await (await chooser).setFiles({ name: "pic.png", mimeType: "image/png", buffer: png });
  await expect(page.locator(".attachment-chip--image img")).toBeVisible();
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.locator(".cx-msg-images img")).toHaveCount(1);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /查看图片/ }).click();
  await expect(page.getByRole("dialog", { name: "查看图片" }).locator("img")).toBeVisible();
  await page.getByRole("dialog", { name: "查看图片" }).click();
  await expect(page.getByRole("dialog", { name: "查看图片" })).toHaveCount(0);
});

test("chat settings expose notifications and auto titles; web-search chip explains when unavailable", async ({ page }) => {
  await fresh(page);
  await page.getByRole("button", { name: "联网搜索" }).click();
  await expect(page.getByRole("status")).toContainText("连接推理服务后可使用联网搜索");
  await go(page, "设置");
  await page.locator(".sc-nav").getByRole("button", { name: "对话设置", exact: true }).click();
  await expect(page.getByRole("switch", { name: "自动生成对话标题" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("switch", { name: "回答完成时通知" })).toBeVisible();
});

test("reply notifications: browser permission and a clear reason when blocked", async ({ page }) => {
  const openChat = async () => {
    await go(page, "设置");
    await page.locator(".sc-nav").getByRole("button", { name: "对话设置", exact: true }).click();
    return page.getByRole("switch", { name: "回答完成时通知" });
  };
  // Browser: granted permission turns it on. (Headless Chromium has no real notification service, so the
  // permission prompt is answered by a stand-in that behaves like a browser where the user clicks "Allow".)
  await page.addInitScript(() => {
    if (sessionStorage.getItem("deny")) return;
    let state: NotificationPermission = "default";
    Object.defineProperty(Notification, "permission", { configurable: true, get: () => state });
    Notification.requestPermission = (() => { state = "granted"; return Promise.resolve(state); }) as typeof Notification.requestPermission;
  });
  await fresh(page);
  let toggle = await openChat();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  // Browser: denied permission explains how to allow it instead of silently doing nothing.
  await page.evaluate(() => sessionStorage.setItem("deny", "1"));
  await page.addInitScript(() => Object.defineProperty(Notification, "permission", { configurable: true, get: () => "denied" }));
  await page.reload({ waitUntil: "domcontentloaded" });
  toggle = await openChat();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("alert")).toContainText("通知权限已被拒绝");
});

test("back handler closes layers before leaving the conversation", async ({ page }) => {
  await fresh(page);
  await send(page, "返回键测试");
  await page.keyboard.press("Control+k");
  expect(await page.evaluate(() => (window as unknown as { ciroHandleBack: () => boolean }).ciroHandleBack())).toBe(true);
  await expect(page.getByRole("dialog", { name: "搜索对话" })).toHaveCount(0);
  await expect(page.locator(".user-bubble")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { ciroHandleBack: () => boolean }).ciroHandleBack())).toBe(true);
  await expect(page.getByRole("heading", { name: /让每一个想法/ })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { ciroHandleBack: () => boolean }).ciroHandleBack())).toBe(false);
});
