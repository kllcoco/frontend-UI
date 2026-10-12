import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const sha=value=>createHash('sha256').update(value).digest('hex');
const fail=message=>{throw Error(message)};
const limit=600000;
const actualText=async response=>{
 const body=await response.text();
 if(body.length>limit)fail('Live acceptance response too large');
 return body;
};
async function getJson(fetchFn,url,options={}){
 const response=await fetchFn(url,{redirect:'error',signal:AbortSignal.timeout(12000),...options});
 if(!response.ok)fail('Live acceptance HTTP '+response.status+' at '+new URL(url).pathname);
 let data;
 try{data=JSON.parse(await actualText(response));}catch{fail('Live acceptance expected JSON');}
 return {data,response};
}
function requireLoopback(input){
 const url=new URL(input);
 if(url.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||
    url.username||url.password||url.search||url.hash||url.pathname!=='/')
  fail('Live acceptance requires an exact local HTTP origin');
 return url.origin;
}
export async function verifyCiroDesktopLive({baseUrl,email,password,repo,fetchFn=fetch}={}){
 const base=requireLoopback(baseUrl);
 if(typeof email!=='string'||!email||typeof password!=='string'||!password)
  fail('Use local CIRO_ACCEPTANCE_EMAIL and CIRO_ACCEPTANCE_PASSWORD; never paste credentials into chat');
 if(typeof repo!=='string'||!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repo))fail('Invalid acceptance repository');
 const headers={'Content-Type':'application/json',Origin:base};
 const login=await getJson(fetchFn,base+'/api/account/login',{method:'POST',headers,
  body:JSON.stringify({email,password})});
 if(login.data.authenticated!==true||typeof login.data.csrf!=='string')fail('Owner login did not succeed');
 const cookie=login.response.headers.get('set-cookie')?.split(';')[0]||'';
 if(!/^ciro_sid=/.test(cookie))fail('Owner session cookie was not issued');
 const authHeaders={...headers,Cookie:cookie,'x-ciro-csrf':login.data.csrf};
 const {data:session}=await getJson(fetchFn,base+'/api/account/session',{headers:{Cookie:cookie}});
 if(session.authenticated!==true||session.mode!=='session')fail('Live owner session not accepted');
 const {data:status}=await getJson(fetchFn,base+'/api/status');
 if(status.configured!==true||status.mode!=='configured')fail('CIRO is still preview-only; native inference not configured');
 const {data:market}=await getJson(fetchFn,base+'/api/plugins/catalog',{headers:{Cookie:cookie}});
 if(!market.installed?.some(p=>p.id==='github'&&p.enabled===true))fail('GitHub plugin not installed and enabled');
 if(!market.connections?.some(p=>p.provider==='github'&&p.account?.login))fail('CIRO-local GitHub account not connected');
 if(market.githubScope?.selectedRepository!==repo)fail('GitHub selected repo not equal to acceptance repo');
 const {data:file}=await getJson(fetchFn,base+'/api/plugins/invoke',{method:'POST',headers:authHeaders,
  body:JSON.stringify({provider:'github',tool:'github.read_file',source:'manual',args:{repo,path:'README.md'}})});
 if(file.executed!==true||file.tool!=='github.read_file'||typeof file.result?.content!=='string'||
    !/^[a-f0-9]{40}$/i.test(file.result.sha||''))fail('Authenticated GitHub live README read not confirmed');
 const chat=await fetchFn(base+'/api/chat',{method:'POST',redirect:'error',headers:authHeaders,
  signal:AbortSignal.timeout(45000),body:JSON.stringify({model:status.model||'ciro',
    messages:[{role:'user',content:'请用一句中文回答：CIRO 连通性探针。'}]})});
 if(!chat.ok)fail('Model chat endpoint failed HTTP '+chat.status);
 const body=await actualText(chat);
 if(!body.includes('data: [DONE]')||!body.includes('"choices"'))fail('Chat did not produce a complete SSE stream');
 // This proves the HTTP route only; native NCPA needs an independently pinned runtime receipt.
 return {schema:'ciro.live.client.smoke.v1',observedAt:new Date().toISOString(),
  github:{status:'PASS_LIVE_READ',repo,path:'README.md',blobSha:file.result.sha,
   contentSha256:sha(file.result.content),login:market.connections.find(p=>p.provider==='github').account.login},
  model:{status:'PASS_HTTP_STREAM',displayedModel:status.model,responseSha256:sha(body),
   nativeNcpaAuthority:'NOT_VERIFIED'},
  githubWrites:'NOT_RUN_REQUIRES_HUMAN_APPROVAL',windowsInstall:'NOT_RUN',
  graduated:false};
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){
 try{
  const result=await verifyCiroDesktopLive({baseUrl:process.env.CIRO_ACCEPTANCE_BASE_URL,
   email:process.env.CIRO_ACCEPTANCE_EMAIL,password:process.env.CIRO_ACCEPTANCE_PASSWORD,
   repo:process.env.CIRO_ACCEPTANCE_REPO});
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
 }catch(error){process.stderr.write('CIRO live acceptance NOT PASS: '+error.message+'\n');process.exitCode=1;}
}
