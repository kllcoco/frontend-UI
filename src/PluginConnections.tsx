import {useCallback,useEffect,useMemo,useState} from "react";
import {accountFetch} from "./lib/account-api";
import "./plugin-marketplace.css";

type Entry={id:string;title:string;category:string;description:string;version:string;publisher:string;status?:string;tools:string[];permissions:string[];ready:boolean};
type Installed={id:string;version:string;installedAt:string;enabled:boolean};
type Connection={provider:string;account?:{login?:string;email?:string;id?:string|number};connectedAt:string};
type Approval={id:string;provider:string;summary:string;createdAt:string};
type Prepared={nonce:string;fingerprint:string;plugin:Entry;expiresInSeconds:number};
type PluginJob={id:string;provider:string;tool:string;status:string;effect:boolean;attempts:number;createdAt:number;code?:string|null};
type Snapshot={catalog:Entry[];installed:Installed[];connections:Connection[];approvals:Approval[];jobs?:PluginJob[];audit:{id:string;at:string;event:string}[]};
async function api<T>(path:string,body?:unknown):Promise<T>{
 const response=await accountFetch("/api/plugins"+path,{
  method:body===undefined?"GET":"POST",
  ...(body===undefined?{}:{headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})
 });
 const result=await response.json();
 if(!response.ok)throw new Error(result.error||"插件服务请求失败");
 return result as T;
}
export default function PluginConnections(){
 const [state,setState]=useState<Snapshot|null>(null);
 const [selected,setSelected]=useState("github");
 const [query,setQuery]=useState("");
 const [category,setCategory]=useState("全部");
 const [pending,setPending]=useState<Prepared|null>(null);
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
 const categories=useMemo(()=>["全部",...new Set((state?.catalog||[]).map(x=>x.category))],[state]);
 const available=(state?.catalog||[]).filter(x=>(category==="全部"||category===x.category)&&
  (x.title+" "+x.description).toLowerCase().includes(query.trim().toLowerCase()));
 const current=state?.catalog.find(x=>x.id===selected);
 const active=state?.installed.find(x=>x.id===selected);
 const connected=state?.connections.find(x=>x.provider===selected);
 async function action(fn:()=>Promise<void>){
  setBusy(true);setError("");setNotice("");
  try{await fn();await refresh();}
  catch(e){setError(e instanceof Error?e.message:String(e));}
  finally{setBusy(false);}
 }
 return <section className="ciro-market" aria-label="CIRO 插件中心">
   <div className="ciro-market-head"><div><span>CIRO PLUGIN CENTER · V0.8</span><h2>插件中心</h2>
    <p>像应用商店一样自由挑选、安装和管理工具。CIRO 不会在聊天中自行安装插件。</p></div>
    <button className="wb-secondary" onClick={()=>void refresh()}>刷新</button></div>
   {error&&<p className="ciro-market-error" role="alert">{error}</p>}
   {notice&&<p className="ciro-market-notice" role="status">{notice}</p>}
   <div className="ciro-market-layout">
    <aside className="ciro-market-installed"><h3>我的插件 <small>{state?.installed.length||0}</small></h3>
     {!state?.installed.length&&<p className="ciro-market-muted">尚未安装。请从右侧市场选择插件。</p>}
     {state?.installed.map(item=>{
      const entry=state.catalog.find(x=>x.id===item.id);
      return <button key={item.id} className={"ciro-market-nav "+(selected===item.id?"active":"")}
       onClick={()=>setSelected(item.id)} aria-pressed={selected===item.id}>
       <span className="ciro-market-logo">{item.id==="github"?"GH":item.id==="supabase"?"SB":item.id==="gmail"?"GM":"+"}</span>
       <span><strong>{entry?.title||item.id}</strong><small>{item.enabled?"已安装":"已停用"}</small></span>
      </button>;
     })}
     <div className="ciro-market-hint">安装与账号授权是两件事。卸载后会阻断 CIRO 对该插件的调用。</div>
    </aside>
    <div className="ciro-market-store">
     <header className="ciro-market-toolbar"><h3>发现插件</h3><input aria-label="搜索插件" placeholder="搜索插件名称或功能" value={query} onChange={e=>setQuery(e.target.value)}/></header>
     <div className="ciro-market-categories">{categories.map(x=><button key={x} className={category===x?"active":""}
      onClick={()=>setCategory(x)}>{x}</button>)}</div>
     <div className="ciro-market-grid">{available.map(item=>{
      const installed=state?.installed.some(x=>x.id===item.id);
      return <button key={item.id} className={"ciro-market-tile "+(selected===item.id?"active":"")} onClick={()=>{setSelected(item.id);setPending(null);}}>
       <span className="ciro-market-logo">{item.id==="github"?"GH":item.id==="supabase"?"SB":item.id==="gmail"?"GM":item.id==="calendar"?"CA":"GD"}</span>
       <strong>{item.title}</strong><small>{item.category} · {item.publisher}</small>
       <p>{item.description}</p><span className="ciro-market-tile-status">{installed?"已安装":item.ready?"查看并安装":"即将开放"}</span>
      </button>;
     })}</div>
     {current&&<div className="ciro-market-detail">
      <div className="ciro-market-detail-header"><div><span className="ciro-market-logo">{current.title.slice(0,2)}</span>
       <div><h3>{current.title}</h3><small>{current.publisher} · v{current.version}</small></div></div>
       {active?<button className="wb-secondary" disabled={busy} onClick={()=>void action(async()=>{
        if(!window.confirm("确定卸载 "+current.title+"？关联授权及待审批操作也将被移除。"))return;
        await api("/installed/"+current.id+"/uninstall",{});
        setPending(null);setNotice("插件已卸载，调用权限已停止。");
       })}>卸载</button>:<button className="wb-primary" disabled={busy||!current.ready} onClick={()=>void action(async()=>{
        setPending(await api<Prepared>("/marketplace/"+current.id+"/prepare",{}));
        setNotice("请查看下方请求权限，然后确认安装。");
       })}>{current.ready?"安装插件":"暂未开放"}</button>}</div>
      <p>{current.description}</p>
      <h4>插件请求的权限</h4><div className="ciro-market-tags">{current.permissions.map(x=><code key={x}>{x}</code>)}</div>
      <p className="ciro-market-muted">安装后不会自动登录第三方账号。需要使用时，再由用户亲自授权；高风险操作仍需审批。</p>
      {pending?.plugin.id===current.id&&!active&&<div className="ciro-market-confirm">
       <strong>确认安装 {current.title}？</strong><p>版本 {pending.plugin.version} · 请确认以上权限。</p>
       <button className="wb-secondary" onClick={()=>setPending(null)}>取消</button>
       <button className="wb-primary" disabled={busy} onClick={()=>void action(async()=>{
        await api("/marketplace/"+current.id+"/install",{nonce:pending.nonce,fingerprint:pending.fingerprint,confirm:true});
        setPending(null);setNotice("安装成功。可在左侧管理。");
       })}>确认安装</button>
      </div>}
      {active&&<div className="ciro-market-management"><h4>已安装插件管理</h4>
       <button className="wb-secondary" disabled={busy} onClick={()=>void action(async()=>{
        await api("/installed/"+current.id+"/enabled",{enabled:!active.enabled});
        setNotice(active.enabled?"插件已停用":"插件已启用");
       })}>{active.enabled?"暂停使用":"启用"}</button>
       {(current.id==="github"||current.id==="supabase")&&active.enabled&&(connected?<button className="wb-secondary" disabled={busy} onClick={()=>void action(async()=>{
        await api("/"+current.id+"/disconnect",{});setNotice("第三方连接已断开");
       })}>断开 {current.title} 账户 ({connected.account?.login||connected.account?.email||"已授权"})</button>:
       <button className="wb-primary" disabled={busy} onClick={()=>void action(async()=>{
        const out=await api<{authorizeUrl:string}>("/"+current.id+"/connect",{});
        const target=new URL(out.authorizeUrl);
        if(current.id==="github"?target.origin!=="https://github.com":
          !(target.protocol==="https:"&&target.hostname.endsWith(".supabase.co")))
          throw new Error("授权地址不可信");
        window.location.assign(target.href);
       })}>连接 {current.title} 账户</button>)}
       {current.id==="github"&&connected&&active.enabled&&<div className="ciro-market-test">
         <h4>工具验证：读取仓库文件</h4>
         <input aria-label="GitHub 仓库" value={repo} onChange={e=>setRepo(e.target.value)} placeholder="owner/repo"/>
         <input aria-label="GitHub 文件路径" value={path} onChange={e=>setPath(e.target.value)}/>
         <button className="wb-secondary" disabled={busy||!repo||!path} onClick={()=>void action(async()=>{
          const out=await api<{result?:{content?:string}}>("/invoke",{provider:"github",tool:"github.read_file",source:"manual",args:{repo,path}});
          setResult(out.result?.content||"无返回内容");
         })}>读取文件</button>
         <button className="wb-secondary" disabled={busy||!repo||!path} onClick={()=>void action(async()=>{
          const job=await api<{id:string}>("/jobs",{provider:"github",tool:"github.read_file",
            args:{repo,path},idempotencyKey:crypto.randomUUID()});
          setNotice("读取任务已保存，编号："+job.id.slice(0,8)+"；刷新可查看执行状态。");
         })}>加入可靠后台队列</button>
         {result&&<pre>{result.slice(0,5000)}</pre>}
        </div>}
      </div>}
     </div>}
     {!!state?.jobs?.length&&<div className="ciro-market-detail" aria-label="插件任务记录">
      <h3>可靠插件任务</h3>
      <p className="ciro-market-muted">只读任务可安全重试；外部写入如果结果未知，不会自动重复提交。</p>
      {state.jobs.slice(0,10).map(job=><div key={job.id} className="ciro-market-job">
       <strong>{job.provider} · {job.tool}</strong>
       <p>{job.status==="uncertain"?"结果待人工核对":job.status} · 尝试 {job.attempts} 次</p>
       {["queued","leased"].includes(job.status)&&
        <button className="wb-secondary" disabled={busy} onClick={()=>void action(async()=>{
         const updated=await api<PluginJob>("/jobs/"+job.id+"/cancel",{});
         setNotice(updated.status==="cancel_requested"?"已请求取消，执行中的外部操作可能无法撤回":"任务已取消");
        })}>取消</button>}
       {job.status==="succeeded"&&!job.effect&&
        <button className="wb-secondary" disabled={busy} onClick={()=>void action(async()=>{
         const full=await api<{result?:unknown}>("/jobs/"+job.id);
         setResult(JSON.stringify(full.result??{},null,2).slice(0,5000));
         setNotice("任务结果已加载到 GitHub 文件读取区");
        })}>查看结果</button>}
      </div>)}
     </div>}
     {!!state?.approvals.length&&<div className="ciro-market-detail"><h3>待审批工具调用</h3>
      {state.approvals.map(x=><div key={x.id}><p>{x.summary}</p>
       <button className="wb-secondary" disabled={busy} onClick={()=>void action(async()=>{await api("/approvals/"+x.id,{decision:"reject"});})}>拒绝</button>
       <button className="wb-primary" disabled={busy} onClick={()=>void action(async()=>{await api("/approvals/"+x.id,{decision:"approve"});})}>批准本次</button>
      </div>)}</div>}
    </div>
   </div>
  </section>;
}
