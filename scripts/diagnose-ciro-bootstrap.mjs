import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {chromium} from '@playwright/test';

// CIRO local-only, single-owner browser bootstrap diagnosis.
// This script uses a fresh disposable account directory and dummy credentials.
// Never prints secret values or modifies an existing account.
const scratchRoot=resolve('.ciro-runtime','diagnostics');
mkdirSync(scratchRoot,{recursive:true});
const scratch=mkdtempSync(join(scratchRoot,'browser-bootstrap-'));
const PASSWORD='ciro-local-diagnostic-long-password';
const BOOTSTRAP='ciro-local-diagnostic-bootstrap-secret';
const parentEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>
 !/^(CIRO_|NODE_OPTIONS$|NODE_PATH$|DOTENV_CONFIG_)/i.test(key)));
const child=spawn(process.execPath,[resolve('server/index.mjs')],{
 cwd:process.cwd(),
 env:{...parentEnv,HOST:'127.0.0.1',PORT:'0',CIRO_API_BASE_URL:'',
  CIRO_ACCOUNTS_ENABLED:'true',CIRO_BOOTSTRAP_TOKEN:BOOTSTRAP,
  CIRO_API_KEY_PEPPER:'ciro-local-diagnostic-pepper-long-value',
  CIRO_ACCOUNT_DATA_KEY:randomBytes(32).toString('base64'),
  CIRO_WORKSPACE_DATA_DIR:scratch,CIRO_PUBLIC_ORIGIN:'',
  CIRO_DEPLOYMENT_MODE:'development',CIRO_GITHUB_REPOS:'demo/repository',
  CIRO_STRIPE_SECRET_KEY:''},
 stdio:['ignore','ignore','pipe','ipc']
});
let browser;
const ready=new Promise((yes,no)=>{
 const timeout=setTimeout(()=>no(new Error('Local test backend did not start within 15 seconds')),15000);
 child.once('error',err=>{clearTimeout(timeout);no(err);});
 child.on('message',msg=>{
  if(msg?.type==='ciro-server-ready'&&Number.isInteger(msg.port)){
   clearTimeout(timeout);yes(msg.port);
  }
 });
 child.once('exit',code=>{clearTimeout(timeout);no(new Error('Local test backend exited '+code));});
});
function safeShape(value){
 return Object.fromEntries(['email','displayName','password','bootstrapToken'].map(k=>
  [k,{present:typeof value?.[k]==='string',nonempty:typeof value?.[k]==='string'&&value[k].length>0}]));
}
try{
 const port=await ready;
 const origin='http://127.0.0.1:'+port;
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage();
 await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'账户与安全',exact:true}).click();
 await page.getByRole('textbox',{name:'邮箱'}).fill('person@example.com');
 await page.getByRole('textbox',{name:'显示名称'}).fill('Ciro user');
 await page.getByLabel('登录密码').fill(PASSWORD);
 await page.getByLabel('初始化口令').fill(BOOTSTRAP);
 const [reply]=await Promise.all([
  page.waitForResponse(x=>x.url().endsWith('/api/account/bootstrap')&&x.request().method()==='POST',{timeout:10000}),
  page.getByRole('button',{name:'创建账户'}).click()
 ]);
 const responseBody=await reply.json().catch(()=>({error:'Response was not JSON'}));
 let reqPayload={};
 try{reqPayload=reply.request().postDataJSON()}catch{}
 console.log(JSON.stringify({browserStatus:reply.status(),browserApiError:typeof responseBody?.error==='string'?responseBody.error:null,
  browserRequestShape:safeShape(reqPayload)},null,2));
 if(reply.status()!==201){
  const direct=await fetch(origin+'/api/account/bootstrap',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({email:'person@example.com',displayName:'Ciro user',password:PASSWORD,bootstrapToken:BOOTSTRAP})
  });
  const directBody=await direct.json().catch(()=>({error:'Response was not JSON'}));
  console.log(JSON.stringify({directStatus:direct.status(),directApiError:typeof directBody?.error==='string'?directBody.error:null},null,2));
  process.exitCode=1;
 }
} catch(error){
 console.error('CIRO local bootstrap diagnosis failed: '+(error?.message||String(error)).slice(0,500));
 process.exitCode=1;
}finally{
 try{await browser?.close();}catch{}
 if(child.exitCode===null){
  await new Promise(done=>{
   const timer=setTimeout(done,2500);
   child.once('exit',()=>{clearTimeout(timer);done();});
   try{child.kill();}catch{clearTimeout(timer);done();}
  });
 }
 // Clear only this script's unique disposable scratch, never user data.
 try{rmSync(scratch,{recursive:true,force:true,maxRetries:8,retryDelay:150});}
 catch(e){console.error('Temporary local QA scratch retained: '+e.code);}
}
