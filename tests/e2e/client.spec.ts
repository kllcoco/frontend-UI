import { test, expect, type Locator } from "@playwright/test";
import { mkdirSync } from "node:fs";

const imageDir = "artifacts/ui-screenshots";
mkdirSync(imageDir, { recursive: true });

async function waitForPreview(page: import("@playwright/test").Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("当前为客户端预览，尚未连接真实 CIRO 推理服务")).toBeVisible();
}
async function setRange(locator: Locator, value: number) {
  await locator.evaluate((node, v) => {
    const input = node as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Native range setter unavailable");
    setter.call(input, String(v));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function openSettings(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

test("desktop welcome UI uses the approved moon logo and dark theme", async ({ page }) => {
  await waitForPreview(page);
  await expect(page).toHaveTitle(/Ciro/);
  await expect(page.getByRole("heading", { name: /让每一个想法/ })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".wallpaper-image")).toHaveCSS("background-image", /night-lake\.svg/);
  await expect(page.locator(".suggestion-card")).toHaveCount(4);
  await page.screenshot({ path: imageDir + "/01-welcome-desktop.png", fullPage: true, animations: "disabled" });
});

test("appearance panel changes wallpaper and persists settings on reload", async ({ page }) => {
  await waitForPreview(page);
  await openSettings(page);
  await expect(page.getByRole("heading", { name: "外观与背景" })).toBeVisible();
  await page.screenshot({ path: imageDir + "/02-settings-appearance.png", fullPage: true, animations: "disabled" });

  await page.getByRole("button", { name: "北境极光" }).click();
  const sliders = page.locator(".sc-slider-row input[type=range]");
  await setRange(sliders.nth(0), 65);
  await setRange(sliders.nth(1), 7);
  await setRange(sliders.nth(2), 50);
  await page.getByRole("button", { name: "仅欢迎页面" }).click();
  await page.getByRole("button", { name: "完成" }).click();

  await expect(page.locator(".wallpaper-image")).toHaveCSS("background-image", /aurora\.svg/);
  await page.reload({ waitUntil: "domcontentloaded" });
  await openSettings(page);
  await expect(page.getByRole("button", { name: "北境极光" })).toHaveAttribute("aria-pressed", "true");
  await expect(sliders.nth(0)).toHaveValue("65");
  await expect(sliders.nth(1)).toHaveValue("7");
  await expect(sliders.nth(2)).toHaveValue("50");
  await page.screenshot({ path: imageDir + "/03-settings-diy-controls.png", fullPage: true, animations: "disabled" });
});

test("personal wallpaper is stored in IndexedDB and survives reload", async ({ page }) => {
  await waitForPreview(page);
  await openSettings(page);
  const file = page.locator(".sc-wallpaper-grid input[type=file]");
  await file.setInputFiles({
    name: "mine.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/+qkAAAAASUVORK5CYII=", "base64")
  });
  await expect(page.getByText("我的背景")).toBeVisible();
  await expect(page.getByText("上传中…")).toHaveCount(0);
  await page.reload({ waitUntil: "domcontentloaded" });
  await openSettings(page);
  await expect(page.getByText("我的背景")).toBeVisible();
  await expect(page.locator(".sc-wallpaper-tile--active .sc-wallpaper-title")).toHaveText("我的背景");
  await page.screenshot({ path: imageDir + "/04-settings-custom-wallpaper.png", fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "删除自定义背景" }).click();
  await expect(page.getByText("我的背景")).toHaveCount(0);
});

test("chat preview explicitly avoids impersonating a real CIRO model response", async ({ page }) => {
  await waitForPreview(page);
  await page.getByRole("textbox", { name: "向 Ciro 发送消息" }).fill("介绍一下 CIRO");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.getByText(/这.*界面预览，并非模型回答/)).toBeVisible();
  await expect(page.getByText("介绍一下 CIRO")).toBeVisible();
  await page.screenshot({ path: imageDir + "/05-chat-preview.png", fullPage: true, animations: "disabled" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("介绍一下 CIRO")).toBeVisible();
  await expect(page.getByText(/界面预览，并非模型回答/)).toBeVisible();
});

test("settings categories and model list display without fabricated capabilities", async ({ page }) => {
  await waitForPreview(page);
  await openSettings(page);
  for (const name of [
    "通用设置", "外观与背景", "模型设置", "对话设置",
    "文件与存储", "快捷键", "隐私与安全", "关于 Ciro"
  ]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "模型设置", exact: true }).click();
  await expect(page.getByText("等待 CIRO 推理服务接入")).toBeVisible();
  await page.screenshot({ path: imageDir + "/06-settings-models.png", fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "通用设置", exact: true }).click();
  await page.screenshot({ path: imageDir + "/07-settings-general.png", fullPage: true, animations: "disabled" });
});

test("mobile navigation and settings stay inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await waitForPreview(page);
  await expect(page.getByRole("button", { name: "打开侧栏" })).toBeVisible();
  await page.screenshot({ path: imageDir + "/08-mobile-welcome.png", fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "打开侧栏" }).click();
  await page.getByRole("button", { name: "设置与连接", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "外观与背景" })).toBeVisible();
  await page.screenshot({ path: imageDir + "/09-mobile-settings.png", fullPage: true, animations: "disabled" });
  const width = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  expect(width.doc).toBeLessThanOrEqual(width.win + 1);
});
