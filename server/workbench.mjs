import express from "express";
import { join } from "node:path";
import { createWorkbenchStore } from "./workbench-store.mjs";
import { checkedString, decision, normalizePolicy, safeBranch, safeFilePath } from "./agent-policy.mjs";
import { githubConfig, verifyGitHubRepo, readGitHubFile, writeGitHubFile, createGitHubBranch } from "./github-client.mjs";
import { createCommercialRouter } from "./commercial.mjs";
import { selectedSkills } from "./commercial-catalog.mjs";
import { assertBudgetAdmission } from "./commercial-billing.mjs";
import {issueAgentPluginCapability} from "./plugin-agent-capability.mjs";

const PLUGIN_LABELS = {
  github: {title:"GitHub", description:"Read files and create scoped branch commits using a server-side credential."},
  scheduler: {title:"Scheduled tasks", description:"Persistent recurring goals while this server process is running."},
  runner: {title:"CIRO Agent runtime", description:"Delegated agents, testing and red-team adapters. Requires separate runtime and verifier."}
};
const PHASES = [
  {phase:"plan",actor:"Planner",service:"runner"},
  {phase:"implement",actor:"Builder",service:"runner"},
  {phase:"test",actor:"Tester",service:"verifier"},
  {phase:"redteam",actor:"Red Team",service:"verifier"},
  {phase:"audit",actor:"Auditor",service:"verifier"}
];
function now(){return new Date().toISOString();}
function runtimeConfig(env){
  return { runner: Boolean(env.CIRO_AGENT_RUNNER_URL && env.CIRO_AGENT_RUNNER_TOKEN),
    verifier: Boolean(env.CIRO_VERIFIER_URL && env.CIRO_VERIFIER_TOKEN) };
}
function shortText(x,max=4500){return String(x || "").slice(0,max);}
function validatedMode(value){if(!["goal","plan"].includes(value))throw new Error("Mode must be goal or plan.");return value;}
function cleanRunnerEndpoint(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" && !(url.protocol==="http:"&&["localhost","127.0.0.1","[::1]"].includes(url.hostname))) {
    throw new Error("Runner must use HTTPS or a loopback HTTP address.");
  }
  if (url.username || url.password || url.search || url.hash) throw new Error("Runner URL cannot include credentials or queries.");
  return url.toString().replace(/\/+$/, "");
}
function normalizeEvidence(items){
  if(!Array.isArray(items))return [];
  return items.slice(0,20).filter(x=>x&&typeof x==="object"&&typeof x.type==="string"&&typeof x.digest==="string"&&/^[a-f0-9]{64}$/.test(x.digest))
    .map(x=>({type:shortText(x.type,50),digest:x.digest,location:shortText(x.location,400)}));
}
function normalizePlan(items) {
  if (!Array.isArray(items) || items.length<1 || items.length>20) throw new Error("Planner returned no usable task plan.");
  return items.map((x,i)=>({
    id:String(i+1), title:checkedString(x?.title,"plan title",130),
    role:["Planner","Builder","Tester","Red Team","Auditor","Integrator"].includes(x.role)?x.role:"Builder",
    acceptance:checkedString(x?.acceptance || "Evidence-backed completion","acceptance",380),
    status:"pending"
  }));
}
function serverCapabilities(env,store){
  const c=githubConfig(env), r=runtimeConfig(env);
  return {
    repo:c.repos,github:{configured:c.configured,writeEnabled:c.writeEnabled,allowedRepositories:c.repos,
      selectedRepo:store.get().policy.repo || ""},
    runtime:{runner:r.runner,verifier:r.verifier,working:r.runner&&r.verifier},
    plugins:Object.entries(PLUGIN_LABELS).map(([id,value])=>({
      id,...value,enabled:store.get().plugins[id]===true,
      ready:id==="github"?c.configured:id==="scheduler"?true:r.runner,
      detail:id==="github"?(c.configured?"Server credential present":"Configure CIRO_GITHUB_TOKEN on the server"):
        id==="runner"?(r.runner?"Runner adapter configured":"CIRO_AGENT_RUNNER_URL not configured"):
        "Runs only while this local client server is online"
    }))
  };
}
export function createWorkbenchRouter({env=process.env,dir,fetchFn=fetch,automaticScheduler=true,notify=()=>{}}={}) {
  const router=express.Router(),store=createWorkbenchStore(dir || env.CIRO_WORKSPACE_DATA_DIR || join(process.cwd(),".ciro-runtime"));
  const adapterOptions={env,fetchFn};
  const running=new Set();
  const activeRequests=new Map();
  const commercial=createCommercialRouter({env,store,notify});
  // Intentional local-only API. For production, add real login, CSRF and per-user isolation.
  router.use((req,res,next)=>{
    if(["POST","PUT","PATCH","DELETE"].includes(req.method)){
      const origin=req.get("origin");
      const allowed = new Set([
        "http://127.0.0.1:5173","http://localhost:5173","http://127.0.0.1:8787","http://localhost:8787",
        ...(env.CIRO_ALLOWED_ORIGINS||"").split(",").map(x=>x.trim()).filter(Boolean)
      ]);
      let sameOrigin=false;
      try {
        const parsed=new URL(origin),host=req.get("host")||"";
        const localHost=/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
        sameOrigin=parsed.host===host && (parsed.protocol==="https:" ||
          (parsed.protocol==="http:"&&localHost));
      }catch{/* malformed origin denied */}
      if(origin && !sameOrigin && !allowed.has(origin))
        return res.status(403).json({error:"Origin is not authorized."});
      if(!req.is("application/json"))return res.status(415).json({error:"Only JSON requests are accepted."});
    }
    res.set("Cache-Control","no-store");
    next();
  });
  // Authenticated accounts must use the installed-plugin gateway for GitHub.
  // The V0.7 server-wide token endpoints are local development compatibility only.
  router.use((req,res,next)=>{
    if(env.CIRO_ACCOUNTS_ENABLED==="true" &&
       (/^\/github(?:\/|$)/.test(req.path)||req.path==="/plugins/github/toggle"))
      return res.status(410).json({error:"Use the per-user GitHub plugin in Plugin Center."});
    next();
  });
  const wrap=fn=>(req,res)=>Promise.resolve().then(()=>fn(req,res)).catch(error=>{
    res.status(error.statusCode||400).json({error:error.message||"Workbench action failed."});
  });
  const findGoal=id=>store.get().goals.find(g=>g.id===id);
  function log(goal,event,details=""){
    goal.events.unshift({time:now(),event,details:shortText(details,400)});
    goal.events=goal.events.slice(0,120);
    goal.updatedAt=now();
  }
  function approval(action,summary,scope,payload){
    const item={id:store.id(),createdAt:now(),type:action,summary,scope,payload,status:"pending"};
    store.change("approval.created",{action,scope},s=>{s.approvals.unshift(item);s.approvals=s.approvals.slice(0,150);});
    return {approvalRequired:true,id:item.id,summary:item.summary};
  }
  async function invokeAdapter(service,goal,phase,context={}) {
    const uri=service==="runner"?env.CIRO_AGENT_RUNNER_URL:env.CIRO_VERIFIER_URL;
    const token=service==="runner"?env.CIRO_AGENT_RUNNER_TOKEN:env.CIRO_VERIFIER_TOKEN;
    if(!uri||!token)throw new Error(service+" service has not been configured.");
    const endpoint=cleanRunnerEndpoint(uri)+"/workbench/step";
    const controller=new AbortController();
    activeRequests.set(goal.id,controller);
    const timeout=setTimeout(()=>controller.abort(),180_000);
    try {
      // Never forward credentials for external systems, only explicitly scoped policy.
      const pluginCapability=(service==="runner"&&goal.mode==="goal"&&goal.ownerId&&
        env.CIRO_AGENT_TOOL_CAPABILITY_SECRET)?issueAgentPluginCapability({secret:env.CIRO_AGENT_TOOL_CAPABILITY_SECRET,goal}):null;
      const response=await fetchFn(endpoint,{
        method:"POST",signal:controller.signal,
        headers:{"Content-Type":"application/json","Authorization":"Bearer "+token,
          "X-Ciro-Workbench-Version":"1"},
        body:JSON.stringify({jobId:goal.id,goal:goal.goal,mode:goal.mode,phase,repo:goal.repo,
          plan:goal.plan,attempt:goal.attempt,policy:store.get().policy,
          skills:selectedSkills(env,store.get()),context,
          ...(pluginCapability?{pluginCapability}:{}) ,
          requirements:{ evidenceDigests:true, independentVerifier:service==="verifier" }})
      });
      if(!response.ok)throw new Error(service+" returned HTTP "+response.status);
      const raw=await response.text();
      if(raw.length>200_000)throw new Error("Runner response too large.");
      const result=JSON.parse(raw);
      if(!result||typeof result!=="object"||typeof result.ok!=="boolean")throw new Error("Runner response schema invalid.");
      return {ok:result.ok,summary:shortText(result.summary,1200),
        evidence:normalizeEvidence(result.evidence),plan:result.plan,
        retryable:result.retryable===true};
    }finally{
      clearTimeout(timeout);
      if(activeRequests.get(goal.id)===controller)activeRequests.delete(goal.id);
    }
  }
  async function workGoal(id) {
    if(running.has(id))return;
    const initialGoal=findGoal(id);
    if(!initialGoal)return;
    const caps=runtimeConfig(env);
    if(!caps.runner){store.change("goal.waiting_runtime",{id},()=>{initialGoal.status="waiting_runtime";log(initialGoal,"waiting","CIRO agent runtime is not connected.");});return;}
    running.add(id);
    try{
      for(let loops=0;loops<40;loops++){
        const goal=findGoal(id);
        if(!goal||goal.status==="cancelled"||goal.status==="paused")break;
        if(!store.get().plugins.runner || goal.repo!==store.get().policy.repo ||
           (goal.policySnapshot && goal.policySnapshot!==JSON.stringify(store.get().policy))) {
          store.change("goal.authorization.revoked",{id},()=>{
            goal.status="paused";goal.error="Workspace permissions changed; resume requires fresh authorization.";
            log(goal,"revoked",goal.error);
          });
          break;
        }
        try {
          if(goal.phase!=="plan")assertBudgetAdmission(env,store.get());
        }catch(error){
          store.change("goal.budget.blocked",{id},()=>{
            goal.status="paused";goal.error=shortText(error.message);log(goal,"budget",goal.error);
          });
          break;
        }
        const step=PHASES.find(x=>x.phase===goal.phase);
        if(!step)break;
        if(step.service==="verifier"&&!caps.verifier){
          store.change("goal.waiting_verifier",{id},()=>{goal.status="waiting_verifier";log(goal,"waiting","Independent verifier is not configured.");});
          break;
        }
        store.change("goal.phase.started",{id,phase:step.phase,actor:step.actor},()=>{
          goal.status="running";log(goal,step.phase,step.actor+" started.");
        });
        let response;
        try{
          if(step.phase==="implement" && goal.plan.length){
            const results=[];
            for(const assignment of goal.plan){
              if(goal.status==="paused"||goal.status==="cancelled")break;
              // Each task is assigned to its planned agent role. Serialized to preserve
              // repository/test dependencies; the external CIRO runner handles its own safe parallelism.
              store.change("goal.agent.assigned",{id,task:assignment.id,role:assignment.role},()=>{
                assignment.status="running";
                log(goal,"delegated",assignment.role+": "+assignment.title);
              });
              const item=await invokeAdapter("runner",goal,"implement",{task:assignment,role:assignment.role,lastResult:goal.lastResult});
              results.push(item);
              store.change("goal.agent.result",{id,task:assignment.id,ok:item.ok},()=>{
                assignment.status=item.ok?"completed":"failed";
                goal.evidence.push(...item.evidence.map(x=>({...x,phase:"implement",actor:assignment.role,taskId:assignment.id})));
                log(goal,"agent",assignment.title+": "+item.summary);
              });
              if(!item.ok)break;
            }
            response={ok:results.length===goal.plan.length&&results.every(x=>x.ok),
              summary:results.map(x=>x.summary).join(" | ").slice(0,1200),evidence:[],plan:null};
          } else {
            response=await invokeAdapter(step.service,goal,step.phase,{lastResult:goal.lastResult});
          }
        }
        catch(error){
          if(goal.status==="paused"||goal.status==="cancelled")break;
          store.change("goal.phase.failed",{id,phase:step.phase},()=>{
            goal.status="blocked";goal.error=shortText(error.message);log(goal,"error",goal.error);
          });
          break;
        }
        if(!findGoal(id)||goal.status==="cancelled"||goal.status==="paused")break;
        store.change("goal.phase.finished",{id,phase:step.phase,ok:response.ok},()=>{
          goal.lastResult={phase:step.phase,ok:response.ok,summary:response.summary};
          goal.evidence.push(...response.evidence.map(x=>({...x,phase:step.phase,actor:step.actor})));
          goal.evidence=goal.evidence.slice(-80);
          log(goal,step.phase,response.summary|| (response.ok?"Step passed":"Step failed"));
          if(step.phase==="plan"&&response.ok){
            try{goal.plan=normalizePlan(response.plan);}
            catch(error){goal.status="blocked";goal.error=error.message;return;}
          }
          if(goal.status==="blocked")return;
          if(!response.ok){
            if(step.phase==="test"||step.phase==="redteam"){
              if(goal.attempt>=3){goal.status="blocked";goal.error="Maximum 3 repair attempts reached.";return;}
              goal.phase="repair";goal.status="running";goal.attempt++;return;
            }
            if(step.phase==="repair"){goal.status="blocked";goal.error="Repair step failed.";return;}
            goal.status="blocked";goal.error="Failed at "+step.phase;return;
          }
          if(step.phase==="plan"){goal.phase="implement";
            if(goal.mode==="plan")goal.status="planned";}
          else if(step.phase==="implement")goal.phase="test";
          else if(step.phase==="test")goal.phase="redteam";
          else if(step.phase==="redteam")goal.phase="audit";
          else if(step.phase==="audit"){
            // The verifier must have returned evidence for independent testing and redteam;
            // a model's "PASS" text alone is never a completed acceptance.
            const test=goal.evidence.some(x=>x.phase==="test");
            const redteam=goal.evidence.some(x=>x.phase==="redteam");
            const audit=goal.evidence.some(x=>x.phase==="audit");
            goal.status=test&&redteam&&audit?"completed":"needs_evidence";
          }
        });
        if(goal.mode==="plan"&&goal.status==="planned")break;
        if(["blocked","needs_evidence","completed"].includes(goal.status))break;
        if(goal.phase==="repair"){
          // An isolated fixer is required; never silently invoke arbitrary local shell.
          try {
            const repair=await invokeAdapter("runner",goal,"repair",{failure:goal.lastResult});
            store.change("goal.repair",{id,ok:repair.ok},()=>{
              goal.evidence.push(...repair.evidence.map(x=>({...x,phase:"repair",actor:"Builder"})));
              log(goal,"repair",repair.summary);
              if(repair.ok){goal.phase="test";goal.status="running";} else {goal.status="blocked";goal.error="Repair attempt failed.";}
            });
          } catch(error) {
            store.change("goal.repair.failed",{id},()=>{goal.status="blocked";goal.error=shortText(error.message);log(goal,"error",goal.error);});
          }
          if(goal.status==="blocked")break;
        }
      }
    }finally{
      running.delete(id);
      const latest=findGoal(id);
      if(latest?.status==="queued")queueMicrotask(()=>void workGoal(id));
      else if(latest?.status==="running")store.change("goal.phase.limit",{id},()=>{
        latest.status="blocked";latest.error="Maximum workflow phase count reached.";
        log(latest,"blocked",latest.error);
      });
    }
  }
  function requestStart(goal, action="task.run") {
    if(goal.repo!==store.get().policy.repo) throw new Error("Goal repository scope changed; start a new scoped task.");
    const runtime=runtimeConfig(env);
    if(!store.get().plugins.runner) throw new Error("CIRO runtime plugin is disabled.");
    if(!runtime.runner){
      store.change("goal.waiting_runtime",{id:goal.id},()=>{goal.status="waiting_runtime";log(goal,"waiting","Configure the CIRO runner before executing.");});
      return {status:"waiting_runtime",goal};
    }
    if(!(goal.mode==="plan" && goal.phase==="plan")) assertBudgetAdmission(env,store.get());
    const access=(goal.mode==="plan" && goal.phase==="plan") ? { result: "allow" } : decision(store.get().policy,action,{repo:goal.repo});
    if(access.result==="deny")throw new Error(access.reason);
    if(access.result==="approval"){
      const a=approval(action,"Run delegated goal: "+goal.title,{repo:goal.repo},{goalId:goal.id});
      store.change("goal.waiting_approval",{id:goal.id},()=>{goal.status="waiting_approval";log(goal,"approval",a.id);});
      return {status:"waiting_approval",goal,approval:a};
    }
    store.change("goal.queued",{id:goal.id},()=>{
      goal.status="queued";goal.policySnapshot=JSON.stringify(store.get().policy);
      log(goal,"queued","Delegated execution queued.");
    });
    queueMicrotask(()=>void workGoal(goal.id));
    return {status:"queued",goal};
  }
  router.use("/commercial",commercial.router);
  router.get("/state",(_req,res)=>res.json({...store.snapshot(),capabilities:serverCapabilities(env,store)}));
  router.post("/permissions",wrap((req,res)=>{
    const prev=store.get().policy;
    const next=normalizePolicy(req.body,prev);
    const changed=JSON.stringify(prev)!==JSON.stringify(next);
    store.change("permissions.updated",{mode:next.mode,repo:next.repo},s=>{s.policy=next;});
    if(changed) {
      for(const id of running) {
        activeRequests.get(id)?.abort();
        const goal=findGoal(id);
        if(goal)store.change("goal.permission.revoked",{id},()=>{
          goal.status="paused";goal.error="Permissions changed during execution.";
          log(goal,"revoked",goal.error);
        });
      }
    }
    res.json({policy:next});
  }));
  router.get("/github/status",(_req,res)=>res.json(serverCapabilities(env,store).github));
  router.post("/github/connect",wrap(async(req,res)=>{
    const repo=checkedString(req.body?.repo,"repository",210);
    const verified=await verifyGitHubRepo(repo,adapterOptions);
    const previousRepo=store.get().policy.repo;
    store.change("github.selected",{repo},s=>{
      const changed=s.policy.repo!==repo;
      s.policy={...s.policy,repo, ...(changed?{mode:"request"}:{})};
    });
    if(previousRepo!==repo)for(const id of running){
      activeRequests.get(id)?.abort();
      const goal=findGoal(id);
      if(goal)store.change("goal.repository.revoked",{id},()=>{
        goal.status="paused";goal.error="Repository scope changed.";
        log(goal,"revoked",goal.error);
      });
    }
    res.json({...verified,policy:store.get().policy});
  }));
  router.get("/github/file",wrap(async(req,res)=>{
    const repo=store.get().policy.repo;
    if(!repo)throw new Error("Select a repository first.");
    if(!store.get().plugins.github)throw new Error("GitHub plugin is disabled.");
    if(decision(store.get().policy,"github.read",{repo}).result!=="allow")throw new Error("Repository read is outside custom permissions.");
    const path=checkedString(req.query.path,"path",220);
    const branch=typeof req.query.branch==="string"?req.query.branch:"";
    const result=await readGitHubFile(repo,path,branch,adapterOptions);
    res.json(result);
  }));
  async function executeApproved(action,payload){
    const repo=store.get().policy.repo;
    if(!repo||repo!==payload.repo)throw new Error("Repository scope changed; request new approval.");
    if(action==="github.write")return writeGitHubFile(payload,adapterOptions);
    if(action==="github.branch")return createGitHubBranch(payload.repo,payload.branch,adapterOptions);
    if(action==="task.run"){
      assertBudgetAdmission(env,store.get());
      const g=findGoal(payload.goalId);
      if(!g)throw new Error("Goal no longer exists.");
      store.change("goal.approved",{id:g.id},()=>{
        g.status="queued";g.policySnapshot=JSON.stringify(store.get().policy);
        log(g,"approved","Execution approved.");
      });
      queueMicrotask(()=>void workGoal(g.id));return {goalId:g.id,status:"queued"};
    }
    if(action==="schedule.run"){
      const sched=store.get().schedules.find(x=>x.id===payload.scheduleId);
      if(!sched)throw new Error("Schedule no longer exists.");
      return createGoalFromSchedule(sched);
    }
    throw new Error("Unsupported approval action.");
  }
  router.post("/github/write",wrap(async(req,res)=>{
    const repo=store.get().policy.repo;
    if(!store.get().plugins.github)throw new Error("GitHub plugin is disabled.");
    const content=req.body?.content;
    if(typeof content!=="string" || Buffer.byteLength(content,"utf8")>180_000)throw new Error("Invalid content size.");
    const payload={repo,path:safeFilePath(req.body?.path),branch:safeBranch(req.body?.branch),
      content,message:checkedString(req.body?.message,"commit message",150),
      expectedSha:req.body?.expectedSha||undefined};
    const access=decision(store.get().policy,"github.write",{repo});
    if(access.result==="deny")throw new Error(access.reason);
    if(!githubConfig(env).writeEnabled)throw new Error("GitHub writing is disabled; set CIRO_GITHUB_WRITES=true on server.");
    if(access.result==="approval")return res.status(202).json(approval("github.write","Commit "+payload.path+" to "+payload.branch,{repo},payload));
    const result=await executeApproved("github.write",payload);
    store.change("github.commit",{repo,branch:payload.branch,sha:result.commit,path:payload.path});
    res.json(result);
  }));
  router.post("/github/branch",wrap(async(req,res)=>{
    if(!store.get().plugins.github)throw new Error("GitHub plugin is disabled.");
    const repo=store.get().policy.repo,branch=safeBranch(req.body?.branch);
    const access=decision(store.get().policy,"github.branch",{repo});
    if(access.result==="deny")throw new Error(access.reason);
    if(!githubConfig(env).writeEnabled)throw new Error("GitHub writing is disabled on server.");
    if(access.result==="approval")return res.status(202).json(approval("github.branch","Create branch "+branch,{repo},{repo,branch}));
    const result=await executeApproved("github.branch",{repo,branch});
    store.change("github.branch",{repo,branch});
    res.json(result);
  }));
  router.post("/approvals/:id/decision",wrap(async(req,res)=>{
    const d=req.body?.decision;
    if(!["approve","reject"].includes(d))throw new Error("Decision must be approve or reject.");
    const item=store.get().approvals.find(a=>a.id===req.params.id&&a.status==="pending");
    if(!item)throw new Error("Pending approval not found.");
    store.change("approval.decided",{id:item.id,type:item.type,decision:d},()=>{
      item.status=d==="approve"?"processing":"rejected";
    });
    if(d==="reject"){
      if(item.payload.goalId){const goal=findGoal(item.payload.goalId);if(goal)store.change("goal.rejected",{id:goal.id},()=>{goal.status="paused";log(goal,"rejected","Execution rejected.");});}
      return res.json({status:"rejected"});
    }
    try{
      const result=await executeApproved(item.type,item.payload);
      store.change("approval.executed",{id:item.id,type:item.type},()=>{item.status="approved";});
      res.json({status:"approved",result});
    }catch(error){
      store.change("approval.failed",{id:item.id,type:item.type,error:shortText(error.message)},()=>{item.status="failed";});
      throw error;
    }
  }));
  router.post("/goals",wrap((req,res)=>{
    const title=checkedString(req.body?.title,"title",130);
    const goalText=checkedString(req.body?.goal,"goal",12000);
    const mode=validatedMode(req.body?.mode);
    const repo=store.get().policy.repo;
    const goal={id:store.id(),title,goal:goalText,mode,repo,
      ownerId:req.principal?.id||null,createdAt:now(),updatedAt:now(),
      phase:"plan",status:"draft",attempt:0,plan:[],evidence:[],events:[],lastResult:null,error:null};
    store.change("goal.created",{id:goal.id,mode,repo},s=>{
      s.goals.unshift(goal);s.goals=s.goals.slice(0,90);log(goal,"created","Goal accepted; execution not yet verified.");
    });
    const result=requestStart(goal);
    res.status(201).json(result);
  }));
  router.post("/goals/:id/action",wrap((req,res)=>{
    const g=findGoal(req.params.id);
    if(!g)throw new Error("Goal not found.");
    const action=req.body?.action;
    if(action==="cancel"||action==="pause"){
      store.change("goal."+action,{id:g.id},()=>{g.status=action==="cancel"?"cancelled":"paused";log(g,action);});
      activeRequests.get(g.id)?.abort();
      return res.json({status:g.status});
    }
    if(action==="resume"){
      if(!["paused","waiting_runtime","waiting_verifier","blocked","planned","needs_evidence"].includes(g.status))
        throw new Error("Goal cannot be resumed in its current state.");
      g.error=null;
      return res.json(requestStart(g));
    }
    throw new Error("Unknown goal action.");
  }));
  function validateSchedule(body) {
    const recurrence=body?.recurrence;
    if(!["hourly","daily","weekly"].includes(recurrence))throw new Error("Invalid recurrence.");
    const hour=body?.hour,weekday=body?.weekday;
    if(recurrence!=="hourly"&&(!Number.isInteger(hour)||hour<0||hour>23))throw new Error("Invalid hour.");
    if(recurrence==="weekly"&&(!Number.isInteger(weekday)||weekday<0||weekday>6))throw new Error("Invalid weekday.");
    const timezone=checkedString(body?.timezone||"UTC","timezone",90);
    try{new Intl.DateTimeFormat("en-US",{timeZone:timezone}).format();}catch{throw new Error("Invalid timezone.");}
    return {title:checkedString(body.title,"schedule title",130),goal:checkedString(body.goal,"schedule goal",12000),
      recurrence,hour:recurrence==="hourly"?null:hour,weekday:recurrence==="weekly"?weekday:null,timezone};
  }
  router.post("/schedules",wrap((req,res)=>{
    const value=validateSchedule(req.body);
    const schedule={id:store.id(),...value,ownerId:req.principal?.id||null,
      enabled:true,createdAt:now(),lastSlot:null};
    store.change("schedule.created",{id:schedule.id},s=>s.schedules.unshift(schedule));
    res.status(201).json({schedule});
  }));
  router.post("/schedules/:id/toggle",wrap((req,res)=>{
    const s=store.get().schedules.find(x=>x.id===req.params.id);
    if(!s)throw new Error("Schedule not found.");
    store.change("schedule.toggled",{id:s.id,enabled:req.body?.enabled===true},()=>{s.enabled=req.body?.enabled===true;});
    res.json({schedule:s});
  }));
  router.post("/schedules/:id/delete",wrap((req,res)=>{
    store.change("schedule.deleted",{id:req.params.id},s=>{s.schedules=s.schedules.filter(x=>x.id!==req.params.id);});
    res.json({ok:true});
  }));
  router.post("/plugins/:id/toggle",wrap((req,res)=>{
    const id=req.params.id;
    if(!Object.hasOwn(PLUGIN_LABELS,id))throw new Error("Plugin is not in the built-in catalog.");
    const item=serverCapabilities(env,store).plugins.find(x=>x.id===id);
    if(req.body?.enabled===true&&!item.ready)throw new Error("Plugin adapter has not been configured.");
    const enabled=req.body?.enabled===true;
    store.change("plugin.toggled",{id,enabled},s=>{s.plugins[id]=enabled;});
    if(id==="runner"&&!enabled)for(const goalId of running){
      activeRequests.get(goalId)?.abort();
      const goal=findGoal(goalId);
      if(goal)store.change("goal.runtime.revoked",{id:goalId},()=>{
        goal.status="paused";goal.error="Runtime was disabled.";
        log(goal,"revoked",goal.error);
      });
    }
    res.json({ok:true,enabled:store.get().plugins[id]});
  }));
  // Results of scheduled runs, for the notification feed (and the account notification centre).
  const FINISHED={completed:["success","已完成"],needs_evidence:["warning","已结束，但缺少验证证据"],failed:["warning","运行失败"],
    rejected:["warning","已被拒绝"],waiting_runtime:["warning","无法运行：服务器未连接 CIRO 运行时"],waiting_verifier:["warning","已执行，等待独立验证器"]};
  function scheduleEvent(kind,title,body,scheduleId,goalId=null){
    const event={id:store.id(),at:new Date().toISOString(),kind,title:String(title).slice(0,130),body:String(body||"").slice(0,500),scheduleId,goalId};
    store.change("schedule.event",{id:event.id,kind},s=>{
      s.scheduleEvents=[event,...(s.scheduleEvents||[])].slice(0,100);
    });
    try{notify({type:kind==="success"?"success":kind==="warning"?"warning":"info",title:event.title,body:event.body,refId:goalId});}catch{/* accounts off */}
  }
  function reportScheduledGoals(){
    for(const goal of store.get().goals){
      if(!goal.fromSchedule||goal.reported===goal.status||!FINISHED[goal.status])continue;
      const [kind,label]=FINISHED[goal.status];
      const summary=typeof goal.lastResult==="string"?goal.lastResult:goal.lastResult?.summary||goal.error||"";
      store.change("schedule.goal.reported",{id:goal.id,status:goal.status},()=>{goal.reported=goal.status;});
      scheduleEvent(kind,"定时任务「"+goal.title+"」"+label,summary,goal.fromSchedule,goal.id);
    }
  }
  router.get("/schedule-events",(req,res)=>{
    const after=typeof req.query.after==="string"?req.query.after:"";
    const events=(store.get().scheduleEvents||[]).filter(e=>!after||e.at>after);
    res.set("Cache-Control","no-store").json({events:events.slice(0,30),now:new Date().toISOString()});
  });
  function createGoalFromSchedule(schedule){
    const goal={id:store.id(),title:schedule.title,goal:schedule.goal,mode:"goal",fromSchedule:schedule.id,
      repo:store.get().policy.repo,ownerId:schedule.ownerId||null,
      createdAt:now(),updatedAt:now(),phase:"plan",status:"draft",attempt:0,
      plan:[],evidence:[],events:[],lastResult:null,error:null};
    store.change("schedule.goal.created",{scheduleId:schedule.id,id:goal.id},s=>{s.goals.unshift(goal);s.goals=s.goals.slice(0,90);});
    return requestStart(goal,"task.run");
  }
  function tick(at=new Date()){
    const state=store.get();
    if(!state.plugins.scheduler)return;
    for(const schedule of state.schedules){
      if(!schedule.enabled)continue;
      const fields=new Intl.DateTimeFormat("en-US",{timeZone:schedule.timezone,
        year:"numeric",month:"2-digit",day:"2-digit",weekday:"short",hour:"2-digit",hourCycle:"h23"
      }).formatToParts(at);
      const map=Object.fromEntries(fields.map(x=>[x.type,x.value]));
      const hour=Number(map.hour);
      const day=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(map.weekday);
      const slot=[map.year,map.month,map.day].join("-")+"-"+hour;
      const due=schedule.recurrence==="hourly"||(
        hour===schedule.hour&&(schedule.recurrence==="daily"||day===schedule.weekday));
      if(!due||schedule.lastSlot===slot)continue;
      store.change("schedule.fired",{id:schedule.id,slot},()=>{schedule.lastSlot=slot;});
      const access=decision(state.policy,"schedule.run",{repo:state.policy.repo});
      if(access.result==="approval"){
        approval("schedule.run","Scheduled goal: "+schedule.title,{repo:state.policy.repo},{scheduleId:schedule.id,repo:state.policy.repo});
        scheduleEvent("info","定时任务「"+schedule.title+"」等待你批准","到了设定时间。打开协作空间批准后才会运行。",schedule.id);
      }else if(access.result==="allow"){
        createGoalFromSchedule(schedule);
      }
    }
    reportScheduledGoals();
  }
  const timer=automaticScheduler?setInterval(()=>{try{tick();}catch(error){console.error("Ciro scheduler error:",error.message);}},60_000):null;
  timer?.unref?.();
  return {router,store,tick,stop:()=>timer&&clearInterval(timer)};
}
