import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // Every spec drives the same mock server and its single shared collaborative document, so specs
  // must run one at a time — one worker serializes across files, not just within a file.
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:5175",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run e2e:app",
    url: "http://127.0.0.1:5175",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
