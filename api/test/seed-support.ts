import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { fakeClock } from "./fakes"
import { ownerDb, ownerQuery, ownerTenantQuery } from "./db"
import { testEnv } from "./harness"
import type { SeedOptions } from "../src/seed/demo"

const here = dirname(fileURLToPath(import.meta.url))
export const PUBLIC_DATA = resolve(here, "../../public/data")
/** Test-only password (never a real secret); 12+ characters like the seed demands. */
export const DEMO_PASSWORD = "Demo-Passw0rd!test-2026"

/** Options for seedDemo against the Testcontainers database: fixed clock, explicit opt-in, the same BETTER_AUTH_SECRET the test app uses. */
export async function demoOptions(over: Partial<SeedOptions> = {}): Promise<SeedOptions> {
  return {
    clock: fakeClock(new Date("2026-12-01T09:00:00Z")),
    password: DEMO_PASSWORD,
    sourceDir: PUBLIC_DATA,
    env: { NODE_ENV: "test", ALLOW_DEMO_SEED: "1" },
    owner: ownerDb(),
    authEnv: { BETTER_AUTH_SECRET: testEnv.BETTER_AUTH_SECRET, APP_URL: testEnv.APP_URL },
    ...over,
  }
}

/**
 * Row count of a tenant table summed over every tenant. FORCE RLS applies to the owner too, so a plain `select count(*)` without a tenant context sees
 * nothing; counting per tenant is the only honest count (a vacuous 0 would make "nothing was written" tests meaningless).
 */
export async function countAll(table: string, where = "true"): Promise<number> {
  let total = 0
  for (const t of await ownerQuery("select id from tenants order by id")) {
    total += Number((await ownerTenantQuery(String(t.id), `select count(*)::int as n from ${table} where ${where}`))[0].n)
  }
  return total
}
