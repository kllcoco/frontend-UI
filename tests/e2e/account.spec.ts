import {test,expect} from "@playwright/test";
import { go, setLanguage } from "./helpers";
import {spawn,type ChildProcessWithoutNullStreams} from "node:child_process";
import {createServer} from "node:net";
import {mkdtempSync,rmSync,readFileSync,mkdirSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {randomBytes} from "node:crypto";

const photoDir="artifacts/ui-screenshots";
mkdirSync(photoDir,{recursive:true});
const PASSWORD="safe-test-password-long-12345";
const SECRET="account-onboarding-secret-very-long";
let port=0,dir="",server:ChildProcessWithoutNullStreams;
async function freePort():Promise<number>{
  const s=createServer();
  return await new Promise((ok,fail)=>{
    s.once("error",fail);
    s.listen(0,"127.0.0.1",()=>{
      const address=s.address();
      const n=address&&typeof address==="object"?address.port:0;
      s.close(()=>ok(n));
    });
  });
}
test.beforeAll(async()=>{
  dir=mkdtempSync(join(tmpdir(),"ciro-real-browser-"));
  port=await freePort();
  server=spawn(process.execPath,[resolve("server/index.mjs")],{
    cwd:process.cwd(),
    env:{...process.env,HOST:"127.0.0.1",PORT:String(port),CIRO_API_BASE_URL:"",
      CIRO_WORKSPACE_DATA_DIR:dir,CIRO_ACCOUNTS_ENABLED:"true",
      CIRO_BOOTSTRAP_TOKEN:SECRET,
      CIRO_API_KEY_PEPPER:"test-account-pepper-long-value-secret",
      CIRO_ACCOUNT_DATA_KEY:randomBytes(32).toString("base64"),
      CIRO_STRIPE_SECRET_KEY:"",CIRO_PUBLIC_ORIGIN:"",CIRO_GITHUB_REPOS:"demo/repository"}
  });
  let ready=false;
  for(let tries=0;tries<100;tries++){
    if(server.exitCode!==null)throw new Error("Account server failed to launch");
    try{
      const r=await fetch("http://127.0.0.1:"+port+"/api/account/session");
      if(r.ok){ready=true;break;}
    }catch{/* startup in progress */}
    await new Promise(r=>setTimeout(r,100));
  }
  if(!ready)throw new Error("Account test server startup timeout");
});
test.afterAll(async()=>{
  if(server && server.exitCode===null){
    server.kill();
    await new Promise(resolve=>{server.once("exit",resolve);setTimeout(resolve,1000);});
  }
  if(dir)rmSync(dir,{recursive:true,force:true});
});
test("real account authentication, encrypted memories, spending limits and device sync work end to end",async({browser,page})=>{
  test.setTimeout(100000);
  const root="http://127.0.0.1:"+port;
  await page.goto(root+"/",{waitUntil:"domcontentloaded"});
  await go(page,"账户与安全");
  await expect(page.getByRole("heading",{name:"初始化管理员账户"})).toBeVisible();
  await page.getByRole("textbox",{name:"邮箱"}).fill("person@example.com");
  await page.getByRole("textbox",{name:"显示名称"}).fill("Ciro user");
  await page.getByLabel("登录密码").fill(PASSWORD);
  await page.getByLabel("初始化口令").fill(SECRET);
  await page.screenshot({path:photoDir+"/31-account-onboarding.png",fullPage:true,animations:"disabled"});
  const signup=page.waitForResponse(x=>x.url().includes("/api/account/bootstrap")&&x.request().method()==="POST");
  await page.getByRole("button",{name:"创建账户"}).click();
  const response=await signup;
  expect(response.status()).toBe(201);
  await expect.poll(async()=>{
    const r=await page.request.get(root+"/api/account/session");
    const v=await r.json();
    return v.authenticated;
  }).toBe(true);
  // Explicit reload checks that the authenticated HttpOnly session persists.
  await page.reload({waitUntil:"domcontentloaded"});
  await go(page,"账户与安全");
  await expect(page.getByText("person@example.com")).toBeVisible();
  await page.screenshot({path:photoDir+"/32-account-profile.png",fullPage:true,animations:"disabled"});

  // A scoped API key is actually minted by the server (only shown once).
  await go(page,"设置");
  await page.locator(".sc-nav").getByRole("button",{name:"API 控制台"}).click();
  await page.getByRole("textbox",{name:"密钥名称"}).fill("CIRO browser integration key");
  await page.getByRole("button",{name:"创建密钥"}).click();
  await expect(page.getByText("密钥只显示一次，请妥善保存。")).toBeVisible();
  await page.screenshot({path:photoDir+"/38-account-api-keys.png",fullPage:true,animations:"disabled"});
  await page.locator(".sc-nav").getByRole("button",{name:"通知中心"}).click();
  await expect(page.getByText("暂无通知")).toBeVisible();
  await page.screenshot({path:photoDir+"/39-account-notifications.png",fullPage:true,animations:"disabled"});
  // Real persisted memory: plaintext must never be written to account-state.json.
  await page.locator(".sc-nav").getByRole("button",{name:"记忆管理"}).click();
  await page.getByRole("checkbox",{name:"记忆开关"}).check();
  await page.getByRole("textbox",{name:"记忆内容"}).fill("CIRO evidence first, no false green results.");
  await page.getByRole("button",{name:"添加记忆"}).click();
  await expect(page.getByText("CIRO evidence first, no false green results.")).toBeVisible();
  expect(readFileSync(join(dir,"account-state.json"),"utf8")).not.toContain("CIRO evidence first");
  await page.screenshot({path:photoDir+"/33-account-memory.png",fullPage:true,animations:"disabled"});

  await page.locator(".sc-nav").getByRole("button",{name:"消费限额"}).click();
  await page.getByRole("textbox",{name:"日限额（美元）"}).fill("9.50");
  await page.getByRole("textbox",{name:"月限额（美元）"}).fill("50");
  await page.getByRole("textbox",{name:"单次上限（美元）"}).fill("3");
  await page.getByRole("button",{name:"保存限额"}).click();
  await expect(page.getByText("操作成功").first()).toBeVisible();
  await page.screenshot({path:photoDir+"/34-account-spending.png",fullPage:true,animations:"disabled"});

  await page.locator(".sc-nav").getByRole("button",{name:"订阅管理"}).click();
  await expect(page.getByText("尚未连接支付服务").first()).toBeVisible();
  await page.screenshot({path:photoDir+"/35-account-subscription.png",fullPage:true,animations:"disabled"});
  await page.locator('button[aria-label="关闭设置"]:visible').click();

  // Create actual local preview conversation, upload it with the authenticated versioned API.
  await page.getByRole("button",{name:/新对话/}).first().click();
  await page.getByRole("textbox",{name:"向 Ciro 发送消息"}).fill("A sync test conversation");
  await page.getByRole("button",{name:"发送消息"}).click();
  await go(page,"跨设备同步");
  await page.getByRole("button",{name:"立即同步"}).click();
  await expect(page.locator(".acc-state")).toContainText("已同步",{timeout:15000});
  await expect(page.locator(".acc-sync-grid > div").nth(1)).toContainText(/[1-9]/);
  await page.screenshot({path:photoDir+"/36-account-sync.png",fullPage:true,animations:"disabled"});

  // A second browser device signs into the *same* live server; sync is on by default and
  // pulls the encrypted conversation from the server rather than a fake local copy.
  const other=await browser.newContext();
  const second=await other.newPage();
  await second.goto(root+"/",{waitUntil:"domcontentloaded"});
  await go(second,"账户与安全");
  await expect(second.getByRole("heading",{name:"登录 Ciro"})).toBeVisible();
  await second.getByRole("textbox",{name:"邮箱"}).fill("person@example.com");
  await second.getByLabel("登录密码").fill(PASSWORD);
  const login=second.waitForResponse(x=>x.url().includes("/api/account/login")&&x.request().method()==="POST");
  await second.getByRole("button",{name:"登录",exact:true}).click();
  const loginResponse=await login;
  expect(loginResponse.status()).toBe(200);
  await second.reload({waitUntil:"domcontentloaded"});
  await go(second,"跨设备同步");
  await expect(second.getByRole("checkbox",{name:"在此设备上同步"})).toBeChecked();
  await expect(second.getByText(/A sync test conversation/).first()).toBeVisible({timeout:18000});
  await second.screenshot({path:photoDir+"/37-account-sync-second-device.png",fullPage:true,animations:"disabled"});
  await other.close();
});


test("plugin center lets an authenticated user choose their GitHub repository without legacy token setup",async({page})=>{
 test.setTimeout(65000);
 const root="http://127.0.0.1:"+port;
 const login=await page.request.post(root+"/api/account/login",{
  data:{email:"person@example.com",password:PASSWORD}
 });
 expect(login.status()).toBe(200);
 await page.goto(root+"/",{waitUntil:"domcontentloaded"});
 await go(page,"插件中心");
 await expect(page.getByRole("heading",{name:"发现插件"})).toBeVisible();
 await page.getByRole("button",{name:"安装插件"}).click();
 await page.getByRole("button",{name:"确认安装"}).click();
 await expect(page.getByRole("heading",{name:"GitHub 仓库授权范围"})).toBeVisible();
 const selector=page.getByRole("combobox",{name:"GitHub 允许的仓库"});
 await expect(selector).toBeVisible();
 await expect(selector).toHaveValue("demo/repository");
 await page.getByRole("button",{name:"选择仓库"}).click();
 await expect(page.getByText("当前范围：demo/repository")).toBeVisible();
 const catalog=await (await page.request.get(root+"/api/plugins/catalog")).json();
 expect(catalog.githubScope.selectedRepository).toBe("demo/repository");
 expect(catalog.githubScope.mode).toBe("request");
 await page.screenshot({path:photoDir+"/41-github-plugin-repository-scope.png",fullPage:true,animations:"disabled"});
 page.once("dialog",dialog=>void dialog.accept());
 await page.getByRole("button",{name:"卸载"}).click();
 await expect(page.getByText("尚未安装。请从右侧市场选择插件。")).toBeVisible();

 // The legacy workbench tab must direct signed-in users to the safe marketplace.
 await page.getByRole("navigation",{name:"自主协作工作台"}).getByRole("button",{name:"GitHub 仓库"}).click();
 await expect(page.getByRole("heading",{name:"GitHub 已迁移到插件中心"})).toBeVisible();
 await page.getByRole("button",{name:"打开插件中心"}).click();
 await expect(page.getByRole("heading",{name:"发现插件"})).toBeVisible();
});
