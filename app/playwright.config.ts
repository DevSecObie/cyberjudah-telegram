import { defineConfig } from "@playwright/test";

/** Runs against the built app served by the worker (bot/), so /api and the SPA fallback are real. */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:8787", trace: "retain-on-failure", screenshot: "only-on-failure", viewport: { width: 390, height: 780 }, ...(process.env.CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.CHROMIUM_PATH } } : {}) },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "npm run build && cd ../bot && npx wrangler dev --local --port 8787",
    url: "http://127.0.0.1:8787/api/verse-of-day",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
