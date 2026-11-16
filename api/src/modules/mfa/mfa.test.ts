import { beforeEach, expect, test } from "vitest"
import { ownerQuery, ownerTenantQuery } from "../../../test/db"
import { enrollTotp, makeMember, makeTenant, signIn, signInWithTotp, totpCode } from "../../../test/factories"
import { call, resetDb, tenantGetRoutes, testApp, testEnv } from "../../../test/harness"
import type { MfaPolicy } from "@opsdesk/domain/mfa"

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const ORIGIN = { origin: testEnv.APP_URL }
beforeEach(resetDb)

async function world(policy: MfaPolicy = { mode: "off", roles: [] }) {
  const t = testApp()
  const tenant = await makeTenant(t.deps, { slug: "acme", mfaPolicy: policy })
  const who = async (key: string, o: { totp?: boolean } = {}) => {
    const m = await makeMember(t.deps, tenant.id, key, o)
    return m
  }
  const setPolicy = (p: MfaPolicy) => ownerQuery("update tenants set mfa_policy = $1::jsonb where id = $2", [JSON.stringify(p), tenant.id])
  const req = (method: string, path: string, cookie: string | undefined, body?: unknown) =>
    call(t.app, method, path, { cookie, tenant: "acme", body })
  const mfaPassed = async (cookie: string) => {
    const me = await call(t.app, "GET", "/v1/me/mfa", { cookie })
    return ((await me.json()) as Json).passed as boolean
  }
  return { ...t, tenant, who, setPolicy, req, mfaPassed }
}
const codeOf = async (r: Response) => ((await r.clone().json()) as Json).code

test("policy all: a member without TOTP gets 401 mfa_enrolment_required on every tenant route", async () => {
  const w = await world({ mode: "all", roles: [] })
  const m = await w.who("employee")
  const { cookie } = await signIn(w.app, m.email, m.password)
  const paths = tenantGetRoutes(w.app)
  expect(paths).toContain("/v1/roles")
  for (const path of paths) {
    const r = await w.req("GET", path, cookie)
    expect([path, r.status, await codeOf(r)]).toEqual([path, 401, "mfa_enrolment_required"])
  }
})
test("policy roles: only listed roles are gated; policy off gates nobody", async () => {
  const w = await world({ mode: "roles", roles: ["manager"] })
  const emp = await w.who("employee")
  const mgr = await w.who("manager")
  const e = (await signIn(w.app, emp.email, emp.password)).cookie
  const g = (await signIn(w.app, mgr.email, mgr.password)).cookie
  expect((await w.req("GET", "/v1/roles", e)).status).not.toBe(401) // employee: 403 (no settings), not an MFA gate
  const r = await w.req("GET", "/v1/roles", g)
  expect([r.status, await codeOf(r)]).toEqual([401, "mfa_enrolment_required"])
  await w.setPolicy({ mode: "off", roles: [] })
  expect((await w.req("GET", "/v1/roles", g)).status).toBe(200)
})
test("enrolled but not verified this session is 401 mfa_challenge; after verify-totp it is 200", async () => {
  const w = await world()
  const m = await w.who("manager")
  const stale = (await signIn(w.app, m.email, m.password)).cookie // session created before 2FA existed
  const { secret } = await enrollTotp(w.deps, m.email, m.password) // "another device" enrols
  await w.setPolicy({ mode: "all", roles: [] })
  expect(await w.mfaPassed(stale)).toBe(false)
  const r = await w.req("GET", "/v1/roles", stale)
  expect([r.status, await codeOf(r)]).toEqual([401, "mfa_challenge"])
  const v = await call(w.app, "POST", "/api/auth/two-factor/verify-totp", { cookie: stale, body: { code: await totpCode(secret) }, headers: ORIGIN })
  expect(v.status).toBe(200)
  expect(await w.mfaPassed(stale)).toBe(true)
  expect((await w.req("GET", "/v1/roles", stale)).status).toBe(200)
})
test("a wrong code leaves the session challenged", async () => {
  const w = await world({ mode: "all", roles: [] })
  const m = await w.who("manager")
  const stale = (await signIn(w.app, m.email, m.password)).cookie
  await enrollTotp(w.deps, m.email, m.password)
  const v = await call(w.app, "POST", "/api/auth/two-factor/verify-totp", { cookie: stale, body: { code: "000000" }, headers: ORIGIN })
  expect(v.status).toBe(401)
  expect(await w.mfaPassed(stale)).toBe(false)
  expect(await codeOf(await w.req("GET", "/v1/roles", stale))).toBe("mfa_challenge")
})
test("sign-in with password alone creates no session for a 2FA user; password + TOTP does, with mfa_passed true", async () => {
  const w = await world({ mode: "all", roles: [] })
  const m = await w.who("manager", { totp: true })
  const first = await call(w.app, "POST", "/api/auth/sign-in/email", { body: { email: m.email, password: m.password }, headers: ORIGIN })
  expect(((await first.json()) as Json).twoFactorRedirect).toBe(true)
  expect(first.headers.getSetCookie().some((c) => c.includes("session_token=") && !c.includes("session_token=;"))).toBe(false)
  const { cookie } = await signInWithTotp(w.app, m.email, m.password, m.totpSecret!)
  expect(await w.mfaPassed(cookie)).toBe(true)
  expect((await w.req("GET", "/v1/roles", cookie)).status).toBe(200)
})
test("sessions that never passed a second factor stay false (a plain sign-in before enrolment)", async () => {
  const w = await world()
  const m = await w.who("manager")
  const a = (await signIn(w.app, m.email, m.password)).cookie
  expect(await w.mfaPassed(a)).toBe(false)
})
test("backup code verification also marks the session", async () => {
  const w = await world({ mode: "all", roles: [] })
  const m = await w.who("manager")
  const stale = (await signIn(w.app, m.email, m.password)).cookie
  const e = await enrollTotp(w.deps, m.email, m.password)
  const v = await call(w.app, "POST", "/api/auth/two-factor/verify-backup-code", { cookie: stale, body: { code: e.backupCodes[0] }, headers: ORIGIN })
  expect(v.status).toBe(200)
  expect(await w.mfaPassed(stale)).toBe(true)
})
test("disabling 2FA does not flip other sessions to passed", async () => {
  const w = await world()
  const m = await w.who("manager")
  const stale = (await signIn(w.app, m.email, m.password)).cookie
  const e = await enrollTotp(w.deps, m.email, m.password)
  const d = await call(w.app, "POST", "/api/auth/two-factor/disable", { cookie: e.cookie, body: { password: m.password }, headers: ORIGIN })
  expect(d.status).toBe(200)
  expect(await w.mfaPassed(stale)).toBe(false)
})
test("totp accepts one previous step, rejects two", async () => {
  const w = await world()
  const m = await w.who("manager")
  const stale = (await signIn(w.app, m.email, m.password)).cookie
  const { secret } = await enrollTotp(w.deps, m.email, m.password)
  const verify = (code: string) => call(w.app, "POST", "/api/auth/two-factor/verify-totp", { cookie: stale, body: { code }, headers: ORIGIN })
  expect((await verify(await totpCode(secret, 61_000))).status).toBe(401) // two+ steps old
  expect(await w.mfaPassed(stale)).toBe(false)
  expect((await verify(await totpCode(secret, 30_000))).status).toBe(200) // one step old
  expect(await w.mfaPassed(stale)).toBe(true)
})
test("/v1/me/mfa is reachable without TOTP under policy all (allow-list) and reports state", async () => {
  const w = await world({ mode: "all", roles: [] })
  const m = await w.who("employee")
  const { cookie } = await signIn(w.app, m.email, m.password)
  const r = await call(w.app, "GET", "/v1/me/mfa", { cookie })
  expect(r.status).toBe(200)
  expect(await r.json()).toEqual({ enrolled: false, passed: false })
  expect((await call(w.app, "GET", "/v1/me", { cookie })).status).toBe(200)
})

test("PUT /v1/settings/mfa-policy: invalid role id or mode is 422", async () => {
  const w = await world()
  const o = await w.who("owner")
  const { cookie } = await signIn(w.app, o.email, o.password)
  for (const body of [{ mode: "roles", roles: ["nope"] }, { mode: "sometimes", roles: [] }, { mode: "roles", roles: ["platform"] }]) {
    const r = await w.req("PUT", "/v1/settings/mfa-policy", cookie, body)
    expect([r.status, await codeOf(r)]).toEqual([422, "invalid_mfa_policy"])
  }
  expect((await ownerQuery("select mfa_policy from tenants"))[0].mfa_policy).toEqual({ mode: "off", roles: [] })
})
test("PUT /v1/settings/mfa-policy needs settings write", async () => {
  const w = await world()
  const m = await w.who("manager") // settings: read
  const { cookie } = await signIn(w.app, m.email, m.password)
  const r = await w.req("PUT", "/v1/settings/mfa-policy", cookie, { mode: "all", roles: [] })
  expect(r.status).toBe(403)
  expect((await w.req("GET", "/v1/settings/mfa-policy", cookie)).status).toBe(200)
})
test("policy change is audited with old and new value, and normalised", async () => {
  const w = await world()
  const o = await w.who("owner")
  const { cookie } = await signIn(w.app, o.email, o.password)
  const r = await w.req("PUT", "/v1/settings/mfa-policy", cookie, { mode: "roles", roles: ["manager", "manager", "admin"] })
  expect(r.status).toBe(200)
  expect(await r.json()).toEqual({ mode: "roles", roles: ["manager", "admin"] })
  expect(((await (await w.req("GET", "/v1/settings/mfa-policy", cookie)).json()) as Json).mode).toBe("roles")
  const [a] = await ownerTenantQuery(w.tenant.id, "select * from audit_events order by seq desc limit 1")
  expect(a).toMatchObject({ action: "settings.mfa_policy.updated", actor_id: o.userId, entity: "tenant" })
  expect(a.before).toEqual({ mode: "off", roles: [] })
  expect(a.after).toEqual({ mode: "roles", roles: ["manager", "admin"] })
})

// R27: an un-MFA'd session of a 2FA user must not be able to reconfigure/escape 2FA with just the password.
async function stale2fa() {
  const w = await world()
  const m = await w.who("manager")
  const stale = (await signIn(w.app, m.email, m.password)).cookie
  const e = await enrollTotp(w.deps, m.email, m.password)
  const post = (path: string, body: unknown = { password: m.password }) =>
    call(w.app, "POST", `/api/auth/${path}`, { cookie: stale, body, headers: ORIGIN })
  return { w, m, stale, e, post }
}
test("R27: password-only calls from an unpassed session of a 2FA user are 403 mfa_required", async () => {
  const { m, post } = await stale2fa()
  const codesBefore = await ownerQuery('select backup_codes from two_factor')
  for (const [path, body] of [
    ["two-factor/generate-backup-codes", { password: m.password }],
    ["two-factor/disable", { password: m.password }],
    ["two-factor/enable", { password: m.password }],
    ["change-password", { currentPassword: m.password, newPassword: "An0ther-long-pw!" }],
  ] as const) {
    const r = await post(path, body)
    expect([path, r.status, await codeOf(r)]).toEqual([path, 403, "mfa_required"])
  }
  expect(await ownerQuery('select backup_codes from two_factor')).toEqual(codesBefore)
  expect(await ownerQuery('select two_factor_enabled from "user"')).toEqual([{ two_factor_enabled: true }])
  const [{ n }] = await ownerQuery("select count(*)::int as n from session where mfa_passed = false")
  expect(n).toBe(1)
})
test("R27: allowed paths still work on an unpassed session, and the same calls succeed after verify-totp", async () => {
  const { w, m, stale, e, post } = await stale2fa()
  expect((await call(w.app, "GET", "/api/auth/get-session", { cookie: stale })).status).toBe(200)
  const bad = await post("two-factor/verify-totp", { code: "000000" })
  expect(bad.status).toBe(401) // verify-totp is reachable (a wrong code is Better Auth's 401, not mfa_required)
  expect(await codeOf(bad)).not.toBe("mfa_required")
  expect((await post("two-factor/verify-totp", { code: await totpCode(e.secret) })).status).toBe(200)
  expect((await post("two-factor/generate-backup-codes", { password: m.password })).status).toBe(200)
})
test("R27: /revoke-session is 403 mfa_required from an unpassed session; the target survives, and it works after verify-totp", async () => {
  const w = await world()
  const m = await w.who("manager")
  const stale = (await signIn(w.app, m.email, m.password)).cookie
  await signIn(w.app, m.email, m.password) // a second session: the revoke target
  const e = await enrollTotp(w.deps, m.email, m.password)
  const [{ token }] = await ownerQuery("select token from session order by created_at desc limit 1")
  const post = (path: string, body: unknown) => call(w.app, "POST", `/api/auth/${path}`, { cookie: stale, body, headers: ORIGIN })
  const r = await post("revoke-session", { token })
  expect([r.status, await codeOf(r)]).toEqual([403, "mfa_required"])
  expect(r.headers.get("content-type")).toContain("application/problem+json")
  expect(await ownerQuery("select 1 from session where token = $1", [token])).toHaveLength(1)
  expect((await post("two-factor/verify-totp", { code: await totpCode(e.secret) })).status).toBe(200)
  expect((await post("revoke-session", { token })).status).toBe(200)
  expect(await ownerQuery("select 1 from session where token = $1", [token])).toHaveLength(0)
})
test("R27: a user without 2FA can still enrol via /two-factor/enable", async () => {
  const w = await world()
  const m = await w.who("manager")
  const { cookie } = await signIn(w.app, m.email, m.password)
  const r = await call(w.app, "POST", "/api/auth/two-factor/enable", { cookie, body: { password: m.password }, headers: ORIGIN })
  expect(r.status).toBe(200)
  expect(((await r.json()) as Json).totpURI).toContain("otpauth://")
})
