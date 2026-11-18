import { expect } from "vitest"
import { ownerQuery, ownerTenantQuery } from "../../../test/db"
import { makeMember, makeTenant, signIn } from "../../../test/factories"
import { call, testApp } from "../../../test/harness"

/** Shared world of the B8 week, shift and publish tests: one tenant, every roster role, two sites with their own supervisors and one shift type each. */
export type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
export type Who = { userId: string; email: string; password: string }
export const TZ = "Europe/Dublin"
export const MON = "2026-11-02"

export async function world(over: Parameters<typeof testApp>[0] = {}) {
  const t = testApp(over)
  const tenant = await makeTenant(t.deps, { slug: "acme" })
  const other = await makeTenant(t.deps, { slug: "other" })
  const p: Record<string, Who> = {}
  for (const k of ["owner", "admin", "roster-manager", "location-supervisor", "manager", "employee"]) p[k] = await makeMember(t.deps, tenant.id, k)
  const sup2 = await makeMember(t.deps, tenant.id, "location-supervisor")
  const staff2 = await makeMember(t.deps, tenant.id, "employee")
  const staff3 = await makeMember(t.deps, tenant.id, "employee")
  const cookies = new Map<string, string>()
  const cookie = async (who: Who) => {
    if (!cookies.has(who.email)) cookies.set(who.email, (await signIn(t.app, who.email, who.password)).cookie)
    return cookies.get(who.email)!
  }
  const req = async (method: string, path: string, who: Who, body?: unknown, headers?: Record<string, string>) => call(t.app, method, path, { cookie: await cookie(who), tenant: "acme", body, headers })
  const ok = async (method: string, path: string, who: Who, body?: unknown, status = 200): Promise<Json> => {
    const r = await req(method, path, who, body)
    const text = await r.text()
    expect(r.status, `${method} ${path} -> ${text}`).toBe(status)
    return text ? JSON.parse(text) : {}
  }
  /** The error body of a call that must fail with `status`; the code is checked by the caller. */
  const fail = async (method: string, path: string, who: Who, body: unknown, status: number): Promise<Json> => {
    const r = await req(method, path, who, body)
    const text = await r.text()
    expect(r.status, `${method} ${path} -> ${text}`).toBe(status)
    return JSON.parse(text)
  }
  const rows = (sql: string, params: unknown[] = []) => ownerTenantQuery(tenant.id, sql, params) as Promise<Json[]>
  for (const [who, name] of [[p.employee, "Aoife Byrne"], [staff2, "Cian Doyle"], [staff3, "Dara Walsh"], [p.owner, "Olive Owner"], [p["location-supervisor"], "Sinead Sup"], [sup2, "Seamus Sup"]] as const) await ownerQuery(`update "user" set name = $1 where id = $2`, [name, who.userId])
  /** PUT /v1/roster/rules with the ETag of what is stored (If-Match), the way the settings screen sends it. */
  const rules = async (who: Who, body: Json): Promise<Json> => {
    const etag = (await req("GET", "/v1/roster/rules", who)).headers.get("etag")!
    const r = await req("PUT", "/v1/roster/rules", who, body, { "if-match": etag })
    const text = await r.text()
    expect(r.status, text).toBe(200)
    return JSON.parse(text)
  }
  const loc = async (name: string) => (await ok("POST", "/v1/locations", p.owner, { name }, 201)).id as string
  const type = async (locationId: string, name: string, o: Json = {}) => (await ok("POST", `/v1/locations/${locationId}/shift-types`, p.owner, { name, start: "08:00", end: "16:00", role: "Guard", ...o }, 201)).id as string
  const week = async (who: Who, locationId: string, weekStart: string): Promise<string> => {
    const r = await req("POST", "/v1/roster/weeks", who, { locationId, weekStart })
    const body = (await r.json()) as Json
    if (r.status === 201) return body.id
    expect(r.status, JSON.stringify(body)).toBe(409)
    return body.weekId
  }
  const add = (who: Who, weekId: string, shifts: Json[], extra: Json = {}) => req("POST", `/v1/roster/weeks/${weekId}/shifts`, who, { shifts, ...extra })
  const addOk = async (who: Who, weekId: string, shifts: Json[], extra: Json = {}): Promise<Json> => {
    const r = await add(who, weekId, shifts, extra)
    const text = await r.text()
    expect(r.status, text).toBe(201)
    return JSON.parse(text)
  }
  return { ...t, tenant, other, p, sup2, staff2, staff3, cookies, req, ok, fail, rows, rules, loc, type, week, add, addOk }
}

/** Alpha (supervised by `location-supervisor`) and Bravo (supervised by sup2), a Day type (08:00-16:00) at each, and a draft week at each for MON. */
export async function sites(over: Parameters<typeof testApp>[0] = {}) {
  const w = await world(over)
  const [a, b] = [await w.loc("Alpha"), await w.loc("Bravo")]
  await w.ok("PUT", `/v1/locations/${a}/supervisors`, w.p.owner, { userIds: [w.p["location-supervisor"].userId] })
  await w.ok("PUT", `/v1/locations/${b}/supervisors`, w.p.owner, { userIds: [w.sup2.userId] })
  const [ta, tb] = [await w.type(a, "Day"), await w.type(b, "Day")]
  const wa = await w.week(w.p.owner, a, MON)
  const wb = await w.week(w.p.owner, b, MON)
  return { ...w, a, b, ta, tb, wa, wb }
}
