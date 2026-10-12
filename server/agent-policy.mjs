export const PERMISSION_MODES = ["request", "auto", "full", "custom"];
export const DEFAULT_CUSTOM = Object.freeze({
  githubRead: true,
  githubWrite: false,
  taskExecution: false,
  recurringTasks: false,
  externalNetwork: false
});
export function defaultPolicy() {
  return { mode: "request", custom: { ...DEFAULT_CUSTOM }, repo: "" };
}
export function validateRepo(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(value) ||
      value.includes("..")) throw new Error("Invalid owner/repository.");
  return value;
}
export function normalizePolicy(input, before = defaultPolicy()) {
  if (!input || typeof input !== "object" || !PERMISSION_MODES.includes(input.mode)) throw new Error("Invalid permission mode.");
  if (input.mode === "full" && input.confirmFullAccess !== "ALLOW_SCOPED_FULL_ACCESS") {
    throw new Error("Full access requires explicit consent.");
  }
  const custom = Object.fromEntries(Object.keys(DEFAULT_CUSTOM).map(key =>
    [key, input.custom?.[key] === true]));
  const repo = input.repo ? validateRepo(input.repo) : before.repo;
  return { mode: input.mode, custom, repo };
}
export function decision(policy, action, scope) {
  // No UI toggle grants system/root privileges or production/secrets access.
  if (["host.exec", "secrets.read", "production.deploy", "force.push", "repo.delete"].includes(action)) {
    return { result: "deny", reason: "High-risk operation is not supported by this client." };
  }
  if (["github.read", "github.write", "github.branch"].includes(action)) {
    if (!scope?.repo || scope.repo !== policy.repo) return { result: "deny", reason: "Repository is outside the selected scope." };
  }
  if (action === "github.read") return { result: policy.mode === "custom" && !policy.custom.githubRead ? "deny" : "allow" };
  const key = ({
    "github.write": "githubWrite", "github.branch": "githubWrite",
    "task.run": "taskExecution", "schedule.run": "recurringTasks",
    "external.network": "externalNetwork"
  })[action];
  if (!key) return { result: "deny", reason: "Unknown action." };
  if (policy.mode === "full") return { result: "allow" };
  if (policy.mode === "request") return { result: "approval", reason: "Request approval for each effect." };
  if (policy.mode === "auto") {
    if (action === "task.run" || action === "schedule.run") return { result: "allow" };
    return { result: "approval", reason: "External repository changes always need explicit consent in Auto mode." };
  }
  return { result: policy.custom[key] ? "allow" : "approval", reason: "Custom permissions require approval." };
}
export function checkedString(value, name, max=6000) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("Invalid " + name);
  return value.trim();
}
export function safeFilePath(value) {
  if (typeof value !== "string" || value.length > 220 || !value ||
      value.startsWith("/") || value.includes("\\") || value.includes("..") ||
      value.split("/").some(x=>!x || x.startsWith(".")) ||
      /(?:^|\/)(?:secrets?|node_modules|\.git)(?:\/|$)/i.test(value)) throw new Error("Invalid repository path.");
  return value;
}
// Read-only lookups may target main or existing feat/* branches.
 // Branch creation and writes must still use the stricter safeBranch below.
export function safeReadRef(value){
 if(typeof value!=="string"||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,130}$/.test(value)||
    value.includes("..")||value.includes("//")||value.endsWith("/")||
    value.endsWith(".lock")||value.startsWith("refs/"))
   throw new Error("Invalid read-only GitHub branch/ref");
 return value;
}
export function safeBranch(value) {
  if (typeof value !== "string" || !/^(ciro|feature|repair)\/[a-zA-Z0-9][a-zA-Z0-9._/-]{0,130}$/.test(value) ||
      value.includes("..") || value.includes("//") || value.endsWith("/")) throw new Error("Use a non-protected branch under ciro/, feature/ or repair/.");
  return value;
}
