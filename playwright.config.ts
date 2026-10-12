import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

// Strict Windows release acceptance must never attach to an already-running
// developer server or reuse a previous run's local Workbench/app/skill state.
// Normal interactive Playwright usage retains its existing reuse behavior.
const strictAcceptance=process.env.CIRO_E2E_STRICT==="true"||Boolean(process.env.CI);
let isolatedStateDir:string|undefined;
if(strictAcceptance){
  const root=resolve(".ciro-runtime","e2e-isolated");
  mkdirSync(root,{recursive:true});
  isolatedStateDir=mkdtempSync(join(root,"run-"));
}

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 35_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "artifacts/playwright-report" }]
  ],
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  projects: [{
    name: "desktop-chromium",
    use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }
  }],
  webServer: [
    {
      command: "npm run dev:server",
      url: "http://127.0.0.1:8787/api/status",
      timeout: 30_000,
      reuseExistingServer: !strictAcceptance,
      env: {
        HOST: "127.0.0.1", PORT: "8787", CIRO_API_BASE_URL: "",
        ...(strictAcceptance?{
          CIRO_WORKSPACE_DATA_DIR: isolatedStateDir!,
          CIRO_ACCOUNTS_ENABLED: "false", CIRO_DEPLOYMENT_MODE: "development",
          CIRO_PUBLIC_MULTI_TENANT: "false", CIRO_PUBLIC_ORIGIN: "",
          CIRO_GITHUB_TOKEN: "", CIRO_GITHUB_REPOS: "",
          CIRO_AGENT_RUNNER_URL: "", CIRO_AGENT_RUNNER_TOKEN: "",
          CIRO_VERIFIER_URL: "", CIRO_VERIFIER_TOKEN: "",
          CIRO_RESEARCH_SERVICE_URL: "", CIRO_FILES_SERVICE_URL: "",
          CIRO_BILLING_EVENT_SECRET: "",
        }:{})
      }
    },
    {
      command: "npm run dev",
      url: "http://127.0.0.1:5173",
      timeout: 30_000,
      reuseExistingServer: !strictAcceptance
    }
  ]
});
