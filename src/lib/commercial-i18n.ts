import { localize } from "./i18n";
import type { Language } from "./i18n";
const english:ReadOnlyMap = new Map([
  ["服务已配置","Backend configuration present"],
  ["已配置计量验签","Signed metering configured"],
  ["官方预置目录","First-party built-in catalog"],
  [
    "账单与用量",
    "Billing & usage"
  ],
  [
    "官方应用",
    "Official apps"
  ],
  [
    "技能中心",
    "Skills"
  ],
  [
    "真实用量、预算及账单",
    "Verified usage, budgets and invoices"
  ],
  [
    "你安装的 Ciro 官方功能入口",
    "Official Ciro application directory"
  ],
  [
    "经过审核的代理技能",
    "Curated, reviewed agent skills"
  ],
  [
    "本月用量概览",
    "Monthly usage overview"
  ],
  [
    "当前账期",
    "Current billing period"
  ],
  [
    "已计量任务",
    "Metered events"
  ],
  [
    "估算费用",
    "Estimated cost"
  ],
  [
    "本月估算",
    "Month estimate"
  ],
  [
    "未计价记录",
    "Unpriced events"
  ],
  [
    "总计量",
    "Measured units"
  ],
  [
    "暂无真实用量记录",
    "No verified usage has been recorded"
  ],
  [
    "只有 CIRO Runtime 签名的计量收据才会出现在这里。",
    "Only signed CIRO runtime receipts appear here."
  ],
  [
    "未连接计量服务",
    "Metering service not connected"
  ],
  [
    "已连接计量收据",
    "Signed metering configured"
  ],
  [
    "费率尚未配置",
    "Rates not configured"
  ],
  [
    "按照服务端配置费率计算，仅用于费用预估，不代表已扣款。",
    "Calculated using server rates. Estimates are not settled charges."
  ],
  [
    "费率 / 百万单位",
    "Price per million units"
  ],
  [
    "本月预算设置",
    "Monthly budget settings"
  ],
  [
    "预算上限（USD）",
    "Monthly budget (USD)"
  ],
  [
    "可留空，表示不限制。",
    "Leave blank for no limit."
  ],
  [
    "预警比例",
    "Warning threshold"
  ],
  [
    "保存预算",
    "Save budget"
  ],
  [
    "预算已保存",
    "Budget saved"
  ],
  [
    "预算已达到",
    "Budget reached"
  ],
  [
    "接近预算",
    "Approaching budget"
  ],
  [
    "超过预算后暂停新任务；运行中的费用仍可能继续产生。",
    "New tasks pause at the budget threshold; ongoing jobs may continue accruing costs."
  ],
  [
    "计量或费率未接通时，配置的预算会阻止新代理任务启动。",
    "If rates or metering are unavailable, a configured budget blocks new agent runs."
  ],
  [
    "无预算上限",
    "No budget limit"
  ],
  [
    "本月费用明细",
    "Monthly usage details"
  ],
  [
    "账单与发票",
    "Invoices & payments"
  ],
  [
    "账单服务尚未接入",
    "Invoice provider not connected"
  ],
  [
    "这里不会生成虚假发票、付款记录或订阅状态。",
    "This page will not invent invoices, payments or subscription status."
  ],
  [
    "支付方式",
    "Payment methods"
  ],
  [
    "尚未启用在线支付。",
    "Online payments are not enabled."
  ],
  [
    "正式开票与扣款需对接支付服务端。",
    "Invoices and charges require a real payment provider."
  ],
  [
    "查看明细",
    "Usage records"
  ],
  [
    "发票管理",
    "Invoice management"
  ],
  [
    "导出 CSV",
    "Export CSV"
  ],
  [
    "计量时间",
    "Metered at"
  ],
  [
    "类别",
    "Category"
  ],
  [
    "模型",
    "Model"
  ],
  [
    "用量",
    "Usage"
  ],
  [
    "单价",
    "Unit price"
  ],
  [
    "凭证摘要",
    "Receipt digest"
  ],
  [
    "本月暂无明细",
    "No records this month"
  ],
  [
    "未知",
    "Unknown"
  ],
  [
    "聊天",
    "Chat"
  ],
  [
    "代理",
    "Agent"
  ],
  [
    "工具",
    "Tool"
  ],
  [
    "训练",
    "Training"
  ],
  [
    "选择官方应用",
    "Explore official applications"
  ],
  [
    "我的应用",
    "My apps"
  ],
  [
    "全部应用",
    "All apps"
  ],
  [
    "搜索应用",
    "Search apps"
  ],
  [
    "搜索技能",
    "Search skills"
  ],
  [
    "暂无匹配结果",
    "No matching results"
  ],
  [
    "已收藏",
    "Pinned"
  ],
  [
    "收藏",
    "Pin"
  ],
  [
    "取消收藏",
    "Unpin"
  ],
  [
    "打开",
    "Open"
  ],
  [
    "打开预览",
    "Open preview"
  ],
  [
    "待接入后端",
    "Needs backend"
  ],
  [
    "服务可用",
    "Backend configured"
  ],
  [
    "界面就绪",
    "Interface ready"
  ],
  [
    "应用启动需相应服务与权限。",
    "Opening an app may require its own backend and permissions."
  ],
  [
    "不支持任意第三方代码安装。",
    "Arbitrary third-party code installation is not supported."
  ],
  [
    "官方审核目录",
    "Official curated catalog"
  ],
  [
    "审核版本",
    "Reviewed version"
  ],
  [
    "所需权限",
    "Required permissions"
  ],
  [
    "已选择",
    "Selected"
  ],
  [
    "选择技能",
    "Enable skill"
  ],
  [
    "取消技能",
    "Disable skill"
  ],
  [
    "选择的技能会随 Agent 请求交给原生执行器，但不能授予新权限。",
    "Selected skills are passed to the Agent runner and cannot grant additional permissions."
  ],
  [
    "技能尚不能执行",
    "Skill runner not connected"
  ],
  [
    "已选择，等待执行器",
    "Selected; awaiting runtime"
  ],
  [
    "与 GitHub 权限及沙盒策略同时生效。",
    "Existing GitHub and sandbox policies still apply."
  ],
  [
    "无收费服务接入",
    "No charging provider connected"
  ],
  [
    "安全说明",
    "Safety note"
  ],
  [
    "重新加载",
    "Reload"
  ],
  [
    "操作成功",
    "Saved"
  ],
  [
    "操作失败",
    "Action failed"
  ],
  [
    "全部",
    "All"
  ],
  [
    "开发",
    "Developer"
  ],
  [
    "效率",
    "Productivity"
  ],
  [
    "研究",
    "Research"
  ],
  [
    "助手",
    "Assistant"
  ],
  [
    "规划",
    "Planning"
  ],
  [
    "质量",
    "Quality"
  ],
  [
    "写作",
    "Writing"
  ],
  [
    "分析",
    "Analysis"
  ],
  [
    "本地管理",
    "Locally managed"
  ],
  [
    "没有配置真实计费服务，不展示虚构的支出和余额。",
    "No verified billing provider: no fabricated charges or balances."
  ],
  [
    "消费和模型账单必须来自可信收据。",
    "Usage and model charges require trusted receipts."
  ],
  [
    "官方应用不代表已开放所有实际能力。",
    "Being listed does not mean every app is operational."
  ],
  [
    "可用",
    "Available"
  ],
  [
    "未接线",
    "Not connected"
  ]
]);
type ReadOnlyMap = ReadonlyMap<string,string>;
export function commerceTranslate(language:Language,value:string):string {return localize(language,value,(k)=>english.get(k));}
