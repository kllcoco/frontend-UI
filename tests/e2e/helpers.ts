import { expect, type Page } from "@playwright/test";

const EN: Record<string, string> = {
  "融合工作台": "Unified Studio", "协作空间": "Collaboration Space", "插件中心": "Plugins", "代码工作区": "Code workspace",
  "研究工作台": "Research workspace", "知识与文件": "Knowledge & files", "官方应用": "Official apps", "技能中心": "Skills",
  "账户与安全": "Account & security", "跨设备同步": "Device sync", "账单与用量": "Billing & usage", "设置": "Settings",
  "通知中心": "Notifications", "键盘快捷键": "Keyboard shortcuts"
};
const PRIMARY = ["融合工作台", "协作空间", "插件中心", "Unified Studio", "Collaboration Space", "Plugins"];
const MORE = ["代码工作区", "研究工作台", "知识与文件", "官方应用", "技能中心", "Code workspace", "Research workspace", "Knowledge & files", "Official apps", "Skills"];

/** Navigate through the redesigned shell: sidebar, "More tools" drawer, or the profile menu. */
export async function go(page: Page, requested: string) {
  const english = (await page.locator("html").getAttribute("lang")) === "en";
  const label = english ? (EN[requested] ?? requested) : requested;
  const sidebar = page.locator(".cx-sidebar");
  if (PRIMARY.includes(label)) {
    await sidebar.locator(".cx-nav").getByRole("button", { name: label, exact: true }).click();
    return;
  }
  if (MORE.includes(label)) {
    const toggle = sidebar.locator(".cx-more-toggle");
    if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
    await sidebar.locator(".cx-more").getByRole("button", { name: label, exact: true }).click();
    return;
  }
  await sidebar.locator(".um-trigger").click();
  await page.getByRole("menuitem", { name: label }).first().click();
}

async function revealSidebar(page: Page): Promise<boolean> {
  const box = await page.locator(".cx-sidebar").boundingBox();
  if (box && box.x >= 0) return false;
  await page.locator(".cx-mobile-menu, .wb-mobile-top button").first().click();
  await page.waitForTimeout(350);
  return true;
}

export async function setLanguage(page: Page, language: "en" | "zh") {
  const opened = await revealSidebar(page);
  await page.locator(".cx-sidebar .um-trigger").click();
  await page.locator(".um-menu .um-sub-wrap").first().locator(".um-item").first().click();
  await page.getByRole("menuitemradio", { name: language === "en" ? "English" : "简体中文" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", language === "en" ? "en" : "zh-CN");
  await page.keyboard.press("Escape");
  if (opened) { const vw = page.viewportSize()?.width ?? 390; await page.mouse.click(vw - 6, 300); await page.waitForTimeout(300); }
}
