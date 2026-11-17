import { defineConfig } from "vitest/config"
import path from "node:path"

// Contract tests (B6 ruling I29): the web's clients against the REAL API in process. Needs Docker (Testcontainers Postgres, Redis, MinIO),
// so they are not part of the default `npx vitest run`; CI runs `npm run test:contract` in its own job.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    include: ["test/contract/**/*.test.ts"],
    environment: "node",
    globalSetup: ["./api/test/global-setup.ts"],
    hookTimeout: 120_000,
    testTimeout: 60_000,
    fileParallelism: false,
  },
})
