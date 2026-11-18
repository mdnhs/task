import { execFile } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { beforeEach, describe, expect, test } from "vitest"
import { resetDb, testApp, testEnv } from "../../../test/harness"
import { ownerDb, ownerQuery } from "../../../test/db"
import { SEED_LOCK_KEY } from "./guards"
import { makeTenant } from "../../../test/factories"
import { countAll, DEMO_PASSWORD } from "../../../test/seed-support"

const run = promisify(execFile)
const API = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")

type Out = { code: number; stdout: string; stderr: string }
/** Runs the real script in a child process with exactly these variables (a minimal environment, never the parent's). */
async function seed(env: Record<string, string | undefined>, args: string[] = []): Promise<Out> {
  const clean = Object.fromEntries(Object.entries({
    PATH: process.env.PATH, HOME: process.env.HOME,
    DATABASE_URL: process.env.TEST_DATABASE_URL, BETTER_AUTH_SECRET: testEnv.BETTER_AUTH_SECRET, APP_URL: testEnv.APP_URL, ...env,
  }).filter(([, v]) => v !== undefined)) as Record<string, string>
  try {
    const r = await run(process.execPath, ["../node_modules/.bin/tsx", "scripts/seed-demo.ts", ...args], { cwd: API, env: clean, timeout: 120_000 })
    return { code: 0, stdout: r.stdout, stderr: r.stderr }
  } catch (e) {
    const x = e as { code?: number; stdout?: string; stderr?: string }
    return { code: typeof x.code === "number" ? x.code : -1, stdout: x.stdout ?? "", stderr: x.stderr ?? "" }
  }
}
const OPT_IN = { ALLOW_DEMO_SEED: "1", SEED_DEMO_PASSWORD: DEMO_PASSWORD }
const users = async () => Number((await ownerQuery('select count(*)::int as n from "user"'))[0].n)

beforeEach(resetDb)

describe("scripts/seed-demo.ts", () => {
  test("refuses without the opt-in, with a bad argument, and without a usable password: nothing is written and nothing secret is printed", async () => {
    const noOptIn = await seed({ SEED_DEMO_PASSWORD: DEMO_PASSWORD })
    expect([noOptIn.code, noOptIn.stderr.trim()]).toEqual([1, "refused: opt_in_required"])
    const badArg = await seed(OPT_IN, ["--force"])
    expect(badArg.code).toBe(2)
    expect((await seed(OPT_IN, ["--anchor", "yesterday"])).code).toBe(2)
    const noPassword = await seed({ ALLOW_DEMO_SEED: "1" })
    expect([noPassword.code, noPassword.stderr.trim()]).toEqual([1, "refused: password_required"])
    const short = await seed({ ALLOW_DEMO_SEED: "1", SEED_DEMO_PASSWORD: "short-pw" })
    expect(short.stderr).not.toContain("short-pw")
    expect(await users()).toBe(0)
    expect(await countAll("tasks")).toBe(0)
  }, 180_000)

  test("NODE_ENV=production with the opt-in still refuses a database that holds another tenant, and without the opt-in refuses outright", async () => {
    const t = testApp()
    await makeTenant(t.deps, { slug: "real-customer" })
    const prod = await seed({ ...OPT_IN, NODE_ENV: "production" })
    expect([prod.code, prod.stderr.trim().split("\n").pop()]).toEqual([1, "refused: other_tenants"])
    const prodNoOptIn = await seed({ NODE_ENV: "production", SEED_DEMO_PASSWORD: DEMO_PASSWORD })
    expect(prodNoOptIn.stderr.trim()).toBe("refused: opt_in_required")
    expect(await users()).toBe(0)
    expect(Number((await ownerQuery("select count(*)::int as n from tenants"))[0].n)).toBe(1)
  }, 180_000)

  test("seeds, and a second run on the same database is allowed only with the owner connection, then yields the same tenants; the password is never printed", async () => {
    const first = await seed({ ...OPT_IN, SEED_PLATFORM_TOTP_SECRET: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP" }, ["--anchor", "2026-12-01"])
    expect(first.code).toBe(0)
    expect(first.stdout).toContain("seeded northgate, harbourline, millbrook")
    expect(first.stdout).toContain("anchor 2026-12-01")
    expect(first.stdout).toContain("not seeded: rosters/*: FE-only")
    const before = (await ownerQuery("select id, slug from tenants order by slug")).map((r) => `${r.id}:${r.slug}`)
    const noOwner = await seed(OPT_IN)
    expect([noOwner.code, noOwner.stderr.trim()]).toEqual([1, "refused: owner_required"])
    const again = await seed({ ...OPT_IN, DATABASE_OWNER_URL: process.env.TEST_DATABASE_OWNER_URL })
    expect(again.code).toBe(0)
    expect((await ownerQuery("select id, slug from tenants order by slug")).map((r) => `${r.id}:${r.slug}`)).toEqual(before)
    for (const out of [first, again]) {
      expect(out.stdout + out.stderr).not.toContain(DEMO_PASSWORD)
      expect(out.stdout + out.stderr).not.toContain("JBSWY3DPEHPK3PXP")
    }
    expect(await users()).toBe(21) // 20 people + the platform owner
  }, 300_000)

  test("--anchor latest-report is accepted; a held seed lock makes the script exit 1 with refused: lock_timeout within SEED_LOCK_TIMEOUT_MS", async () => {
    const holder = await ownerDb().$client.connect()
    await holder.query("select pg_advisory_lock($1)", [SEED_LOCK_KEY])
    try {
      const started = Date.now()
      const out = await seed({ ...OPT_IN, SEED_LOCK_TIMEOUT_MS: "500" }, ["--anchor", "latest-report"])
      expect([out.code, out.stderr.trim().split("\n").pop()]).toEqual([1, "refused: lock_timeout"])
      expect(Date.now() - started).toBeLessThan(60_000)
    } finally {
      await holder.query("select pg_advisory_unlock($1)", [SEED_LOCK_KEY])
      holder.release()
    }
    expect(await users()).toBe(0)
  }, 180_000)
})
