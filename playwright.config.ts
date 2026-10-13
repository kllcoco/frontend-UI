import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each run starts from empty server state (no leftovers from earlier runs).
const dataDir = mkdtempSync(join(tmpdir(), "ciro-e2e-data-"));

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
    use: {
      ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, locale: "zh-CN",
      launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}
    }
  }],
  webServer: [
    {
      command: "npm run dev:server",
      url: "http://127.0.0.1:8787/api/status",
      timeout: 30_000,
      reuseExistingServer: false,
      env: { HOST: "127.0.0.1", CIRO_API_BASE_URL: "", CIRO_WORKSPACE_DATA_DIR: dataDir, CIRO_ANNOUNCEMENTS_URL: "off", CIRO_SETUP_HINTS: "on" }
    },
    {
      command: "npm run dev",
      url: "http://127.0.0.1:5173",
      timeout: 30_000,
      reuseExistingServer: !process.env.CI
    }
  ]
});
