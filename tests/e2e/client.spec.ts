import { go, setLanguage } from "./helpers";
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

test("default first visit is Chinese with the ivory theme and orbit logo", async ({ page }) => {
  await waitForPreview(page);
  await expect(page).toHaveTitle(/Ciro/);
  await expect(page.getByRole("heading", { name: /让每一个想法/ })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.locator(".workspace")).toHaveCSS("background-color", "rgb(250, 249, 246)");
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
  await expect(page.getByText("CIRO CLIENT · v0.9.3")).toBeVisible();
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
  await setLanguage(page, "en");
  await setLanguage(page, "zh");
});

test("mobile navigation and settings stay inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await waitForPreview(page);
  await expect(page.getByRole("button", { name: "打开侧栏" })).toBeVisible();
  await page.screenshot({ path: imageDir + "/08-mobile-welcome.png", fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "打开侧栏" }).click();
  await go(page, "设置");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "通用设置" })).toBeVisible();
  await page.screenshot({ path: imageDir + "/09-mobile-settings.png", fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "完成" }).click();
  await expect(page.locator(".connection-text")).toBeHidden();
  const mobileStatus = await page.locator(".connection-label").evaluate((element) => element.clientWidth);
  expect(mobileStatus).toBeLessThanOrEqual(32);
  const width = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  expect(width.doc).toBeLessThanOrEqual(width.win + 1);
});


test("workbench is accessible and unmet runtime requirements stay explicit", async ({page}) => {
  await waitForPreview(page);
  await go(page,"协作空间");
  await expect(page.getByRole("heading",{name:"自主协作工作台"})).toBeVisible();
  await expect(page.getByText("执行引擎未连接").first()).toBeVisible();
  await expect(page.getByText("独立验证器未连接").first()).toBeVisible();
  await page.screenshot({path:imageDir+"/17-workbench-goals.png",fullPage:true,animations:"disabled"});
  await page.getByRole("textbox",{name:"详细目标与验收标准"}).fill("搭建网站，并跑独立红队反证");
  await page.getByRole("button",{name:"创建目标"}).click();
  await expect(page.getByText("等待执行器").first()).toBeVisible();
  await expect(page.getByText("搭建网站，并跑独立红队反证").first()).toBeVisible();
});

test("four sandbox permission modes require scoped consent", async ({page})=>{
  await waitForPreview(page);
  await go(page,"协作空间");
  await page.getByRole("button",{name:"权限与沙盒"}).click();
  await page.getByRole("button",{name:/完全访问/}).click();
  const save=page.getByRole("button",{name:"保存权限"});
  await expect(save).toBeDisabled();
  await page.getByRole("checkbox",{name:/我理解完全访问仅限已授权范围/}).check();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText("权限已保存")).toBeVisible();
  await page.getByRole("button",{name:/自定义权限/}).click();
  await expect(page.getByRole("checkbox",{name:"写入 GitHub 分支"})).toBeVisible();
  await page.screenshot({path:imageDir+"/18-workbench-permissions.png",fullPage:true,animations:"disabled"});
});

test("scheduled tasks and manually installed marketplace render without fake plugin readiness", async ({page},testInfo)=>{
  await waitForPreview(page);
  await go(page,"协作空间");
  await page.getByRole("button",{name:"定时任务"}).click();
  // Retry-safe: a previous attempt may already have persisted another schedule.
  const name="Hourly report - attempt "+testInfo.retry+" - "+Date.now();
  await page.getByRole("textbox",{name:"计划名称"}).fill(name);
  await page.getByRole("textbox",{name:"计划目标"}).fill("Summarize development progress");
  await page.getByRole("combobox",{name:"运行频率"}).selectOption("hourly");
  await page.getByRole("button",{name:"添加任务"}).click();
  const card=page.locator(".wb-schedule").filter({hasText:name});
  await expect(card.getByText(name)).toBeVisible();
  await page.screenshot({path:imageDir+"/19-workbench-schedules.png",fullPage:true,animations:"disabled"});
  await card.getByRole("button",{name:"暂停计划"}).click();
  await expect(card.getByRole("button",{name:"启用计划"})).toBeVisible();
  // A separate sidebar shortcut intentionally shares this label.
  await page.getByRole("navigation",{name:"自主协作工作台"})
    .getByRole("button",{name:"插件中心"}).click();
  await expect(page.getByRole("heading",{name:"发现插件"})).toBeVisible();
  await expect(page.getByRole("heading",{name:"我的插件"})).toBeVisible();
  await expect(page.getByRole("button",{name:"安装插件"})).toBeVisible();
  await expect(page.getByText("即将开放").first()).toBeVisible();
  await page.screenshot({path:imageDir+"/20-workbench-plugins.png",fullPage:true,animations:"disabled"});
});

test("GitHub settings require server authorization rather than browser tokens", async ({page})=>{
  await waitForPreview(page);
  await go(page,"协作空间");
  await page.getByRole("button",{name:"GitHub 仓库"}).click();
  await expect(page.getByText("服务端未配置 GitHub 凭据")).toBeVisible();
  await expect(page.getByText("CIRO_GITHUB_TOKEN / CIRO_GITHUB_REPOS")).toBeVisible();
  await expect(page.getByRole("button",{name:"验证并连接"})).toBeDisabled();
  await page.screenshot({path:imageDir+"/21-workbench-github.png",fullPage:true,animations:"disabled"});
  await go(page,"设置");
  await page.getByRole("button",{name:"GitHub 连接",exact:true}).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator(".sc-scroll .wb-block-title").getByText("GitHub 集成")).toBeVisible();
});

test("plan composer sends a plan job to the workbench", async ({page})=>{
  await waitForPreview(page);
  await page.getByRole("button",{name:"添加附件与模式"}).click();
  await page.getByRole("menuitemradio",{name:/计划模式/}).click();
  await expect(page.getByRole("button",{name:/退出 计划模式/})).toBeVisible();
  await page.getByRole("textbox",{name:"向 Ciro 发送消息"}).fill("设计一套模块化任务计划");
  await page.getByRole("button",{name:"发送消息"}).click();
  await expect(page.getByRole("heading",{name:"自主协作工作台"})).toBeVisible();
  await expect(page.getByText("设计一套模块化任务计划").first()).toBeVisible();
});

test("English multi-agent workbench remains translated and mobile width-safe", async ({page})=>{
  await page.setViewportSize({width:390,height:844});
  await waitForPreview(page);
  await setLanguage(page,"en");
  await page.getByRole("button",{name:"Open sidebar"}).click();
  await go(page,"协作空间");
  await expect(page.getByRole("heading",{name:"Autonomous Workbench"})).toBeVisible();
  await page.getByRole("button",{name:"Permissions & sandbox"}).click();
  await expect(page.getByRole("heading",{name:"Execution permissions"})).toBeVisible();
  await page.screenshot({path:imageDir+"/22-workbench-english-mobile.png",fullPage:true,animations:"disabled"});
  const width=await page.evaluate(()=>({doc:document.documentElement.scrollWidth,win:window.innerWidth}));
  expect(width.doc).toBeLessThanOrEqual(width.win+1);
});

test("custom instructions save in browser and can be enabled independently of agent permissions",async ({page})=>{
  await waitForPreview(page);
  await page.getByRole("button",{name:"设置",exact:true}).click();
  await page.getByRole("button",{name:"自定义指令",exact:true}).click();
  await expect(page.getByRole("heading",{name:"自定义指令",level:2})).toBeVisible();
  await page.getByRole("textbox",{name:"关于你"}).fill("CIRO developer");
  await page.getByRole("textbox",{name:"希望 Ciro 如何回答"}).fill("Lead with evidence");
  await page.getByRole("switch",{name:"启用自定义指令"}).click();
  await page.screenshot({path:imageDir+"/23-custom-instructions.png",fullPage:true,animations:"disabled"});
  await page.reload({waitUntil:"domcontentloaded"});
  await page.getByRole("button",{name:"设置",exact:true}).click();
  await page.getByRole("button",{name:"自定义指令",exact:true}).click();
  await expect(page.getByRole("textbox",{name:"关于你"})).toHaveValue("CIRO developer");
  await expect(page.getByRole("textbox",{name:"希望 Ciro 如何回答"})).toHaveValue("Lead with evidence");
  await expect(page.getByRole("switch",{name:"启用自定义指令"})).toHaveAttribute("aria-checked","true");
});


test("billing dashboard shows honest unconfigured usage and saves budget preferences", async ({page})=>{
  await waitForPreview(page);
  await go(page,"账单与用量");
  await expect(page.locator(".com-page-head").getByRole("heading",{name:"账单与用量"})).toBeVisible();
  await expect(page.getByText("暂无真实用量记录")).toBeVisible();
  await expect(page.getByText("无收费服务接入")).toBeVisible();
  await page.screenshot({path:imageDir+"/24-billing-usage.png",fullPage:true,animations:"disabled"});
  await page.getByRole("textbox",{name:"预算上限（USD）"}).fill("10.50");
  await page.getByRole("combobox",{name:"预警比例"}).selectOption("90");
  await page.getByRole("button",{name:"保存预算"}).click();
  await expect(page.getByText("预算已保存")).toBeVisible();
  await expect(page.locator(".com-budget-numbers")).toContainText("$10.50");
  await page.getByRole("button",{name:"发票管理"}).click();
  await expect(page.getByRole("heading",{name:"账单服务尚未接入"})).toBeVisible();
  await expect(page.getByRole("heading",{name:"支付方式"})).toBeVisible();
  await page.screenshot({path:imageDir+"/25-billing-invoices.png",fullPage:true,animations:"disabled"});
  await page.reload({waitUntil:"domcontentloaded"});
  await go(page,"账单与用量");
  await expect(page.locator(".com-budget-numbers")).toContainText("$10.50");
});

test("first-party application directory supports search, persistent pinning and real navigation",async ({page})=>{
  await waitForPreview(page);
  await go(page,"官方应用");
  await expect(page.locator(".com-page-head").getByRole("heading",{name:"官方应用"})).toBeVisible();
  await expect(page.locator(".com-app-card")).toHaveCount(8);
  await page.screenshot({path:imageDir+"/26-official-apps.png",fullPage:true,animations:"disabled"});
  await page.getByRole("button",{name:"收藏: Ciro GitHub"}).click();
  await expect(page.getByRole("button",{name:"取消收藏: Ciro GitHub"})).toBeVisible();
  await page.getByRole("textbox",{name:"搜索应用"}).fill("GitHub");
  await expect(page.locator(".com-app-card")).toHaveCount(1);
  await page.getByRole("textbox",{name:"搜索应用"}).fill("");
  await page.reload({waitUntil:"domcontentloaded"});
  await go(page,"官方应用");
  await expect(page.getByRole("button",{name:"取消收藏: Ciro GitHub"})).toBeVisible();
  await page.locator(".com-app-card").filter({hasText:"Ciro GitHub"}).getByRole("button",{name:/打开/}).click();
  await expect(page.getByRole("heading",{name:"GitHub 集成"})).toBeVisible();
});

test("skills catalog enables reviewed manifests without pretending a runner exists",async ({page})=>{
  await waitForPreview(page);
  await go(page,"技能中心");
  await expect(page.locator(".com-page-head").getByRole("heading",{name:"技能中心"})).toBeVisible();
  await expect(page.locator(".com-skill")).toHaveCount(7);
  await expect(page.getByText("技能尚不能执行").first()).toBeVisible();
  await page.screenshot({path:imageDir+"/27-skill-library.png",fullPage:true,animations:"disabled"});
  const review=page.locator(".com-skill").filter({hasText:"代码审查"});
  await review.getByRole("button",{name:"选择技能"}).click();
  await expect(review.getByRole("button",{name:"取消技能"})).toHaveAttribute("aria-pressed","true");
  await expect(review.getByText("已选择，等待执行器")).toBeVisible();
  await page.screenshot({path:imageDir+"/28-skill-enabled.png",fullPage:true,animations:"disabled"});
  await page.reload({waitUntil:"domcontentloaded"});
  await go(page,"技能中心");
  await expect(page.locator(".com-skill").filter({hasText:"代码审查"}).getByRole("button",{name:"取消技能"})).toBeVisible();
});

test("billing, apps and skills also appear in settings and slash navigation",async ({page})=>{
  await waitForPreview(page);
  await openSettings(page);
  await page.locator(".sc-nav").getByRole("button",{name:"账单与用量",exact:true}).click();
  await expect(page.locator(".sc-scroll .com-page-head").getByRole("heading",{name:"账单与用量"})).toBeVisible();
  await page.locator(".sc-nav").getByRole("button",{name:"官方应用",exact:true}).click();
  await expect(page.locator(".sc-scroll .com-app-card")).toHaveCount(8);
  await page.locator(".sc-nav").getByRole("button",{name:"技能中心",exact:true}).click();
  await expect(page.locator(".sc-scroll .com-skill")).toHaveCount(7);
  await page.getByRole("button",{name:"完成"}).click();
  await page.getByRole("textbox",{name:"向 Ciro 发送消息"}).fill("/billing");
  await page.getByRole("button",{name:"发送消息"}).click();
  await expect(page.locator(".com-page-head").getByRole("heading",{name:"账单与用量"})).toBeVisible();
});

test("billing and app catalog translate into English without mobile viewport overflow",async ({page})=>{
  await page.setViewportSize({width:390,height:844});
  await waitForPreview(page);
  await setLanguage(page,"en");
  await page.getByRole("button",{name:"Open sidebar"}).click();
  await go(page,"Billing & usage");
  await expect(page.locator(".com-page-head").getByRole("heading",{name:"Billing & usage"})).toBeVisible();
  await page.screenshot({path:imageDir+"/29-billing-mobile-en.png",fullPage:true,animations:"disabled"});
  const dimensions=await page.evaluate(()=>({doc:document.documentElement.scrollWidth,win:window.innerWidth}));
  expect(dimensions.doc).toBeLessThanOrEqual(dimensions.win+1);
  await page.locator(".wb-nav").getByRole("button",{name:"Official apps",exact:true}).click();
  await expect(page.locator(".com-app-card")).toHaveCount(8);
  await page.screenshot({path:imageDir+"/30-apps-mobile-en.png",fullPage:true,animations:"disabled"});
});
