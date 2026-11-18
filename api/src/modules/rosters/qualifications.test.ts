import { randomUUID } from "node:crypto"
import { beforeEach, describe, expect, test } from "vitest"
import { ownerTenantQuery } from "../../../test/db"
import { makeMember, makeTenant, signIn } from "../../../test/factories"
import { call, resetDb, testApp } from "../../../test/harness"
import { isExpired } from "./qualifications"

// B8 Task 6: member qualifications (FR-RS-40) and the home location.

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Who = { userId: string; email: string; password: string }
beforeEach(resetDb)

async function world() {
  const t = testApp()
  const tenant = await makeTenant(t.deps, { slug: "acme" })
  const other = await makeTenant(t.deps, { slug: "other" })
  const p: Record<string, Who> = {}
  for (const k of ["owner", "admin", "roster-manager", "location-supervisor", "manager", "employee"]) p[k] = await makeMember(t.deps, tenant.id, k)
  const staff2 = await makeMember(t.deps, tenant.id, "employee")
  const foreign = await makeMember(t.deps, other.id, "employee")
  const cookies = new Map<string, string>()
  const cookie = async (who: Who) => {
    if (!cookies.has(who.email)) cookies.set(who.email, (await signIn(t.app, who.email, who.password)).cookie)
    return cookies.get(who.email)!
  }
  const req = async (method: string, path: string, who: Who, body?: unknown) => call(t.app, method, path, { cookie: await cookie(who), tenant: "acme", body })
  const ok = async (method: string, path: string, who: Who, body?: unknown, status = 200): Promise<Json> => {
    const r = await req(method, path, who, body)
    const text = await r.text()
    expect(r.status, `${method} ${path} -> ${text}`).toBe(status)
    return text ? JSON.parse(text) : {}
  }
  const code = async (method: string, path: string, who: Who, body: unknown, status: number): Promise<string> => {
    const r = await req(method, path, who, body)
    expect(r.status, `${method} ${path}`).toBe(status)
    return ((await r.json()) as Json).code as string
  }
  const rows = (sql: string, params: unknown[] = []) => ownerTenantQuery(tenant.id, sql, params) as Promise<Json[]>
  const loc = async (name: string) => (await ok("POST", "/v1/locations", p.owner, { name }, 201)).id as string
  return { ...t, tenant, p, staff2, foreign, req, ok, code, rows, loc, cookies }
}
const q = (id: string) => `/v1/members/${id}/qualifications`

describe("qualifications (FR-RS-40)", () => {
  test("qualifications: office writes, supervisor reads only people homed or rostered at their locations, staff reads own; another tenant's userId is 404", async () => {
    const w = await world()
    const [a, b] = [await w.loc("Alpha"), await w.loc("Bravo")]
    const sup = w.p["location-supervisor"]
    await w.ok("PUT", `/v1/locations/${a}/supervisors`, w.p.owner, { userIds: [sup.userId] })
    const staff = w.p.employee
    const put = await w.ok("PUT", q(staff.userId), w.p.owner, { qualifications: [{ type: " SIA licence ", expiresOn: "2027-03-31" }, { type: "First aid", expiresOn: null }] })
    expect(put).toEqual({ userId: staff.userId, items: [{ type: "First aid", expiresOn: null, expired: false }, { type: "SIA licence", expiresOn: "2027-03-31", expired: false }] })
    expect((await w.rows("select action from audit_events where action = 'roster.qualifications_changed'")).length).toBe(1)
    // office (admin) reads; the person reads their own; a colleague (staff) reads nobody else's
    expect((await w.ok("GET", q(staff.userId), w.p.admin)).items).toHaveLength(2)
    expect((await w.ok("GET", q(staff.userId), staff)).items).toHaveLength(2)
    expect(await w.code("GET", q(staff.userId), w.staff2, undefined, 404)).toBe("member_not_found")
    expect((await w.ok("GET", q(w.staff2.userId), w.staff2)).items).toEqual([])
    // the supervisor of Alpha: not homed, not rostered -> 404; homed at Alpha -> 200; homed at Bravo only -> 404
    expect(await w.code("GET", q(staff.userId), sup, undefined, 404)).toBe("member_not_found")
    await w.ok("PUT", `/v1/members/${staff.userId}/home-location`, w.p.owner, { locationId: a })
    expect((await w.ok("GET", q(staff.userId), sup)).items).toHaveLength(2)
    await w.ok("PUT", `/v1/members/${staff.userId}/home-location`, w.p.owner, { locationId: b })
    expect(await w.code("GET", q(staff.userId), sup, undefined, 404)).toBe("member_not_found")
    // ... unless the person is rostered at Alpha (a shift in the last 90 days or later)
    const ty = (await w.ok("POST", `/v1/locations/${a}/shift-types`, w.p.owner, { name: "Day", start: "07:00", end: "15:00", role: "Guard" }, 201)).id as string
    const [wk] = await w.rows("insert into roster_weeks (tenant_id, location_id, week_start, created_at, updated_at) values ($1, $2, '2026-11-16', now(), now()) returning id", [w.tenant.id, a])
    const [sh] = await w.rows("insert into roster_shifts (tenant_id, week_id, location_id, date, user_id, shift_type_id, role, start_time, end_time, start_at, end_at, created_at, updated_at) values ($1, $2, $3, '2026-11-17', $4, $5, 'Guard', '07:00', '15:00', '2026-11-17T07:00Z', '2026-11-17T15:00Z', now(), now()) returning id", [w.tenant.id, wk.id, a, staff.userId, ty])
    expect((await w.ok("GET", q(staff.userId), sup)).items).toHaveLength(2)
    await w.rows("update roster_shifts set start_at = '2026-06-01T07:00Z', end_at = '2026-06-01T15:00Z', date = '2026-06-01' where id = $1", [sh.id]) // older than 90 days
    expect(await w.code("GET", q(staff.userId), sup, undefined, 404)).toBe("member_not_found")
    // a supervisor and a read-only manager cannot write; nobody writes their own
    for (const who of [sup, w.p.manager, staff]) expect((await w.req("PUT", q(staff.userId), who, { qualifications: [] })).status, who.email).toBe(403)
    // read-only manager: no reach to others
    expect(await w.code("GET", q(staff.userId), w.p.manager, undefined, 404)).toBe("member_not_found")
    // another tenant's person and a ghost: the same 404 for every caller
    for (const who of [w.p.owner, sup, staff]) {
      expect(await w.code("GET", q(w.foreign.userId), who, undefined, 404)).toBe("member_not_found")
      expect(await w.code("GET", q("usr_ghost"), who, undefined, 404)).toBe("member_not_found")
    }
    expect(await w.code("PUT", q(w.foreign.userId), w.p.owner, { qualifications: [] }, 404)).toBe("member_not_found")
  })

  test("an office role with an except list reaches people homed nowhere or at a visible site, not those homed only at the excepted site", async () => {
    const w = await world()
    const [a, b] = [await w.loc("Alpha"), await w.loc("Bravo")]
    const rm = w.p["roster-manager"]
    await w.ok("PUT", `/v1/roster/office-limits/${rm.userId}`, w.p.owner, { except: [b] })
    const [x, y] = [w.p.employee, w.staff2]
    await w.ok("PUT", `/v1/members/${x.userId}/home-location`, w.p.owner, { locationId: b })
    expect(await w.code("GET", q(x.userId), rm, undefined, 404)).toBe("member_not_found") // homed at the excepted site
    expect((await w.ok("GET", q(y.userId), rm)).userId).toBe(y.userId) // homed nowhere
    await w.ok("PUT", `/v1/members/${y.userId}/home-location`, rm, { locationId: a })
    expect((await w.ok("GET", q(y.userId), rm)).userId).toBe(y.userId)
    expect(await w.code("PUT", `/v1/members/${y.userId}/home-location`, rm, { locationId: b }, 404)).toBe("not_found") // a site the caller cannot see
    expect(await w.code("PUT", `/v1/members/${x.userId}/home-location`, rm, { locationId: a }, 404)).toBe("member_not_found")
  })

  test("expired type shown with expired true computed on the clock", async () => {
    const w = await world()
    const staff = w.p.employee // the clock starts 2026-11-16 09:00Z; Europe/Dublin today is 2026-11-16
    await w.ok("PUT", q(staff.userId), w.p.owner, { qualifications: [{ type: "Past", expiresOn: "2026-11-15" }, { type: "Today", expiresOn: "2026-11-16" }, { type: "Future", expiresOn: "2026-11-17" }, { type: "Never" }] })
    const by = (r: Json) => Object.fromEntries(r.items.map((i: Json) => [i.type, i.expired]))
    expect(by(await w.ok("GET", q(staff.userId), staff))).toEqual({ Past: true, Today: false, Future: false, Never: false }) // valid THROUGH its expiry date
    w.clock.advance({ days: 1 })
    w.cookies.clear() // a day on the fake clock is past the 12 h idle timeout: sign in again
    expect(by(await w.ok("GET", q(staff.userId), staff))).toEqual({ Past: true, Today: true, Future: false, Never: false })
    w.clock.advance({ days: 1 })
    w.cookies.clear()
    expect(by(await w.ok("GET", q(staff.userId), w.p.owner))).toEqual({ Past: true, Today: true, Future: true, Never: false })
    expect([isExpired(null, "2026-01-01"), isExpired("2026-01-01", "2026-01-01"), isExpired("2025-12-31", "2026-01-01")]).toEqual([false, false, true])
  })

  test("PUT replaces the whole set; invalid types or dates are 422; an unchanged set writes nothing; removing and changing keep the other rows", async () => {
    const w = await world()
    const staff = w.p.employee
    await w.ok("PUT", q(staff.userId), w.p.owner, { qualifications: [{ type: "A", expiresOn: "2027-01-01" }, { type: "B", expiresOn: "2027-02-01" }] })
    const ids = Object.fromEntries((await w.rows("select id, type from member_qualifications")).map((r) => [r.type, r.id]))
    await w.ok("PUT", q(staff.userId), w.p.owner, { qualifications: [{ type: "B", expiresOn: "2027-02-01" }, { type: "A", expiresOn: "2028-01-01" }, { type: "C" }] })
    const now = Object.fromEntries((await w.rows("select id, type, expires_on::text as e from member_qualifications")).map((r) => [r.type, [r.id, r.e]]))
    expect(now.A).toEqual([ids.A, "2028-01-01"]) // same row, new date (a linked proof file survives)
    expect(now.B).toEqual([ids.B, "2027-02-01"])
    expect(now.C[1]).toBeNull()
    expect((await w.rows("select 1 from audit_events where action = 'roster.qualifications_changed'")).length).toBe(2)
    await w.ok("PUT", q(staff.userId), w.p.owner, { qualifications: [{ type: "C" }, { type: "A", expiresOn: "2028-01-01" }, { type: "B", expiresOn: "2027-02-01" }] })
    expect((await w.rows("select 1 from audit_events where action = 'roster.qualifications_changed'")).length).toBe(2) // unchanged: nothing written
    await w.ok("PUT", q(staff.userId), w.p.owner, { qualifications: [{ type: "C" }] })
    expect((await w.rows("select type from member_qualifications")).map((r) => r.type)).toEqual(["C"])
    for (const bad of [[{ type: "" }], [{ type: "  " }], [{ type: "x".repeat(81) }], [{ type: "A" }, { type: " A " }], [{ type: "A", expiresOn: "2027-02-30" }], [{ type: "A", expiresOn: "31/12/2027" }], Array.from({ length: 51 }, (_, i) => ({ type: `T${i}` }))]) {
      expect(await w.code("PUT", q(staff.userId), w.p.owner, { qualifications: bad }, 422)).toBe("invalid_qualification")
    }
    expect((await w.rows("select type from member_qualifications")).map((r) => r.type)).toEqual(["C"]) // a refused PUT changed nothing
  })
})

describe("home location", () => {
  test("home-location set to a location the caller cannot see is 404", async () => {
    const w = await world()
    const [a, b] = [await w.loc("Alpha"), await w.loc("Bravo")]
    const staff = w.p.employee
    expect(await w.ok("PUT", `/v1/members/${staff.userId}/home-location`, w.p.owner, { locationId: a })).toEqual({ userId: staff.userId, homeLocationId: a })
    expect((await w.rows("select home_location_id from memberships where user_id = $1", [staff.userId]))[0].home_location_id).toBe(a)
    expect((await w.rows("select action, location_id from roster_history where action = 'home_location_changed'")).map((r) => r.location_id)).toEqual([a])
    expect((await w.rows("select 1 from audit_events where action = 'roster.home_location_changed'")).length).toBe(1)
    await w.ok("PUT", `/v1/members/${staff.userId}/home-location`, w.p.owner, { locationId: a }) // same again: nothing written
    expect((await w.rows("select 1 from audit_events where action = 'roster.home_location_changed'")).length).toBe(1)
    // moving: history on the old and the new site
    await w.ok("PUT", `/v1/members/${staff.userId}/home-location`, w.p.owner, { locationId: b })
    expect((await w.rows("select location_id from roster_history where action = 'home_location_changed' order by created_at, id")).map((r) => r.location_id).sort()).toEqual([a, a, b].sort())
    // a location the caller cannot see (excepted for a limited office role), a missing one, a non-uuid and another tenant's: one 404 body
    const rm = w.p["roster-manager"]
    await w.ok("PUT", `/v1/roster/office-limits/${rm.userId}`, w.p.owner, { except: [b] })
    const body = async (id: string) => {
      const r = await w.req("PUT", `/v1/members/${w.staff2.userId}/home-location`, rm, { locationId: id })
      const j = (await r.json()) as Json
      delete j.requestId
      return JSON.stringify([r.status, j])
    }
    const hidden = await body(b)
    expect(JSON.parse(hidden)[0]).toBe(404)
    for (const id of [randomUUID(), "not-a-uuid", "12345"]) expect(await body(id)).toBe(hidden)
    expect((await w.rows("select home_location_id from memberships where user_id = $1", [w.staff2.userId]))[0].home_location_id).toBeNull()
    // clearing, archived, and who may write
    expect(await w.ok("PUT", `/v1/members/${staff.userId}/home-location`, w.p.admin, { locationId: null })).toEqual({ userId: staff.userId, homeLocationId: null })
    await w.ok("POST", `/v1/locations/${a}/archive`, w.p.owner)
    expect(await w.code("PUT", `/v1/members/${staff.userId}/home-location`, w.p.owner, { locationId: a }, 409)).toBe("location_archived")
    for (const who of [w.p["location-supervisor"], w.p.manager, staff]) expect((await w.req("PUT", `/v1/members/${staff.userId}/home-location`, who, { locationId: b })).status).toBe(403)
    expect(await w.code("PUT", `/v1/members/${w.foreign.userId}/home-location`, w.p.owner, { locationId: b }, 404)).toBe("member_not_found")
  })

  test("deleting a location clears only the home location of the people homed there (tenant_id stays)", async () => {
    const w = await world()
    const [{ id: a }] = await w.rows("insert into locations (tenant_id, name, created_at, updated_at) values ($1, 'Plain', now(), now()) returning id", [w.tenant.id]) // no history rows: the history FK would refuse the delete
    await w.rows("update memberships set home_location_id = $1 where user_id = $2", [a, w.p.employee.userId])
    await w.rows("delete from locations where id = $1", [a])
    expect((await w.rows("select tenant_id, home_location_id from memberships where user_id = $1", [w.p.employee.userId]))[0]).toEqual({ tenant_id: w.tenant.id, home_location_id: null })
  })
})
