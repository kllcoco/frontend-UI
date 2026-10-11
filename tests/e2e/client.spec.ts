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
  await page.getByRole("button", { name: /^(设置|Settings)$/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

test("default first visit is Chinese with white background and the approved moon logo", async ({ page }) => {
  await waitForPreview(page);
  await expect(page).toHaveTitle(/Ciro/);
  await expect(page.getByRole("heading", { name: /让每一个想法/ })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.locator(".workspace")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.locator(".wallpaper-image")).toHaveCount(0);
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
  await page.locator(".sc-scroll").evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(page.getByRole("button", { name: "恢复默认外观" })).toBeVisible();
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
  await expect(page.locator(".user-bubble").filter({ hasText: "介绍一下 CIRO" })).toBeVisible();
  await page.screenshot({ path: imageDir + "/05-chat-preview.png", fullPage: true, animations: "disabled" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".user-bubble").filter({ hasText: "介绍一下 CIRO" })).toBeVisible();
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

test("remaining settings pages render and the visible toggles work", async ({ page }) => {
  await waitForPreview(page);
  await openSettings(page);

  await page.getByRole("button", { name: "对话设置", exact: true }).click();
  await expect(page.getByRole("heading", { name: "对话设置" })).toBeVisible();
  const density = page.getByRole("switch", { name: "紧凑显示" });
  await expect(density).toHaveAttribute("aria-checked", "false");
  await density.click();
  await expect(density).toHaveAttribute("aria-checked", "true");
  await page.screenshot({ path: imageDir + "/10-settings-chat.png", fullPage: true, animations: "disabled" });

  await page.getByRole("button", { name: "文件与存储", exact: true }).click();
  await expect(page.getByText("本地数据")).toBeVisible();
  await expect(page.getByRole("button", { name: "导出全部对话 JSON" })).toBeDisabled();
  await page.screenshot({ path: imageDir + "/11-settings-storage.png", fullPage: true, animations: "disabled" });

  await page.getByRole("button", { name: "快捷键", exact: true }).click();
  await expect(page.locator(".sc-shortcut").filter({ hasText: "搜索历史" })).toBeVisible();
  await page.screenshot({ path: imageDir + "/12-settings-shortcuts.png", fullPage: true, animations: "disabled" });

  await page.getByRole("button", { name: "隐私与安全", exact: true }).click();
  await expect(page.getByText("模型密钥保留在服务端")).toBeVisible();
  await page.screenshot({ path: imageDir + "/13-settings-privacy.png", fullPage: true, animations: "disabled" });

  await page.getByRole("button", { name: "关于 Ciro", exact: true }).click();
  await expect(page.getByText("CIRO CLIENT · PREVIEW v0.2")).toBeVisible();
  await page.screenshot({ path: imageDir + "/14-settings-about.png", fullPage: true, animations: "disabled" });
});

test("English interface is complete, persists across reloads, and returns to Chinese", async ({ page }) => {
  await waitForPreview(page);
  await expect(page.getByRole("heading", { name: /让每一个想法/ })).toBeVisible();
  await openSettings(page);
  await page.getByRole("button", { name: "通用设置", exact: true }).click();
  await expect(page.getByRole("button", { name: "简体中文" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "General" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Appearance & background" })).toBeVisible();
  await expect(page.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: imageDir + "/15-settings-english.png", fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("heading", { name: /Let every idea/ })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message Ciro" })).toBeVisible();
  await expect(page.getByText("Client preview: CIRO inference is not connected")).toBeVisible();
  await page.screenshot({ path: imageDir + "/16-welcome-english.png", fullPage: true, animations: "disabled" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: /Let every idea/ })).toBeVisible();
  await openSettings(page);
  await page.getByRole("button", { name: "General", exact: true }).click();
  await page.getByRole("button", { name: "简体中文" }).click();
  await expect(page.getByRole("heading", { name: "通用设置" })).toBeVisible();
  await page.getByRole("button", { name: "完成" }).click();
  await expect(page.getByRole("heading", { name: /让每一个想法/ })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
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
  const mobileStatus = await page.locator(".connection-label").evaluate((element) => ({
    width: element.clientWidth,
    fontSize: getComputedStyle(element).fontSize
  }));
  expect(mobileStatus.width).toBeLessThanOrEqual(30);
  expect(mobileStatus.fontSize).toBe("0px");
  const width = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  expect(width.doc).toBeLessThanOrEqual(width.win + 1);
});
