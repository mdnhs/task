import { readFileSync } from "node:fs"
import { beforeEach, describe, expect, test } from "vitest"
import { call, resetDb, testApp, testEnv } from "../test/harness"
import { makeTenant } from "../test/factories"
import { ownerDb, ownerQuery, ownerTenantQuery, testDb } from "../test/db"
import { fakeClock } from "../test/fakes"
import { buildUsersFile, isLocalUrl, LOAD_SLUG, LoadRefused, prepareLoad, type LoadOptions } from "./load-prepare"

// B7 Task 17: the load-test seed. Same guards as the demo seed (ALLOW_DEMO_SEED, one local database, nothing but demo data) plus its own.
const PASSWORD = "Load-Passw0rd!test-2026"
const opts = (over: Partial<LoadOptions> = {}): LoadOptions => ({
  env: { NODE_ENV: "test", ALLOW_DEMO_SEED: "1" },
  urls: { app: "postgres://u:p@localhost:5432/x", owner: "postgres://u:p@127.0.0.1:5432/x" },
  db: testDb(),
  owner: ownerDb(),
  clock: fakeClock(new Date("2026-12-01T09:00:00Z")),
  password: PASSWORD,
  users: 12,
  tasks: 120,
  authEnv: { BETTER_AUTH_SECRET: testEnv.BETTER_AUTH_SECRET, APP_URL: testEnv.APP_URL },
  ...over,
})
const refusal = async (o: LoadOptions) => {
  const e = await prepareLoad(o).then(() => null, (x: unknown) => x)
  expect(e).toBeInstanceOf(LoadRefused)
  return (e as LoadRefused).code
}
const noLoadRows = async () => Number((await ownerQuery("select count(*)::int as n from tenants where slug = $1", [LOAD_SLUG]))[0].n) + Number((await ownerQuery(`select count(*)::int as n from "user"`))[0].n)

beforeEach(resetDb)

describe("load-prepare", () => {
  test("produces N users each with a cookie jar entry and the tenant slug; the cookies sign in to the real app; tasks and the shift exist", async () => {
    const r = await prepareLoad(opts())
    expect(r.file.tenant).toBe(LOAD_SLUG)
    expect(r.file.users).toHaveLength(12)
    expect(r.file.users.map((u) => u.role)).toEqual(["owner", ...Array(10).fill("ops"), "employee"])
    for (const u of r.file.users) {
      expect(Object.keys(u).sort()).toEqual(["cookie", "email", "role"])
      expect(u.email).toMatch(/^load-\d{4}@demo\.example$/)
      expect(u.cookie).toMatch(/session_token=/)
    }
    expect(JSON.stringify(r.file)).not.toContain(PASSWORD)
    expect(r.counts).toMatchObject({ users: 12, tasks: 120 })
    const { app } = testApp()
    const ops = r.file.users[1]
    const me = await call(app, "GET", "/v1/dashboard", { cookie: ops.cookie, tenant: LOAD_SLUG })
    expect(me.status, await me.clone().text()).toBe(200)
    const emp = r.file.users[11]
    const list = await call(app, "GET", "/v1/tasks?limit=50", { cookie: emp.cookie, tenant: LOAD_SLUG })
    expect(list.status).toBe(200)
    expect(((await list.json()) as { items: unknown[] }).items.length).toBeGreaterThan(0)
    const tid = String((await ownerQuery("select id from tenants where slug = $1", [LOAD_SLUG]))[0].id)
    expect(Number((await ownerTenantQuery(tid, "select count(*)::int as n from tasks"))[0].n)).toBe(120)
    expect(Number((await ownerTenantQuery(tid, "select count(*)::int as n from shift_assignments"))[0].n)).toBe(12)
    expect(Number((await ownerTenantQuery(tid, "select count(*)::int as n from search_documents where entity = 'task'"))[0].n)).toBe(120)
    const open = await call(app, "POST", "/v1/shift-reports/open", { cookie: emp.cookie, tenant: LOAD_SLUG, body: { patternId: r.file.patternId, date: "2026-11-10" } })
    expect([200, 201], await open.clone().text()).toContain(open.status)
  })

  test("buildUsersFile keeps only email, role and cookie per user", () => {
    const f = buildUsersFile({ tenant: "t", patternId: "p", today: "2026-12-01", users: [{ email: "a@demo.example", role: "ops", cookie: "c=1", ...({ password: "leak" } as object) } as never] })
    expect(f.users[0]).toEqual({ email: "a@demo.example", role: "ops", cookie: "c=1" })
  })

  test("refuses without ALLOW_DEMO_SEED=1, and NODE_ENV=production without ALLOW_LOAD_SEED=1; nothing is written", async () => {
    expect(await refusal(opts({ env: { NODE_ENV: "test" } }))).toBe("opt_in_required")
    expect(await refusal(opts({ env: { NODE_ENV: "production", ALLOW_DEMO_SEED: "1" } }))).toBe("load_opt_in_required")
    expect(await noLoadRows()).toBe(0)
  })

  test("refuses a database URL that is not localhost, a bad size and a short password", async () => {
    expect(await refusal(opts({ urls: { app: "postgres://u:p@db.example.com:5432/x", owner: "postgres://u:p@localhost:5432/x" } }))).toBe("not_local")
    expect(await refusal(opts({ urls: { app: "postgres://u:p@localhost:5432/x", owner: undefined } }))).toBe("not_local")
    expect(await refusal(opts({ users: 5 }))).toBe("bad_size")
    expect(await refusal(opts({ password: "short" }))).toBe("password_required")
    expect(isLocalUrl("postgres://u:p@localhost.evil.com:5432/x")).toBe(false)
    expect(await noLoadRows()).toBe(0)
  })

  test("never touches a database that holds a real tenant or a real account; a second run is refused", async () => {
    await makeTenant(testApp().deps, { slug: "real-client" })
    expect(await refusal(opts())).toBe("other_tenants")
    expect(await ownerQuery("select count(*)::int as n from tenants where slug = $1", [LOAD_SLUG])).toEqual([{ n: 0 }])
    await resetDb()
    await ownerQuery(`insert into "user" (id, name, email, email_verified, created_at, updated_at) values ('real-1', 'Real', 'someone@gmail.com', true, now(), now())`)
    expect(await refusal(opts())).toBe("foreign_users")
    await resetDb()
    await prepareLoad(opts())
    expect(await refusal(opts())).toBe("tenant_exists")
  })

  test("the users file is gitignored", () => {
    expect(readFileSync(new URL("../../.gitignore", import.meta.url), "utf8")).toMatch(/^\/?load\/\.users\.json$/m)
  })
})
