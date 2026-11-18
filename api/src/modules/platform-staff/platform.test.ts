import { execFileSync } from "node:child_process"
import { getTableName } from "drizzle-orm"
import { beforeEach, expect, test, vi } from "vitest"
import { ownerQuery, testDb } from "../../../test/db"
import { makeMember, makeStaff, makeTenant, makeUser, signInWithTotp } from "../../../test/factories"
import { call, resetDb, testApp, testEnv } from "../../../test/harness"
import * as platformEmail from "../platform-email"
import { recordPlatformAudit, verifyPlatformChain } from "../platform-audit"
import { BootstrapError, createPlatformOwner, updateStaff } from "./index"

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
beforeEach(resetDb)

const KEY = "re_test_key_aaaaaaaaaaaa1234"
const emailBody = { apiKey: KEY, fromAddress: "no-reply@x.ie", fromName: "OpsDesk" }
const ACCOUNT = "0123456789abcdef0123456789abcdef"
const SECRET = "r2-secret-access-key-ABCDEFGHIJKLMNOP9876"
const storageBody = { accountId: ACCOUNT, bucket: "opsdesk-files", accessKeyId: "AKIAR2EXAMPLEKEY0001", secretAccessKey: SECRET }
const codeOf = async (r: Response) => ((await r.clone().json()) as Json).code

async function world() {
  const t = testApp()
  const owner = await makeStaff(t.deps, "owner")
  const req = (method: string, path: string, cookie?: string, body?: unknown) => call(t.app, method, path, { cookie, body })
  const audit = () => ownerQuery("select seq, actor_id, action, entity, entity_id, before, after from platform_audit_events order by seq")
  return { ...t, owner, req, audit }
}

test("platform routes enforce role and MFA", async () => {
  const w = await world()
  const support = await makeStaff(w.deps, "support")
  expect((await w.req("PUT", "/v1/platform/settings/email", support.cookie, emailBody)).status).toBe(403)
  expect(await codeOf(await w.req("PUT", "/v1/platform/settings/email", support.cookie, emailBody))).toBe("platform_forbidden")
  const stale = await w.req("GET", "/v1/platform/staff", w.owner.staleCookie)
  expect([stale.status, await codeOf(stale)]).toEqual([401, "mfa_challenge"])
  const noTfa = await makeStaff(w.deps, "owner", { totp: false })
  const { cookie } = await (async () => {
    const r = await call(w.app, "POST", "/api/auth/sign-in/email", { body: { email: noTfa.email, password: noTfa.password }, headers: { origin: testEnv.APP_URL } })
    return { cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") }
  })()
  const enrol = await w.req("GET", "/v1/platform/staff", cookie)
  expect([enrol.status, await codeOf(enrol)]).toEqual([401, "mfa_enrolment_required"])
  const anon = await w.req("GET", "/v1/platform/staff")
  expect([anon.status, await codeOf(anon)]).toEqual([401, "unauthenticated"])
  expect((await w.req("GET", "/v1/platform/staff", w.owner.cookie)).status).toBe(200)
})

test("non-staff (tenant owner, suspended staff, stranger) get the same 404 not_found on EVERY /v1/platform route, even without 2FA", async () => {
  const w = await world()
  const tenant = await makeTenant(w.deps)
  const tOwner = await makeMember(w.deps, tenant.id, "owner", { totp: true })
  const tOwnerCookie = (await signInWithTotp(w.app, tOwner.email, tOwner.password, tOwner.totpSecret!)).cookie // MFA-passed, but not staff
  const suspended = await makeStaff(w.deps, "owner", { status: "suspended" })
  const noTfaStranger = await makeUser(w.deps)
  const doc = w.app.getOpenAPI31Document({ openapi: "3.1.0", info: { title: "t", version: "1" } })
  const ops = Object.entries(doc.paths ?? {}).filter(([p]) => p.startsWith("/v1/platform/")).flatMap(([p, item]) => (["get", "put", "post", "patch", "delete"] as const).filter((m) => item?.[m]).map((m) => [m.toUpperCase(), p.replace("{userId}", "usr_x")] as const))
  expect(ops.length).toBeGreaterThanOrEqual(11)
  const login = async (u: { email: string; password: string }) => {
    const r = await call(w.app, "POST", "/api/auth/sign-in/email", { body: { email: u.email, password: u.password }, headers: { origin: testEnv.APP_URL } })
    return r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ")
  }
  const cookies = [tOwnerCookie, suspended.cookie!, await login(noTfaStranger)]
  for (const cookie of cookies) {
    for (const [method, path] of ops) {
      const r = await w.req(method, path, cookie, method === "GET" ? undefined : {})
      expect([method, path, r.status, await codeOf(r)], `${method} ${path}`).toEqual([method, path, 404, "not_found"])
      expect(r.headers.get("content-type")).toContain("application/problem+json")
    }
  }
})

test("email settings PUT seals the key, returns keyLast4 only, and writes platform.email_settings.updated in the same tx (no secret, no raw address in audit)", async () => {
  const w = await world()
  const r = await w.req("PUT", "/v1/platform/settings/email", w.owner.cookie, emailBody)
  expect(r.status).toBe(200)
  const text = await r.text()
  expect(JSON.parse(text)).toMatchObject({ configured: true, keyLast4: "1234", fromAddress: "no-reply@x.ie", updatedBy: w.owner.userId })
  expect(text).not.toContain(KEY)
  const [row] = await ownerQuery("select api_key_ciphertext from platform_email_settings")
  expect(String(row.api_key_ciphertext)).toMatch(/^v2:k1:/)
  const entries = await w.audit()
  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({ action: "platform.email_settings.updated", actor_id: w.owner.userId, entity: "platform_email_settings" })
  const dump = JSON.stringify(entries)
  expect(dump).not.toContain(KEY)
  expect(dump).not.toContain("no-reply@x.ie")
  expect(entries[0].after).toMatchObject({ configured: true, keyLast4: "1234", fromDomain: "x.ie" })
  const get = await (await w.req("GET", "/v1/platform/settings/email", w.owner.cookie)).text()
  expect(get).not.toContain(KEY)
  expect((await w.req("PUT", "/v1/platform/settings/email", w.owner.cookie, { ...emailBody, fromAddress: "nope" })).status).toBe(400)
  expect(await w.audit()).toHaveLength(1) // a refused change leaves no entry
  const sent = await w.req("POST", "/v1/platform/settings/email/test", w.owner.cookie, { to: "ops@x.ie" })
  expect(sent.status).toBe(200)
})

test("storage settings routes: secret never returned, last4 only, same-tx platform audit, owner only", async () => {
  const w = await world()
  const billing = await makeStaff(w.deps, "billing")
  expect((await w.req("PUT", "/v1/platform/settings/storage", billing.cookie, storageBody)).status).toBe(403)
  expect((await w.req("GET", "/v1/platform/settings/storage", billing.cookie)).status).toBe(403)
  const r = await w.req("PUT", "/v1/platform/settings/storage", w.owner.cookie, storageBody)
  expect(r.status).toBe(200)
  const text = await r.text()
  expect(JSON.parse(text)).toMatchObject({ configured: true, provider: "r2", accountId: ACCOUNT, secretLast4: "9876" })
  expect(text).not.toContain(SECRET)
  expect(await (await w.req("GET", "/v1/platform/settings/storage", w.owner.cookie)).text()).not.toContain(SECRET)
  const entries = await w.audit()
  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({ action: "platform.storage_settings.updated", actor_id: w.owner.userId })
  expect(JSON.stringify(entries)).not.toContain(SECRET)
  expect((await w.req("PUT", "/v1/platform/settings/storage", w.owner.cookie, { ...storageBody, bucket: "Bad Bucket!" })).status).toBe(400)
  const probe = await w.req("POST", "/v1/platform/settings/storage/test", w.owner.cookie)
  expect(probe.status).toBe(200)
})

test("the settings write and its audit entry are ONE transaction: a failing audit insert rolls the settings back", async () => {
  const w = await world()
  await ownerQuery(`create function zz_fail() returns trigger language plpgsql as $$ begin raise exception 'audit down'; end $$`)
  await ownerQuery(`create trigger zz_fail before insert on platform_audit_events for each row execute function zz_fail()`)
  try {
    expect((await w.req("PUT", "/v1/platform/settings/email", w.owner.cookie, emailBody)).status).toBe(500)
    expect((await w.req("PUT", "/v1/platform/settings/storage", w.owner.cookie, storageBody)).status).toBe(500)
  } finally {
    await ownerQuery("drop trigger zz_fail on platform_audit_events")
    await ownerQuery("drop function zz_fail()")
  }
  expect(await ownerQuery("select 1 from platform_email_settings")).toEqual([])
  expect(await ownerQuery("select 1 from platform_storage_settings")).toEqual([])
})

test("InMemoryAuditSink is no longer exported from platform-email", () => {
  expect(Object.keys(platformEmail)).not.toContain("InMemoryAuditSink")
})

test("platform audit chain verifies, serialises concurrent writers gap-free, and detects a tampered row", async () => {
  const db = testDb()
  expect(await verifyPlatformChain(db)).toEqual({ ok: true, head: null })
  const now = new Date("2026-11-17T10:00:00.000Z")
  await Promise.all(Array.from({ length: 8 }, (_, i) => db.transaction((tx) => recordPlatformAudit(tx, { action: "x.y", entity: "e", entityId: `${i}`, actorId: "a", before: null, after: { i } }, now))))
  const rows = await ownerQuery("select seq from platform_audit_events order by seq")
  expect(rows.map((r) => Number(r.seq))).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  const ok = await verifyPlatformChain(db)
  expect(ok).toMatchObject({ ok: true, head: { seq: 8 } })
  const [victim] = await ownerQuery("select id, after from platform_audit_events where seq = 4")
  await ownerQuery(`update platform_audit_events set after = '{"i":99}'::jsonb where seq = 4`)
  expect(await verifyPlatformChain(db)).toEqual({ ok: false, brokenAt: victim.id })
  await ownerQuery(`update platform_audit_events set after = $1::jsonb where seq = 4`, [JSON.stringify(victim.after)])
  expect((await verifyPlatformChain(db)).ok).toBe(true)
  await ownerQuery("delete from platform_audit_events where seq = 5")
  expect((await verifyPlatformChain(db)).ok).toBe(false) // seq gap
})

test("grants: app_user can only SELECT/INSERT platform_audit_events and never DELETE platform_staff", async () => {
  const w = await world()
  const denied = async (q: string) => {
    const err = await testDb().$client.query(q).then(() => null, (e) => e)
    expect(err?.code, q).toBe("42501")
  }
  await testDb().transaction((tx) => recordPlatformAudit(tx, { action: "a.b", entity: "e", entityId: "1", actorId: "x", before: null, after: null }, new Date()))
  await denied("update platform_audit_events set action = 'z'")
  await denied("delete from platform_audit_events")
  await denied("truncate platform_audit_events")
  await denied("delete from platform_staff")
  await denied("truncate platform_staff")
  expect((await testDb().$client.query("select 1 from platform_audit_events")).rowCount).toBeGreaterThan(0)
  expect((await testDb().$client.query(`update platform_staff set status = 'active' where user_id = '${w.owner.userId}'`)).rowCount).toBe(1)
})

test("last active platform owner cannot be demoted or suspended (409 last_platform_owner); a second owner frees it", async () => {
  const w = await world()
  const demote = await w.req("PATCH", `/v1/platform/staff/${w.owner.userId}`, w.owner.cookie, { role: "viewer" })
  expect([demote.status, await codeOf(demote)]).toEqual([409, "last_platform_owner"])
  const suspend = await w.req("PATCH", `/v1/platform/staff/${w.owner.userId}`, w.owner.cookie, { status: "suspended" })
  expect([suspend.status, await codeOf(suspend)]).toEqual([409, "last_platform_owner"])
  const second = await makeStaff(w.deps, "owner")
  expect((await w.req("PATCH", `/v1/platform/staff/${second.userId}`, w.owner.cookie, { status: "suspended" })).status).toBe(200)
  expect(await codeOf(await w.req("PATCH", `/v1/platform/staff/${w.owner.userId}`, w.owner.cookie, { role: "viewer" }))).toBe("last_platform_owner") // suspended owners do not count
  expect((await w.req("PATCH", `/v1/platform/staff/${second.userId}`, w.owner.cookie, { status: "active" })).status).toBe(200)
  expect((await w.req("PATCH", `/v1/platform/staff/${w.owner.userId}`, second.cookie, { role: "viewer" })).status).toBe(200)
  expect((await w.req("GET", "/v1/platform/staff", w.owner.cookie)).status).toBe(403) // demoted to viewer: still staff, no longer allowed
})

test("two owners suspending each other at the same time: exactly one wins (staff lock), the other gets last_platform_owner", async () => {
  const w = await world()
  const b = await makeStaff(w.deps, "owner")
  const now = new Date()
  const rs = await Promise.allSettled([
    updateStaff(testDb(), now, w.owner.userId, b.userId, { status: "suspended" }),
    updateStaff(testDb(), now, b.userId, w.owner.userId, { status: "suspended" }),
  ])
  expect(rs.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"])
  expect(rs.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "last_platform_owner", status: 409 } })
  expect(Number((await ownerQuery("select count(*) c from platform_staff where role = 'owner' and status = 'active'"))[0].c)).toBe(1)
})

test("staff add/list/patch: identities are user ids in the audit log, never emails; unknown/erased users 422; duplicates 409", async () => {
  const w = await world()
  const person = await makeUser(w.deps, { email: "priya.shah@x.ie" })
  const add = await w.req("POST", "/v1/platform/staff", w.owner.cookie, { email: "Priya.Shah@x.ie", role: "support" })
  expect([add.status, ((await add.json()) as Json).userId]).toEqual([201, person.userId])
  expect(await codeOf(await w.req("POST", "/v1/platform/staff", w.owner.cookie, { email: "priya.shah@x.ie", role: "billing" }))).toBe("already_staff")
  const ghost = await w.req("POST", "/v1/platform/staff", w.owner.cookie, { email: "ghost@x.ie", role: "viewer" })
  expect([ghost.status, await codeOf(ghost)]).toEqual([422, "user_not_found"])
  const erased = await makeUser(w.deps, { email: "gone@x.ie" })
  await ownerQuery("update \"user\" set erased_at = now() where id = $1", [erased.userId])
  expect((await w.req("POST", "/v1/platform/staff", w.owner.cookie, { email: "gone@x.ie", role: "viewer" })).status).toBe(422)
  expect((await w.req("PATCH", `/v1/platform/staff/${person.userId}`, w.owner.cookie, { role: "billing" })).status).toBe(200)
  expect((await w.req("PATCH", "/v1/platform/staff/usr_nope", w.owner.cookie, { role: "billing" })).status).toBe(404)
  expect((await w.req("PATCH", `/v1/platform/staff/${person.userId}`, w.owner.cookie, {})).status).toBe(400)
  const list = (await (await w.req("GET", "/v1/platform/staff", w.owner.cookie)).json()) as Json[]
  expect(list.map((s) => [s.userId, s.role, s.status])).toEqual(expect.arrayContaining([[w.owner.userId, "owner", "active"], [person.userId, "billing", "active"]]))
  const entries = await w.audit()
  expect(entries.map((e) => e.action)).toEqual(["platform.staff.added", "platform.staff.updated"])
  expect(entries[0]).toMatchObject({ entity: "platform_staff", entity_id: person.userId, before: null, after: { role: "support", status: "active" } })
  expect(entries[1]).toMatchObject({ before: { role: "support", status: "active" }, after: { role: "billing", status: "active" } })
  expect(JSON.stringify(entries)).not.toContain("@")
})

test("platform audit list and CSV export: owner and viewer read, support cannot; export is streamed with target_tenant_id and is itself audited", async () => {
  const w = await world()
  const viewer = await makeStaff(w.deps, "viewer")
  const support = await makeStaff(w.deps, "support")
  const tenant = await makeTenant(w.deps)
  await testDb().transaction((tx) => recordPlatformAudit(tx, { action: "tenant.looked_up", entity: "tenant", entityId: tenant.id, actorId: w.owner.userId, targetTenantId: tenant.id, before: null, after: { n: 1 } }, new Date("2026-11-17T09:00:00.000Z")))
  const list = await w.req("GET", "/v1/platform/audit", viewer.cookie)
  expect(list.status).toBe(200)
  const rows = (await list.json()) as Json[]
  expect(rows[0]).toMatchObject({ action: "tenant.looked_up", targetTenantId: tenant.id })
  expect(((await (await w.req("GET", `/v1/platform/audit?targetTenantId=${tenant.id}`, w.owner.cookie)).json()) as Json[]).length).toBe(1)
  expect((await w.req("GET", "/v1/platform/audit", support.cookie)).status).toBe(403)
  expect((await w.req("GET", "/v1/platform/audit/export?format=csv", support.cookie)).status).toBe(403)
  const exp = await w.req("GET", "/v1/platform/audit/export?format=csv", viewer.cookie)
  expect(exp.status).toBe(200)
  expect(exp.headers.get("content-type")).toContain("text/csv")
  const lines = (await exp.text()).trimEnd().split("\n")
  expect(lines[0]).toBe("at,actor,action,entity,entity_id,target_tenant_id,before,after")
  expect(lines.some((l) => l.includes("tenant.looked_up") && l.includes(tenant.id))).toBe(true)
  const exported = (await w.audit()).filter((e) => e.action === "platform.audit.exported")
  expect(exported).toHaveLength(1)
  expect(exported[0].actor_id).toBe(viewer.userId)
})

test("create-platform-owner: refuses unknown, unverified, no-2FA and erased users; creates once; idempotent; audit actor system:cli", async () => {
  const w = await world()
  await ownerQuery("truncate platform_staff, platform_audit_events cascade")
  const db = testDb()
  const now = new Date("2026-11-17T10:00:00.000Z")
  const refused = (email: string) => createPlatformOwner(db, now, email).then(() => "ok", (e) => (e instanceof BootstrapError ? e.code : "other"))
  expect(await refused("nobody@x.ie")).toBe("user_not_found")
  const unverified = await makeUser(w.deps, { email: "u@x.ie", totp: true, verified: false })
  expect(await refused(unverified.email)).toBe("email_not_verified")
  const noTfa = await makeUser(w.deps, { email: "n@x.ie" })
  expect(await refused(noTfa.email)).toBe("two_factor_required")
  const erased = await makeUser(w.deps, { email: "e@x.ie", totp: true })
  await ownerQuery("update \"user\" set erased_at = now() where id = $1", [erased.userId])
  expect(await refused(erased.email)).toBe("user_erased")
  expect(await ownerQuery("select 1 from platform_staff")).toEqual([])
  const good = await makeUser(w.deps, { email: "Boss@x.ie", totp: true })
  expect(await createPlatformOwner(db, now, "boss@X.ie")).toEqual({ userId: good.userId, outcome: "created" })
  expect(await createPlatformOwner(db, now, good.email)).toEqual({ userId: good.userId, outcome: "unchanged" })
  expect(await ownerQuery("select user_id, role, status, added_by from platform_staff")).toEqual([{ user_id: good.userId, role: "owner", status: "active", added_by: "system:cli" }])
  const audit = await ownerQuery("select actor_id, action, entity_id, after from platform_audit_events")
  expect(audit).toEqual([{ actor_id: "system:cli", action: "platform.staff.owner_bootstrapped", entity_id: good.userId, after: { role: "owner", status: "active" } }])
  expect(JSON.stringify(audit)).not.toContain("@")
  // a suspended owner is re-activated by the CLI (recovery), audited as a second entry
  await ownerQuery("update platform_staff set status = 'suspended'")
  expect((await createPlatformOwner(db, now, good.email)).outcome).toBe("promoted")
  expect(await ownerQuery("select 1 from platform_audit_events")).toHaveLength(2)
})

test("the CLI script runs end to end (npm -w api run platform:owner) and prints only safe codes", async () => {
  const w = await world()
  await ownerQuery("truncate platform_staff, platform_audit_events cascade")
  const good = await makeUser(w.deps, { email: "cli@x.ie", totp: true })
  const noTfa = await makeUser(w.deps, { email: "cli2@x.ie" })
  const run = (email: string) => {
    try {
      const out = execFileSync("npx", ["tsx", "scripts/create-platform-owner.ts", "--email", email], { cwd: new URL("../../..", import.meta.url).pathname, env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL! }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
      return { code: 0, out }
    } catch (e) {
      const err = e as { status: number; stderr: string }
      return { code: err.status, out: err.stderr }
    }
  }
  const bad = run(noTfa.email)
  expect(bad.code).toBe(1)
  expect(bad.out).toContain("refused: two_factor_required")
  expect(bad.out).not.toContain("cli2@x.ie")
  const first = run(good.email)
  expect(first.code).toBe(0)
  expect(first.out).toContain(`platform owner created: ${good.userId}`)
  expect(run(good.email).out).toContain("platform owner unchanged")
  expect(run("--x").code).toBe(2) // usage
}, 60_000)

test("GET /v1/platform/session: staff with a verified second factor gets 200 with the role and a single staff lookup (no tenant query)", async () => {
  const w = await world()
  for (const role of ["owner", "support", "billing", "viewer"] as const) {
    const s = role === "owner" ? w.owner : await makeStaff(w.deps, role)
    const read: string[] = []
    const orig = w.deps.db.select.bind(w.deps.db) as (...a: unknown[]) => any // eslint-disable-line @typescript-eslint/no-explicit-any
    const spy = vi.spyOn(w.deps.db, "select").mockImplementation(((...a: unknown[]) => {
      const q = orig(...a)
      const from = q.from.bind(q)
      q.from = (t: unknown) => (read.push(getTableName(t as never)), from(t))
      return q
    }) as never)
    const r = await w.req("GET", "/v1/platform/session", s.cookie)
    spy.mockRestore()
    expect([r.status, await r.json()]).toEqual([200, { staff: true, role, mfa: "ok" }])
    expect(read.filter((t) => t === "tenants" || t === "memberships" || t === "subscriptions")).toEqual([])
    expect(read.filter((t) => t === "platform_staff")).toHaveLength(1)
  }
})

test("GET /v1/platform/session: staff without a verified second factor gets 401 mfa_challenge, no factor 401 mfa_enrolment_required", async () => {
  const w = await world()
  const stale = await w.req("GET", "/v1/platform/session", w.owner.staleCookie)
  expect([stale.status, await codeOf(stale)]).toEqual([401, "mfa_challenge"])
  const noTfa = await makeStaff(w.deps, "viewer", { totp: false })
  const r = await call(w.app, "POST", "/api/auth/sign-in/email", { body: { email: noTfa.email, password: noTfa.password }, headers: { origin: testEnv.APP_URL } })
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ")
  const enrol = await w.req("GET", "/v1/platform/session", cookie)
  expect([enrol.status, await codeOf(enrol)]).toEqual([401, "mfa_enrolment_required"])
  expect((await w.req("GET", "/v1/platform/session")).status).toBe(401)
})

test("GET /v1/platform/session: non-staff gets 404 not_found", async () => {
  const w = await world()
  const tenant = await makeTenant(w.deps)
  const tOwner = await makeMember(w.deps, tenant.id, "owner", { totp: true })
  const cookie = (await signInWithTotp(w.app, tOwner.email, tOwner.password, tOwner.totpSecret!)).cookie
  const r = await w.req("GET", "/v1/platform/session", cookie)
  expect([r.status, await codeOf(r)]).toEqual([404, "not_found"])
})
