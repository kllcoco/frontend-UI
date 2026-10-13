import { test, expect } from "@playwright/test";
import { startCiro, startMockModel } from "./mock-upstream";
const CJK = /[一-鿿]/;
// Every visible label, placeholder and aria-label on the main screens is English once English is chosen.
// Allowed: language names, and chat titles / follow-ups that come from the mock model.
test("English interface has no Chinese leftovers on the main screens", async ({ browser }) => {
  test.setTimeout(300_000);
  const mock = await startMockModel(8895); const c = await startCiro(8799, 8895, { CIRO_ACCOUNTS_ENABLED: "" });
  const found = new Map<string, Set<string>>();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
    const page = await ctx.newPage();
    await page.addInitScript(() => localStorage.setItem("ciro.language.v1", "en"));
    const scan = async (where: string) => {
      await page.waitForTimeout(600);
      const texts = await page.evaluate(() => {
        const out: string[] = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) { const el = n.parentElement!; if (el.closest("textarea,pre,code,.message-prose,.cx-row,[translate=no]")) continue;
          const s = getComputedStyle(el); if (s.display === "none" || s.visibility === "hidden") continue; const v = (n.textContent || "").trim(); if (v) out.push(v); }
        for (const el of Array.from(document.querySelectorAll("[placeholder],[aria-label],[title]"))) for (const a of ["placeholder", "aria-label", "title"]) { const v = el.getAttribute(a); if (v) out.push("@" + a + ":" + v); }
        return out;
      });
      for (const x of texts) if (/[一-鿿]/.test(x)) { if (!found.has(x)) found.set(x, new Set()); found.get(x)!.add(where); }
    };
    await page.goto(c.url + "/"); await scan("home");
    await page.getByRole("textbox").first().fill("hello"); await page.keyboard.press("Enter"); await page.waitForTimeout(1500); await scan("chat");
    await page.getByRole("button", { name: /attach/i }).first().click({ timeout: 3000 }).catch(() => {}); await scan("plus"); await page.keyboard.press("Escape");
    await page.keyboard.press("Control+,"); await page.waitForTimeout(400);
    const names = await page.locator(".sc-nav .sc-nav-item").allInnerTexts();
    for (const n of names) { await page.locator(".sc-nav").getByRole("button", { name: n.trim(), exact: true }).click({ timeout: 5000 }); await scan("settings/" + n.trim()); }
    await page.keyboard.press("Escape");
    for (const cmd of ["/studio", "/work", "/remote", "/plugins"]) {
      await page.goto(c.url + "/"); await page.getByRole("textbox").first().fill(cmd); await page.keyboard.press("Enter"); await scan(cmd);
      const tabs = page.locator(".wb-nav button");
      if (cmd === "/work") for (let i = 0; i < await tabs.count(); i++) { await tabs.nth(i).click({ timeout: 5000 }); await scan("work/" + (await tabs.nth(i).innerText())); }
    }
    await ctx.close();
  } finally { c.stop(); mock.close(); }
  const allowed = /^(简体中文|繁體中文)$|测试标题|追问[一二]/;
  const left = [...found].filter(([k]) => !allowed.test(k)).map(([k, v]) => k.slice(0, 120) + "  <- " + [...v].slice(0, 3).join(", "));
  expect(left).toEqual([]);
});
