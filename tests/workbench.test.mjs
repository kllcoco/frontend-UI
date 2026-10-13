import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkbenchRouter } from "../server/workbench.mjs";
import {
  defaultPolicy, decision, normalizePolicy, safeBranch, safeFilePath, validateRepo
} from "../server/agent-policy.mjs";
import { githubConfig, githubRequest, writeGitHubFile } from "../server/github-client.mjs";

function scratch(){return mkdtempSync(join(tmpdir(),"ciro-workbench-test-"));}
function env(overrides={}){
  return {
    CIRO_GITHUB_TOKEN:"test-server-token",
    CIRO_GITHUB_REPOS:"acme/repo",
    CIRO_GITHUB_WRITES:"true",
    CIRO_AGENT_RUNNER_URL:"http://127.0.0.1:9998",
    CIRO_AGENT_RUNNER_TOKEN:"test-runner-token",
    CIRO_VERIFIER_URL:"http://127.0.0.1:9999",
    CIRO_VERIFIER_TOKEN:"test-verifier-token",
    ...overrides
  };
}
const digest = "a".repeat(64);
function mockAdapter(records=[],redteamFailOnce=false) {
  let failed=false;
  return async (url, options={})=>{
    const target=String(url);
    records.push({url:target,options});
    if(target.startsWith("https://api.github.com/repos/acme/repo/contents/")&&options.method==="PUT") {
      return new Response(JSON.stringify({content:{sha:"c".repeat(40)},commit:{sha:"d".repeat(40)}}),{status:201});
    }
    if(target.startsWith("https://api.github.com/repos/acme/repo/contents/")) {
      return new Response(JSON.stringify({type:"file",encoding:"base64",size:12,content:Buffer.from("Hello World").toString("base64"),sha:"b".repeat(40)}),{status:200});
    }
    if(target==="https://api.github.com/repos/acme/repo") {
      return new Response(JSON.stringify({default_branch:"main",private:true,permissions:{push:true}}),{status:200});
    }
    if(target.startsWith("https://api.github.com/repos/acme/repo/git/ref/heads/")) {
      return new Response(JSON.stringify({object:{sha:"b".repeat(40)}}),{status:200});
    }
    if(target==="https://api.github.com/repos/acme/repo/git/refs") {
      return new Response(JSON.stringify({ref:"refs/heads/ciro/task"}),{status:201});
    }
    if(target.endsWith("/workbench/step")) {
      const data=JSON.parse(options.body);
      if(redteamFailOnce&&data.phase==="redteam"&&!failed){
        failed=true;return new Response(JSON.stringify({ok:false,summary:"Discovered path bypass",evidence:[{type:"redteam",digest}]}));
      }
      return new Response(JSON.stringify({
        ok:true,
        summary:"Real adapter step acknowledged: "+data.phase,
        ...(data.phase==="plan"?{plan:[
          {title:"Implement feature",role:"Builder",acceptance:"Unit coverage"},
          {title:"Integrate module",role:"Integrator",acceptance:"Integration test"}
        ]}:{}),
        evidence:[{type:data.phase,digest,location:"evidence/"+data.phase+".json"}]
      }),{status:200});
    }
    throw new Error("Unexpected mocked URL "+target);
  };
}
async function createTestServer({envVars=env(),mock=mockAdapter()}={}) {
  const dir=scratch();
  const {router,store,tick,stop}=createWorkbenchRouter({env:envVars,dir,fetchFn:mock,automaticScheduler:false});
  const app=express();app.use(express.json());app.use("/api/workbench",router);
  const server=await new Promise(resolve=>{
    const listener=app.listen(0,"127.0.0.1",()=>resolve(listener));
  });
  const url="http://127.0.0.1:"+server.address().port+"/api/workbench";
  const api=async (path,body,extraHeaders={})=>{
    const response=await fetch(url+path,{
      method:body===undefined?"GET":"POST",
      ...(body===undefined?{}:{headers:{"Content-Type":"application/json",...extraHeaders},body:JSON.stringify(body)})
    });
    const data=await response.json();
    return {httpStatus:response.status,...data};
  };
  return {api,store,tick,close:async()=>{
    stop();await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});
  }};
}
async function waitFor(fn,max=80){
  for(let i=0;i<max;i++){
    const value=await fn();if(value)return value;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  throw new Error("Async workbench task did not settle.");
}

test("security policy denies host privileges and scopes GitHub access",()=>{
  const policy=defaultPolicy();
  assert.equal(decision(policy,"host.exec").result,"deny");
  assert.equal(decision(policy,"production.deploy").result,"deny");
  assert.equal(decision(policy,"repo.delete").result,"deny");
  assert.equal(decision(policy,"github.write",{repo:"acme/repo"}).result,"deny");
  assert.throws(()=>normalizePolicy({mode:"full",repo:"acme/repo"}),/explicit consent/);
  const full=normalizePolicy({mode:"full",repo:"acme/repo",confirmFullAccess:"ALLOW_SCOPED_FULL_ACCESS"});
  assert.equal(decision(full,"github.write",{repo:"acme/repo"}).result,"allow");
  assert.equal(decision(full,"github.write",{repo:"other/repo"}).result,"deny");
  const auto=normalizePolicy({mode:"auto",repo:"acme/repo"});
  assert.equal(decision(auto,"task.run").result,"allow");
  assert.equal(decision(auto,"github.write",{repo:"acme/repo"}).result,"approval");
});
test("repository path and branch validators refuse traversal, secrets and protected branches",()=>{
  assert.throws(()=>safeFilePath("../secrets/token"),/Invalid/);
  assert.throws(()=>safeFilePath(".github/workflows/ci.yml"),/Invalid/);
  assert.throws(()=>safeBranch("main"),/non-protected/);
  assert.throws(()=>safeBranch("feature/../../main"),/non-protected/);
  assert.throws(()=>validateRepo("evil.com/api/repo"),/Invalid/);
  assert.equal(safeBranch("ciro/feature"),"ciro/feature");
});
test("GitHub integration only uses allowlisted repos and sends credentials server-side",async()=>{
  const calls=[],mock=mockAdapter(calls);
  const response=await githubRequest("/repos/acme/repo",{env:env(),fetchFn:mock});
  assert.equal(response.default_branch,"main");
  assert.equal(calls[0].options.headers.Authorization,"Bearer test-server-token");
  assert.equal(githubConfig(env()).writeEnabled,true);
  await assert.rejects(()=>writeGitHubFile({repo:"outside/repo",branch:"ciro/task",
    path:"README.md",content:"X",message:"Test"}, {env:env(),fetchFn:mock}),/allowlist/);
});
test("no runner -> goal persisted as waiting, never falsely completed",async()=>{
  const ctx=await createTestServer({envVars:env({CIRO_AGENT_RUNNER_URL:"",CIRO_AGENT_RUNNER_TOKEN:""})});
  try{
    const r=await ctx.api("/goals",{mode:"goal",title:"Build feature",goal:"Create a real testable app"});
    assert.equal(r.httpStatus,201);
    assert.equal(r.goal.status,"waiting_runtime");
    const state=await ctx.api("/state");
    assert.equal(state.goals.length,1);
    assert.equal(state.goals[0].evidence.length,0);
    assert.equal(state.capabilities.runtime.working,false);
    assert.ok(!JSON.stringify(state).includes("test-server-token"));
  } finally {await ctx.close();}
});
test("goal in Request mode requires explicit one-shot approval",async()=>{
  const ctx=await createTestServer();
  try{
    const r=await ctx.api("/goals",{mode:"goal",title:"Task",goal:"Implement and verify"});
    assert.equal(r.goal.status,"waiting_approval");
    const state=await ctx.api("/state");
    assert.equal(state.approvals.length,1);
    const approval=state.approvals[0];
    assert.equal(approval.type,"task.run");
    await ctx.api("/approvals/"+approval.id+"/decision",{decision:"reject"});
    const rejected=await ctx.api("/state");
    assert.equal(rejected.goals[0].status,"paused");
    assert.equal(rejected.approvals.length,0);
  }finally{await ctx.close();}
});
test("plan mode creates a plan but never starts repository changes",async()=>{
  const calls=[],ctx=await createTestServer({mock:mockAdapter(calls)});
  try{
    const r=await ctx.api("/goals",{mode:"plan",title:"Plan app",goal:"Design a reliable website"});
    assert.equal(r.httpStatus,201);
    const goal=await waitFor(async()=>{
      const s=await ctx.api("/state");return s.goals[0]?.status==="planned"?s.goals[0]:null;
    });
    assert.equal(goal.plan.length,2);
    assert.equal(goal.phase,"implement");
    assert.equal(calls.filter(c=>c.url.includes("/workbench/step")).length,1);
  }finally{await ctx.close();}
});
test("automatic mode delegates distinct agent roles, independent tests, redteam and audit",async()=>{
  const calls=[],ctx=await createTestServer({mock:mockAdapter(calls)});
  try{
    const policy=await ctx.api("/permissions",{mode:"auto",custom:{},repo:""});
    assert.equal(policy.policy.mode,"auto");
    const create=await ctx.api("/goals",{mode:"goal",title:"Website",goal:"Deliver working site with tests and red-team"});
    assert.equal(create.httpStatus,201);
    const complete=await waitFor(async()=>{
      const s=await ctx.api("/state");return s.goals[0]?.status==="completed"?s.goals[0]:null;
    });
    assert.deepEqual(complete.plan.map(x=>x.status),["completed","completed"]);
    assert.ok(complete.evidence.some(x=>x.phase==="test"));
    assert.ok(complete.evidence.some(x=>x.phase==="redteam"));
    assert.ok(complete.evidence.some(x=>x.phase==="audit"));
    const assigned=calls.filter(x=>x.url.endsWith("/workbench/step")).map(x=>JSON.parse(x.options.body));
    assert.deepEqual(assigned.map(x=>x.phase),["plan","implement","implement","test","redteam","audit"]);
    assert.deepEqual(assigned.filter(x=>x.phase==="implement").map(x=>x.context.role),["Builder","Integrator"]);
    assert.equal(complete.status,"completed");
  }finally{await ctx.close();}
});
test("red-team rejection triggers a genuine repair and re-verification cycle",async()=>{
  const calls=[],ctx=await createTestServer({mock:mockAdapter(calls,true)});
  try{
    await ctx.api("/permissions",{mode:"auto"});
    await ctx.api("/goals",{mode:"goal",title:"Fix security",goal:"Run red team and repair regressions"});
    const goal=await waitFor(async()=>{
      const s=await ctx.api("/state");return s.goals[0]?.status==="completed"?s.goals[0]:null;
    });
    assert.equal(goal.attempt,1);
    const phases=calls.filter(x=>x.url.endsWith("/workbench/step")).map(x=>JSON.parse(x.options.body).phase);
    assert.equal(phases.filter(x=>x==="test").length,2);
    assert.ok(phases.includes("repair"));
    assert.equal(phases.filter(x=>x==="redteam").length,2);
  }finally{await ctx.close();}
});
test("scoped GitHub read/write uses immutable approval payload and rejects CSRF origin",async()=>{
  const calls=[],ctx=await createTestServer({mock:mockAdapter(calls)});
  try {
    const connect=await ctx.api("/github/connect",{repo:"acme/repo"});
    assert.equal(connect.repo,"acme/repo");
    const read=await ctx.api("/github/file?path=README.md&branch=ciro/task");
    assert.equal(read.content,"Hello World");
    const write=await ctx.api("/github/write",{path:"README.md",branch:"ciro/task",
      content:"Updated",message:"feat: change",expectedSha:"b".repeat(40)});
    assert.equal(write.httpStatus,202);
    assert.equal(write.approvalRequired,true);
    assert.equal(calls.filter(x=>x.options.method==="PUT").length,0);
    const approved=await ctx.api("/approvals/"+write.id+"/decision",{decision:"approve"});
    assert.equal(approved.httpStatus,200);
    assert.equal(approved.result.commit,"d".repeat(40));
    assert.equal(calls.filter(x=>x.options.method==="PUT").length,1);
    const rejectedOrigin=await ctx.api("/github/connect",{repo:"acme/repo"},{origin:"https://outside.example"});
    assert.equal(rejectedOrigin.httpStatus,403);
    const unsafe=await ctx.api("/github/write",{path:".github/workflows/ci.yml",branch:"ciro/task",
      content:"malicious",message:"feat: change"});
    assert.equal(unsafe.httpStatus,400);
    const state=await ctx.api("/state");
    assert.ok(!JSON.stringify(state).includes("test-server-token"));
  }finally{await ctx.close();}
});
test("switching repo scope reverts full access to Request mode",async()=>{
  const fake=async(url)=>new Response(JSON.stringify({default_branch:"main",permissions:{push:true}}));
  const ctx=await createTestServer({envVars:env({CIRO_GITHUB_REPOS:"acme/repo;acme/other".replace(";",",")}),mock:fake});
  try{
    await ctx.api("/github/connect",{repo:"acme/repo"});
    await ctx.api("/permissions",{mode:"full",repo:"acme/repo",confirmFullAccess:"ALLOW_SCOPED_FULL_ACCESS"});
    const r=await ctx.api("/github/connect",{repo:"acme/other"});
    assert.equal(r.policy.mode,"request");
  }finally{await ctx.close();}
});
test("scheduled runs report their outcome to the notification feed",async()=>{
  const ctx=await createTestServer({envVars:env({CIRO_AGENT_RUNNER_URL:""})});
  try{
    await ctx.api("/permissions",{mode:"request",repo:"acme/repo"});
    await ctx.api("/schedules",{title:"Nightly check",goal:"Run the checks",recurrence:"daily",hour:9,timezone:"UTC"});
    ctx.tick(new Date("2026-01-04T09:00:01Z"));
    let feed=await ctx.api("/schedule-events");
    assert.equal(feed.events.length,1);
    assert.match(feed.events[0].title,/Nightly check.*等待你批准/);
    // Approve: the goal starts, cannot run without a runner, and that outcome is reported once.
    const state=await ctx.api("/state");
    const approved=await ctx.api("/approvals/"+state.approvals[0].id+"/decision",{decision:"approve"});
    assert.equal(approved.status,"approved");
    ctx.tick(new Date("2026-01-04T09:30:00Z"));
    ctx.tick(new Date("2026-01-04T09:31:00Z"));
    feed=await ctx.api("/schedule-events?after="+encodeURIComponent(feed.events[0].at));
    assert.equal(feed.events.length,1);
    assert.match(feed.events[0].title,/Nightly check.*无法运行/);
  }finally{await ctx.close();}
});

test("server scheduler creates one approval per due slot and persists deduplication",async()=>{
  const ctx=await createTestServer({envVars:env({CIRO_AGENT_RUNNER_URL:""})});
  try{
    const r=await ctx.api("/schedules",{title:"Daily test",goal:"Check project tests",recurrence:"daily",hour:9,timezone:"UTC"});
    assert.equal(r.httpStatus,201);
    ctx.tick(new Date("2026-01-04T09:00:01Z"));
    ctx.tick(new Date("2026-01-04T09:59:57Z"));
    const state=await ctx.api("/state");
    assert.equal(state.approvals.length,1);
    assert.equal(state.schedules[0].lastSlot,"2026-01-04-9");
    const disable=await ctx.api("/schedules/"+state.schedules[0].id+"/toggle",{enabled:false});
    assert.equal(disable.schedule.enabled,false);
  }finally{await ctx.close();}
});
