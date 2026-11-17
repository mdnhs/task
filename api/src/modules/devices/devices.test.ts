import { beforeEach, describe, expect, test } from "vitest"
import { call, resetDb, testApp, testEnv } from "../../../test/harness"
import { ownerQuery, ownerTenantQuery } from "../../../test/db"
import { makeMember, makeTenant, signIn } from "../../../test/factories"

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
beforeEach(resetDb)

const DRIVE_URL = "https://drive.google.com/file/d/probe/view"

async function world() {
  const t = testApp()
  const tenant = await makeTenant(t.deps, { slug: "acme" })
  const who = async (key: string, tenantId = tenant.id, slug = tenant.slug) => {
    const m = await makeMember(t.deps, tenantId, key)
    return { ...m, slug, cookie: (await signIn(t.app, m.email, m.password)).cookie }
  }
  const admin = await who("owner")
  const staff = await who("employee")
  const staff2 = await who("employee")
  type P = { cookie: string; slug: string }
  const req = (method: string, path: string, as: P | null, body?: unknown, headers?: Record<string, string>) =>
    call(t.app, method, path, { cookie: as?.cookie, tenant: as?.slug ?? "acme", body, headers })
  const register = async (userId: string, over: Json = {}, as: P = admin) => {
    const r = await req("POST", "/v1/devices", as, { userId, type: "pc", owner: "company", label: "Front desk PC", trusted: true, ...over })
    expect(r.status).toBe(201)
    return (await r.json()) as Json
  }
  const CK = "od-device-" // per-tenant name od-device-<8 of tenant id>; http (test) APP_URL means no __Host- prefix
  const deviceCookieOf = (r: Response) => r.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith(CK))
  /** Admin issues a one-time enrolment code (also resets any binding). */
  const enrol = async (id: string, as: P = admin) => {
    const r = await req("POST", `/v1/devices/${id}/enrolment-code`, as)
    expect(r.status).toBe(201)
    return ((await r.json()) as Json).code as string
  }
  /** Full enrolment: admin issues a code, the allocated user binds; returns the Cookie fragment that browser now sends. */
  const bind = async (id: string, as: P, by: P = admin) => {
    const r = await req("POST", `/v1/devices/${id}/bind`, as, { code: await enrol(id, by) })
    expect(r.status).toBe(200)
    return deviceCookieOf(r)!
  }
  const putPolicy = (feature: string, allow: string, as: P = admin) => req("PUT", `/v1/device-policies/${feature}`, as, { allow })
  const probe = async (as: P, deviceCookie?: string) => {
    const r = await call(t.app, "GET", "/v1/_probe/drive-links", { cookie: deviceCookie ? `${as.cookie}; ${deviceCookie}` : as.cookie, tenant: as.slug })
    expect(r.status).toBe(200)
    return (await r.json()) as Json
  }
  const lastAudit = async () => (await ownerTenantQuery(tenant.id, "select * from audit_events order by seq desc limit 1"))[0] as Json
  return { ...t, tenant, who, admin, staff, staff2, req, register, bind, enrol, deviceCookieOf, putPolicy, probe, lastAudit }
}

describe("devices", () => {
  test("register a device with type, owner, allocated user and trusted flag", async () => { // FR-M0-08
    const w = await world()
    const d = await w.register(w.staff.userId)
    expect(d).toMatchObject({ userId: w.staff.userId, type: "pc", owner: "company", label: "Front desk PC", trusted: true, lastSeen: null })
    const list = (await (await w.req("GET", "/v1/devices", w.admin)).json()) as Json[]
    expect(list.map((x) => x.id)).toEqual([d.id])
    expect((await w.lastAudit()).action).toBe("device.registered")
    // user must be a member of this tenant; plain members cannot register
    expect((await w.req("POST", "/v1/devices", w.admin, { userId: "nobody", type: "pc", owner: "company", label: "Ghost PC" })).status).toBe(422)
    expect((await w.req("POST", "/v1/devices", w.staff, { userId: w.staff.userId, type: "pc", owner: "company", label: "My PC", trusted: true })).status).toBe(403)
  })

  test("a member lists only their own devices, an admin lists all", async () => {
    const w = await world()
    const mine = await w.register(w.staff.userId)
    await w.register(w.staff2.userId, { label: "Other PC" })
    const own = (await (await w.req("GET", "/v1/devices", w.staff)).json()) as Json[]
    expect(own.map((x) => x.id)).toEqual([mine.id])
    expect(((await (await w.req("GET", "/v1/devices", w.admin)).json()) as Json[]).length).toBe(2)
  })

  test("policy drive=trusted-company-pc: trusted PC sees links, android and unregistered do not", async () => { // AC-M0-03
    const w = await world()
    const pc = await w.register(w.staff.userId)
    const android = await w.register(w.staff.userId, { type: "android", owner: "personal", label: "Phone", trusted: false })
    const pcCookie = await w.bind(pc.id, w.staff)
    const androidCookie = await w.bind(android.id, w.staff)
    expect((await w.putPolicy("drive", "trusted-company-pc")).status).toBe(200)
    expect(await w.probe(w.staff, pcCookie)).toEqual({ links: [DRIVE_URL] })
    expect(await w.probe(w.staff, androidCookie)).toEqual({ links: [], withheld: 1 })
    expect(await w.probe(w.staff)).toEqual({ links: [], withheld: 1 })
  })

  test("a request from a bound device records last_seen", async () => {
    const w = await world()
    const pc = await w.register(w.staff.userId)
    await w.probe(w.staff, await w.bind(pc.id, w.staff))
    const list = (await (await w.req("GET", "/v1/devices", w.admin)).json()) as Json[]
    expect(list[0].lastSeen).toEqual(expect.any(String))
  })

  test("no policy row means any device may use drive (default, tenants opt in)", async () => {
    const w = await world()
    expect(await w.probe(w.staff)).toEqual({ links: [DRIVE_URL] })
    const list = (await (await w.req("GET", "/v1/device-policies", w.staff)).json()) as Json[]
    expect(list).toEqual(expect.arrayContaining([{ feature: "drive", allow: "any" }, { feature: "payroll", allow: "any" }]))
  })

  test("trust revoked mid-session withholds drive on next request", async () => { // Review Focus #3
    const w = await world()
    const pc = await w.register(w.staff.userId)
    const cookie = await w.bind(pc.id, w.staff)
    await w.putPolicy("drive", "trusted-company-pc")
    expect((await w.probe(w.staff, cookie)).links).toHaveLength(1)
    const r = await w.req("PATCH", `/v1/devices/${pc.id}`, w.admin, { trusted: false })
    expect(r.status).toBe(200)
    expect((await w.probe(w.staff, cookie)).links).toHaveLength(0)
    await w.req("PATCH", `/v1/devices/${pc.id}`, w.admin, { trusted: true })
    expect((await w.probe(w.staff, cookie)).links).toHaveLength(1)
    // a policy change also takes effect on the very next request
    await w.putPolicy("drive", "none")
    expect((await w.probe(w.staff, cookie)).links).toHaveLength(0)
  })

  test("a device cookie belonging to another user resolves to unregistered", async () => {
    const w = await world()
    const pc = await w.register(w.staff.userId)
    const cookie = await w.bind(pc.id, w.staff)
    await w.putPolicy("drive", "trusted-company-pc")
    expect((await w.probe(w.staff2, cookie)).links).toHaveLength(0)
    expect((await w.probe(w.admin, cookie)).links).toHaveLength(0)
  })

  test("tampered device cookie signature resolves to unregistered", async () => {
    const w = await world()
    const pc = await w.register(w.staff.userId)
    const cookie = await w.bind(pc.id, w.staff)
    await w.putPolicy("drive", "trusted-company-pc")
    expect((await w.probe(w.staff, cookie)).links).toHaveLength(1)
    const [name, value] = [cookie.slice(0, cookie.indexOf("=")), cookie.slice(cookie.indexOf("=") + 1)]
    expect((await w.probe(w.staff, `${name}=${value.slice(0, -4)}AAAA`)).links).toHaveLength(0) // bad signature
    expect((await w.probe(w.staff, `${name}=${pc.id}`)).links).toHaveLength(0) // unsigned id
    expect((await w.probe(w.staff, `${name}=${pc.id}.${"A".repeat(43)}`)).links).toHaveLength(0) // unsigned, guessed secret
    expect((await w.probe(w.staff, `${name}=${pc.id}.${"A".repeat(43)}=`)).links).toHaveLength(0) // forged signature
  })

  test("bind without a code is 422 and sets no cookie", async () => {
    const w = await world()
    const pc = await w.register(w.staff.userId)
    for (const body of [undefined, {}, { code: "" }, { code: "WRONGCODE1" }]) {
      const r = await w.req("POST", `/v1/devices/${pc.id}/bind`, w.staff, body)
      expect(r.status).toBe(422)
      expect(((await r.json()) as Json).code).toBe("invalid_enrolment_code")
      expect(w.deviceCookieOf(r)).toBeUndefined()
    }
  })

  test("valid code from the allocated user binds: 200, HttpOnly signed per-tenant cookie, audited without secrets", async () => {
    const w = await world()
    const pc = await w.register(w.staff.userId)
    const code = await w.enrol(pc.id)
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{10}$/)
    const r = await w.req("POST", `/v1/devices/${pc.id}/bind`, w.staff, { code }, { "user-agent": "Mozilla/5.0 TestPC" })
    expect(r.status).toBe(200)
    const sc = r.headers.getSetCookie().find((c) => c.startsWith("od-device-"))!
    expect(sc.startsWith(`od-device-${w.tenant.id.slice(0, 8)}=`)).toBe(true)
    expect(sc).toMatch(/HttpOnly/i)
    expect(sc).toMatch(/SameSite=Lax/i)
    expect(sc).toMatch(/Path=\//)
    expect(sc).not.toMatch(/Domain=/i)
    const audit = await w.lastAudit()
    expect(audit.action).toBe("device.bound")
    expect(JSON.stringify(audit)).not.toContain(code)
    expect(JSON.stringify(audit)).not.toContain("TestPC")
    expect(audit.after.userAgentHash).toMatch(/^[0-9a-f]{64}$/)
    const all = JSON.stringify(await ownerTenantQuery(w.tenant.id, "select * from audit_events"))
    expect(all).not.toContain(code)
    // the code is stored only as a hash and is single use
    const [row] = await ownerTenantQuery(w.tenant.id, "select * from devices")
    expect(JSON.stringify(row)).not.toContain(code)
    expect((await w.req("POST", `/v1/devices/${pc.id}/bind`, w.staff, { code })).status).toBe(409)
  })

  test("second bind (e.g. from an Android) without a fresh code is 409 and sets no cookie", async () => {
    const w = await world()
    const pc = await w.register(w.staff.userId)
    await w.putPolicy("drive", "trusted-company-pc")
    const good = await w.bind(pc.id, w.staff)
    for (const code of ["", "ANYTHING12"]) {
      const r = await w.req("POST", `/v1/devices/${pc.id}/bind`, w.staff, { code })
      expect(r.status).toBe(409)
      expect(((await r.json()) as Json).code).toBe("device_already_bound")
      expect(w.deviceCookieOf(r)).toBeUndefined()
    }
    expect((await w.probe(w.staff, good)).links).toHaveLength(1)
    expect((await w.probe(w.staff)).links).toHaveLength(0) // the "android" has no cookie
  })

  test("a new enrolment code resets the binding: the old cookie is unregistered at once", async () => {
    const w = await world()
    const pc = await w.register(w.staff.userId)
    await w.putPolicy("drive", "trusted-company-pc")
    const old = await w.bind(pc.id, w.staff)
    expect((await w.probe(w.staff, old)).links).toHaveLength(1)
    await w.enrol(pc.id)
    expect((await w.probe(w.staff, old)).links).toHaveLength(0)
    expect((await w.lastAudit()).action).toBe("device.enrolment_issued")
    // re-enrolling issues a different cookie; the old one stays dead
    const fresh = await w.bind(pc.id, w.staff)
    expect(fresh).not.toBe(old)
    expect((await w.probe(w.staff, fresh)).links).toHaveLength(1)
    expect((await w.probe(w.staff, old)).links).toHaveLength(0)
  })

  test("an expired code (16 minutes) is 422; 14 minutes still works", async () => {
    const w = await world()
    const pc = await w.register(w.staff.userId)
    const code = await w.enrol(pc.id)
    w.clock.advance({ minutes: 16 })
    expect((await w.req("POST", `/v1/devices/${pc.id}/bind`, w.staff, { code })).status).toBe(422)
  })

  test("5 wrong codes invalidate the code, even the right one then", async () => {
    const w = await world()
    const pc = await w.register(w.staff.userId)
    const code = await w.enrol(pc.id)
    for (let i = 0; i < 5; i++) expect((await w.req("POST", `/v1/devices/${pc.id}/bind`, w.staff, { code: "WRONGCODE1" })).status).toBe(422)
    const r = await w.req("POST", `/v1/devices/${pc.id}/bind`, w.staff, { code })
    expect(r.status).toBe(422)
    expect(w.deviceCookieOf(r)).toBeUndefined()
    // an admin can issue a fresh code afterwards
    expect((await w.req("POST", `/v1/devices/${pc.id}/bind`, w.staff, { code: await w.enrol(pc.id) })).status).toBe(200)
  })

  test("another user cannot use the code or bind the device, admins included", async () => {
    const w = await world()
    const pc = await w.register(w.staff.userId)
    const code = await w.enrol(pc.id)
    for (const as of [w.staff2, w.admin]) {
      const r = await w.req("POST", `/v1/devices/${pc.id}/bind`, as, { code })
      expect(r.status).toBe(404)
      expect(w.deviceCookieOf(r)).toBeUndefined()
    }
    // the allocated user can still use it (not burnt by others)
    expect((await w.req("POST", `/v1/devices/${pc.id}/bind`, w.staff, { code })).status).toBe(200)
  })

  test("enrolment codes need settings:write; user_id is immutable", async () => {
    const w = await world()
    const pc = await w.register(w.staff.userId)
    expect((await w.req("POST", `/v1/devices/${pc.id}/enrolment-code`, w.staff)).status).toBe(403)
    await w.req("PATCH", `/v1/devices/${pc.id}`, w.admin, { userId: w.admin.userId, label: "Re-owned" })
    const [row] = await ownerTenantQuery(w.tenant.id, "select user_id from devices")
    expect(row.user_id).toBe(w.staff.userId)
  })

  test("requireFeatureOnDevice('payroll') with allow none is 403 device_policy", async () => {
    const w = await world()
    expect((await w.req("GET", "/v1/_probe/payroll", w.staff)).status).toBe(200)
    await w.putPolicy("payroll", "none")
    const r = await w.req("GET", "/v1/_probe/payroll", w.staff)
    expect(r.status).toBe(403)
    expect(r.headers.get("content-type")).toContain("application/problem+json")
    expect(((await r.json()) as Json).code).toBe("device_policy")
  })

  test("policy and trust changes are audited with old and new value", async () => { // AC-M0-04
    const w = await world()
    await w.putPolicy("drive", "trusted-company-pc")
    let a = await w.lastAudit()
    expect(a).toMatchObject({ action: "device_policy.set", entity: "device_policy", entity_id: "drive", actor_id: w.admin.userId })
    expect(a.before).toEqual({ allow: "any" })
    expect(a.after).toEqual({ allow: "trusted-company-pc" })
    await w.putPolicy("drive", "none")
    a = await w.lastAudit()
    expect(a.before).toEqual({ allow: "trusted-company-pc" })
    expect(a.after).toEqual({ allow: "none" })
    const pc = await w.register(w.staff.userId)
    await w.req("PATCH", `/v1/devices/${pc.id}`, w.admin, { trusted: false })
    a = await w.lastAudit()
    expect(a).toMatchObject({ action: "device.updated", entity: "device", entity_id: pc.id })
    expect(a.before.trusted).toBe(true)
    expect(a.after.trusted).toBe(false)
  })

  test("policy changes need settings:write; bad feature or allow value is 400", async () => {
    const w = await world()
    expect((await w.putPolicy("drive", "none", w.staff)).status).toBe(403)
    expect((await w.putPolicy("coffee", "none")).status).toBe(400)
    expect((await w.putPolicy("drive", "sometimes")).status).toBe(400)
    const pc = await w.register(w.staff.userId)
    expect((await w.req("PATCH", `/v1/devices/${pc.id}`, w.staff, { trusted: false })).status).toBe(403)
  })

  test("device id from another tenant is 404; a cookie from another tenant is unregistered", async () => {
    const w = await world()
    const other = await makeTenant(w.deps, { slug: "other" })
    const oAdmin = await w.who("owner", other.id, "other")
    const oPc = await w.register(oAdmin.userId, {}, oAdmin)
    expect((await w.req("PATCH", `/v1/devices/${oPc.id}`, w.admin, { trusted: false })).status).toBe(404)
    expect((await w.req("POST", `/v1/devices/${oPc.id}/bind`, w.admin)).status).toBe(404)
    expect(((await (await w.req("GET", "/v1/devices", w.admin)).json()) as Json[]).length).toBe(0)
  })

  test("a cookie bound in one tenant is unregistered in another tenant of the same user", async () => {
    const w = await world()
    const other = await makeTenant(w.deps, { slug: "other" })
    const oAdmin = await w.who("owner", other.id, "other")
    await ownerTenantQuery(other.id, `insert into memberships (tenant_id, user_id, role_id, status, joined_at) select '${other.id}', '${w.staff.userId}', r.id, 'active', now() from roles r where r.tenant_id = '${other.id}' and r.key = 'employee'`)
    const pc = await w.register(w.staff.userId)
    const cookie = await w.bind(pc.id, w.staff)
    await w.putPolicy("drive", "trusted-company-pc")
    expect((await w.probe(w.staff, cookie)).links).toHaveLength(1)
    expect((await w.putPolicy("drive", "trusted-company-pc", oAdmin)).status).toBe(200)
    expect((await w.probe({ cookie: w.staff.cookie, slug: "other" }, cookie)).links).toHaveLength(0)
  })

  test("a cookie of tenant A is not read in tenant B", async () => {
    const w = await world()
    const other = await makeTenant(w.deps, { slug: "other" })
    const oAdmin = await w.who("owner", other.id, "other")
    const oPc = await w.register(oAdmin.userId, {}, oAdmin)
    await w.putPolicy("drive", "trusted-company-pc", oAdmin)
    const pc = await w.register(w.staff.userId)
    const cookie = await w.bind(pc.id, w.staff)
    // renaming A's cookie to B's name must not make it resolve there either
    const asB = cookie.replace(w.tenant.id.slice(0, 8), other.id.slice(0, 8))
    expect((await w.probe(oAdmin, asB)).links).toHaveLength(0)
    expect((await w.probe(oAdmin, await w.bind(oPc.id, oAdmin, oAdmin))).links).toHaveLength(1)
  })

  test("devices and device_policies force row level security", async () => {
    await world()
    const rows = await ownerQuery("select relname, relrowsecurity, relforcerowsecurity from pg_class where relname in ('devices','device_policies')")
    expect(rows).toHaveLength(2)
    for (const r of rows) expect([r.relname, r.relrowsecurity, r.relforcerowsecurity]).toEqual([r.relname, true, true])
  })

  test("the probe route is test-only: absent from the OpenAPI doc and from production", async () => {
    const w = await world()
    const doc = (await (await call(w.app, "GET", "/v1/openapi.json")).json()) as Json
    expect(Object.keys(doc.paths).filter((p) => p.startsWith("/v1/_probe"))).toEqual([])
    const prod = testApp({ env: { ...testEnv, NODE_ENV: "production" } })
    expect((await call(prod.app, "GET", "/v1/_probe/drive-links", { tenant: "acme" })).status).toBe(404)
  })
})

// ---------------------------------------------------------------- B6 T6.5: DELETE /v1/devices/{id} (retire)
describe("retire a device", () => {
  test("DELETE drops the device and its binding, is audited device.retired, and the old cookie is the unregistered browser from the next request", async () => {
    const w = await world()
    const pc = await w.register(w.staff.userId)
    const cookie = await w.bind(pc.id, w.staff)
    await w.putPolicy("drive", "trusted-company-pc")
    expect(await w.probe(w.staff, cookie)).toEqual({ links: [DRIVE_URL] })
    const del = await w.req("DELETE", `/v1/devices/${pc.id}`, w.admin)
    expect(del.status).toBe(204)
    expect(await del.text()).toBe("")
    expect(await ownerTenantQuery(w.tenant.id, "select 1 from devices")).toEqual([])
    expect(await w.probe(w.staff, cookie)).toEqual({ links: [], withheld: 1 }) // the cookie still verifies but names no device
    const a = await w.lastAudit()
    expect(a).toMatchObject({ action: "device.retired", entity: "device", entity_id: pc.id, actor_id: w.admin.userId })
    expect(a.before).toMatchObject({ userId: w.staff.userId, label: "Front desk PC", bound: true })
    expect(a.after).toBeNull()
    const dump = JSON.stringify(await ownerTenantQuery(w.tenant.id, "select before, after from audit_events"))
    expect(dump).not.toMatch(/binding|secret|enrol_hash/i)
    expect((await w.req("GET", "/v1/devices", w.admin).then((r) => r.json()) as Json[])).toEqual([])
  })

  test("an unbound device can be retired too; a second DELETE and a never-existing id are 404 device_not_found", async () => {
    const w = await world()
    const pc = await w.register(w.staff.userId)
    expect((await w.req("DELETE", `/v1/devices/${pc.id}`, w.admin)).status).toBe(204)
    expect((await w.lastAudit()).before.bound).toBe(false)
    for (const id of [pc.id, "00000000-0000-4000-8000-000000000000"]) {
      const r = await w.req("DELETE", `/v1/devices/${id}`, w.admin)
      expect(r.status).toBe(404)
      expect(((await r.json()) as Json).code).toBe("device_not_found")
    }
    expect((await w.req("DELETE", "/v1/devices/not-a-uuid", w.admin)).status).toBe(400)
  })

  test("needs settings:write (staff 403, signed-out 401); another tenant's device id is 404 and the device survives", async () => {
    const w = await world()
    const pc = await w.register(w.staff.userId)
    expect((await w.req("DELETE", `/v1/devices/${pc.id}`, w.staff)).status).toBe(403)
    expect((await w.req("DELETE", `/v1/devices/${pc.id}`, null)).status).toBe(401)
    const other = await makeTenant(w.deps, { slug: "other" })
    const o = await w.who("owner", other.id, "other")
    const r = await w.req("DELETE", `/v1/devices/${pc.id}`, o)
    expect(r.status).toBe(404)
    expect(JSON.stringify(await r.json())).not.toContain(pc.id)
    expect(await ownerTenantQuery(w.tenant.id, "select 1 from devices")).toHaveLength(1)
  })

  test("API keys are refused by the /v1/devices deny-list prefix", async () => {
    const { API_KEY_DENIED_ROUTES } = await import("../../core/middleware/api-key")
    expect(API_KEY_DENIED_ROUTES.some((r) => "prefix" in r && r.prefix === "/v1/devices")).toBe(true)
  })
})
