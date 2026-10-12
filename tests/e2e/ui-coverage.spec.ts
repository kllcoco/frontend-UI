import {test,expect,type Page} from "@playwright/test";
import {mkdirSync} from "node:fs";

const output="artifacts/ui-screenshots";
mkdirSync(output,{recursive:true});

async function noViewportOverflow(page:Page,label:string){
 const widths=await page.evaluate(()=>({
  doc:document.documentElement.scrollWidth,
  viewport:document.documentElement.clientWidth
 }));
 expect(widths.doc,label+" should fit in the viewport").toBeLessThanOrEqual(widths.viewport+2);
}

test("every Studio module loads its own styles and fits the available canvas",async({page})=>{
 test.setTimeout(135_000);
 await page.goto("/",{waitUntil:"domcontentloaded"});
 await page.locator(".studio-hub-launch").click();
 await expect(page.locator(".stu-module")).toHaveCount(10);
 // Regression: studio.css existed but was accidentally omitted from main.tsx.
 const layout=await page.locator(".stu-root").evaluate(
  el=>({display:getComputedStyle(el).display,columns:getComputedStyle(
   el.querySelector(".stu-module-grid")!).gridTemplateColumns})
 );
 expect(layout.display).toBe("flex");
 expect(layout.columns).not.toBe("none");
 await page.screenshot({path:output+"/ux-studio-dashboard.png",fullPage:true});
 const sections=[
  "持续思考","代码工作区","知识与文件","研究工作台",
  "多模态工作台","算力与成本","历史对话与版本",
  "官方应用与技能","跨平台终端"
 ];
 for(const label of sections){
  await page.locator(".stu-module").filter({hasText:label}).click();
  await expect(page.locator(".stu-root"),label).toBeVisible();
  await noViewportOverflow(page,label);
  await page.locator(".stu-header .stu-light-button").click();
  await expect(page.locator(".stu-module")).toHaveCount(10);
 }
 await page.setViewportSize({width:390,height:844});
 await noViewportOverflow(page,"Studio dashboard (mobile)");
 await page.screenshot({path:output+"/ux-studio-mobile.png",fullPage:true});
 await page.locator(".stu-module").filter({hasText:"代码工作区"}).click();
 await noViewportOverflow(page,"IDE (mobile)");
});

test("account, marketplace, commerce and workbench layouts remain coherent in dark theme",async({page})=>{
 test.setTimeout(150_000);
 await page.goto("/",{waitUntil:"domcontentloaded"});
 await page.locator(".sidebar-setting").filter({hasText:"深色模式"}).click();
 await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
 const links=[
  {name:"账户与安全",selector:".acc-root",shot:"account"},
  {name:"通知中心",selector:".acc-root"},
  {name:"跨设备同步",selector:".acc-root"},
  {name:"插件中心",selector:".ciro-market",shot:"plugins"},
  {name:"官方应用",selector:".com-root",shot:"apps"},
  {name:"技能中心",selector:".com-root",shot:"skills"},
  {name:"账单与用量",selector:".com-root",shot:"billing"},
  {name:"代码工作区",selector:".stu-root"},
  {name:"研究工作台",selector:".stu-root"},
  {name:"知识与文件",selector:".stu-root"}
 ];
 for(const link of links){
  await page.locator(".studio-quick-links").getByRole("button",{name:link.name,exact:true}).click();
  await expect(page.locator(link.selector),link.name).toBeVisible();
  await noViewportOverflow(page,link.name);
  if(link.shot)await page.screenshot({
   path:output+"/ux-dark-"+link.shot+".png",fullPage:true
  });
 }
});
