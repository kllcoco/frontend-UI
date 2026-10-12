import {useCallback,useEffect,useMemo,useState} from "react";
import {accountFetch} from "./lib/account-api";
import "./plugin-marketplace.css";
import type {Language} from "./lib/i18n";
import {localize} from "./lib/i18n";

type Entry={id:string;title:string;category:string;description:string;version:string;publisher:string;status?:string;tools:string[];permissions:string[];ready:boolean};
type Installed={id:string;version:string;installedAt:string;enabled:boolean};
type Connection={provider:string;account?:{login?:string;email?:string;id?:string|number};connectedAt:string};
type Approval={id:string;provider:string;summary:string;createdAt:string};
type GitHubScope={allowedRepositories:string[];selectedRepository:string;mode:string;
 custom:Record<string,boolean>;writesEnabled:boolean;oauthConfigured:boolean};
type DiscoveredTool={name:string;description:string};
type Prepared={nonce:string;fingerprint:string;plugin:Entry;expiresInSeconds:number};
type PluginJob={id:string;provider:string;tool:string;status:string;effect:boolean;attempts:number;createdAt:number;code?:string|null};
type Snapshot={catalog:Entry[];installed:Installed[];connections:Connection[];
 approvals:Approval[];jobs?:PluginJob[];githubScope?:GitHubScope;
 audit:{id:string;at:string;event:string}[]};
const EN:Readonly<Record<string,string>>={"CIRO 插件中心": "CIRO plugin center", "GitHub 仓库": "GitHub repository", "GitHub 允许的仓库": "Allowed GitHub repositories", "GitHub 文件路径": "GitHub file path", "任务已取消": "Job cancelled", "任务结果已加载到 GitHub 文件读取区": "Job result loaded into the GitHub file reader", "允许请求写入，执行前仍要批准": "Writes may be requested; each still needs approval", "全部": "All", "即将开放": "Coming soon", "启用": "Enable", "安装成功。可在左侧管理。": "Installed. Manage it from the list on the left.", "安装插件": "Install plugin", "已停用": "Disabled", "已刷新当前账户可用的 MCP 工具。": "Refreshed the MCP tools available to this account.", "已安装": "Installed", "已授权": "authorized", "已请求取消，执行中的外部操作可能无法撤回": "Cancellation requested; external operations already running may not be reversible", "当前仓库：": "Current repository: ", "授权地址不可信": "Untrusted authorization URL", "插件任务记录": "Plugin job history", "插件已停用": "Plugin disabled", "插件已卸载，调用权限已停止。": "Plugin uninstalled; its tool access has been revoked.", "插件已启用": "Plugin enabled", "插件服务请求失败": "Plugin service request failed", "搜索插件名称或功能": "Search plugins by name or capability", "无法设置仓库权限": "Unable to set repository permissions", "无返回内容": "No content returned", "暂停使用": "Pause", "暂未开放": "Not yet available", "服务器禁止写入": "Server forbids writes", "查看并安装": "View & install", "确定卸载 ": "Uninstall ", "第三方连接已断开": "Third-party connection removed", "结果待人工核对": "Result needs manual review", "请查看下方请求权限，然后确认安装。": "Review the requested permissions below, then confirm.", "读取任务已保存，编号：": "Read job saved, id: ", "；刷新可查看执行状态。": ". Refresh to see its status.", "；已恢复逐次审批模式。": "; approval-per-action mode restored.", "？关联授权及待审批操作也将被移除。": "? Linked authorizations and pending approvals will also be removed.", "GitHub OAuth 尚未由服务器管理员配置。你可以安装插件、选择仓库，但暂时不能连接账户；不需要把密钥发给 CIRO。": "GitHub OAuth has not been configured by the server administrator. You can install the plugin and pick a repository, but cannot connect an account yet. Never send secrets to CIRO.", "GitHub 仓库授权范围": "GitHub repository scope", "Supabase 已授权 MCP 工具": "Authorized Supabase MCP tools", "像应用商店一样自由挑选、安装和管理工具。CIRO 不会在聊天中自行安装插件。": "Browse, install and manage tools like an app store. CIRO never installs plugins on its own from chat.", "先选择服务端已允许的仓库。聊天和 Agent 只能操作这个仓库；切换仓库时权限恢复为逐次审批。": "Pick a repository the server allows. Chat and agents can only use this repository; switching resets permissions to per-action approval.", "刷新": "Refresh", "加入可靠后台队列": "Queue as background job", "卸载": "Uninstall", "发现已授权工具": "Discover authorized tools", "发现插件": "Discover plugins", "取消": "Cancel", "只读任务可安全重试；外部写入如果结果未知，不会自动重复提交。": "Read-only jobs retry safely; external writes with unknown results are never resubmitted automatically.", "只读取工具目录，不执行数据修改。数据写入仍需单独批准。": "Only reads the tool catalog; data writes still require separate approval.", "可靠插件任务": "Reliable plugin jobs", "安装与账号授权是两件事。卸载后会阻断 CIRO 对该插件的调用。": "Installing and authorizing an account are separate steps. Uninstalling blocks CIRO from calling the plugin.", "安装后不会自动登录第三方账号。需要使用时，再由用户亲自授权；高风险操作仍需审批。": "Installing never signs in to third-party accounts. You authorize when needed; risky actions still require approval.", "尚未安装。请从右侧市场选择插件。": "Nothing installed yet. Pick a plugin from the marketplace.", "工具验证：读取仓库文件": "Tool check: read a repository file", "已安装插件管理": "Manage installed plugin", "待审批工具调用": "Tool calls awaiting approval", "我的插件": "My plugins", "批准本次": "Approve once", "拒绝": "Reject", "插件中心": "Plugin center", "插件请求的权限": "Requested permissions", "服务器还没有设置 GitHub 仓库白名单（CIRO_GITHUB_REPOS）。请联系部署管理员；不用输入个人 Token。": "The server has no GitHub repository allow-list (CIRO_GITHUB_REPOS) yet. Ask your administrator; never paste a personal token.", "查看结果": "View result", "注意：GitHub OAuth 的 repo 授权本身可能覆盖多个仓库；CIRO 工具网关只允许使用这里选中的仓库。请在 GitHub 授权页核对权限。": "Note: GitHub OAuth repo scope may cover many repositories; the CIRO tool gateway only allows the repository selected here. Review permissions on GitHub's authorization page.", "确认安装": "Confirm install", "读取文件": "Read file", "选择仓库": "Select repository", "当前范围：": "Current scope: ", "尚未选择": "Not selected", "开发": "Development", "效率": "Productivity", "CIRO 官方适配器": "CIRO official adapter", "断开 ": "Disconnect ", "连接 ": "Connect ", " 账户": " account", "确认安装 ": "Install ", "版本 ": "Version ", " · 请确认以上权限。": " · Please confirm the permissions above.", " · 尝试 ": " · attempts: ", " 次": "", "读取仓库文件、创建分支和提交代码。": "Read repository files, create branches and commit code.", "连接数据库与项目工具（正在完成用户级 MCP 授权）。": "Connect databases and project tools (user-level MCP authorization in progress).", "邮件搜索、草稿及发送（尚未开放连接）。": "Search, draft and send mail (connection not yet available).", "云端文件连接（尚未开放连接）。": "Cloud file access (connection not yet available).", "查看及管理日程（尚未开放连接）。": "View and manage calendar events (connection not yet available)."};
async function api<T>(path:string,body?:unknown):Promise<T>{
 const response=await accountFetch("/api/plugins"+path,{
  method:body===undefined?"GET":"POST",
  ...(body===undefined?{}:{headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})
 });
 const result=await response.json();
 if(!response.ok)throw new Error(result.error||"Plugin service request failed");
 return result as T;
}
export default function PluginConnections({language="zh-CN"}:{language?:Language}={}){
 const t=(text:string)=>localize(language,text,(k)=>EN[k]);
 const [state,setState]=useState<Snapshot|null>(null);
 const [selected,setSelected]=useState("github");
 const [query,setQuery]=useState("");
 const [category,setCategory]=useState(t("全部"));
 const [pending,setPending]=useState<Prepared|null>(null);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [busy,setBusy]=useState(false);
 const [repo,setRepo]=useState("");
 const [path,setPath]=useState("README.md");
 const [result,setResult]=useState("");
 const [repoChoice,setRepoChoice]=useState("");
 const [discoveredTools,setDiscoveredTools]=useState<DiscoveredTool[]>([]);
 const refresh=useCallback(async()=>{
  try{
   const snapshot=await api<Snapshot>("/catalog");
   setState(snapshot);
   setRepoChoice(snapshot.githubScope?.selectedRepository||
     snapshot.githubScope?.allowedRepositories[0]||"");
   setRepo(snapshot.githubScope?.selectedRepository||"");
   setError("");
  }
  catch(e){setError(e instanceof Error?e.message:String(e));}
 },[]);
 useEffect(()=>{void refresh();},[refresh]);
 const categories=useMemo(()=>[t("全部"),...new Set((state?.catalog||[]).map(x=>x.category))],[state]);
 const available=(state?.catalog||[]).filter(x=>(category===t("全部")||category===x.category)&&
  (x.title+" "+x.description).toLowerCase().includes(query.trim().toLowerCase()));
 const current=state?.catalog.find(x=>x.id===selected);
 const githubScope=state?.githubScope;
 const active=state?.installed.find(x=>x.id===selected);
 const connected=state?.connections.find(x=>x.provider===selected);
 async function action(fn:()=>Promise<void>){
  setBusy(true);setError("");setNotice("");
  try{await fn();await refresh();}
  catch(e){setError(e instanceof Error?e.message:String(e));}
  finally{setBusy(false);}
 }
 return <section className="ciro-market" aria-label={t("CIRO 插件中心")}>
   <div className="ciro-market-head"><div><span>CIRO PLUGIN CENTER · V0.8</span><h2>{t("插件中心")}</h2>
    <p>{t("像应用商店一样自由挑选、安装和管理工具。CIRO 不会在聊天中自行安装插件。")}</p></div>
    <button className="wb-secondary" onClick={()=>void refresh()}>{t("刷新")}</button></div>
   {error&&<p className="ciro-market-error" role="alert">{error}</p>}
   {notice&&<p className="ciro-market-notice" role="status">{notice}</p>}
   <div className="ciro-market-layout">
    <aside className="ciro-market-installed"><h3>{t("我的插件")} <small>{state?.installed.length||0}</small></h3>
     {!state?.installed.length&&<p className="ciro-market-muted">{t("尚未安装。请从右侧市场选择插件。")}</p>}
     {state?.installed.map(item=>{
      const entry=state.catalog.find(x=>x.id===item.id);
      return <button key={item.id} className={"ciro-market-nav "+(selected===item.id?"active":"")}
       onClick={()=>setSelected(item.id)} aria-pressed={selected===item.id}>
       <span className="ciro-market-logo">{item.id==="github"?"GH":item.id==="supabase"?"SB":item.id==="gmail"?"GM":"+"}</span>
       <span><strong>{entry?.title||item.id}</strong><small>{item.enabled?t("已安装"):t("已停用")}</small></span>
      </button>;
     })}
     <div className="ciro-market-hint">{t("安装与账号授权是两件事。卸载后会阻断 CIRO 对该插件的调用。")}</div>
    </aside>
    <div className="ciro-market-store">
     <header className="ciro-market-toolbar"><h3>{t("发现插件")}</h3><input aria-label={t("搜索插件")} placeholder={t("搜索插件名称或功能")} value={query} onChange={e=>setQuery(e.target.value)}/></header>
     <div className="ciro-market-categories">{categories.map(x=><button key={x} className={category===x?"active":""}
      onClick={()=>setCategory(x)}>{t(x)}</button>)}</div>
     <div className="ciro-market-grid">{available.map(item=>{
      const installed=state?.installed.some(x=>x.id===item.id);
      return <button key={item.id} className={"ciro-market-tile "+(selected===item.id?"active":"")} onClick={()=>{setSelected(item.id);setPending(null);}}>
       <span className="ciro-market-logo">{item.id==="github"?"GH":item.id==="supabase"?"SB":item.id==="gmail"?"GM":item.id==="calendar"?"CA":"GD"}</span>
       <strong>{item.title}</strong><small>{t(item.category)} · {t(item.publisher)}</small>
       <p>{t(item.description)}</p><span className="ciro-market-tile-status">{installed?t("已安装"):item.ready?t("查看并安装"):t("即将开放")}</span>
      </button>;
     })}</div>
     {current&&<div className="ciro-market-detail">
      <div className="ciro-market-detail-header"><div><span className="ciro-market-logo">{current.title.slice(0,2)}</span>
       <div><h3>{current.title}</h3><small>{t(current.publisher)} · v{current.version}</small></div></div>
       {active?<button className="wb-secondary" disabled={busy} onClick={()=>void action(async()=>{
        if(!window.confirm(t("确定卸载 ")+current.title+t("？关联授权及待审批操作也将被移除。")))return;
        await api("/installed/"+current.id+"/uninstall",{});
        setPending(null);setNotice(t("插件已卸载，调用权限已停止。"));
       })}>{t("卸载")}</button>:<button className="wb-primary" disabled={busy||!current.ready} onClick={()=>void action(async()=>{
        setPending(await api<Prepared>("/marketplace/"+current.id+"/prepare",{}));
        setNotice(t("请查看下方请求权限，然后确认安装。"));
       })}>{current.ready?t("安装插件"):t("暂未开放")}</button>}</div>
      <p>{t(current.description)}</p>
      <h4>{t("插件请求的权限")}</h4><div className="ciro-market-tags">{current.permissions.map(x=><code key={x}>{x}</code>)}</div>
      <p className="ciro-market-muted">{t("安装后不会自动登录第三方账号。需要使用时，再由用户亲自授权；高风险操作仍需审批。")}</p>
      {pending?.plugin.id===current.id&&!active&&<div className="ciro-market-confirm">
       <strong>{t("确认安装 ")}{current.title}?</strong><p>{t("版本 ")}{pending.plugin.version}{t(" · 请确认以上权限。")}</p>
       <button className="wb-secondary" onClick={()=>setPending(null)}>{t("取消")}</button>
       <button className="wb-primary" disabled={busy} onClick={()=>void action(async()=>{
        await api("/marketplace/"+current.id+"/install",{nonce:pending.nonce,fingerprint:pending.fingerprint,confirm:true});
        setPending(null);setNotice(t("安装成功。可在左侧管理。"));
       })}>{t("确认安装")}</button>
      </div>}
      {active&&<div className="ciro-market-management"><h4>{t("已安装插件管理")}</h4>
       {current.id==="github"&&<div className="ciro-market-scope">
        <h4>{t("GitHub 仓库授权范围")}</h4>
        <p className="ciro-market-muted">{t("先选择服务端已允许的仓库。聊天和 Agent 只能操作这个仓库；切换仓库时权限恢复为逐次审批。")}</p>
        {!!githubScope?.allowedRepositories.length?<>
         <div className="ciro-market-scope-picker">
          <select aria-label={t("GitHub 允许的仓库")} value={repoChoice} onChange={e=>setRepoChoice(e.target.value)}>
           {githubScope?.allowedRepositories.map(name=><option key={name} value={name}>{name}</option>)}
          </select>
          <button className="wb-secondary" disabled={busy||!repoChoice||
            repoChoice===githubScope?.selectedRepository} onClick={()=>void action(async()=>{
             const response=await accountFetch("/api/workbench/permissions",{
              method:"POST",headers:{"Content-Type":"application/json"},
              body:JSON.stringify({mode:"request",repo:repoChoice,custom:githubScope?.custom||{}})
             });
             const data=await response.json();
             if(!response.ok)throw new Error(data.error||t("无法设置仓库权限"));
             setDiscoveredTools([]);
             setNotice(t("当前仓库：")+data.policy.repo+t("；已恢复逐次审批模式。"));
          })}>{t("选择仓库")}</button>
         </div>
         <p className="ciro-market-muted">{t("当前范围：")}{githubScope?.selectedRepository||t("尚未选择")} · {githubScope?.writesEnabled?t("允许请求写入，执行前仍要批准"):t("服务器禁止写入")}</p>
        </>:<p className="ciro-market-error">{t("服务器还没有设置 GitHub 仓库白名单（CIRO_GITHUB_REPOS）。请联系部署管理员；不用输入个人 Token。")}</p>}
        <p className="ciro-market-muted">{t("注意：GitHub OAuth 的 repo 授权本身可能覆盖多个仓库；CIRO 工具网关只允许使用这里选中的仓库。请在 GitHub 授权页核对权限。")}</p>
        {!githubScope?.oauthConfigured&&<p className="ciro-market-muted">{t("GitHub OAuth 尚未由服务器管理员配置。你可以安装插件、选择仓库，但暂时不能连接账户；不需要把密钥发给 CIRO。")}</p>}
       </div>}
       <button className="wb-secondary" disabled={busy} onClick={()=>void action(async()=>{
        await api("/installed/"+current.id+"/enabled",{enabled:!active.enabled});
        setNotice(active.enabled?t("插件已停用"):t("插件已启用"));
       })}>{active.enabled?t("暂停使用"):t("启用")}</button>
       {(current.id==="github"||current.id==="supabase")&&active.enabled&&(connected?<button className="wb-secondary" disabled={busy} onClick={()=>void action(async()=>{
        await api("/"+current.id+"/disconnect",{});setDiscoveredTools([]);setNotice(t("第三方连接已断开"));
       })}>{t("断开 ")}{current.title}{t(" 账户")} ({connected.account?.login||connected.account?.email||t("已授权")})</button>:
       <button className="wb-primary" disabled={busy||(current.id==="github"&&(!githubScope?.selectedRepository||!githubScope?.oauthConfigured))} onClick={()=>void action(async()=>{
        const out=await api<{authorizeUrl:string}>("/"+current.id+"/connect",{});
        const target=new URL(out.authorizeUrl);
        if(current.id==="github"?target.origin!=="https://github.com":
          !(target.protocol==="https:"&&target.hostname.endsWith(".supabase.co")))
          throw new Error(t("授权地址不可信"));
        window.location.assign(target.href);
       })}>{t("连接 ")}{current.title}{t(" 账户")}</button>)}
       {current.id==="supabase"&&connected&&active.enabled&&<div className="ciro-market-scope">
        <h4>{t("Supabase 已授权 MCP 工具")}</h4>
        <p className="ciro-market-muted">{t("只读取工具目录，不执行数据修改。数据写入仍需单独批准。")}</p>
        <button className="wb-secondary" disabled={busy} onClick={()=>void action(async()=>{
          const out=await api<{result?:{tools?:DiscoveredTool[]}}>("/invoke",{
            provider:"supabase",tool:"supabase.list_tools",args:{},source:"manual"
          });
          setDiscoveredTools(out.result?.tools||[]);
          setNotice(t("已刷新当前账户可用的 MCP 工具。"));
        })}>{t("发现已授权工具")}</button>
        {discoveredTools.map(tool=><p key={tool.name}><strong>{tool.name}</strong> — {tool.description}</p>)}
       </div>}
       {current.id==="github"&&connected&&active.enabled&&<div className="ciro-market-test">
         <h4>{t("工具验证：读取仓库文件")}</h4>
         <input aria-label={t("GitHub 仓库")} value={repo} onChange={e=>setRepo(e.target.value)} placeholder="owner/repo"/>
         <input aria-label={t("GitHub 文件路径")} value={path} onChange={e=>setPath(e.target.value)}/>
         <button className="wb-secondary" disabled={busy||!repo||!path} onClick={()=>void action(async()=>{
          const out=await api<{result?:{content?:string}}>("/invoke",{provider:"github",tool:"github.read_file",source:"manual",args:{repo,path}});
          setResult(out.result?.content||t("无返回内容"));
         })}>{t("读取文件")}</button>
         <button className="wb-secondary" disabled={busy||!repo||!path} onClick={()=>void action(async()=>{
          const job=await api<{id:string}>("/jobs",{provider:"github",tool:"github.read_file",
            args:{repo,path},idempotencyKey:crypto.randomUUID()});
          setNotice(t("读取任务已保存，编号：")+job.id.slice(0,8)+t("；刷新可查看执行状态。"));
         })}>{t("加入可靠后台队列")}</button>
         {result&&<pre>{result.slice(0,5000)}</pre>}
        </div>}
      </div>}
     </div>}
     {!!state?.jobs?.length&&<div className="ciro-market-detail" aria-label={t("插件任务记录")}>
      <h3>{t("可靠插件任务")}</h3>
      <p className="ciro-market-muted">{t("只读任务可安全重试；外部写入如果结果未知，不会自动重复提交。")}</p>
      {state.jobs.slice(0,10).map(job=><div key={job.id} className="ciro-market-job">
       <strong>{job.provider} · {job.tool}</strong>
       <p>{job.status==="uncertain"?t("结果待人工核对"):job.status} · 尝试 {job.attempts} 次</p>
       {["queued","leased"].includes(job.status)&&
        <button className="wb-secondary" disabled={busy} onClick={()=>void action(async()=>{
         const updated=await api<PluginJob>("/jobs/"+job.id+"/cancel",{});
         setNotice(updated.status==="cancel_requested"?t("已请求取消，执行中的外部操作可能无法撤回"):t("任务已取消"));
        })}>{t("取消")}</button>}
       {job.status==="succeeded"&&!job.effect&&
        <button className="wb-secondary" disabled={busy} onClick={()=>void action(async()=>{
         const full=await api<{result?:unknown}>("/jobs/"+job.id);
         setResult(JSON.stringify(full.result??{},null,2).slice(0,5000));
         setNotice(t("任务结果已加载到 GitHub 文件读取区"));
        })}>{t("查看结果")}</button>}
      </div>)}
     </div>}
     {!!state?.approvals.length&&<div className="ciro-market-detail"><h3>{t("待审批工具调用")}</h3>
      {state.approvals.map(x=><div key={x.id}><p>{x.summary}</p>
       <button className="wb-secondary" disabled={busy} onClick={()=>void action(async()=>{await api("/approvals/"+x.id,{decision:"reject"});})}>{t("拒绝")}</button>
       <button className="wb-primary" disabled={busy} onClick={()=>void action(async()=>{await api("/approvals/"+x.id,{decision:"approve"});})}>{t("批准本次")}</button>
      </div>)}</div>}
    </div>
   </div>
  </section>;
}
