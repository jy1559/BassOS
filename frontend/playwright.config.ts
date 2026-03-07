import { defineConfig, devices } from "@playwright/test";

const E2E_PORT = 5100;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: {
    timeout: 8_000,
  },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: `set BASSOS_PORT=${E2E_PORT}&& python ../app.py`,
    url: `http://127.0.0.1:${E2E_PORT}/api/health`,
    timeout: 120_000,
    reuseExistingServer: true,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
