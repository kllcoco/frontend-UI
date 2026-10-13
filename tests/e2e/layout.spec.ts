import { test, expect, type Page } from "@playwright/test";
import type { Server } from "node:http";
import { startCiro, startMockModel } from "./mock-upstream";

// Nothing may stick out of the viewport (no horizontal page scroll, no clipped popovers) on phones,
// tablets or desktops, in any main view, menu or dialog.
const SIZES = [
  { name: "phone-320", width: 320, height: 640 },
  { name: "phone-360", width: 360, height: 740 },
  { name: "phone-390", width: 390, height: 844 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "laptop-1024", width: 1024, height: 700 },
  { name: "desktop-1440", width: 1440, height: 900 }
];

let mock: Server, ciro: { url: string; stop: () => void };
test.beforeAll(async () => { mock = await startMockModel(8889); ciro = await startCiro(8789, 8889, { CIRO_WEB_SEARCH: "on" }); });
test.afterAll(() => { ciro?.stop(); mock?.close(); });

/** Elements whose box leaves the viewport horizontally (or vertically for fixed/absolute overlays), unless an ancestor clips them. */
async function overflow(page: Page, where: string): Promise<string[]> {
  const found = await page.evaluate(() => {
    const W = window.innerWidth, H = window.innerHeight, out: string[] = [];
    if (document.documentElement.scrollWidth > W + 1) out.push("page scrolls horizontally: " + document.documentElement.scrollWidth + " > " + W);
    const describe = (el: Element) => {
      const c = typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
      const label = el.getAttribute("aria-label") ? "[" + el.getAttribute("aria-label") + "]" : "";
      return el.tagName.toLowerCase() + c + label;
    };
    // Inside a scroll/clip container that itself sits in the viewport: the content is reachable by scrolling.
    const clipped = (el: Element, outY: boolean) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (p instanceof SVGElement) continue;
        const st = getComputedStyle(p);
        if (!/(auto|scroll|hidden|clip)/.test(st.overflowX + st.overflowY)) continue;
        const c = p.getBoundingClientRect();
        if (c.left >= -1 && c.right <= W + 1 && (!outY || (c.top >= -1 && c.bottom <= H + 1))) return true;
      }
      return false;
    };
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      if (el instanceof SVGElement && el.tagName.toLowerCase() !== "svg") continue; // judged by its <svg>
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) continue;
      if (el.closest(".cx-sidebar:not(.cx-sidebar--open)") && W <= 760) continue; // off-canvas drawer
      if (el.closest("[aria-hidden='true'], .cx-skip, .sr-only, .visually-hidden")) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const outX = r.left < -1 || r.right > W + 1;
      const overlay = s.position === "fixed" || s.position === "absolute";
      const outY = overlay && (r.top < -1 || r.bottom > H + 1);
      if (!outX && !outY) continue;
      if (clipped(el, outY)) continue;
      // Report only the outermost offender of a subtree.
      if (el.parentElement && out.some((x) => x.startsWith("@" + describe(el.parentElement!)))) continue;
      out.push("@" + describe(el) + " x=" + Math.round(r.left) + ".." + Math.round(r.right) + " y=" + Math.round(r.top) + ".." + Math.round(r.bottom));
    }
    return out.slice(0, 8);
  });
  return found.map((x) => where + ": " + x);
}

async function openNav(page: Page, mobile: boolean) {
  if (mobile && !(await page.locator(".cx-sidebar--open").count())) { await page.locator(".cx-mobile-menu:visible, .wb-mobile-top button:visible").first().click(); await page.waitForTimeout(350); }
}
async function closeAll(page: Page) {
  for (let i = 0; i < 3; i += 1) { await page.keyboard.press("Escape"); await page.waitForTimeout(80); }
}

for (const size of SIZES) {
  test("no overflow · " + size.name, async ({ page }) => {
    test.setTimeout(240_000);
    page.setDefaultTimeout(8000);
    const mobile = size.width <= 760;
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto(ciro.url + "/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    const issues: string[] = [];
    const check = async (where: string) => { await page.waitForTimeout(250); const found = await overflow(page, where); if (found.length) console.log("OVERFLOW", where, found.slice(0, 4).join(" ;; ")); issues.push(...found); };

    await check("home");
    await page.locator(".td-chip").click(); await check("thinking slider"); await closeAll(page);
    await page.getByRole("button", { name: "添加附件与模式" }).click(); await check("plus menu");
    await page.getByRole("menuitem", { name: /对比模型/ }).click(); await check("compare picker");
    await page.getByRole("dialog", { name: "选择要对比的模型" }).getByRole("button", { name: "关闭对比" }).click();
    await page.locator(".cx-topbar").getByRole("button").filter({ hasText: "Ciro" }).first().click(); await check("model menu"); await closeAll(page);

    // A conversation with wide content: long code, a table, a long URL and math.
    const long = "```python\n" + "x = '" + "很长的一行代码".repeat(30) + "'\nprint(x)\n```\n\n| A | B | C | D | E | F |\n|---|---|---|---|---|---|\n| " + "长单元格内容 | ".repeat(6) + "\n\nhttps://example.com/" + "a".repeat(200) + "\n\n$$\\sum_{i=1}^{n} i^2 = \\frac{n(n+1)(2n+1)}{6} + \\frac{a+b+c+d+e+f+g+h}{x+y+z} \\cdot \\int_0^\\infty e^{-x^2} dx$$";
    await page.getByRole("textbox", { name: "向 Ciro 发送消息" }).fill("说点什么");
    await page.keyboard.press("Enter");
    await page.locator(".cx-usage-tag").first().waitFor();
    await page.evaluate((md) => {
      const chats = JSON.parse(localStorage.getItem("ciro.chats.v1") || "[]");
      chats[0].messages.push({ id: "wide", role: "assistant", content: md, createdAt: Date.now() });
      chats[0].messages.push({ id: "wideu", role: "user", content: "https://example.com/" + "b".repeat(160), createdAt: Date.now() });
      localStorage.setItem("ciro.chats.v1", JSON.stringify(chats));
    }, long);
    await page.evaluate(() => window.dispatchEvent(new StorageEvent("storage", { key: "ciro.chats.v1" })));
    await page.waitForTimeout(400);
    await check("conversation with wide content");
    await page.keyboard.press("Control+f"); await check("find bar"); await closeAll(page);
    await page.keyboard.press("Control+k"); await check("search palette"); await closeAll(page);

    await openNav(page, mobile);
    await page.locator(".cx-row").first().getByRole("button", { name: /管理对话/ }).click(); await check("row menu"); await closeAll(page);
    await openNav(page, mobile);
    await page.locator(".um-trigger").click(); await check("user menu"); await closeAll(page);

    await page.keyboard.press("Control+,");
    const back = page.getByRole("button", { name: "返回设置列表" });
    if (mobile) { await back.click(); await check("settings list"); }
    const names = (await page.locator(".sc-nav .sc-nav-item").allInnerTexts()).map((x) => x.trim());
    for (const name of names) {
      if (mobile && !(await page.locator(".sc-shell--list").count())) await back.click();
      await page.locator(".sc-nav").getByRole("button", { name, exact: true }).click();
      await check("settings › " + name);
    }
    await closeAll(page);

    for (const item of ["融合工作台", "协作空间", "插件中心", "代码工作区", "研究工作台", "知识与文件", "官方应用", "技能中心"]) {
      await openNav(page, mobile);
      const sidebar = page.locator(".cx-sidebar");
      const direct = sidebar.locator(".cx-nav").getByRole("button", { name: item, exact: true });
      if (!(await direct.isVisible())) {
        const toggle = sidebar.locator(".cx-more-toggle");
        if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
        await sidebar.locator(".cx-more").getByRole("button", { name: item, exact: true }).click();
      } else await direct.click();
      if (mobile) await page.waitForTimeout(300);
      await check(item);
    }

    await openNav(page, mobile);
    await page.getByRole("button", { name: "新对话", exact: true }).first().click();
    await page.getByRole("button", { name: "添加附件与模式" }).click();
    await page.getByRole("menuitem", { name: /新建画布/ }).click(); await check("canvas");
    await page.getByRole("button", { name: "关闭画布" }).click();
    await page.getByRole("button", { name: "添加附件与模式" }).click();
    await page.getByRole("menuitem", { name: /提示词库/ }).click(); await check("prompt library"); await closeAll(page);

    expect(issues, issues.join("\n")).toEqual([]);
  });
}
