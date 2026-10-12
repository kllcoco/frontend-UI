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
// Start the Ciro web client + API proxy. Reads .env from the current directory.
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (args.includes("--help") || args.includes("-h")) {
  console.log("Usage: ciro-client [--port 8787] [--host 127.0.0.1]\\nConfigure CIRO_API_BASE_URL etc. in ./.env (see .env.example).");
  process.exit(0);
}
if (flag("--port")) process.env.PORT = flag("--port");
if (flag("--host")) process.env.HOST = flag("--host");
await import("../server/index.mjs");
`);
chmodSync(join(out, "bin", "ciro-client.mjs"), 0o755);
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
writeFileSync(join(out, "README.md"), `# @kllcoco/ciro-client

Run the Ciro client (web UI + API proxy) locally:

\`\`\`bash
npm i -g @kllcoco/ciro-client --registry=https://npm.pkg.github.com
ciro-client --port 8787
\`\`\`

Put \`CIRO_API_BASE_URL\`, \`CIRO_MODEL\` and \`CIRO_API_KEY\` in a \`.env\` file in the working directory (see \`.env.example\`).
Then open http://127.0.0.1:8787 .
`);
console.log("Staged", out);
