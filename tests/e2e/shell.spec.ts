import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { go, setLanguage } from "./helpers";

const imageDir = "artifacts/ui-screenshots";
mkdirSync(imageDir, { recursive: true });

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

test("profile menu switches language and theme, and they persist", async ({ page }) => {
  await fresh(page);
  await page.getByRole("button", { name: "打开账户菜单" }).click();
  await expect(page.getByRole("menu", { name: "账户菜单" })).toBeVisible();
  await page.screenshot({ path: imageDir + "/40-profile-menu.png", animations: "disabled" });
  await page.getByRole("menuitem", { name: /主题/ }).click();
  await page.getByRole("menuitemradio", { name: "深色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.keyboard.press("Escape");
  await setLanguage(page, "en");
  await expect(page.getByRole("button", { name: "New chat", exact: true })).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await setLanguage(page, "zh");
});

test("profile menu opens settings sections and workspace pages", async ({ page }) => {
  await fresh(page);
  await go(page, "键盘快捷键");
  await expect(page.getByRole("heading", { name: "快捷键", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "完成" }).click();
  await page.keyboard.press("Control+,");
  await expect(page.getByRole("heading", { name: "通用设置" })).toBeVisible();
  await page.getByRole("textbox", { name: "你的名字" }).fill("林雨");
  await page.getByRole("button", { name: "完成" }).click();
  await expect(page.locator(".um-trigger")).toContainText("林雨");
  await expect(page.locator(".cx-greeting")).toContainText("林雨");
  await go(page, "跨设备同步");
  await expect(page.locator(".acc-workspace")).toBeVisible();
});

test("thinking depth slider moves by click, drag keys and persists", async ({ page }) => {
  await fresh(page);
  const chip = page.getByRole("button", { name: /思考深度/ });
  await expect(chip).toContainText("均衡");
  await chip.click();
  const slider = page.getByRole("slider", { name: "思考深度" });
  await expect(slider).toHaveAttribute("aria-valuenow", "2");
  await page.locator(".td-label").filter({ hasText: "极致" }).click();
  await expect(slider).toHaveAttribute("aria-valuenow", "4");
  await expect(page.locator(".td-hint")).toContainText("30 分钟");
  await slider.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(slider).toHaveAttribute("aria-valuetext", "深入");
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.26, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(slider).toHaveAttribute("aria-valuenow", "1");
  await page.screenshot({ path: imageDir + "/41-thinking-depth.png", animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(chip).toContainText("轻度");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: /思考深度/ })).toContainText("轻度");
});

test("search palette finds chats by content and runs commands", async ({ page }) => {
  await fresh(page);
  await send(page, "量子纠缠的直观解释");
  await page.keyboard.press("Control+Shift+O");
  await expect(page.getByRole("heading", { name: /让每一个想法/ })).toBeVisible();
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "搜索对话" });
  await dialog.getByRole("textbox").fill("纠缠");
  await expect(dialog.locator(".sp-item")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page.locator(".user-bubble").filter({ hasText: "量子纠缠" })).toBeVisible();
  await page.keyboard.press("Control+k");
  await page.getByRole("dialog", { name: "搜索对话" }).getByRole("textbox").fill("插件");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "发现插件" })).toBeVisible();
});

test("conversation rows support inline rename, pin, edit-and-resend and branch", async ({ page }) => {
  await fresh(page);
  await send(page, "第一条问题");
  const row = page.locator(".cx-row").filter({ hasText: "第一条问题" });
  await row.getByRole("button", { name: /管理对话/ }).click();
  await page.getByRole("menuitem", { name: "重命名" }).click();
  await page.getByRole("textbox", { name: "重命名对话" }).fill("改名后的对话");
  await page.keyboard.press("Enter");
  const renamed = page.locator(".cx-row").filter({ hasText: "改名后的对话" });
  await renamed.getByRole("button", { name: /管理对话/ }).click();
  await page.getByRole("menuitem", { name: "置顶" }).click();
  await expect(page.locator(".cx-group").filter({ hasText: "已置顶" })).toContainText("改名后的对话");
  await page.locator(".message--user").hover();
  await page.getByRole("button", { name: "编辑消息" }).click();
  await page.getByRole("textbox", { name: "编辑消息" }).fill("修改后的问题");
  await page.keyboard.press("Enter");
  await expect(page.locator(".user-bubble")).toHaveText(["修改后的问题"]);
  await page.getByRole("button", { name: "从这里创建分支" }).click();
  await expect(page.locator(".cx-row").filter({ hasText: "分支" })).toBeVisible();
});

test("projects group chats, keep instructions and send context with new chats", async ({ page }) => {
  await fresh(page);
  await page.getByRole("button", { name: "新建项目" }).first().click();
  await page.getByRole("textbox", { name: "项目名称" }).fill("毕业论文");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "毕业论文" })).toBeVisible();
  await page.getByRole("textbox", { name: "项目指令" }).fill("回答使用学术语气");
  await send(page, "帮我列论文大纲");
  await expect(page.locator(".cx-crumb")).toContainText("毕业论文");
  await page.locator(".cx-crumb").click();
  await expect(page.locator(".pv-chat")).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "项目指令" })).toHaveValue("回答使用学术语气");
  await page.screenshot({ path: imageDir + "/42-project.png", animations: "disabled" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".cx-project-row").filter({ hasText: "毕业论文" }).click();
  await expect(page.locator(".pv-chat")).toHaveCount(1);
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "删除项目" }).click();
  await expect(page.locator(".cx-project-row")).toHaveCount(0);
  await expect(page.locator(".cx-row").filter({ hasText: "帮我列论文大纲" })).toBeVisible();
});

test("temporary chats never reach history or storage", async ({ page }) => {
  await fresh(page);
  await page.getByRole("button", { name: "临时对话" }).click();
  await expect(page.getByRole("heading", { name: "临时对话" })).toBeVisible();
  await send(page, "不要保存这句话");
  await expect(page.locator(".cx-row").filter({ hasText: "不要保存这句话" })).toHaveCount(0);
  const stored = await page.evaluate(() => localStorage.getItem("ciro.chats.v1") || "");
  expect(stored).not.toContain("不要保存这句话");
  await page.getByRole("button", { name: "新对话", exact: true }).click();
  await page.keyboard.press("Control+k");
  await page.getByRole("dialog", { name: "搜索对话" }).getByRole("textbox").fill("不要保存");
  await expect(page.locator(".sp-empty")).toBeVisible();
});

test("slash menu, plus menu and attachments work from the composer", async ({ page }) => {
  await fresh(page);
  await page.getByRole("textbox", { name: "向 Ciro 发送消息" }).fill("/pl");
  await expect(page.getByRole("listbox", { name: "斜杠命令" })).toContainText("/plan");
  await page.getByRole("option").filter({ hasText: "/plugins" }).click();
  await expect(page.getByRole("heading", { name: "发现插件" })).toBeVisible();
  await page.getByRole("button", { name: "新对话", exact: true }).click();
  await page.getByRole("button", { name: "添加附件与模式" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: /添加附件/ }).click();
  await (await chooser).setFiles({ name: "notes.md", mimeType: "text/markdown", buffer: Buffer.from("# hello") });
  await expect(page.locator(".attachment-chip")).toContainText("notes.md");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.locator(".cx-msg-file")).toContainText("notes.md");
  await expect(page.locator(".user-bubble")).not.toContainText("```");
});

test("collapsed sidebar rail and mobile layout keep every control reachable", async ({ page }) => {
  await fresh(page);
  await page.getByRole("button", { name: "折叠侧栏" }).click();
  await expect(page.locator(".cx-sidebar--collapsed")).toBeVisible();
  await page.screenshot({ path: imageDir + "/43-collapsed.png", animations: "disabled" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".cx-sidebar--collapsed")).toBeVisible();
  await page.locator(".cx-topbar").getByRole("button", { name: "展开侧栏" }).click();
  await expect(page.locator(".cx-sidebar--collapsed")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "打开侧栏" }).click();
  await page.getByRole("button", { name: "打开账户菜单" }).click();
  await expect(page.getByRole("menu", { name: "账户菜单" })).toBeInViewport();
  const width = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  expect(width.doc).toBeLessThanOrEqual(width.win + 1);
});
