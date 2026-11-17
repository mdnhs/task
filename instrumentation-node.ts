// Node-only part of instrumentation.ts (Next's pattern: keeps `process.exit` out of the edge bundle). Production refuses to boot without APP_ORIGIN and
// API_URL (lib/env.ts). Throwing alone would leave `next start` serving 500s, so the process exits with the message: a deployment with a missing
// variable fails loudly at boot.
import { assertServerEnv } from "./lib/env"

export function checkServerEnvAtBoot(): void {
  try {
    assertServerEnv()
  } catch (e) {
    console.error(e instanceof Error ? e.message : "Invalid server environment.")
    process.exit(1)
  }
}
