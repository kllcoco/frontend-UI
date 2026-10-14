import { test, expect, type Page } from "@playwright/test";
import type { Server } from "node:http";
import { startCiro, startMockModel } from "./mock-upstream";
import { go } from "./helpers";

// The tool pages (持续思考, 研究, 知识问答, 协作空间计划) run on the model you chat with when their native
// services are not connected — your own model (API) or the server model. Customers never see .env plumbing.
let mock: Server, customer: { url: string; stop: () => void }, hosted: { url: string; stop: () => void };
test.beforeAll(async () => {
  mock = await startMockModel(8902);
  customer = await startCiro(8801, 8902, { CIRO_API_BASE_URL: "", CIRO_SETUP_HINTS: "" });
  hosted = await startCiro(8802, 8902);
});
test.afterAll(() => { customer?.stop(); hosted?.stop(); mock?.close(); });

async function addOwnModel(page: Page) {
  await page.keyboard.press("Control+,");
  await page.locator(".sc-nav").getByRole("button", { name: "模型设置", exact: true }).click();
  await page.getByRole("button", { name: "添加模型" }).click();
  await page.getByRole("button", { name: "DeepSeek" }).click();
  await page.getByLabel("接口地址").fill("http://127.0.0.1:8902/v1");
  await page.getByLabel("API Key").fill("sk-test");
  await page.getByLabel("模型名").fill("my-model");
  await page.getByRole("button", { name: "添加并测试" }).click();
  await expect(page.getByText("「DeepSeek」可以用了。")).toBeVisible();
  await page.getByRole("button", { name: "关闭设置" }).first().click();
  await expect(page.getByRole("button", { name: "切换模型" })).toContainText("DeepSeek");
}

test("customers' own model runs 持续思考, research and goal plans — no server plumbing shown", async ({ page }) => {
  await page.goto(customer.url + "/");
  await addOwnModel(page);
  await go(page, "融合工作台");
  await page.locator(".stu-module").filter({ hasText: "持续思考" }).click();
  await page.getByLabel("问题或目标").fill("为什么天空是蓝色的");
  await page.getByRole("button", { name: "开始思考" }).click();
  await expect(page.locator(".stu-model-answer")).toContainText("来自 my-model 的回答：为什么天空是蓝色的");
  await expect(page.getByText(/\.env|CIRO_/)).toHaveCount(0);
  // The result is kept on this device.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ciro.tool-runs.v1") || "[]")[0].kind)).toBe("think");

  await page.locator(".stu-rail").getByRole("button", { name: "研究工作台" }).click();
  await page.getByLabel("研究主题").fill("城市雨水花园的效果");
  await page.getByRole("button", { name: "启动研究" }).click();
  await expect(page.locator(".stu-model-answer")).toContainText("来自 my-model 的回答：城市雨水花园的效果");
  await expect(page.getByText(/\.env|CIRO_/)).toHaveCount(0);

  // Features that truly need a native service say so plainly.
  await page.locator(".stu-rail").getByRole("button", { name: "多模态工作台" }).click();
  await expect(page.getByText("该功能暂未开放").first()).toBeVisible();

  await go(page, "协作空间");
  await page.getByLabel("详细目标与验收标准").fill("做一个周末读书会的报名页面");
  await page.getByRole("button", { name: "生成计划" }).click();
  await expect(page.locator(".wb-plan")).toContainText("来自 my-model 的回答：做一个周末读书会的报名页面");
  await expect(page.getByText("执行需要连接电脑（工作模式）或执行引擎；计划已生成")).toBeVisible();
  await expect(page.getByText("执行引擎未连接")).toHaveCount(0);
  await expect(page.getByText(/\.env|CIRO_/)).toHaveCount(0);
});

test("the server model answers research and questions about your files", async ({ page }) => {
  await page.goto(hosted.url + "/");
  await go(page, "融合工作台");
  await page.locator(".stu-module").filter({ hasText: "研究工作台" }).click();
  await page.getByLabel("研究主题").fill("咖啡因对睡眠的影响");
  await page.getByRole("button", { name: "启动研究" }).click();
  await expect(page.locator(".stu-model-answer")).toContainText("来自 ciro 的回答：咖啡因对睡眠的影响");

  await page.locator(".stu-rail").getByRole("button", { name: "知识与文件" }).click();
  await page.getByLabel("导入文本文件").setInputFiles({ name: "合同.md", mimeType: "text/markdown",
    buffer: Buffer.from("# 合同\n付款期限为 30 天，逾期按日计息。\n", "utf8") });
  await expect(page.locator(".stu-document")).toContainText("合同.md");
  await page.getByRole("textbox", { name: "基于文件提问" }).fill("付款期限是多久");
  await page.getByRole("button", { name: "提问", exact: true }).click();
  await expect(page.locator(".stu-model-answer")).toContainText("来自 ciro 的回答：付款期限是多久");
  await expect(page.locator(".stu-model-answer")).toContainText("合同.md");
});
