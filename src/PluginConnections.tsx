import {useCallback,useEffect,useState} from "react";
import {accountFetch} from "./lib/account-api";

type Entry={id:string;title:string;status:string;tools:string[]};
type Connection={provider:string;account:{login?:string;id?:number};connectedAt:string};
type Approval={id:string;provider:string;summary:string;createdAt:string};
type Snapshot={catalog:Entry[];connections:Connection[];approvals:Approval[];
 audit:{id:string;at:string;event:string}[]};

async function api<T>(path:string,body?:unknown):Promise<T>{
 const response=await accountFetch("/api/plugins"+path,{
  method:body===undefined?"GET":"POST",
  ...(body===undefined?{}:{headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})
 });
 const value=await response.json();
 if(!response.ok)throw new Error(value.error||"插件服务请求失败");
 return value as T;
}
export default function PluginConnections(){
 const [state,setState]=useState<Snapshot|null>(null);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [busy,setBusy]=useState(false);
 const [repo,setRepo]=useState("");
 const [path,setPath]=useState("README.md");
 const [result,setResult]=useState("");
 const refresh=useCallback(async()=>{
  try{setState(await api<Snapshot>("/catalog"));setError("");}
  catch(e){setError(e instanceof Error?e.message:String(e));}
 },[]);
 useEffect(()=>{void refresh();},[refresh]);
 async function action(fn:()=>Promise<void>){
  setBusy(true);setError("");setNotice("");
  try{await fn();await refresh();}
  catch(e){setError(e instanceof Error?e.message:String(e));}
  finally{setBusy(false);}
 }
 return <section className="wb-card" aria-label="CIRO V0.8 插件连接">
  <h3>CIRO V0.8 · 真实插件连接</h3>
  <p className="wb-muted">每个账户单独授权；凭据只保存在服务端。未验证的连接不能调用工具。</p>
  {error&&<p role="alert" className="wb-risk">{error}</p>}
  {notice&&<p role="status" className="wb-verified">{notice}</p>}
  {!state?<button className="wb-secondary" onClick={()=>void refresh()}>加载连接状态</button>:
   <>
    {state.catalog.map(plugin=>{
      const connected=state.connections.find(x=>x.provider===plugin.id);
      return <article key={plugin.id} className="wb-plugin">
       <div><h3>{plugin.title}</h3>
        <p>{connected?"已连接："+(connected.account?.login||"授权账户"):"尚未连接"}</p>
        <small>{plugin.id==="supabase"?"开发者 MCP 尚未完成安全会话，暂不开放实际调用":plugin.tools.join(" · ")}</small>
       </div>
       <div className="wb-plugin-side">
        {connected?<button className="wb-secondary" disabled={busy} onClick={()=>void action(async()=>{
          await api("/"+plugin.id+"/disconnect",{});
          setNotice("本地连接已撤销；建议同时在服务提供方撤销应用授权。");
        })}>断开连接</button>:plugin.id==="github"?
        <button className="wb-primary" disabled={busy} onClick={()=>void action(async()=>{
          const response=await api<{authorizeUrl:string}>("/github/connect",{});
          const url=new URL(response.authorizeUrl);
          if(url.origin!=="https://github.com")throw new Error("OAuth 地址不可信");
          window.location.assign(url.href);
        })}>连接 GitHub</button>:
        <button className="wb-secondary" disabled>等待 OAuth/MCP 适配</button>}
       </div>
      </article>;
    })}
    {state.connections.some(x=>x.provider==="github")&&<div className="wb-card">
      <h3>GitHub 工具调用验证</h3>
      <p className="wb-muted">仅可读取工作台已经授权、且在服务器白名单内的仓库。</p>
      <label className="wb-label">仓库 owner/repo<input value={repo} onChange={e=>setRepo(e.target.value)} placeholder="owner/repository"/></label>
      <label className="wb-label">相对文件路径<input value={path} onChange={e=>setPath(e.target.value)}/></label>
      <button className="wb-secondary" disabled={busy||!repo||!path} onClick={()=>void action(async()=>{
       const value=await api<{result?:{content?:string};approvalRequired?:boolean}>("/invoke",
        {provider:"github",tool:"github.read_file",args:{repo,path},source:"manual"});
       setResult(value.result?.content||JSON.stringify(value));
      })}>验证读取</button>
      {result&&<pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",maxHeight:260,overflow:"auto"}}>{result}</pre>}
    </div>}
    {state.approvals.map(x=><div className="wb-card" key={x.id}>
      <p>等待审批：{x.summary}</p>
      <div className="wb-actions">
       <button className="wb-secondary" disabled={busy} onClick={()=>void action(async()=>{
        await api("/approvals/"+x.id,{decision:"reject"});setNotice("已拒绝");
       })}>拒绝</button>
       <button className="wb-primary" disabled={busy} onClick={()=>void action(async()=>{
        await api("/approvals/"+x.id,{decision:"approve"});setNotice("已提交执行并记录审计");
       })}>批准本次</button>
      </div>
    </div>)}
    <details><summary>插件审计记录</summary>
      {state.audit.slice(0,12).map(x=><p key={x.id}><small>{x.at} · {x.event}</small></p>)}
    </details>
   </>}
 </section>;
}
