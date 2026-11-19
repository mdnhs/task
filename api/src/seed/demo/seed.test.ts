import { readFileSync } from "node:fs"
import { createOTP } from "@better-auth/utils/otp"
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest"
import { call, resetDb, tenantGetRoutes, testApp } from "../../../test/harness"
import { ownerDb, ownerQuery, ownerTenantQuery, testDb } from "../../../test/db"
import { cookieFrom, signIn } from "../../../test/factories"
import { countAll, DEMO_PASSWORD, demoOptions, PUBLIC_DATA } from "../../../test/seed-support"
import { verifyChain } from "../../modules/audit"
import { withTenant } from "../../db/tenant-tx"
import { seedDemo, type SeedReport } from "./index"
import { deleteDemoTenants, tenantTableNames } from "./wipe"
import type { Storage } from "../../core/storage/storage"
import { sourcePath } from "./source"

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const read = <T = Json>(path: string): T => JSON.parse(readFileSync(sourcePath(PUBLIC_DATA, path), "utf8")) as T
const n = async (sqlText: string, params: unknown[] = []) => Number((await ownerQuery(sqlText, params))[0].n)
const tenantId = async (slug: string) => String((await ownerQuery("select id from tenants where slug = $1", [slug]))[0].id)
const nIn = async (slug: string, sqlText: string) => Number((await ownerTenantQuery(await tenantId(slug), sqlText))[0].n)
const ANCHOR = "2026-12-01" // 42 days after the mock's 2026-10-20, a Tuesday like it

const OPEN = ["not_started", "in_progress", "blocked", "submitted", "changes_requested"]
const mockTasks = read<{ tasks: Json[] }>("tasks/tasks.json").tasks
const mockReports = read<{ reports: Json[] }>("reports/reports.json").reports
const mockUsers = read<{ users: Json[] }>("settings/users.json").users
const mockPeople = read<{ people: Json[] }>("tasks/people.json").people
const mockNotifications = read<Json[]>("shell/notifications.json")
const MOCK_NOW = read("shell/org.json").today as string // 2026-10-20T09:00:00

describe("demo seed (loaded once, anchored to 2026-12-01)", () => {
  let report: SeedReport
  let out = ""
  const t = testApp()

  beforeAll(async () => {
    await resetDb()
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "info"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")]
    const w = vi.spyOn(process.stdout, "write")
    const e = vi.spyOn(process.stderr, "write")
    try {
      report = await seedDemo(testDb(), await demoOptions({ anchor: ANCHOR }))
    } finally {
      out = [...spies, w, e].map((s) => JSON.stringify(s.mock.calls)).join("\n")
      vi.restoreAllMocks()
    }
  }, 300_000)

  afterAll(() => vi.restoreAllMocks())

  test("row counts equal the JSON: users, memberships, teams, patterns, assignments, tasks, reports, devices, projects, templates", async () => {
    // + the two roster people with no account (s-bell, s-grant): the other `s-` ids of the roster files are accounts under another name key (M. Haddad, J. Silva, A. Kowalski)
    const people = new Set([...mockUsers.map((u) => u.name), ...mockPeople.map((p) => p.name), "Marcus Bell", "Oliver Grant"])
    expect(report.tenants).toEqual(["northgate", "harbourline", "millbrook"])
    expect(await n('select count(*)::int as n from "user"')).toBe(people.size)
    expect(report.users).toBe(people.size)
    const north = "northgate"
    expect(await nIn(north, "select count(*)::int as n from memberships")).toBe(people.size)
    expect(await nIn("harbourline", "select count(*)::int as n from memberships")).toBe(1)
    expect(await nIn("millbrook", "select count(*)::int as n from memberships")).toBe(1)
    expect(await nIn(north, "select count(*)::int as n from teams")).toBe(read("settings/departments.json").departments.length)
    expect(await nIn(north, "select count(*)::int as n from shift_patterns")).toBe(read("shifts/patterns.json").patterns.length)
    expect(await nIn(north, "select count(*)::int as n from shift_assignments")).toBe(read("shifts/assignments.json").assignments.length)
    expect(await nIn(north, "select count(*)::int as n from tasks")).toBe(mockTasks.length)
    expect(await nIn(north, "select count(*)::int as n from shift_reports")).toBe(mockReports.length)
    expect(await nIn(north, "select count(*)::int as n from devices")).toBe(read("settings/devices.json").devices.length)
    expect(await nIn(north, "select count(*)::int as n from projects")).toBe(read("tasks/projects.json").projects.length)
    expect(await nIn(north, "select count(*)::int as n from task_templates")).toBe(read("tasks/templates.json").templates.length)
    expect(await nIn(north, "select count(*)::int as n from project_milestones")).toBe(4)
    expect(await nIn(north, "select count(*)::int as n from shift_report_versions")).toBe(mockReports.reduce((a, r) => a + r.versions.length, 0))
    expect(await nIn(north, "select count(*)::int as n from task_checklist_items")).toBe(mockTasks.reduce((a, x) => a + (x.checklist?.length ?? 0), 0))
    expect(await nIn(north, "select count(*)::int as n from task_evidence")).toBe(mockTasks.reduce((a, x) => a + x.evidence.length, 0))
    expect(report.counts.tasks).toBe(mockTasks.length)
    expect(report.counts.reports).toBe(mockReports.length)
    expect(report.warnings.length).toBeGreaterThan(0) // evidence files and report attachments are metadata only: said out loud
  })

  test("dates re-anchor: overdue, due-today and submitted counts equal the mock's at 2026-10-20; wall times and report shift dates keep their offsets", async () => {
    const live = mockTasks.filter((x) => !x.archivedAt)
    const overdue = live.filter((x) => OPEN.includes(x.status) && x.due < MOCK_NOW).length
    const dueToday = live.filter((x) => OPEN.includes(x.status) && x.due.slice(0, 10) === MOCK_NOW.slice(0, 10)).length
    const submitted = live.filter((x) => x.status === "submitted").length
    expect(overdue).toBeGreaterThan(0)
    expect(dueToday).toBeGreaterThan(0)
    const nowAt = "2026-12-01T09:00:00Z" // 09:00 Dublin on the anchor day (GMT)
    const open = `status in ('${OPEN.join("','")}') and archived_at is null`
    expect(await nIn("northgate", `select count(*)::int as n from tasks where ${open} and due_at < '${nowAt}'`)).toBe(overdue)
    expect(await nIn("northgate", `select count(*)::int as n from tasks where ${open} and (due_at at time zone 'Europe/Dublin')::date = date '${ANCHOR}'`)).toBe(dueToday)
    expect(await nIn("northgate", "select count(*)::int as n from tasks where status = 'submitted' and archived_at is null")).toBe(submitted)
    // TSK-1001 was due 2026-10-12 17:00 local: 8 days before the mock's today, so 2026-11-23 17:00 local on the anchor
    const t1001 = (await ownerTenantQuery(await tenantId("northgate"), "select to_char(due_at at time zone 'Europe/Dublin', 'YYYY-MM-DD\"T\"HH24:MI') as due from tasks where ref_no = 1001"))[0]
    expect(t1001.due).toBe("2026-11-23T17:00")
    // a task that straddles the DST end keeps its local wall time (TSK due on 2026-10-26 or later is shifted into GMT)
    const across = mockTasks.find((x) => x.due.slice(0, 10) >= "2026-10-26")!
    const ref = Number(across.ref.slice(4))
    const row = (await ownerTenantQuery(await tenantId("northgate"), `select to_char(due_at at time zone 'Europe/Dublin', 'HH24:MI') as hm from tasks where ref_no = ${ref}`))[0]
    expect(row.hm).toBe(across.due.slice(11, 16))
    // reports keep their shift dates relative to the anchor (42 days later)
    const dates = (await ownerTenantQuery(await tenantId("northgate"), "select to_char(shift_date, 'YYYY-MM-DD') as d from shift_reports order by 1")).map((r) => r.d)
    const expected = mockReports.map((r) => new Date(Date.parse(`${r.date}T00:00:00Z`) + 42 * 86_400_000).toISOString().slice(0, 10)).sort()
    expect(dates).toEqual(expected)
  })

  test("task refs are preserved: TSK-1042 exists with its mock ref, and the counter row says the next ref is max+1", async () => {
    expect(mockTasks.some((x) => x.ref === "TSK-1042")).toBe(true)
    expect(await nIn("northgate", "select count(*)::int as n from tasks where ref_no = 1042")).toBe(1)
    const max = Math.max(...mockTasks.map((x) => Number(x.ref.slice(4))))
    expect(await nIn("northgate", `select count(*)::int as n from task_counters where next_no = ${max + 1}`)).toBe(1)
  })

  test("every seeded persona signs in through Better Auth with the demo password: verified, no 2FA, role key as in roles.json", async () => {
    const roleKeys = new Set(read<{ roles: Json[] }>("shell/roles.json").roles.map((r) => r.id))
    const byEmail = new Map(mockUsers.map((u) => [u.email.replace(/@.*/, "@demo.example"), u]))
    const rows = await ownerQuery('select email, email_verified, two_factor_enabled from "user" order by email')
    expect(rows.length).toBe(report.users)
    for (const r of rows) {
      expect(r.email_verified).toBe(true)
      expect(r.two_factor_enabled).toBeFalsy()
      expect(String(r.email)).toMatch(/@demo\.example$/)
    }
    const memberRoles = new Map((await ownerTenantQuery(await tenantId("northgate"), "select u.email, r.key from memberships m join roles r on r.id = m.role_id join \"user\" u on u.id = m.user_id")).map((r) => [String(r.email), String(r.key)]))
    for (const [email, u] of byEmail) expect(memberRoles.get(email)).toBe(u.role)
    for (const key of memberRoles.values()) expect(roleKeys.has(key)).toBe(true)
    for (const email of ["amara.bello@demo.example", "lilianna.novak@demo.example", "tomasz.wojcik@demo.example", "marcus.hill@demo.example"]) {
      const s = await signIn(t.app, email, DEMO_PASSWORD)
      const me = (await (await call(t.app, "GET", "/v1/me", { cookie: s.cookie })).json()) as Json
      expect(me.user.emailVerified).toBe(true)
      expect(me.user.twoFactorEnabled).toBeFalsy()
    }
    expect(await n('select count(*)::int as n from platform_staff')).toBe(0) // no SEED_PLATFORM_TOTP_SECRET: no platform owner (J4)
  })

  test("the demo owner is an owner of all three tenants; the other two tenants hold only that owner", async () => {
    const me = (await (await call(t.app, "GET", "/v1/me", { cookie: (await signIn(t.app, "amara.bello@demo.example", DEMO_PASSWORD)).cookie })).json()) as Json
    expect(me.tenants.map((x: Json) => [x.slug, x.roleKey]).sort()).toEqual([["harbourline", "owner"], ["millbrook", "owner"], ["northgate", "owner"]])
  })

  test("emails use the reserved domain; the seed sent no mail and queued no notification email", async () => {
    expect(await n(`select count(*)::int as n from "user" where email not like '%@demo.example'`)).toBe(0)
    expect(await countAll("notification_deliveries")).toBe(0)
    expect(await countAll("domain_events", "relayed_at is null")).toBe(0) // the relay ran, with the search indexers only
    expect(await countAll("domain_events")).toBeGreaterThan(0) // ... over events the services really published
    expect(await countAll("notifications")).toBe(mockNotifications.filter((x) => !/payroll/i.test(x.title)).length) // in-app only, no deliveries
    expect(report.counts.jobsQueued).toBe(0)
  })

  test("the password never appears in stdout, stderr or the report", () => {
    expect(out).not.toContain(DEMO_PASSWORD)
    expect(JSON.stringify(report)).not.toContain(DEMO_PASSWORD)
    expect(JSON.stringify(report)).not.toContain("Passw0rd")
  })

  test("devices are registered but unbound: no binding or enrolment secret is seeded", async () => {
    const rows = await ownerTenantQuery(await tenantId("northgate"), "select binding_hash, enrol_hash, enrol_expires_at from devices")
    expect(rows.length).toBe(6)
    for (const r of rows) expect([r.binding_hash, r.enrol_hash, r.enrol_expires_at]).toEqual([null, null, null])
    expect(await nIn("northgate", "select count(*)::int as n from device_policies where feature = 'drive' and allow = 'trusted-company-pc'")).toBe(1)
  })

  test("reporting lines are copied verbatim and indirectReports lists every manager-of-manager pair (F5 note)", async () => {
    const members = read<{ members: Json[] }>("shifts/members.json").members
    const email = (pid: string) => {
      const p = mockPeople.find((x) => x.id === pid)!
      const u = mockUsers.find((x) => x.name === p.name)
      return (u ? u.email.replace(/@.*/, "") : p.name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "")) + "@demo.example"
    }
    const lines = (await ownerTenantQuery(await tenantId("northgate"), "select u.email as member, m.email as manager from reporting_lines r join \"user\" u on u.id = r.user_id join \"user\" m on m.id = r.manager_id")).map((r) => `${r.member}>${r.manager}`).sort()
    const expected = members.filter((m) => m.managerId).map((m) => `${email(m.personId)}>${email(m.managerId)}`).sort()
    expect(lines).toEqual(expected)
    // two levels: ismail -> daniel -> lilianna is the only manager-of-manager chain in the data
    const manager = new Map(members.filter((m) => m.managerId).map((m) => [m.personId, m.managerId as string]))
    const pairs: [string, string][] = []
    for (const [person, mgr] of manager) for (let up = manager.get(mgr); up; up = manager.get(up)) pairs.push([email(up), email(person)])
    expect(pairs.length).toBeGreaterThan(0)
    expect([...report.indirectReports].sort()).toEqual([...pairs].sort())
  })

  test("after seeding: tenant isolation holds, verifyChain is ok for every tenant, search finds a seeded task by ref, entitlements are business / starter trialing / business past_due", async () => {
    // RLS: nothing is visible without a tenant context, and a tenant sees only its own rows
    expect(Number((await testDb().execute(`select count(*)::int as n from tasks` as never)).rows[0].n)).toBe(0)
    expect(await nIn("harbourline", "select count(*)::int as n from tasks")).toBe(0)
    for (const slug of report.tenants) {
      const id = await tenantId(slug)
      expect(await verifyChain(testDb(), id)).toMatchObject({ ok: true })
      expect(await withTenant(testDb(), id, async (tx) => Number((await tx.execute("select count(*)::int as n from audit_events" as never)).rows[0].n))).toBeGreaterThan(0)
    }
    const owner = (await signIn(t.app, "amara.bello@demo.example", DEMO_PASSWORD)).cookie
    const hits = ((await (await call(t.app, "GET", "/v1/search?q=TSK-1042", { cookie: owner, tenant: "northgate" })).json()) as { hits: Json[] }).hits
    expect(hits.some((h) => String(h.title).startsWith("TSK-1042"))).toBe(true)
    const ent = async (slug: string) => (await (await call(t.app, "GET", "/v1/entitlements", { cookie: owner, tenant: slug })).json()) as Json
    expect(await ent("northgate")).toMatchObject({ planId: "business", status: "active", billingState: "ok" })
    expect(await ent("harbourline")).toMatchObject({ planId: "starter", status: "trialing" })
    expect(await ent("millbrook")).toMatchObject({ planId: "business", status: "past_due" })
  })

  test("the real routes read the seeded data: no GET route fails, and tasks, projects, teams, devices and reports answer with the mock's numbers", async () => {
    const owner = (await signIn(t.app, "amara.bello@demo.example", DEMO_PASSWORD)).cookie
    const get = async (path: string, cookie = owner, tenant = "northgate") => {
      const res = await call(t.app, "GET", path, { cookie, tenant })
      return { status: res.status, body: (await res.json().catch(() => null)) as Json }
    }
    const failures: string[] = []
    for (const path of tenantGetRoutes(t.app)) {
      const r = await get(path)
      if (r.status >= 500) failures.push(`${path} ${r.status}`)
    }
    expect(failures).toEqual([])
    const all: Json[] = []
    for (let cursor = ""; ; ) {
      const page = (await get(`/v1/tasks?limit=100${cursor}`)).body
      all.push(...page.items)
      if (!page.nextCursor) break
      cursor = `&cursor=${encodeURIComponent(page.nextCursor)}`
    }
    expect(all.length).toBe(mockTasks.filter((x) => !x.archivedAt).length)
    const t1001 = all.find((x) => x.ref === "TSK-1001")!
    const detail = (await get(`/v1/tasks/${t1001.id}`)).body
    expect(detail.timeline.length).toBe(mockTasks.find((x) => x.ref === "TSK-1001")!.timeline.length)
    expect((await get("/v1/projects")).body.items.length).toBe(2)
    expect((await get("/v1/teams")).body.length).toBe(2)
    expect((await get("/v1/devices")).body.items?.length ?? (await get("/v1/devices")).body.length).toBe(6)
    // a staff persona sees only their own tasks (the server scopes; no client filter)
    const marcus = (await signIn(t.app, "marcus.hill@demo.example", DEMO_PASSWORD)).cookie
    const mine = (await get("/v1/tasks?limit=100", marcus)).body.items as Json[]
    expect(mine.length).toBeGreaterThan(0)
    expect(mine.length).toBeLessThan(all.length)
  })

  test("the plans table equals public/data/billing/plans.json (single source of plan data)", async () => {
    const file = read<Json[]>("billing/plans.json")
    const rows = await ownerQuery("select id, name, price_monthly_minor, currency, trial_days, limits from plans order by id")
    expect(rows.map((r) => ({ id: r.id, name: r.name, priceMonthly: Number(r.price_monthly_minor) / 100, currency: r.currency, trialDays: r.trial_days, limits: r.limits }))).toEqual(
      file.map((p) => ({ id: p.id, name: p.name, priceMonthly: p.priceMonthly, currency: p.currency, trialDays: p.trialDays, limits: p.limits })).sort((a, b) => a.id.localeCompare(b.id)),
    )
  })

  test("seed is idempotent: a second run gives identical row counts, no duplicate users, the same refs, tenant and user ids", async () => {
    const snapshot = async () => ({
      users: (await ownerQuery('select id, email from "user" order by email')).map((r) => `${r.id}:${r.email}`),
      tenants: (await ownerQuery("select id, slug from tenants order by slug")).map((r) => `${r.id}:${r.slug}`),
      refs: (await ownerQuery("select ref_no from tasks order by ref_no")).map((r) => Number(r.ref_no)),
      counts: [
        ...(await Promise.all(["memberships", "teams", "team_members", "reporting_lines", "shift_patterns", "shift_assignments", "tasks", "task_history", "task_evidence", "task_checklist_items", "task_comments", "task_assignees", "shift_reports", "shift_report_versions", "shift_report_items", "devices", "projects", "project_milestones", "task_templates", "notifications", "search_documents", "public_holidays", "subscriptions", "files"].map(async (tb) => `${tb}=${await countAll(tb)}`))),
        `account=${await n("select count(*)::int as n from account")}`,
      ],
    })
    const before = await snapshot()
    const again = await seedDemo(testDb(), await demoOptions({ anchor: ANCHOR }))
    expect(again.users).toBe(report.users)
    expect(await snapshot()).toEqual(before)
    for (const slug of report.tenants) expect(await verifyChain(testDb(), await tenantId(slug))).toMatchObject({ ok: true })
  }, 300_000)

  test("a re-run on a later day re-anchors every date to that day", async () => {
    await seedDemo(testDb(), await demoOptions({ anchor: "2027-01-12" }))
    // TSK-1001 was 8 days before the mock's today
    const row = (await ownerTenantQuery(await tenantId("northgate"), "select to_char(due_at at time zone 'Europe/Dublin', 'YYYY-MM-DD\"T\"HH24:MI') as due from tasks where ref_no = 1001"))[0]
    expect(row.due).toBe("2027-01-04T17:00")
    const sub = (await ownerTenantQuery(await tenantId("harbourline"), "select to_char(trial_ends_at at time zone 'Europe/Dublin', 'YYYY-MM-DD') as d from subscriptions"))[0]
    expect(sub.d).toBe("2027-01-26") // the mock's trialEndsOn 2026-11-03 is 14 days after its today
  }, 300_000)

  // LAST: it creates a task through the API, which leaves its own (unrelayed) event and one more row behind
  test("the next created task gets TSK-<max+1>", async () => {
    const max = Math.max(...mockTasks.map((x) => Number(x.ref.slice(4))))
    const owner = await signIn(t.app, "amara.bello@demo.example", DEMO_PASSWORD)
    const res = await call(t.app, "POST", "/v1/tasks", {
      cookie: owner.cookie, tenant: "northgate", headers: { origin: "http://localhost:3000" },
      body: { title: "Check the seed counter", due: "2026-12-10T17:00:00", start: "2026-12-10T09:00:00", priority: 2 },
    })
    expect(res.status).toBe(201)
    expect(((await res.json()) as Json).ref).toBe(`TSK-${max + 1}`)
  })
})

describe("demo seed: options and platform owner", () => {
  beforeEach(resetDb)

  test("the platform owner exists only when SEED_PLATFORM_TOTP_SECRET is given, and then has 2FA enrolled with it", async () => {
    const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP" // a raw TOTP key string (the authenticator sees its base32 form)
    await seedDemo(testDb(), await demoOptions({ anchor: ANCHOR, platformTotpSecret: secret }))
    const t = testApp()
    const email = "platform.owner@demo.example"
    const row = (await ownerQuery('select email_verified, two_factor_enabled from "user" where email = $1', [email]))[0]
    expect(row).toEqual({ email_verified: true, two_factor_enabled: true })
    expect(await n("select count(*)::int as n from platform_staff where role = 'owner' and status = 'active'")).toBe(1)
    const origin = { origin: "http://localhost:3000" }
    const first = await call(t.app, "POST", "/api/auth/sign-in/email", { body: { email, password: DEMO_PASSWORD }, headers: origin })
    expect(((await first.json()) as Json).twoFactorRedirect).toBe(true)
    // the code comes from the supplied secret (Better Auth keys the OTP on the raw string it stored, so the authenticator generates the same codes)
    const code = await createOTP(secret, { digits: 6, period: 30 }).totp()
    const second = await call(t.app, "POST", "/api/auth/two-factor/verify-totp", { body: { code }, cookie: cookieFrom(first), headers: origin })
    expect(second.status).toBe(200)
    expect(cookieFrom(second)).toBeTruthy()
    const me = (await (await call(t.app, "GET", "/v1/me", { cookie: cookieFrom(second) })).json()) as Json
    expect(me.platformRole).toBe("owner")
  }, 300_000)

  test("--reset deletes only the demo tenants and their users, never any other tenant", async () => {
    await seedDemo(testDb(), await demoOptions({ anchor: ANCHOR }))
    const before = await ownerQuery("select id from tenants order by id")
    const users = await n('select count(*)::int as n from "user"')
    const again = await seedDemo(testDb(), await demoOptions({ anchor: ANCHOR, reset: true }))
    expect(again.users).toBe(users)
    // fresh tenant ids prove the old ones were deleted; the new set is again exactly the three demo tenants
    const after = await ownerQuery("select id, slug from tenants order by slug")
    expect(after.map((r) => r.slug)).toEqual(["harbourline", "millbrook", "northgate"])
    expect(after.some((r) => before.some((b) => b.id === r.id))).toBe(false)
    expect(await countAll("tasks")).toBe(mockTasks.length)
  }, 300_000)

  test("a seed refuses when a tenant outside the demo set exists, even with --reset: the foreign tenant and its data survive", async () => {
    const t = testApp()
    const { makeTenant, makeMember } = await import("../../../test/factories")
    const foreign = await makeTenant(t.deps, { slug: "real-customer" })
    await makeMember(t.deps, foreign.id, "owner", { email: "boss@real-customer.ie" })
    await expect(seedDemo(testDb(), await demoOptions({ reset: true }))).rejects.toMatchObject({ code: "other_tenants" })
    expect(await n("select count(*)::int as n from tenants")).toBe(1)
    expect(await n(`select count(*)::int as n from "user" where email = 'boss@real-customer.ie'`)).toBe(1)
  })
})

/** In-memory object storage: never a live bucket. Only `delete` is used by the seed. */
function fakeObjects(keys: string[]) {
  const objects = new Set(keys)
  const deleted: string[] = []
  const storage = { delete: async (k: string) => { deleted.push(k); objects.delete(k) } } as unknown as Storage
  return { storage, objects, deleted }
}

describe("B7 T13 --reset: no orphans", () => {
  beforeEach(resetDb)

  test("reset leaves no row for any tenant_id table (catalogue-driven, every table information_schema lists)", async () => {
    await seedDemo(testDb(), await demoOptions({ anchor: ANCHOR }))
    const ids = (await ownerQuery("select id from tenants")).map((r) => String(r.id))
    expect(ids).toHaveLength(3)
    const catalogue = await tenantTableNames(ownerDb())
    expect(catalogue.length).toBeGreaterThan(40) // the real schema, not an empty or hand-picked list
    for (const must of ["tasks", "audit_events", "files", "shift_reports", "domain_events"]) expect(catalogue).toContain(must)
    await deleteDemoTenants(ownerDb())
    const left: string[] = []
    for (const id of ids) for (const t of catalogue) if (Number((await ownerTenantQuery(id, `select count(*)::int as n from "${t}" where tenant_id = $1`, [id]))[0].n) > 0) left.push(t)
    expect(left).toEqual([])
    expect(await n("select count(*)::int as n from tenants")).toBe(0)
  }, 300_000)

  test("a tenant_id table that has no foreign key to tenants (a new table nobody listed) is swept too", async () => {
    await seedDemo(testDb(), await demoOptions({ anchor: ANCHOR }))
    const [t] = await ownerQuery("select id from tenants where slug = 'northgate'")
    const id = String(t.id)
    // rls_probe is the test schema's table with tenant_id and the standard RLS template and NO foreign key: exactly what a table added after B6 might look like
    await ownerTenantQuery(id, "insert into rls_probe (tenant_id, label) values ($1, 'late table')", [id])
    expect(await tenantTableNames(ownerDb())).toContain("rls_probe")
    await deleteDemoTenants(ownerDb())
    expect(Number((await ownerTenantQuery(id, "select count(*)::int as n from rls_probe where tenant_id = $1", [id]))[0].n)).toBe(0)
  }, 300_000)

  test("reset deletes the storage objects of the demo tenants' files (final and staging keys) through the injected storage, and nobody else's", async () => {
    await seedDemo(testDb(), await demoOptions({ anchor: ANCHOR }))
    const [t] = await ownerQuery("select id from tenants where slug = 'northgate'")
    const tid = String(t.id)
    const fid = "11111111-1111-4111-8111-111111111111"
    await ownerTenantQuery(tid, "insert into files (id, tenant_id, key, name, mime, size_bytes, status, created_at) values ($1, $2, $3, 'a.pdf', 'application/pdf', 10, 'clean', now())", [fid, tid, `t/${tid}/${fid}`])
    const other = "t/99999999-9999-4999-8999-999999999999/keep"
    const fake = fakeObjects([`t/${tid}/${fid}`, `u/${tid}/${fid}`, other])
    const res = await deleteDemoTenants(ownerDb(), { storage: fake.storage })
    expect(res.tenants).toBe(3)
    expect(res.objectsRemoved).toBeGreaterThanOrEqual(2)
    expect([...fake.objects]).toEqual([other])
    expect(fake.deleted).toContain(`t/${tid}/${fid}`)
    expect(fake.deleted).toContain(`u/${tid}/${fid}`)
    expect(fake.deleted).not.toContain(other)
  }, 300_000)

  test("a files row whose key is outside the demo tenant's prefixes is never deleted from storage", async () => {
    await seedDemo(testDb(), await demoOptions({ anchor: ANCHOR }))
    const [t] = await ownerQuery("select id from tenants where slug = 'northgate'")
    const tid = String(t.id)
    const fid = "44444444-4444-4444-8444-444444444444"
    const foreign = "t/99999999-9999-4999-8999-999999999999/victim"
    // files_key_check pins the key shape, so a foreign key can only exist if the constraint is lifted: do that for this test and restore it after
    await ownerQuery("alter table files drop constraint files_key_check")
    try {
      await ownerTenantQuery(tid, "insert into files (id, tenant_id, key, name, mime, size_bytes, status, created_at) values ($1, $2, $3, 'x.pdf', 'application/pdf', 10, 'clean', now())", [fid, tid, foreign])
      const fake = fakeObjects([foreign])
      await deleteDemoTenants(ownerDb(), { storage: fake.storage })
      expect(fake.deleted).not.toContain(foreign)
      expect([...fake.objects]).toEqual([foreign])
    } finally {
      await ownerQuery(`alter table files add constraint files_key_check check ("key" = 't/' || "tenant_id"::text || '/' || "id"::text)`)
    }
  }, 300_000)

  test("a storage failure does not undo the reset: the database is clean and the failure is counted for the report", async () => {
    await seedDemo(testDb(), await demoOptions({ anchor: ANCHOR }))
    const [t] = await ownerQuery("select id from tenants where slug = 'northgate'")
    const tid = String(t.id)
    const fid = "22222222-2222-4222-8222-222222222222"
    await ownerTenantQuery(tid, "insert into files (id, tenant_id, key, name, mime, size_bytes, status, created_at) values ($1, $2, $3, 'b.pdf', 'application/pdf', 10, 'clean', now())", [fid, tid, `t/${tid}/${fid}`])
    const broken = { delete: async () => { throw new Error("bucket unreachable") } } as unknown as Storage
    const res = await deleteDemoTenants(ownerDb(), { storage: broken })
    expect(res.objectFailures).toBeGreaterThanOrEqual(1)
    expect(await n("select count(*)::int as n from tenants")).toBe(0)
  }, 300_000)

  test("without a storage the reset still works and says how many objects it could not remove", async () => {
    await seedDemo(testDb(), await demoOptions({ anchor: ANCHOR }))
    const [t] = await ownerQuery("select id from tenants where slug = 'northgate'")
    const tid = String(t.id)
    const fid = "33333333-3333-4333-8333-333333333333"
    await ownerTenantQuery(tid, "insert into files (id, tenant_id, key, name, mime, size_bytes, status, created_at) values ($1, $2, $3, 'c.pdf', 'application/pdf', 10, 'clean', now())", [fid, tid, `t/${tid}/${fid}`])
    const res = await deleteDemoTenants(ownerDb())
    expect(res.objectsLeft).toBeGreaterThanOrEqual(1)
    expect(res.objectsRemoved).toBe(0)
  }, 300_000)
})

describe("B7 T13 --anchor latest-report", () => {
  beforeEach(resetDb)
  test("latest-report anchor makes the newest report date equal today (tasks keep today as their anchor)", async () => {
    const r = await seedDemo(testDb(), await demoOptions({ anchor: "latest-report" })) // the clock is 2026-12-01 in Dublin
    expect(r.anchor).toBe("2026-12-01")
    const dates = await ownerTenantQuery(String((await ownerQuery("select id from tenants where slug = 'northgate'"))[0].id), "select max(shift_date)::text as d from shift_reports")
    expect(dates[0].d).toBe("2026-12-01")
    expect(r.warnings.some((w) => /latest-report/.test(w))).toBe(true) // weekdays may differ from the patterns: said out loud
  }, 300_000)
  test("the default anchor still never puts a report after the anchor day (whole weeks)", async () => {
    const r = await seedDemo(testDb(), await demoOptions({ anchor: ANCHOR }))
    const max = (await ownerTenantQuery(String((await ownerQuery("select id from tenants where slug = 'northgate'"))[0].id), "select max(shift_date)::text as d from shift_reports"))[0].d as string
    expect(max <= r.anchor).toBe(true)
  }, 300_000)
})
