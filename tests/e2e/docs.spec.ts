import { test, expect } from "@playwright/test";
import type { Server } from "node:http";
import { zipSync, strToU8 } from "fflate";
import { startCiro, startMockModel } from "./mock-upstream";

// Document Q&A: Word / Excel / PowerPoint files are read in the browser with page, sheet and slide
// markers; the answer's sources link back to the original text of the cited page.
let mock: Server, ciro: { url: string; stop: () => void };
test.beforeAll(async () => { mock = await startMockModel(8881); ciro = await startCiro(8780, 8881); });
test.afterAll(() => { ciro?.stop(); mock?.close(); });

const para = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const pageBreak = `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
function docx(): Buffer {
  const body = para("采购合同") + pageBreak + para("第二条 付款期限为收货后 30 天。") + pageBreak + para("第三条 违约金为合同金额的 5%。");
  return Buffer.from(zipSync({ "word/document.xml": strToU8(`<?xml version="1.0"?><w:document xmlns:w="w"><w:body>${body}</w:body></w:document>`) }));
}
function xlsx(): Buffer {
  return Buffer.from(zipSync({
    "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="销售" sheetId="1"/></sheets></workbook>'),
    "xl/sharedStrings.xml": strToU8("<sst><si><t>城市</t></si><si><t>上海</t></si></sst>"),
    "xl/worksheets/sheet1.xml": strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>2024</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>1200</v></c></row></sheetData></worksheet>')
  }));
}
function pptx(): Buffer {
  return Buffer.from(zipSync({ "ppt/slides/slide1.xml": strToU8("<p:sld><a:p><a:r><a:t>季度汇报</a:t></a:r></a:p></p:sld>"),
    "ppt/slides/slide2.xml": strToU8("<p:sld><a:p><a:r><a:t>营收增长 20%</a:t></a:r></a:p></p:sld>") }));
}

test("ask about a Word file: the answer cites pages and each source opens the original page text", async ({ page }) => {
  await page.goto(ciro.url + "/");
  await page.locator("input[type=file]").first().setInputFiles({ name: "合同.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: docx() });
  await expect(page.locator(".cx-file-chip, .att-chip, [class*=chip]").filter({ hasText: "合同.docx" }).first()).toBeVisible();
  await page.getByRole("textbox", { name: "向 Ciro 发送消息" }).fill("付款期限和违约金是多少？");
  await page.keyboard.press("Enter");
  await expect(page.locator(".message--assistant .message-prose").last()).toContainText("付款期限是 30 天");
  const cites = page.getByLabel("出处", { exact: true });
  await expect(cites.getByRole("button")).toHaveCount(2);
  await cites.getByRole("button", { name: /第 2 页/ }).click();
  const dialog = page.getByRole("dialog", { name: /合同\.docx · 第 2 页/ });
  await expect(dialog).toContainText("付款期限为收货后 30 天");
  await expect(dialog).not.toContainText("违约金");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("Excel sheets and PowerPoint slides are readable; old binary formats get a clear message", async ({ page }) => {
  await page.goto(ciro.url + "/");
  const input = page.locator("input[type=file]").first();
  await input.setInputFiles([
    { name: "销售.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: xlsx() },
    { name: "汇报.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: pptx() }
  ]);
  await page.getByRole("textbox", { name: "向 Ciro 发送消息" }).fill("总结一下");
  const sent = page.waitForRequest((r) => r.url().endsWith("/api/chat"));
  await page.keyboard.press("Enter");
  const body = (await sent).postDataJSON() as { messages: { content: string }[] };
  const text = body.messages.at(-1)!.content;
  expect(text).toContain("[工作表 销售]");
  expect(text).toContain("第 2 行 | A2: 上海 | B2: 1200");
  expect(text).toContain("[第 2 张幻灯片]\n营收增长 20%");
  await input.setInputFiles({ name: "旧合同.doc", mimeType: "application/msword", buffer: Buffer.from("old") });
  await expect(page.getByText("旧版 Office 格式暂不支持")).toBeVisible();
});
