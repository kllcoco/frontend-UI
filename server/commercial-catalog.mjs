
const APP_CATALOG = Object.freeze([
  {id:"chat",name:"Ciro Chat",zh:"智能对话",category:"assistant",icon:"message-circle",
    description:"聊天、文件输入和自定义指令",descriptionEn:"Chats, file input and personal instructions",route:"chat",requires:"chat"},
  {id:"workbench",name:"Ciro Workbench",zh:"协作空间",category:"productivity",icon:"workflow",
    description:"多代理目标、计划、审批及验证",descriptionEn:"Agent goals, plans, approvals and verification",route:"goals",requires:"local"},
  {id:"github",name:"Ciro GitHub",zh:"代码仓库",category:"developer",icon:"github",
    description:"已授权仓库的读取与分支提交",descriptionEn:"Scoped repository reads and branch commits",route:"github",requires:"github"},
  {id:"scheduler",name:"Ciro Scheduler",zh:"定时任务",category:"productivity",icon:"calendar-clock",
    description:"按时区安排可审核的重复任务",descriptionEn:"Schedule auditable recurring tasks by timezone",route:"schedules",requires:"local"},
  {id:"skills",name:"Ciro Skills",zh:"技能中心",category:"developer",icon:"blocks",
    description:"配置官方审核的代理技能",descriptionEn:"Configure reviewed agent skills",route:"skills",requires:"local"},
  {id:"research",name:"Ciro Research",zh:"研究助手",category:"research",icon:"search",
    description:"需要原生模型和联网检索适配器",descriptionEn:"Requires the native research and search provider",route:null,requires:"research"},
  {id:"files",name:"Ciro Files",zh:"文件工作区",category:"productivity",icon:"folder",
    description:"需要可信文件工作区后端",descriptionEn:"Requires a trusted file workspace service",route:null,requires:"files"},
  {id:"code",name:"Ciro Code",zh:"代码执行",category:"developer",icon:"terminal",
    description:"需要隔离执行器、配额与命令权限",descriptionEn:"Requires isolated runner, quotas and execution policy",route:null,requires:"runner"}
]);
const SKILL_CATALOG=Object.freeze([
  {id:"repo-review",name:"Repository Review",zh:"代码审查",version:"1.0.0",category:"coding",
    description:"审查实现、测试覆盖和潜在回归",descriptionEn:"Review code, tests and regressions",
    scope:["github.read"],requires:"runner"},
  {id:"test-design",name:"Test Design",zh:"测试设计",version:"1.0.0",category:"quality",
    description:"依据验收标准制定边界及失败用例",descriptionEn:"Develop boundary and failure-case tests",scope:["task.run"],requires:"runner"},
  {id:"red-team",name:"Adversarial Review",zh:"红队反证",version:"1.0.0",category:"quality",
    description:"独立查找权限绕过、伪 PASS 与异常恢复漏洞",descriptionEn:"Independent adversarial review of claims and controls",
    scope:["task.run"],requires:"verifier"},
  {id:"architecture",name:"Architecture Planning",zh:"架构规划",version:"1.0.0",category:"planning",
    description:"拆解依赖 DAG、接口与变更边界",descriptionEn:"Define dependency DAGs, interfaces and ownership",scope:["task.run"],requires:"runner"},
  {id:"cost-analysis",name:"Cost Analysis",zh:"成本分析",version:"1.0.0",category:"analysis",
    description:"追踪训练、推理与代理任务的算力预算",descriptionEn:"Analyze training, inference and agent budgets",scope:["task.run"],requires:"runner"},
  {id:"documentation",name:"Documentation",zh:"技术文档",version:"1.0.0",category:"writing",
    description:"维护实施记录、接口说明与交付材料",descriptionEn:"Maintain architecture, API and handoff docs",scope:["task.run"],requires:"runner"},
  {id:"research",name:"Research Workflow",zh:"研究检索",version:"1.0.0",category:"research",
    description:"收集可追溯来源并整理结论",descriptionEn:"Research with traceable sources and evidence",scope:["external.network"],requires:"research"}
]);
export const officialApps=APP_CATALOG;
export const officialSkills=SKILL_CATALOG;
export const officialAppIds=new Set(APP_CATALOG.map(item=>item.id));
export const officialSkillIds=new Set(SKILL_CATALOG.map(item=>item.id));
export function capabilityFlags(env){
  return {
    local:true,
    chat:Boolean(env.CIRO_API_BASE_URL),
    github:Boolean(env.CIRO_GITHUB_TOKEN && env.CIRO_GITHUB_REPOS),
    runner:Boolean(env.CIRO_AGENT_RUNNER_URL && env.CIRO_AGENT_RUNNER_TOKEN),
    verifier:Boolean(env.CIRO_VERIFIER_URL && env.CIRO_VERIFIER_TOKEN),
    research:Boolean(env.CIRO_RESEARCH_SERVICE_URL && env.CIRO_RESEARCH_SERVICE_TOKEN),
    files:Boolean(env.CIRO_FILES_SERVICE_URL && env.CIRO_FILES_SERVICE_TOKEN)
  };
}
export function catalogSnapshot(env,state){
  const flags=capabilityFlags(env);
  const saved=state.commercial||{};
  const pins=saved.pinnedApps||["chat","workbench"];
  const enabled=saved.skills||{};
  return {
    apps:APP_CATALOG.map(item=>({...item,pinned:pins.includes(item.id),ready:flags[item.requires]===true,
      status:flags[item.requires]===true?"available":"not_configured"})),
    skills:SKILL_CATALOG.map(item=>({...item,enabled:enabled[item.id]===true,ready:flags[item.requires]===true,
      status:flags[item.requires]===true?"available":"not_configured"}))
  };
}
export function selectedSkills(env,state){
  const catalog=catalogSnapshot(env,state);
  return catalog.skills.filter(item=>item.enabled && item.ready && state.plugins?.runner!==false).map(({id,version,scope})=>({id,version,scope}));
}
