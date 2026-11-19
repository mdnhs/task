import { defineConfig, devices } from "@playwright/test"
import { apiEnv, API_ORIGIN, API_PORT, PROXY_ORIGIN, PROXY_PORT, WEB_ORIGIN, WEB_PORT, webEnv } from "./e2e/stack-env"

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
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, testMatch: /(cr0[1-5]|cr0[7-9]|b8-flows|walk)\.spec\.ts/ },
    { name: "android", use: { ...devices["Pixel 7"] }, testMatch: /cr06\.spec\.ts/ },
    // Skeleton parity (npm run test:e2e:skeletons): needs the API behind e2e/slow-api.mjs; sets its own viewports.
    { name: "skeletons", use: { ...devices["Desktop Chrome"] }, testMatch: /skeletons\.spec\.ts/ },
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
      command: "node e2e/slow-api.mjs",
      url: `${PROXY_ORIGIN}/healthz`,
      env: { E2E_API_PORT: String(API_PORT), E2E_PROXY_PORT: String(PROXY_PORT) },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      // The dev server: the e2e runs over plain http, where the API names its device cookie `od-device-*`; a production web (next start) would only forward the https-only `__Host-` name.
      // (The second start covers Next's one-off "upgrade recommendation" stop on a fresh machine: it exits and the retry continues.)
      command: `npx next dev -p ${WEB_PORT} || npx next dev -p ${WEB_PORT}`,
      url: `${WEB_ORIGIN}/sign-in`,
      env: { ...(webEnv as unknown as Record<string, string>), NEXT_TELEMETRY_DISABLED: "1" },
      reuseExistingServer: !process.env.CI,
      timeout: 360_000,
    },
  ],
})
