import { defineConfig, devices } from "@playwright/test";

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
      reuseExistingServer: !process.env.CI,
      env: { HOST: "127.0.0.1", CIRO_API_BASE_URL: "" }
    },
    {
      command: "npm run dev",
      url: "http://127.0.0.1:5173",
      timeout: 30_000,
      reuseExistingServer: !process.env.CI
    }
  ]
});
