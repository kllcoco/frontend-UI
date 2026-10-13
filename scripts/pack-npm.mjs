// Stage a slim, runnable npm package (@kllcoco/ciro-client) in build/npm from the built web app + server.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const out = join(root, "build", "npm");
if (!existsSync(join(root, "dist", "index.html"))) throw new Error("Run `npm run build` first.");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "bin"), { recursive: true });
cpSync(join(root, "dist"), join(out, "dist"), { recursive: true });
cpSync(join(root, "server"), join(out, "server"), { recursive: true });
cpSync(join(root, ".env.example"), join(out, ".env.example"));
writeFileSync(join(out, "bin", "ciro-client.mjs"), `#!/usr/bin/env node
// Start the Ciro web client + API proxy.
import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const here = new URL("..", import.meta.url).pathname;
if (args.includes("--version") || args.includes("-v")) { console.log("${pkg.version}"); process.exit(0); }
if (args.includes("--help") || args.includes("-h")) {
  console.log([
    "Usage: ciro-client [init] [--env ./.env] [--port 8787] [--host 127.0.0.1] [--data ./.ciro-runtime]",
    "  init        create ./.env from the bundled template (never overwrites)",
    "  --env FILE  environment file to load (default: ./.env if present)",
    "  --data DIR  where accounts, shares and settings are stored (default: ./.ciro-runtime)"
  ].join("\\n"));
  process.exit(0);
}
if (args[0] === "init") {
  const target = resolve(".env");
  if (existsSync(target)) { console.log(".env already exists:", target); process.exit(0); }
  copyFileSync(resolve(here, ".env.example"), target);
  console.log("Created", target, "- fill in CIRO_API_BASE_URL / CIRO_MODEL / CIRO_API_KEY, then run: ciro-client");
  process.exit(0);
}
const envFile = resolve(flag("--env") || ".env");
if (existsSync(envFile)) { process.loadEnvFile(envFile); console.log("Loaded", envFile); }
else if (flag("--env")) { console.error("Env file not found:", envFile); process.exit(1); }
if (flag("--port")) process.env.PORT = flag("--port");
if (flag("--host")) process.env.HOST = flag("--host");
if (flag("--data")) process.env.CIRO_WORKSPACE_DATA_DIR = resolve(flag("--data"));
await import("../server/index.mjs");
`);

chmodSync(join(out, "bin", "ciro-client.mjs"), 0o755);
// The one-click launchers (deploy/oneclick) start this: asks for the model once, serves the local network.
cpSync(join(root, "scripts", "quickstart.mjs"), join(out, "bin", "quickstart.mjs"));
writeFileSync(join(out, "package.json"), JSON.stringify({
  name: "@kllcoco/ciro-client",
  version: pkg.version,
  description: "Ciro AI client: web UI and OpenAI-compatible streaming proxy, runnable with one command.",
  type: "module",
  bin: { "ciro-client": "bin/ciro-client.mjs" },
  files: ["bin", "dist", "server", ".env.example", "README.md"],
  engines: { node: ">=22.5" },
  dependencies: pkg.dependencies,
  repository: { type: "git", url: "https://github.com/kllcoco/frontend-UI.git" },
  publishConfig: { registry: "https://npm.pkg.github.com" },
  license: "UNLICENSED"
}, null, 2) + "\n");
writeFileSync(join(out, "README.md"), readFileSync(join(root, "docs", "INSTALL_SERVER.md"), "utf8"));

console.log("Staged", out);
