import { beforeEach, describe, expect, test } from "vitest"
import { resetDb, testApp } from "../../../test/harness"
import { ownerQuery, testDb } from "../../../test/db"
import { makeTenant, makeUser } from "../../../test/factories"
import { assertSeedAllowed, DEMO_SLUGS, SeedRefused } from "./guards"
import { seedDemo } from "./seed"
import { countAll, demoOptions } from "../../../test/seed-support"

beforeEach(resetDb)

const refusal = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p
  } catch (e) {
    if (e instanceof SeedRefused) return e.code
    throw e
  }
  return "allowed"
}
const OK = { NODE_ENV: "development", ALLOW_DEMO_SEED: "1" }
const guard = (env: Record<string, string | undefined> = OK, emailDomain = "demo.example") => assertSeedAllowed(testDb(), { env, emailDomain })

/** Row counts of the tables a seed would write first, to prove a refusal wrote nothing. */
async function written(): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const t of ["tenants", '"user"', "account", "platform_staff"]) out[t] = Number((await ownerQuery(`select count(*)::int as n from ${t}`))[0].n)
  for (const t of ["audit_events", "domain_events", "memberships", "tasks", "teams", "roles"]) out[t] = await countAll(t) // tenant tables: per tenant (RLS)
  return out
}

describe("seed guards", () => {
  test("an empty database is allowed", async () => {
    expect(await refusal(guard())).toBe("allowed")
  })

  test("a database with only the demo tenants is allowed (re-run)", async () => {
    const t = testApp()
    for (const slug of DEMO_SLUGS) await makeTenant(t.deps, { slug })
    expect(await refusal(guard())).toBe("allowed")
  })

  test("a database with another tenant is refused", async () => {
    const t = testApp()
    await makeTenant(t.deps, { slug: "northgate" })
    await makeTenant(t.deps, { slug: "real-customer" })
    expect(await refusal(guard())).toBe("other_tenants")
  })

  test("the demo slugs are matched exactly: a look-alike slug is another tenant", async () => {
    const t = testApp()
    await makeTenant(t.deps, { slug: "northgate-2" })
    expect(await refusal(guard())).toBe("other_tenants")
  })

  test("NODE_ENV=production without the opt-in is refused, with the opt-in it still has to pass the tenant check", async () => {
    expect(await refusal(guard({ NODE_ENV: "production" }))).toBe("opt_in_required")
    expect(await refusal(guard({ NODE_ENV: "production", ALLOW_DEMO_SEED: "0" }))).toBe("opt_in_required")
    expect(await refusal(guard({ NODE_ENV: "production", ALLOW_DEMO_SEED: "1" }))).toBe("allowed") // empty demo database
    const t = testApp()
    await makeTenant(t.deps, { slug: "real-customer" })
    expect(await refusal(guard({ NODE_ENV: "production", ALLOW_DEMO_SEED: "1" }))).toBe("other_tenants")
  })

  test("a missing or non-exact opt-in is refused in every environment", async () => {
    expect(await refusal(guard({ NODE_ENV: "development" }))).toBe("opt_in_required")
    expect(await refusal(guard({ NODE_ENV: "test", ALLOW_DEMO_SEED: "true" }))).toBe("opt_in_required")
    expect(await refusal(guard({ ALLOW_DEMO_SEED: "yes" }))).toBe("opt_in_required")
    expect(await refusal(guard({ ALLOW_DEMO_SEED: "" }))).toBe("opt_in_required")
  })

  test("a user outside the demo email domain is refused even before any tenant exists", async () => {
    const t = testApp()
    await makeUser(t.deps, { email: "someone@real-company.ie" })
    expect(await refusal(guard())).toBe("foreign_users")
  })

  test("a refused seed writes nothing, for every refusal", async () => {
    const t = testApp()
    await makeTenant(t.deps, { slug: "real-customer" })
    const before = await written()
    const base = await demoOptions()
    expect(await refusal(seedDemo(testDb(), base))).toBe("other_tenants")
    expect(await refusal(seedDemo(testDb(), { ...base, env: { NODE_ENV: "production" } }))).toBe("opt_in_required")
    expect(await refusal(seedDemo(testDb(), { ...base, env: { NODE_ENV: "test" } }))).toBe("opt_in_required")
    expect(await written()).toEqual(before)
  })

  test("there is no argument that skips the guard", async () => {
    const t = testApp()
    await makeTenant(t.deps, { slug: "real-customer" })
    const before = await written()
    const base = await demoOptions()
    const sneaky = { ...base, force: true, skipGuard: true, allowOtherTenants: true, reset: true, env: { NODE_ENV: "production", ALLOW_DEMO_SEED: "1", FORCE: "1", SEED_FORCE: "1" } }
    expect(await refusal(seedDemo(testDb(), sneaky as never))).toBe("other_tenants")
    expect(await written()).toEqual(before)
  })

  test("a missing or short password refuses before any write, and the password never appears in the error", async () => {
    const base = await demoOptions()
    const before = await written()
    for (const password of [undefined, "", "short-one"]) {
      let message = ""
      let code = ""
      try {
        await seedDemo(testDb(), { ...base, password: password as never })
      } catch (e) {
        code = e instanceof SeedRefused ? e.code : "other"
        message = `${(e as Error).message} ${JSON.stringify(e)}`
      }
      expect(code).toBe("password_required")
      if (password) expect(message).not.toContain(password)
    }
    expect(await written()).toEqual(before)
  })

  test("an unusable anchor, platform TOTP secret or email domain refuses before anything is written", async () => {
    const base = await demoOptions()
    const before = await written()
    expect(await refusal(seedDemo(testDb(), { ...base, anchor: "2026-13-40" }))).toBe("bad_anchor")
    expect(await refusal(seedDemo(testDb(), { ...base, platformTotpSecret: "short" }))).toBe("totp_secret_invalid")
    expect(await refusal(seedDemo(testDb(), { ...base, emailDomain: "company.com" }))).toBe("email_domain")
    expect(await refusal(seedDemo(testDb(), { ...base, emailDomain: "mail.real-company.ie" }))).toBe("email_domain")
    expect(await written()).toEqual(before)
  })
})
