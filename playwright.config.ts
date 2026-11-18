import { defineConfig, devices } from "@playwright/test"
import { apiEnv, API_ORIGIN, WEB_ORIGIN, webEnv } from "./e2e/stack-env"

// B6 T6.9: one spec per first-client requirement (CR-01..CR-06) against the REAL stack: web (next dev), API, worker, Postgres, Redis, MinIO, ClamAV.
// Backing services come from docker-compose.e2e.yml (`npm run e2e:stack`); everything is local demo data with fake credentials, no live provider.
// Specs run one at a time on one seeded database (globalSetup re-seeds it once).
export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: WEB_ORIGIN, trace: "retain-on-failure", screenshot: "only-on-failure", actionTimeout: 15_000 },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, testIgnore: /cr06/ },
    { name: "android", use: { ...devices["Pixel 7"] }, testMatch: /cr06\.spec\.ts/ },
  ],
  webServer: [
    {
      // Prepares the database (roles, migrations, bucket), then runs the worker beside the API.
      command: "npx tsx scripts/e2e-prepare.ts && (../node_modules/.bin/tsx src/worker.ts & exec ../node_modules/.bin/tsx src/server.ts)",
      cwd: "./api",
      url: `${API_ORIGIN}/healthz`,
      env: apiEnv as unknown as Record<string, string>,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "pipe",
    },
    {
      command: "npx next dev -p 3100",
      url: `${WEB_ORIGIN}/sign-in`,
      env: { ...(webEnv as unknown as Record<string, string>), NEXT_TELEMETRY_DISABLED: "1" },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
