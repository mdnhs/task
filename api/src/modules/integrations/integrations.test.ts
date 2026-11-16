import { createHash } from "node:crypto"
import { beforeEach, afterEach, expect, test } from "vitest"
import { ownerTenantQuery } from "../../../test/db"
import { call, resetDb, testApp, testEnv } from "../../../test/harness"
import { makeMember, makeTenant, signIn } from "../../../test/factories"
import { s256 } from "../../core/oauth/fake-oauth"
import { buildKeyring, open } from "../../core/crypto/secret-box"
import { resetSubscribers } from "../../core/events"
import { runJob } from "../../core/queue/queue"
import { registerNotifications } from "../notifications"
import { getAccessToken, registerIntegrations, REFRESH_JOB } from "."

beforeEach(async () => {
  await resetDb()
  resetSubscribers()
  registerNotifications()
  registerIntegrations()
})
afterEach(resetSubscribers)

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const q = (tenant: string, sql: string, params: unknown[] = []) => ownerTenantQuery(tenant, sql, params)
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex")

async function world() {
  const t = testApp()
  const tenant = await makeTenant(t.deps, { slug: "acme" })
  const other = await makeTenant(t.deps, { slug: "other" })
  const owner = await makeMember(t.deps, tenant.id, "owner")
  const admin = await makeMember(t.deps, tenant.id, "admin") // settings: write
  const auditor = await makeMember(t.deps, tenant.id, "auditor") // settings: read
  const otherOwner = await makeMember(t.deps, other.id, "owner")
  const co = (await signIn(t.app, owner.email, owner.password)).cookie
  const cd = (await signIn(t.app, admin.email, admin.password)).cookie
  const ca = (await signIn(t.app, auditor.email, auditor.password)).cookie
  const cx = (await signIn(t.app, otherOwner.email, otherOwner.password)).cookie
  const req = (method: string, path: string, cookie = co, body?: unknown, slug = tenant.slug) => call(t.app, method, path, { cookie, tenant: slug, body })
  /** POST start; returns the state (the only copy of it outside Google's URL) and the PKCE challenge from the auth URL. */
  const start = async (cookie = co, slug = tenant.slug) => {
    const r = await req("POST", "/v1/integrations/google/start", cookie, undefined, slug)
    expect(r.status).toBe(200)
    const u = new URL(((await r.json()) as { url: string }).url)
    return { state: u.searchParams.get("state")!, challenge: u.searchParams.get("code_challenge")!, url: u }
  }
  const callback = (params: Record<string, string>, cookie = co) => call(t.app, "GET", `/v1/integrations/google/callback?${new URLSearchParams(params)}`, { cookie })
  /** Full happy path: start + callback with a fresh fake code. */
  const connect = async (cookie = co, email = "drive@example.com") => {
    const { state } = await start(cookie)
    const r = await callback({ code: t.oauth.codeFor(email), state }, cookie)
    expect(r.headers.get("location")).toBe(`${testEnv.APP_URL}/settings/integrations?status=connected`)
    const [row] = await q(tenant.id, "select id from integration_connections where tenant_id = $1", [tenant.id])
    return String(row.id)
  }
  return { ...t, tenant, other, owner, admin, auditor, co, cd, ca, cx, req, start, callback, connect }
}
type W = Awaited<ReturnType<typeof world>>
const connections = (w: W) => q(w.tenant.id, "select * from integration_connections")
const audits = (w: W, action: string) => q(w.tenant.id, "select actor_id, entity_id, before, after from audit_events where action = $1 order by seq", [action])

test("google start returns an auth URL with an S256 challenge and a single-use state stored only as a hash", async () => {
  const w = await world()
  const { state, challenge, url } = await w.start()
  expect(url.searchParams.get("code_challenge_method")).toBe("S256")
  expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/) // 32 random bytes, base64url
  expect(url.searchParams.get("redirect_uri")).toBe(`${testEnv.APP_URL}/v1/integrations/google/callback`)
  const rows = await q(w.tenant.id, "select * from oauth_states")
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ user_id: w.owner.userId, provider: "google", state_hash: sha256(state), used_at: null, redirect_uri: `${testEnv.APP_URL}/v1/integrations/google/callback` })
  expect(JSON.stringify(rows)).not.toContain(state) // never stored in the clear
  expect(new Date(rows[0].expires_at as string).getTime() - w.clock.now().getTime()).toBe(10 * 60_000)
  // the verifier is sealed (v2, AAD oauth_verifier:<tenant>:<user>) and matches the challenge
  const sealed = String(rows[0].verifier_ciphertext)
  expect(sealed.startsWith("v2:")).toBe(true)
  const verifier = open(sealed, buildKeyring(testEnv), `oauth_verifier:${w.tenant.id}:${w.owner.userId}`)
  expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(s256(verifier)).toBe(challenge)
  expect(() => open(sealed, buildKeyring(testEnv), `oauth_verifier:${w.tenant.id}:someone-else`)).toThrow()
  // a second start gives a different state
  expect((await w.start()).state).not.toBe(state)
})

test("start needs settings:write and a configured client", async () => {
  const w = await world()
  expect((await w.req("POST", "/v1/integrations/google/start", w.ca)).status).toBe(403)
  expect((await w.req("POST", "/v1/integrations/google/start", w.cd)).status).toBe(200)
  w.oauth.configured = false
  const r = await w.req("POST", "/v1/integrations/google/start")
  expect([r.status, ((await r.json()) as Json).code]).toEqual([503, "integration_not_configured"])
})

test("callback stores tokens sealed (v2, AAD integration:<tenant>:google), redirects, audits and publishes; tokens are never returned or audited", async () => {
  const w = await world()
  const id = await w.connect()
  const [row] = await connections(w)
  expect(row).toMatchObject({ provider: "google", status: "connected", account_email: "drive@example.com", connected_by: w.owner.userId })
  expect(row.scopes).toEqual(["https://www.googleapis.com/auth/drive.readonly", "openid", "email"])
  const sealed = String(row.token_ciphertext)
  expect(sealed.startsWith("v2:")).toBe(true)
  expect(sealed).not.toContain("at-1")
  const blob = JSON.parse(open(sealed, buildKeyring(testEnv), `integration:${w.tenant.id}:google`)) as Json
  expect(blob).toMatchObject({ accessToken: "at-1", refreshToken: "rt-1" })
  expect(() => open(sealed, buildKeyring(testEnv), `integration:${w.other.id}:google`)).toThrow() // bound to the tenant
  // never in API output, audit or events
  const list = await w.req("GET", "/v1/integrations")
  expect(list.status).toBe(200)
  const body = await list.text()
  for (const secret of ["at-1", "rt-1", "token", "v2:"]) expect(body).not.toContain(secret)
  expect(JSON.parse(body)).toEqual([{ id, provider: "google", status: "connected", scopes: row.scopes, accountEmail: "drive@example.com", connectedBy: w.owner.userId, connectedAt: w.clock.now().toISOString(), lastRefreshAt: null }])
  const a = await audits(w, "integration.connected")
  expect(a).toHaveLength(1)
  expect(JSON.stringify(a)).not.toMatch(/at-1|rt-1|v2:|ciphertext/)
  expect(a[0]).toMatchObject({ actor_id: w.owner.userId, entity_id: id, before: null })
  const ev = await q(w.tenant.id, "select type, payload from domain_events where type = 'integration.connected'")
  expect(ev).toHaveLength(1)
  expect(JSON.stringify(ev)).not.toMatch(/at-1|rt-1/)
  // the state is consumed
  expect((await q(w.tenant.id, "select used_at from oauth_states"))[0].used_at).not.toBeNull()
  // PKCE: the fake saw the right verifier for this challenge
  const ex = w.oauth.calls.find((c) => c.op === "exchange")!
  expect(ex.arg.startsWith("code-1|")).toBe(true)
})

test("callback with unknown, expired or reused state -> 400 invalid_oauth_state, no connection", async () => {
  const w = await world()
  const bad = async (state: string | undefined, cookie = w.co) => {
    const r = await w.callback({ code: w.oauth.codeFor(), ...(state ? { state } : {}) }, cookie)
    return [r.status, ((await r.json()) as Json).code]
  }
  expect(await bad("unknown-state")).toEqual([400, "invalid_oauth_state"])
  expect(await bad(undefined)).toEqual([400, "invalid_oauth_state"])
  const expired = (await w.start()).state
  w.clock.advance({ minutes: 10, hours: 0 })
  expect(await bad(expired)).toEqual([400, "invalid_oauth_state"])
  const fresh = (await w.start()).state
  const ok = await w.callback({ code: w.oauth.codeFor(), state: fresh })
  expect(ok.status).toBe(302)
  expect(await bad(fresh)).toEqual([400, "invalid_oauth_state"]) // reused
  expect(await connections(w)).toHaveLength(1) // only the one good callback
  expect((await w.callback({ code: "x", state: fresh }, "")).status).toBe(401) // no session
})

test("callback by a different user than the one who started -> 400 invalid_oauth_state, and the state stays usable by the starter", async () => {
  const w = await world()
  const { state } = await w.start(w.co)
  const r = await w.callback({ code: w.oauth.codeFor(), state }, w.cd) // another admin of the same tenant
  expect([r.status, ((await r.json()) as Json).code]).toEqual([400, "invalid_oauth_state"])
  const r2 = await w.callback({ code: w.oauth.codeFor(), state }, w.cx) // a user of another tenant
  expect(r2.status).toBe(400)
  expect(await connections(w)).toHaveLength(0)
  expect((await w.callback({ code: w.oauth.codeFor(), state }, w.co)).status).toBe(302)
})

test("provider-side outcomes redirect with a short error code only (never the code or tokens)", async () => {
  const w = await world()
  const loc = async (params: Record<string, string>) => (await w.callback(params)).headers.get("location")!
  // user denied consent at Google
  let { state } = await w.start()
  expect(await loc({ error: "access_denied", state })).toBe(`${testEnv.APP_URL}/settings/integrations?status=error&reason=access_denied`)
  // an unknown provider error string is not echoed
  ;({ state } = await w.start())
  expect(await loc({ error: "<script>alert(1)</script>", state })).toBe(`${testEnv.APP_URL}/settings/integrations?status=error&reason=provider_error`)
  // the code is rejected by Google
  ;({ state } = await w.start())
  const l = await loc({ code: "code-that-never-existed", state })
  expect(l).toBe(`${testEnv.APP_URL}/settings/integrations?status=error&reason=exchange_failed`)
  expect(l).not.toContain("never-existed")
  // consent without the Drive scope: nothing is stored, the grant is revoked at Google
  w.oauth.grantScopes = ["openid", "email"]
  ;({ state } = await w.start())
  expect(await loc({ code: w.oauth.codeFor(), state })).toBe(`${testEnv.APP_URL}/settings/integrations?status=error&reason=insufficient_scope`)
  expect(w.oauth.calls.some((c) => c.op === "revoke")).toBe(true)
  expect(await connections(w)).toHaveLength(0)
  expect((await q(w.tenant.id, "select count(*)::int as n from oauth_states where used_at is null"))[0].n).toBe(0) // all consumed
})

test("callback re-checks permission and MFA of the starter (demoted or MFA-less user cannot finish)", async () => {
  const w = await world()
  const { state } = await w.start(w.cd)
  await q(w.tenant.id, "update memberships set role_id = (select id from roles where key = 'auditor' and tenant_id = $1) where user_id = $2", [w.tenant.id, w.admin.userId])
  const r = await w.callback({ code: w.oauth.codeFor(), state }, w.cd)
  expect(r.status).toBe(403)
  expect(await connections(w)).toHaveLength(0)
  // forced MFA with no second factor enrolled
  const { state: s2 } = await w.start(w.co)
  await w.deps.db.execute(`update tenants set mfa_policy = '{"mode":"all","roles":[]}' where id = '${w.tenant.id}'` as never)
  const r2 = await w.callback({ code: w.oauth.codeFor(), state: s2 }, w.co)
  expect([r2.status, ((await r2.json()) as Json).code]).toEqual([401, "mfa_enrolment_required"])
  expect(await connections(w)).toHaveLength(0)
})

test("reconnect updates the single connection per tenant; a different admin can reconnect", async () => {
  const w = await world()
  const id = await w.connect(w.co, "one@example.com")
  const id2 = await w.connect(w.cd, "two@example.com")
  expect(id2).toBe(id)
  const [row] = await connections(w)
  expect(row).toMatchObject({ account_email: "two@example.com", connected_by: w.admin.userId, status: "connected" })
  const a = await audits(w, "integration.connected")
  expect(a).toHaveLength(2)
  expect(a[1].before).toMatchObject({ status: "connected", accountEmail: "one@example.com" })
})

test("getAccessToken returns the stored token, refreshes lazily below 5 minutes of life and keeps the refresh token", async () => {
  const w = await world()
  const id = await w.connect()
  expect(await getAccessToken(w.deps, w.tenant.id, id)).toBe("at-1")
  expect(w.oauth.calls.filter((c) => c.op === "refresh")).toHaveLength(0)
  w.clock.advance({ minutes: 54 }) // 6 min left
  expect(await getAccessToken(w.deps, w.tenant.id, id)).toBe("at-1")
  w.clock.advance({ minutes: 2 }) // 4 min left -> refresh
  expect(await getAccessToken(w.deps, w.tenant.id, id)).toBe("at-1-r1")
  expect(w.oauth.calls.filter((c) => c.op === "refresh").map((c) => c.arg)).toEqual(["rt-1"])
  const [row] = await connections(w)
  expect(row.status).toBe("connected")
  expect(new Date(row.last_refresh_at as string).getTime()).toBe(w.clock.now().getTime())
  const blob = JSON.parse(open(String(row.token_ciphertext), buildKeyring(testEnv), `integration:${w.tenant.id}:google`)) as Json
  expect(blob).toMatchObject({ accessToken: "at-1-r1", refreshToken: "rt-1" })
  expect(await getAccessToken(w.deps, w.tenant.id, id)).toBe("at-1-r1") // fresh now: no second refresh
  expect(w.oauth.calls.filter((c) => c.op === "refresh")).toHaveLength(1)
})

test("refresh failure marks the connection error and notifies the connecting admin (security); later calls fail without hitting Google", async () => {
  const w = await world()
  const id = await w.connect(w.cd) // connected by the admin
  w.clock.advance({ minutes: 58 })
  w.oauth.failRefresh = "invalid_grant"
  await expect(getAccessToken(w.deps, w.tenant.id, id)).rejects.toMatchObject({ status: 409, code: "integration_unavailable" })
  const [row] = await connections(w)
  expect(row.status).toBe("error")
  expect(row.token_ciphertext).not.toBeNull()
  const n = await q(w.tenant.id, "select user_id, kind, title, body, link from notifications")
  expect(n).toHaveLength(1)
  expect(n[0]).toMatchObject({ user_id: w.admin.userId, kind: "security", link: "/settings/integrations" })
  expect(JSON.stringify(n)).not.toMatch(/rt-1|at-1/)
  expect((await audits(w, "integration.refresh_failed"))).toHaveLength(1)
  w.oauth.failRefresh = null
  await expect(getAccessToken(w.deps, w.tenant.id, id)).rejects.toMatchObject({ code: "integration_unavailable" })
  expect(w.oauth.calls.filter((c) => c.op === "refresh")).toHaveLength(1)
  expect((await (await w.req("GET", "/v1/integrations")).json() as Json[])[0].status).toBe("error")
})

test("integration.refresh job refreshes an expiring connection; bad job data is rejected; a revoked connection is a no-op", async () => {
  const w = await world()
  const id = await w.connect()
  w.clock.advance({ minutes: 58 })
  await runJob(REFRESH_JOB, { tenantId: w.tenant.id, integrationId: id }, w.deps)
  expect(w.oauth.calls.filter((c) => c.op === "refresh")).toHaveLength(1)
  await expect(runJob(REFRESH_JOB, { tenantId: "nope", integrationId: id }, w.deps)).rejects.toThrow()
  await w.req("DELETE", `/v1/integrations/${id}`)
  w.clock.advance({ hours: 2 })
  await runJob(REFRESH_JOB, { tenantId: w.tenant.id, integrationId: id }, w.deps)
  expect(w.oauth.calls.filter((c) => c.op === "refresh")).toHaveLength(1)
})

test("DELETE revokes at Google (best effort), marks revoked, clears the ciphertext, audits and publishes", async () => {
  const w = await world()
  const id = await w.connect()
  expect((await w.req("DELETE", `/v1/integrations/${id}`, w.ca)).status).toBe(403)
  w.oauth.failRevoke = true // Google unreachable: the disconnect still succeeds locally
  const r = await w.req("DELETE", `/v1/integrations/${id}`)
  expect(r.status).toBe(204)
  const [row] = await connections(w)
  expect(row).toMatchObject({ status: "revoked", token_ciphertext: null })
  expect(w.oauth.calls.filter((c) => c.op === "revoke").map((c) => c.arg)).toEqual(["rt-1"])
  const a = await audits(w, "integration.disconnected")
  expect(a).toHaveLength(1)
  expect(a[0]).toMatchObject({ actor_id: w.owner.userId, entity_id: id })
  expect(JSON.stringify(a)).not.toMatch(/rt-1|at-1/)
  expect(await q(w.tenant.id, "select 1 from domain_events where type = 'integration.disconnected'")).toHaveLength(1)
  expect((await w.req("DELETE", `/v1/integrations/${id}`)).status).toBe(204) // idempotent, no second revoke
  expect(w.oauth.calls.filter((c) => c.op === "revoke")).toHaveLength(1)
  await expect(getAccessToken(w.deps, w.tenant.id, id)).rejects.toMatchObject({ code: "integration_unavailable" })
  // and it can be connected again
  expect(await w.connect()).toBe(id)
  expect((await connections(w))[0].status).toBe("connected")
})

test("integration id from another tenant -> 404 integration_not_found", async () => {
  const w = await world()
  const id = await w.connect()
  const r = await w.req("DELETE", `/v1/integrations/${id}`, w.cx, undefined, "other")
  expect([r.status, ((await r.json()) as Json).code]).toEqual([404, "integration_not_found"])
  expect((await connections(w))[0].status).toBe("connected")
  const g = await w.req("DELETE", `/v1/integrations/${crypto.randomUUID()}`)
  expect([g.status, ((await g.json()) as Json).code]).toEqual([404, "integration_not_found"])
  await expect(getAccessToken(w.deps, w.other.id, id)).rejects.toMatchObject({ status: 404, code: "integration_not_found" })
  expect(await (await w.req("GET", "/v1/integrations", w.cx, undefined, "other")).json()).toEqual([])
})
