import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  testMatch: "**/*.browser.test.ts",
  timeout: 180000,
  workers: 1,
  use: {
    actionTimeout: 15000,
    trace: "retain-on-failure",
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1280, height: 1000 },
    launchOptions: {
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev -- --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
});
