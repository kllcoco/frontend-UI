import { test, expect } from "@playwright/test";

// Without a reachable Ciro server (offline Android app, wrong URL, proxy error page) every view must still
// render something useful: never a blank white screen.
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
for (const mode of ["html", "offline"])
test("every view renders without a server · " + mode, async ({ page }) => {
  test.setTimeout(180000);
  // With the API offline, the app cannot verify operator status and correctly hides
  // privileged navigation from ordinary visitors. Enable local developer options
  // only in this test to exercise all screens without weakening production guards.
  await page.addInitScript(() => localStorage.setItem("ciro.dev.v1", "on"));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));
  await page.route("**/api/**", (route) => mode === "404" ? route.fulfill({ status: 404, body: "Not found" })
    : mode === "html" ? route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html></html>" }) : route.abort());
  const items = ["融合工作台", "协作空间", "插件中心", "代码工作区", "研究工作台", "知识与文件", "官方应用", "技能中心", "账户与安全", "跨设备同步", "账单与用量", "通知中心", "设置"];
  const bad: string[] = [];
  for (const item of items) {
    await page.goto("/");
    await page.locator(".cx-mobile-menu").first().click(); await page.waitForTimeout(300);
    const sb = page.locator(".cx-sidebar");
    const direct = sb.locator(".cx-nav").getByRole("button", { name: item, exact: true });
    try {
      if (!["代码工作区","研究工作台","知识与文件","官方应用","技能中心"].includes(item) && await direct.count()) await direct.click({ timeout: 3000 });
      else if (["代码工作区","研究工作台","知识与文件","官方应用","技能中心"].includes(item)) {
        const t = sb.locator(".cx-more-toggle"); if (await t.getAttribute("aria-expanded") !== "true") await t.click();
        await sb.locator(".cx-more").getByRole("button", { name: item, exact: true }).click({ timeout: 3000 });
      } else { await sb.locator(".um-trigger").click(); await page.getByRole("menuitem", { name: item }).first().click({ timeout: 3000 }); }
    } catch (e) { bad.push(item + " (navigation failed)"); continue; }
    await page.waitForTimeout(1200);
    const len = (await page.locator("#root").innerText().catch(() => "")).trim().length;
    if (len < 40 || errors.length || await page.locator(".vb-root").count()) { errors.splice(0); bad.push(item + " textlen=" + len); }
  }
  expect(bad, bad.join("\n")).toEqual([]);
});
