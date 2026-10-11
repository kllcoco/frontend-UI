import {test,expect} from "@playwright/test";
import {mkdirSync} from "node:fs";
const imageDir="artifacts/ui-screenshots";
mkdirSync(imageDir,{recursive:true});
async function openStudio(page:import("@playwright/test").Page){
  await page.goto("/",{waitUntil:"domcontentloaded"});
  await expect(page.getByText("当前为客户端预览，尚未连接真实 CIRO 推理服务")).toBeVisible();
  await page.locator(".studio-hub-launch").click();
  await expect(page.locator(".stu-header").getByRole("heading",{name:"融合工作台"})).toBeVisible();
}
test("the integrated Studio dashboard keeps the chat style and opens all ten functional areas",async({page})=>{
  await openStudio(page);
  await expect(page.locator(".stu-module")).toHaveCount(10);
  await expect(page.getByRole("button",{name:/打开协作空间/}).first()).toBeVisible();
  await page.screenshot({path:imageDir+"/40-unified-studio.png",fullPage:true,animations:"disabled"});
  await page.locator(".stu-module").filter({hasText:"研究工作台"}).click();
  await expect(page.locator(".stu-header").getByRole("heading",{name:"研究工作台"})).toBeVisible();
  await expect(page.getByText("模型与搜索服务尚未接入。")).toBeVisible();
  await expect(page.getByRole("button",{name:"启动研究"})).toBeDisabled();
  await page.screenshot({path:imageDir+"/41-research-disconnected.png",fullPage:true,animations:"disabled"});
});
test("the IDE really creates versioned source, saves checkpoints and restores saved bytes",async({page})=>{
  await openStudio(page);
  await page.locator(".stu-module").filter({hasText:"代码工作区"}).click();
  await page.getByRole("textbox",{name:"项目名称"}).fill("Ciro IDE regression");
  await page.getByRole("button",{name:"创建项目"}).click();
  await expect(page.locator(".stu-ide-layout")).toBeVisible();
  await page.getByRole("textbox",{name:"新文件路径"}).fill("src/index.ts");
  await page.getByRole("button",{name:"新建",exact:true}).click();
  await page.getByRole("textbox",{name:"文件内容"}).fill('export const stable = "yes";');
  await page.getByRole("button",{name:"保存文件"}).click();
  await expect(page.locator(".stu-file-tree")).toContainText("src/index.ts");
  await page.getByRole("button",{name:"创建检查点"}).click();
  await expect(page.locator(".stu-check-row")).toHaveCount(1);
  await page.getByRole("textbox",{name:"文件内容"}).fill('export const stable = "no";');
  await page.getByRole("button",{name:"保存文件"}).click();
  await page.screenshot({path:imageDir+"/42-versioned-code-editor.png",fullPage:true,animations:"disabled"});
  page.once("dialog",d=>void d.accept());
  await page.getByRole("button",{name:"恢复此版本"}).click();
  await expect(page.getByRole("textbox",{name:"文件内容"})).toHaveValue('export const stable = "yes";');
  await page.reload({waitUntil:"domcontentloaded"});
  await page.locator(".studio-quick-link").filter({hasText:"代码工作区"}).click().catch(async()=>{
    await page.getByRole("button",{name:"代码工作区",exact:true}).click();
  });
  await page.getByRole("combobox",{name:"项目文件"}).selectOption({label:"Ciro IDE regression"});
  await expect(page.getByRole("textbox",{name:"文件内容"})).toHaveValue('export const stable = "yes";');
});
test("knowledge importer creates real indexed documents, source citations and deletion",async({page})=>{
  await openStudio(page);
  await page.locator(".stu-module").filter({hasText:"知识与文件"}).click();
  await page.getByLabel("导入文本文件").setInputFiles({
    name:"evidence.md",mimeType:"text/markdown",buffer:Buffer.from("# Evidence\nH64 verified transition\nDeterministic source", "utf8")
  });
  await expect(page.locator(".stu-document")).toContainText("evidence.md");
  await page.getByRole("textbox",{name:"搜索知识库"}).fill("H64");
  await page.getByRole("button",{name:"搜索知识库"}).click();
  await expect(page.locator(".stu-hit")).toContainText("knowledge:");
  await page.screenshot({path:imageDir+"/43-knowledge-citations.png",fullPage:true,animations:"disabled"});
  page.once("dialog",d=>void d.accept());
  await page.getByRole("button",{name:"删除文档"}).click();
  await expect(page.locator(".stu-document")).toHaveCount(0);
});
test("persistent reasoning and multimodal pages expose real adapters without fake responses",async({page})=>{
  await openStudio(page);
  await page.locator(".stu-module").filter({hasText:"持续思考"}).click();
  await expect(page.getByRole("button",{name:"创建思考任务"})).toBeDisabled();
  await page.screenshot({path:imageDir+"/44-continuous-reasoning.png",fullPage:true,animations:"disabled"});
  await page.getByRole("button",{name:"融合工作台",exact:true}).last().click();
  await page.locator(".stu-module").filter({hasText:"多模态工作台"}).click();
  await expect(page.getByRole("button",{name:"上传并分析"})).toBeDisabled();
  await page.screenshot({path:imageDir+"/45-multimodal.png",fullPage:true,animations:"disabled"});
  await page.getByRole("button",{name:"融合工作台",exact:true}).last().click();
  await page.locator(".stu-module").filter({hasText:"算力与成本"}).click();
  await expect(page.getByText("尚无签名硬件数据")).toBeVisible();
  await page.screenshot({path:imageDir+"/46-compute-monitor.png",fullPage:true,animations:"disabled"});
});
test("conversation library folders, checkpoints, and branches operate on actual chats",async({page})=>{
  await page.goto("/",{waitUntil:"domcontentloaded"});
  await page.getByRole("textbox",{name:"向 Ciro 发送消息"}).fill("Versioned conversation source");
  await page.getByRole("button",{name:"发送消息"}).click();
  await page.locator(".studio-hub-launch").click();
  await page.locator(".stu-module").filter({hasText:"历史对话与版本"}).click();
  await page.locator(".stu-library-list>button").first().click();
  await page.getByRole("textbox",{name:"文件夹名称"}).fill("Architecture");
  await page.getByRole("button",{name:"保存",exact:true}).click();
  await page.getByRole("button",{name:"创建检查点"}).click();
  await expect(page.locator(".stu-check-row")).toHaveCount(1);
  await page.screenshot({path:imageDir+"/47-chat-branches-and-checkpoints.png",fullPage:true,animations:"disabled"});
  await page.getByRole("button",{name:"创建分支"}).click();
  await expect(page.getByRole("textbox",{name:"向 Ciro 发送消息"})).toBeVisible();
  await page.locator(".studio-hub-launch").click();
  await page.locator(".stu-module").filter({hasText:"历史对话与版本"}).click();
  await expect(page.locator(".stu-library-list>button")).toHaveCount(2);
});
test("signed marketplace and installable-device views are labeled accurately",async({page})=>{
  await openStudio(page);
  await page.locator(".stu-module").filter({hasText:"官方应用与技能"}).click();
  await expect(page.getByText("没有签名市场服务")).toBeVisible();
  await page.screenshot({path:imageDir+"/48-trusted-marketplace.png",fullPage:true,animations:"disabled"});
  await page.getByRole("button",{name:"融合工作台",exact:true}).last().click();
  await page.locator(".stu-module").filter({hasText:"跨平台终端"}).click();
  await expect(page.getByText("Windows / macOS 原生封装待构建")).toBeVisible();
  await expect(page.getByText("Android / iOS 原生封装待构建")).toBeVisible();
  await page.screenshot({path:imageDir+"/49-devices-pwa.png",fullPage:true,animations:"disabled"});
  const manifest=await page.request.get("/manifest.webmanifest");
  expect(manifest.status()).toBe(200);
  expect((await manifest.json()).name).toContain("Ciro");
});
test("mobile English Studio shows real feature titles without viewport overflow",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/",{waitUntil:"domcontentloaded"});
  await page.getByRole("button",{name:"切换语言"}).click();
  await page.getByRole("button",{name:"Open sidebar"}).click();
  await page.locator(".studio-hub-launch").click();
  await expect(page.locator(".stu-header").getByRole("heading",{name:"Unified Studio"})).toBeVisible();
  await page.screenshot({path:imageDir+"/50-studio-mobile-en.png",fullPage:true,animations:"disabled"});
  const dimensions=await page.evaluate(()=>({doc:document.documentElement.scrollWidth,viewport:window.innerWidth}));
  expect(dimensions.doc).toBeLessThanOrEqual(dimensions.viewport+1);
});
