import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "test/browser",
  timeout: 30000,
  fullyParallel: true,
  outputDir: ".cache/browser-results",
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1440, height: 1000 },
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...(process.env.PLAYWRIGHT_CHANNEL
      ? { channel: process.env.PLAYWRIGHT_CHANNEL }
      : {}),
  },
  webServer: [
    {
      command: "node test/browser-fixture.mjs",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: !process.env.CI,
      timeout: 20000,
    },
    {
      command: "node test/browser-runtime.mjs",
      url: "http://localhost:4174/",
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
