import { checkedString, safeBranch, safeFilePath, validateRepo } from "./agent-policy.mjs";

export function githubConfig(env = process.env) {
  return {
    configured: Boolean(env.CIRO_GITHUB_TOKEN),
    writeEnabled: env.CIRO_GITHUB_WRITES === "true",
    repos: (env.CIRO_GITHUB_REPOS || "").split(",").map(s=>s.trim()).filter(Boolean)
  };
}
export function assertRepo(repo, env=process.env) {
  validateRepo(repo);
  const config = githubConfig(env);
  if (!config.configured) throw new Error("GitHub server credential is not configured.");
  if (!config.repos.includes(repo)) throw new Error("Repository is not on the server allowlist.");
  return repo;
}
export async function githubRequest(route, { method = "GET", body, env = process.env, fetchFn = fetch } = {}) {
  if (!env.CIRO_GITHUB_TOKEN) throw new Error("GitHub server credential is missing.");
  if (!route.startsWith("/repos/") && route !== "/user") throw new Error("GitHub API route not permitted.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 14000);
  try {
    const response = await fetchFn("https://api.github.com" + route, {
      method, signal: controller.signal,
      headers: { Authorization: "Bearer " + env.CIRO_GITHUB_TOKEN, Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "Ciro-Workbench/0.4",
        ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? {body: JSON.stringify(body)} : {})
    });
    if (!response.ok) {
      // Error details can contain untrusted data; do not mirror arbitrary strings or secrets.
      throw new Error("GitHub API HTTP " + response.status);
    }
    const text = await response.text();
    if (text.length > 650_000) throw new Error("GitHub response exceeded safe size.");
    return text ? JSON.parse(text) : {};
  } finally { clearTimeout(timeout); }
}
function encodedPath(path) { return path.split("/").map(encodeURIComponent).join("/"); }
export async function verifyGitHubRepo(repo, opts={}) {
  assertRepo(repo, opts.env);
  const metadata = await githubRequest("/repos/" + repo, opts);
  return { repo, defaultBranch: metadata.default_branch, private: metadata.private === true,
    canPush: metadata.permissions?.push === true, defaultBranchProtected: false };
}
export async function readGitHubFile(repo, path, branch="", opts={}) {
  assertRepo(repo, opts.env);
  safeFilePath(path);
  if (branch) safeBranch(branch);
  const query = branch ? "?ref=" + encodeURIComponent(branch) : "";
  const response = await githubRequest("/repos/" + repo + "/contents/" + encodedPath(path) + query, opts);
  if (response.type !== "file" || response.encoding !== "base64" || response.size > 180_000 || typeof response.content !== "string")
    throw new Error("Unsupported file or file exceeds 180 KB.");
  return { repo, path, sha: response.sha, content: Buffer.from(response.content.replace(/\s/g, ""), "base64").toString("utf8") };
}
export async function writeGitHubFile({ repo, path, branch, content, message, expectedSha }, opts={}) {
  assertRepo(repo, opts.env);
  if (githubConfig(opts.env).writeEnabled !== true) throw new Error("GitHub writes are disabled on server.");
  safeBranch(branch); safeFilePath(path);
  if (typeof content !== "string" || Buffer.byteLength(content, "utf8") > 180_000) throw new Error("File too large.");
  checkedString(message, "commit message", 150);
  if (expectedSha && !/^[a-f0-9]{40}$/.test(expectedSha)) throw new Error("Invalid previous SHA.");
  const body = { branch, message, content: Buffer.from(content, "utf8").toString("base64"),
    ...(expectedSha ? {sha:expectedSha} : {}) };
  const data = await githubRequest("/repos/" + repo + "/contents/" + encodedPath(path), {
    ...opts, method: "PUT", body
  });
  return { repo, path, branch, commit: data.commit?.sha || null, fileSha: data.content?.sha || null };
}
export async function createGitHubBranch(repo, branch, opts={}) {
  assertRepo(repo, opts.env);safeBranch(branch);
  if (!githubConfig(opts.env).writeEnabled) throw new Error("GitHub writes are disabled on server.");
  const metadata = await githubRequest("/repos/" + repo, opts);
  const defaultBranch = metadata.default_branch;
  const ref = await githubRequest("/repos/" + repo + "/git/ref/heads/" + encodeURIComponent(defaultBranch), opts);
  const objectSha=ref.object?.sha;
  if (!/^[a-f0-9]{40}$/.test(objectSha || "")) throw new Error("Cannot resolve base commit.");
  const created=await githubRequest("/repos/" + repo + "/git/refs", {
    ...opts,method:"POST",body:{ ref:"refs/heads/"+branch, sha:objectSha }
  });
  return { repo, branch, base: objectSha, createdRef: created.ref };
}
