import { randomUUID } from "node:crypto"
import { beforeEach, describe, expect, test } from "vitest"
import { ownerTenantQuery } from "../../../test/db"
import { makeMember, makeTenant, signIn } from "../../../test/factories"
import { call, resetDb, testApp } from "../../../test/harness"
import { normaliseRequires, shiftInstants } from "./locations"

// B8 Task 5: locations, shift types, targets, supervisor grants and office limits (FR-RS-01..04, 30..34).

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Who = { userId: string; email: string; password: string }
beforeEach(resetDb)

async function world() {
  const t = testApp()
  const tenant = await makeTenant(t.deps, { slug: "acme" })
  const other = await makeTenant(t.deps, { slug: "other" })
  const p: Record<string, Who> = {}
  for (const k of ["owner", "admin", "roster-manager", "location-supervisor", "manager", "employee"]) p[k] = await makeMember(t.deps, tenant.id, k)
  const sup2 = await makeMember(t.deps, tenant.id, "location-supervisor")
  const otherOwner = await makeMember(t.deps, other.id, "owner")
  const cookies = new Map<string, string>()
  const cookie = async (who: Who) => {
    if (!cookies.has(who.email)) cookies.set(who.email, (await signIn(t.app, who.email, who.password)).cookie)
    return cookies.get(who.email)!
  }
  const req = async (method: string, path: string, who: Who, body?: unknown, slug = "acme") => call(t.app, method, path, { cookie: await cookie(who), tenant: slug, body })
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
  const mk = (who: Who, name: string, extra: Json = {}) => ok("POST", "/v1/locations", who, { name, ...extra }, 201)
  const mkType = (loc: string, name = "Day", extra: Json = {}) => ok("POST", `/v1/locations/${loc}/shift-types`, p.owner, { name, start: "07:00", end: "15:00", role: "Guard", ...extra }, 201)
  const rows = (sqlText: string, params: unknown[] = []) => ownerTenantQuery(tenant.id, sqlText, params) as Promise<Json[]>
  const audit = (action: string) => rows("select * from audit_events where action = $1 order by seq", [action])
  const events = (type: string) => rows("select * from domain_events where type = $1 order by occurred_at", [type])
  /** A draft or published week of a location with one open shift (direct rows: the week and shift routes come with Task 9). */
  const seedWeek = async (loc: string, typeId: string, status: "draft" | "published", date: string, weekStart: string) => {
    const [wk] = await rows("insert into roster_weeks (tenant_id, location_id, week_start, status, created_at, updated_at) values ($1, $2, $3, $4, now(), now()) returning id", [tenant.id, loc, weekStart, status])
    const [sh] = await rows(
      "insert into roster_shifts (tenant_id, week_id, location_id, date, shift_type_id, role, start_time, end_time, start_at, end_at, created_at, updated_at) values ($1, $2, $3, $4, $5, 'Guard', '08:00', '16:00', $6, $7, now(), now()) returning id",
      [tenant.id, wk.id, loc, date, typeId, `${date}T07:00:00Z`, `${date}T15:00:00Z`],
    )
    return { weekId: wk.id as string, shiftId: sh.id as string }
  }
  return { ...t, tenant, other, p, sup2, otherOwner, req, ok, code, mk, mkType, rows, audit, events, seedWeek }
}

describe("locations (FR-RS-01..03)", () => {
  test("office creates a location; supervisor POST is 403; staff is 403", async () => {
    const w = await world()
    const loc = await w.mk(w.p.owner, "  Harbour Street ", { address: "1 Harbour St", lat: 53.35, lng: -6.26, zoneRadiusM: 150, timeZone: "Europe/Dublin", openingHours: { mon: "08:00-22:00" } })
    expect(loc).toMatchObject({ name: "Harbour Street", address: "1 Harbour St", zoneRadiusM: 150, timeZone: "Europe/Dublin", version: 1, archived: false, supervisorIds: [], swapApprovalDelegated: false })
    expect((await w.audit("roster.location_created"))[0]).toMatchObject({ entity_id: loc.id, actor_id: w.p.owner.userId })
    expect((await w.rows("select action from roster_history where location_id = $1", [loc.id])).map((r) => r.action)).toEqual(["location_created"])
    await w.mk(w.p.admin, "Second") // admin is office too
    for (const k of ["location-supervisor", "manager", "employee"]) expect((await w.req("POST", "/v1/locations", w.p[k], { name: "Nope" })).status, k).toBe(403)
    expect(await w.code("POST", "/v1/locations", w.p.owner, { name: "harbour STREET" }, 409)).toBe("location_name_taken") // case-insensitive among active
  })

  test("AC-RS-03: a supervisor GET /v1/locations lists only the granted one; GET another location id is 404; the body of every response has no other location's name", async () => {
    const w = await world()
    const a = await w.mk(w.p.owner, "Alpha Secret")
    const b = await w.mk(w.p.owner, "Bravo Visible")
    await w.ok("PUT", `/v1/locations/${b.id}/supervisors`, w.p.owner, { userIds: [w.p["location-supervisor"].userId] })
    const sup = w.p["location-supervisor"]
    const listText = await (await w.req("GET", "/v1/locations?includeArchived=true", sup)).text()
    expect((JSON.parse(listText) as Json).items.map((l: Json) => l.id)).toEqual([b.id])
    expect(listText).not.toContain("Alpha Secret")
    expect(listText).not.toContain(a.id)
    const one = await w.ok("GET", `/v1/locations/${b.id}`, sup)
    expect(one).toMatchObject({ id: b.id, supervisorIds: [sup.userId] })
    const types = await w.mkType(a.id, "Alpha day")
    for (const [m, path, body] of [["GET", `/v1/locations/${a.id}`], ["GET", `/v1/locations/${a.id}/shift-types`], ["PATCH", `/v1/shift-types/${types.id}`, { version: 1, role: "x" }]] as [string, string, unknown?][]) {
      const r = await w.req(m, path, sup, body)
      const text = await r.text()
      expect(r.status, `${m} ${path}`).toBe(m === "GET" ? 404 : 403) // a write by a supervisor is 403 whatever the id (office only); reads of another site are 404
      for (const s of ["Alpha Secret", "Alpha day", a.id]) expect(text).not.toContain(s)
    }
    // staff: no locations at all; a read-only manager sees every site
    expect(((await w.ok("GET", "/v1/locations", w.p.employee)) as Json).items).toEqual([])
    expect(((await w.ok("GET", "/v1/locations", w.p.manager)) as Json).items).toHaveLength(2)
  })

  test("a hidden location, a missing one, another tenant's and a non-uuid id answer identically (body and headers) on every location route", async () => {
    const w = await world()
    const hidden = await w.mk(w.p.owner, "Hidden Alpha")
    const seen = await w.mk(w.p.owner, "Seen Bravo")
    const hiddenType = await w.mkType(hidden.id, "Hidden type")
    await w.ok("PUT", `/v1/locations/${seen.id}/supervisors`, w.p.owner, { userIds: [w.p["location-supervisor"].userId] })
    // another tenant's location and type
    const foreignLoc = randomUUID()
    const foreignType = randomUUID()
    await ownerTenantQuery(w.other.id, "insert into locations (id, tenant_id, name, created_at, updated_at) values ($1, $2, 'Foreign', now(), now())", [foreignLoc, w.other.id])
    await ownerTenantQuery(w.other.id, "insert into shift_types (id, tenant_id, location_id, name, start_time, end_time, role, created_at, updated_at) values ($1, $2, $3, 'F', '07:00', '15:00', 'G', now(), now())", [foreignType, w.other.id, foreignLoc])
    await ownerTenantQuery(w.tenant.id, "insert into roster_office_limits (tenant_id, user_id, location_id) values ($1, $2, $3)", [w.tenant.id, w.p["roster-manager"].userId, hidden.id])
    const shape = async (r: Response) => {
      const j = (await r.json()) as Json
      delete j.requestId
      const h = Object.fromEntries([...r.headers.entries()].filter(([k]) => !["x-request-id", "date", "content-length"].includes(k)))
      return JSON.stringify({ status: r.status, h, j })
    }
    const locRoutes: [string, (id: string) => string, unknown?][] = [
      ["GET", (id) => `/v1/locations/${id}`], ["PATCH", (id) => `/v1/locations/${id}`, { version: 1, contact: "x" }], ["POST", (id) => `/v1/locations/${id}/archive`],
      ["PUT", (id) => `/v1/locations/${id}/supervisors`, { userIds: [] }], ["GET", (id) => `/v1/locations/${id}/shift-types`],
      ["POST", (id) => `/v1/locations/${id}/shift-types`, { name: "N", start: "07:00", end: "15:00", role: "G" }],
    ]
    const typeRoutes: [string, (id: string) => string, unknown?][] = [
      ["PATCH", (id) => `/v1/shift-types/${id}`, { version: 1, role: "x" }], ["DELETE", (id) => `/v1/shift-types/${id}`], ["PUT", (id) => `/v1/shift-types/${id}/targets`, { targets: [] }],
    ]
    const bad = ["not-a-uuid", "12345", "'; drop table locations; --", "00000000-0000-0000-0000-000000000000", randomUUID()]
    // the roster manager with an except list is office: write routes reach the lookup; the supervisor covers the reads
    for (const who of [w.p["roster-manager"], w.p.owner]) {
      for (const [method, path, body] of locRoutes) {
        if (who === w.p.owner && method !== "GET") continue
        const answers = new Set<string>()
        const ids = who === w.p.owner ? [...bad, foreignLoc] : [hidden.id, ...bad, foreignLoc]
        for (const id of ids) answers.add(await shape(await w.req(method, path(id), who, body)))
        expect(answers.size, `${who.userId === w.p.owner.userId ? "owner" : "limited office"} ${method} ${path("{id}")}`).toBe(1)
        expect(JSON.parse([...answers][0]).status).toBe(404)
      }
      for (const [method, path, body] of typeRoutes) {
        const answers = new Set<string>()
        for (const id of [...(who === w.p.owner ? [] : [hiddenType.id]), ...bad, foreignType]) answers.add(await shape(await w.req(method, path(id), who, body)))
        expect(answers.size, `${method} ${path("{id}")}`).toBe(1)
        expect(JSON.parse([...answers][0]).status).toBe(404)
      }
    }
    const sup = w.p["location-supervisor"]
    for (const [method, path] of [locRoutes[0], locRoutes[4]]) {
      const answers = new Set<string>()
      for (const id of [hidden.id, ...bad, foreignLoc]) answers.add(await shape(await w.req(method, path(id), sup)))
      expect(answers.size).toBe(1)
    }
  })

  test("PATCH with a stale version is 409 version_conflict; two concurrent PATCH: exactly one wins", async () => {
    const w = await world()
    const loc = await w.mk(w.p.owner, "Alpha")
    const ok1 = await w.ok("PATCH", `/v1/locations/${loc.id}`, w.p.owner, { version: 1, contact: "+353 1 555 0100", swapApprovalDelegated: true })
    expect(ok1).toMatchObject({ version: 2, contact: "+353 1 555 0100", swapApprovalDelegated: true })
    expect(await w.code("PATCH", `/v1/locations/${loc.id}`, w.p.owner, { version: 1, contact: "late" }, 409)).toBe("version_conflict")
    const [x, y] = await Promise.all([w.req("PATCH", `/v1/locations/${loc.id}`, w.p.owner, { version: 2, address: "A" }), w.req("PATCH", `/v1/locations/${loc.id}`, w.p.admin, { version: 2, address: "B" })])
    expect([x.status, y.status].sort()).toEqual([200, 409])
    // an unchanged PATCH bumps nothing and writes nothing
    const now = (await w.ok("GET", `/v1/locations/${loc.id}`, w.p.owner)) as Json
    const before = (await w.audit("roster.location_updated")).length
    expect((await w.ok("PATCH", `/v1/locations/${loc.id}`, w.p.owner, { version: now.version, address: now.address })).version).toBe(now.version)
    expect((await w.audit("roster.location_updated")).length).toBe(before)
  })

  test("time_zone must be an IANA zone; radius over 5000 is 422", async () => {
    const w = await world()
    expect(await w.code("POST", "/v1/locations", w.p.owner, { name: "Z", timeZone: "Mars/Olympus" }, 422)).toBe("invalid_time_zone")
    expect(await w.code("POST", "/v1/locations", w.p.owner, { name: "Z", timeZone: "Not a zone" }, 422)).toBe("invalid_time_zone")
    expect(await w.code("POST", "/v1/locations", w.p.owner, { name: "Z", zoneRadiusM: 5001 }, 422)).toBe("invalid_zone_radius")
    expect(await w.code("POST", "/v1/locations", w.p.owner, { name: "Z", zoneRadiusM: -1 }, 422)).toBe("invalid_zone_radius")
    expect(await w.code("POST", "/v1/locations", w.p.owner, { name: "Z", lat: 91, lng: 0 }, 422)).toBe("invalid_coordinates")
    expect(await w.code("POST", "/v1/locations", w.p.owner, { name: "Z", lat: 10 }, 422)).toBe("invalid_coordinates") // a point is both or neither
    expect(await w.code("POST", "/v1/locations", w.p.owner, { name: "   " }, 422)).toBe("invalid_location")
    const z = await w.mk(w.p.owner, "Z", { zoneRadiusM: 5000, timeZone: "America/New_York" })
    expect(z).toMatchObject({ zoneRadiusM: 5000, timeZone: "America/New_York" })
    expect(await w.code("PATCH", `/v1/locations/${z.id}`, w.p.owner, { version: 1, timeZone: "Atlantis/Lost" }, 422)).toBe("invalid_time_zone")
    expect((await w.ok("PATCH", `/v1/locations/${z.id}`, w.p.owner, { version: 1, timeZone: null })).timeZone).toBeNull()
  })

  test("a zone change recomputes DRAFT shifts only (instants in the new zone, version bumped); published shifts keep their instants (R8-2)", async () => {
    const w = await world()
    const loc = await w.mk(w.p.owner, "Zoned")
    const ty = await w.mkType(loc.id)
    const draft = await w.seedWeek(loc.id, ty.id, "draft", "2026-07-06", "2026-07-06")
    const pub = await w.seedWeek(loc.id, ty.id, "published", "2026-07-13", "2026-07-13")
    await w.ok("PATCH", `/v1/locations/${loc.id}`, w.p.owner, { version: 1, timeZone: "America/New_York" })
    const [d] = await w.rows("select start_at, end_at, version from roster_shifts where id = $1", [draft.shiftId])
    expect(new Date(d.start_at as string).toISOString()).toBe("2026-07-06T12:00:00.000Z") // 08:00 EDT
    expect(new Date(d.end_at as string).toISOString()).toBe("2026-07-06T20:00:00.000Z")
    expect(d.version).toBe(2)
    const [p] = await w.rows("select start_at, version from roster_shifts where id = $1", [pub.shiftId])
    expect(new Date(p.start_at as string).toISOString()).toBe("2026-07-13T07:00:00.000Z")
    expect(p.version).toBe(1)
    expect(new Date(shiftInstants("2026-03-29", "01:30", "09:00", "Europe/Dublin").startAt).toISOString()).toBe("2026-03-29T01:00:00.000Z") // gap: first valid minute after it (R8-1)
    expect(new Date(shiftInstants("2026-10-24", "22:00", "06:00", "Europe/Dublin").endAt).toISOString()).toBe("2026-10-25T06:00:00.000Z") // overnight over the clock change
  })

  test("archive: a location is never deleted, the repeat is a 200, edits and grants on an archived one are 409", async () => {
    const w = await world()
    const loc = await w.mk(w.p.owner, "Old site")
    const live = await w.mk(w.p.owner, "Live site")
    const arch = await w.ok("POST", `/v1/locations/${loc.id}/archive`, w.p.owner)
    expect(arch).toMatchObject({ id: loc.id, archived: true })
    expect((await w.ok("POST", `/v1/locations/${loc.id}/archive`, w.p.owner)).version).toBe(arch.version)
    expect((await w.audit("roster.location_archived")).length).toBe(1)
    expect(((await w.ok("GET", "/v1/locations", w.p.owner)) as Json).items.map((l: Json) => l.id)).toEqual([live.id])
    expect(((await w.ok("GET", "/v1/locations?includeArchived=true", w.p.owner)) as Json).items.map((l: Json) => l.id).sort()).toEqual([loc.id, live.id].sort())
    expect(await w.code("PATCH", `/v1/locations/${loc.id}`, w.p.owner, { version: arch.version, contact: "x" }, 409)).toBe("location_archived")
    expect(await w.code("PUT", `/v1/locations/${loc.id}/supervisors`, w.p.owner, { userIds: [] }, 409)).toBe("location_archived")
    expect((await w.mk(w.p.owner, "Old site")).name).toBe("Old site") // the name is free again once archived
    for (const k of ["location-supervisor", "employee"]) expect((await w.req("POST", `/v1/locations/${loc.id}/archive`, w.p[k])).status, k).toBe(403)
  })
})

describe("supervisor grants (FR-RS-03, FR-RS-34)", () => {
  test("supervisor change writes an audit row with the old and new user ids and publishes location.supervisors_changed once; an unchanged set writes nothing", async () => {
    const w = await world()
    const loc = await w.mk(w.p.owner, "Alpha")
    const [s1, s2] = [w.p["location-supervisor"].userId, w.sup2.userId]
    const out = await w.ok("PUT", `/v1/locations/${loc.id}/supervisors`, w.p.owner, { userIds: [s2, s1, s1] })
    expect(out).toEqual({ locationId: loc.id, userIds: [s1, s2].sort() })
    const a1 = await w.audit("roster.supervisors_changed")
    expect(a1).toHaveLength(1)
    expect(a1[0]).toMatchObject({ entity_id: loc.id, before: { userIds: [] }, after: { userIds: [s1, s2].sort() } })
    const e1 = await w.events("location.supervisors_changed")
    expect(e1).toHaveLength(1)
    expect(e1[0].payload).toEqual({ locationId: loc.id, added: [s1, s2].sort(), removed: [] })
    // the same set again (any order): nothing is written
    await w.ok("PUT", `/v1/locations/${loc.id}/supervisors`, w.p.owner, { userIds: [s1, s2] })
    expect(await w.audit("roster.supervisors_changed")).toHaveLength(1)
    expect(await w.events("location.supervisors_changed")).toHaveLength(1)
    // one removed
    await w.ok("PUT", `/v1/locations/${loc.id}/supervisors`, w.p.owner, { userIds: [s1] })
    const a2 = await w.audit("roster.supervisors_changed")
    expect(a2).toHaveLength(2)
    expect(a2[1]).toMatchObject({ before: { userIds: [s1, s2].sort() }, after: { userIds: [s1] } })
    expect((await w.events("location.supervisors_changed"))[1].payload).toEqual({ locationId: loc.id, added: [], removed: [s2] })
    // history (user ids only) and the notices for the people added and removed
    expect((await w.rows("select action, after from roster_history where location_id = $1 and action = 'supervisors_changed' order by created_at, id", [loc.id])).length).toBe(2)
    expect((await w.rows("select user_id from notifications where title = 'You now supervise a location'")).map((r) => r.user_id).sort()).toEqual([s1, s2].sort()) // sorted in JS: the DB collation orders mixed-case ids differently
    expect((await w.rows("select user_id from notifications where title = 'Location supervision ended'")).map((r) => r.user_id)).toEqual([s2])
    // the DTO and the scope follow the grant
    expect((await w.ok("GET", `/v1/locations/${loc.id}`, w.p.owner)).supervisorIds).toEqual([s1])
    expect((await w.ok("GET", `/v1/locations/${loc.id}`, w.p["location-supervisor"])).id).toBe(loc.id)
    expect((await w.req("GET", `/v1/locations/${loc.id}`, w.sup2)).status).toBe(404)
  })

  test("assigning a supervisor who is deactivated or not a member is 422", async () => {
    const w = await world()
    const loc = await w.mk(w.p.owner, "Alpha")
    const base = [w.p["location-supervisor"].userId]
    await w.ok("PUT", `/v1/locations/${loc.id}/supervisors`, w.p.owner, { userIds: base })
    expect(await w.code("PUT", `/v1/locations/${loc.id}/supervisors`, w.p.owner, { userIds: ["usr_ghost"] }, 422)).toBe("invalid_supervisor")
    expect(await w.code("PUT", `/v1/locations/${loc.id}/supervisors`, w.p.owner, { userIds: [w.otherOwner.userId] }, 422)).toBe("invalid_supervisor") // a member of ANOTHER tenant only
    await w.rows("update memberships set status = 'deactivated' where user_id = $1", [w.sup2.userId])
    expect(await w.code("PUT", `/v1/locations/${loc.id}/supervisors`, w.p.owner, { userIds: [...base, w.sup2.userId] }, 422)).toBe("invalid_supervisor")
    expect((await w.ok("GET", `/v1/locations/${loc.id}`, w.p.owner)).supervisorIds).toEqual(base) // nothing changed
    // an existing grant of a person who is deactivated later stays in the table but is not listed as a supervisor
    await w.rows("update memberships set status = 'deactivated' where user_id = $1", [base[0]])
    expect((await w.ok("GET", `/v1/locations/${loc.id}`, w.p.owner)).supervisorIds).toEqual([])
    expect((await w.req("PUT", `/v1/locations/${loc.id}/supervisors`, w.p.employee, { userIds: [] })).status).toBe(403)
  })
})

describe("shift types and targets (FR-RS-30..33)", () => {
  test("a shift type in use by a shift cannot be hard-deleted: DELETE archives it, the roster still shows it", async () => {
    const w = await world()
    const loc = await w.mk(w.p.owner, "Alpha")
    const ty = await w.mkType(loc.id, "Day")
    const { shiftId } = await w.seedWeek(loc.id, ty.id, "published", "2026-11-17", "2026-11-16")
    await expect(w.rows("delete from shift_types where id = $1", [ty.id])).rejects.toMatchObject({ code: "23503" }) // the FK from roster_shifts: a hard delete is impossible
    expect((await w.req("DELETE", `/v1/shift-types/${ty.id}`, w.p.owner)).status).toBe(204)
    expect((await w.req("DELETE", `/v1/shift-types/${ty.id}`, w.p.owner)).status).toBe(204) // always succeeds, repeat included
    expect(((await w.ok("GET", `/v1/locations/${loc.id}/shift-types`, w.p.owner)) as Json).items).toEqual([])
    const all = (await w.ok("GET", `/v1/locations/${loc.id}/shift-types?includeArchived=true`, w.p.owner)) as Json
    expect(all.items).toHaveLength(1)
    expect(all.items[0]).toMatchObject({ id: ty.id, archived: true, name: "Day" })
    expect((await w.rows("select shift_type_id from roster_shifts where id = $1", [shiftId]))[0].shift_type_id).toBe(ty.id) // the shift keeps its type
    expect((await w.audit("roster.shift_type_archived")).length).toBe(1)
    expect(await w.code("PATCH", `/v1/shift-types/${ty.id}`, w.p.owner, { version: all.items[0].version, role: "x" }, 409)).toBe("shift_type_archived")
    await w.mkType(loc.id, "Day") // the name is free again among active types
    for (const k of ["location-supervisor", "employee"]) expect((await w.req("DELETE", `/v1/shift-types/${ty.id}`, w.p[k])).status, k).toBe(403)
  })

  test("shift type start equal to end is allowed (overnight 24 h is not): 22:00-06:00 is overnight, 08:00-08:00 is 422", async () => {
    const w = await world()
    const loc = await w.mk(w.p.owner, "Alpha")
    expect(await w.mkType(loc.id, "Night", { start: "22:00", end: "06:00", unpaidBreakMin: 30 })).toMatchObject({ start: "22:00", end: "06:00", unpaidBreakMin: 30 })
    const bad = (extra: Json, name: string) => w.code("POST", `/v1/locations/${loc.id}/shift-types`, w.p.owner, { name, start: "07:00", end: "15:00", role: "G", ...extra }, 422)
    expect(await bad({ start: "08:00", end: "08:00" }, "Equal")).toBe("invalid_shift_type")
    expect(await bad({ start: "24:00" }, "H24")).toBe("invalid_shift_type")
    expect(await bad({ end: "7am" }, "Fmt")).toBe("invalid_shift_type")
    expect(await bad({ unpaidBreakMin: 481 }, "Brk")).toBe("invalid_shift_type")
    expect(await bad({ unpaidBreakMin: 480 }, "Brk2")).toBe("invalid_shift_type") // a break as long as the shift
    expect(await bad({ unpaidBreakMin: 1.5 }, "Brk3")).toBe("invalid_shift_type")
    expect(await bad({ role: "  " }, "Role")).toBe("invalid_shift_type")
    expect(await w.code("POST", `/v1/locations/${loc.id}/shift-types`, w.p.owner, { name: "night", start: "20:00", end: "04:00", role: "G" }, 409)).toBe("shift_type_name_taken")
    const day = await w.mkType(loc.id, "Day")
    expect(await w.code("PATCH", `/v1/shift-types/${day.id}`, w.p.owner, { version: 1, start: "15:00" }, 422)).toBe("invalid_shift_type") // start == end after the patch
    expect(await w.code("PATCH", `/v1/shift-types/${day.id}`, w.p.owner, { version: 1, name: "NIGHT" }, 409)).toBe("shift_type_name_taken")
    const up = await w.ok("PATCH", `/v1/shift-types/${day.id}`, w.p.owner, { version: 1, end: "16:00", name: " Early " })
    expect(up).toMatchObject({ name: "Early", end: "16:00", version: 2 })
    expect(await w.code("PATCH", `/v1/shift-types/${day.id}`, w.p.owner, { version: 1, role: "x" }, 409)).toBe("version_conflict")
    expect((await w.audit("roster.shift_type_updated")).length).toBe(1)
  })

  test("qualification types in requires are free text keys, trimmed, deduplicated, max 20", async () => {
    const w = await world()
    const loc = await w.mk(w.p.owner, "Alpha")
    const t1 = await w.mkType(loc.id, "A", { requires: [" SIA licence ", "SIA licence", "First aid", "First aid  "] })
    expect(t1.requires).toEqual(["sia licence", "first aid"]) // keys are canonical lower case: 'First aid' and 'first AID' are one key (Task 8 eligibility compares equal)
    expect((await w.mkType(loc.id, "A2", { requires: ["First Aid", "first aid", "FIRST AID"] })).requires).toEqual(["first aid"])
    const twenty = Array.from({ length: 20 }, (_, i) => `q${i}`)
    expect((await w.mkType(loc.id, "B", { requires: [...twenty, ...twenty] })).requires).toEqual(twenty) // duplicates collapse first, 20 is fine
    expect(await w.code("POST", `/v1/locations/${loc.id}/shift-types`, w.p.owner, { name: "C", start: "07:00", end: "15:00", role: "G", requires: [...twenty, "q20"] }, 422)).toBe("invalid_shift_type")
    expect(await w.code("POST", `/v1/locations/${loc.id}/shift-types`, w.p.owner, { name: "D", start: "07:00", end: "15:00", role: "G", requires: ["ok", "   "] }, 422)).toBe("invalid_shift_type")
    expect(await w.code("POST", `/v1/locations/${loc.id}/shift-types`, w.p.owner, { name: "E", start: "07:00", end: "15:00", role: "G", requires: ["x".repeat(81)] }, 422)).toBe("invalid_shift_type")
    expect((await w.ok("PATCH", `/v1/shift-types/${t1.id}`, w.p.owner, { version: 1, requires: [] })).requires).toEqual([])
    expect(normaliseRequires(["b", " a", "B", "a "])).toEqual(["b", "a"])
  })

  test("targets: a per-weekday count replaces the whole set; duplicates, a bad weekday or count 100 are 422; an unchanged set bumps nothing", async () => {
    const w = await world()
    const loc = await w.mk(w.p.owner, "Alpha")
    const ty = await w.mkType(loc.id, "Day")
    const one = await w.ok("PUT", `/v1/shift-types/${ty.id}/targets`, w.p.owner, { targets: [{ weekday: 5, count: 3 }, { weekday: 1, count: 2 }, { weekday: 0, count: 0 }] })
    expect(one.targets).toEqual([{ weekday: 0, count: 0 }, { weekday: 1, count: 2 }, { weekday: 5, count: 3 }])
    expect(one.version).toBe(2)
    for (const targets of [[{ weekday: 1, count: 1 }, { weekday: 1, count: 2 }], [{ weekday: 7, count: 1 }], [{ weekday: -1, count: 1 }], [{ weekday: 1, count: 100 }], [{ weekday: 1, count: -1 }], [{ weekday: 1.5, count: 1 }]]) {
      expect(await w.code("PUT", `/v1/shift-types/${ty.id}/targets`, w.p.owner, { targets }, 422)).toBe("invalid_targets")
    }
    expect((await w.ok("PUT", `/v1/shift-types/${ty.id}/targets`, w.p.owner, { targets: [{ weekday: 1, count: 2 }, { weekday: 5, count: 3 }, { weekday: 0, count: 0 }] })).version).toBe(2)
    expect((await w.audit("roster.targets_changed")).length).toBe(1)
    const list = (await w.ok("GET", `/v1/locations/${loc.id}/shift-types`, w.p.owner)) as Json
    expect(list.items[0].targets).toHaveLength(3)
    expect((await w.ok("PUT", `/v1/shift-types/${ty.id}/targets`, w.p.owner, { targets: [] })).targets).toEqual([])
    expect((await w.req("PUT", `/v1/shift-types/${ty.id}/targets`, w.p["location-supervisor"], { targets: [] })).status).toBe(403)
  })

  test("a supervisor reads the shift types of the granted location only; writes are office-level", async () => {
    const w = await world()
    const a = await w.mk(w.p.owner, "Alpha")
    const b = await w.mk(w.p.owner, "Bravo")
    await w.mkType(a.id, "Alpha type")
    await w.mkType(b.id, "Bravo type")
    await w.ok("PUT", `/v1/locations/${b.id}/supervisors`, w.p.owner, { userIds: [w.p["location-supervisor"].userId] })
    const sup = w.p["location-supervisor"]
    const text = await (await w.req("GET", `/v1/locations/${b.id}/shift-types`, sup)).text()
    expect(text).toContain("Bravo type")
    expect(text).not.toContain("Alpha type")
    expect((await w.req("GET", `/v1/locations/${a.id}/shift-types`, sup)).status).toBe(404)
    expect((await w.req("POST", `/v1/locations/${b.id}/shift-types`, sup, { name: "X", start: "07:00", end: "15:00", role: "G" })).status).toBe(403)
  })
})

describe("office limits (FR-RS-04)", () => {
  test("office limit: a roster manager with an except list no longer lists or reads that location; limits for a user who is not roster office level are 422", async () => {
    const w = await world()
    const [l1, l2, l3] = [await w.mk(w.p.owner, "One"), await w.mk(w.p.owner, "Two"), await w.mk(w.p.owner, "Three")]
    const rm = w.p["roster-manager"]
    expect(((await w.ok("GET", "/v1/locations", rm)) as Json).items).toHaveLength(3)
    const out = await w.ok("PUT", `/v1/roster/office-limits/${rm.userId}`, w.p.owner, { except: [l3.id, l3.id] })
    expect(out).toEqual({ userId: rm.userId, except: [l3.id] })
    expect(((await w.ok("GET", "/v1/locations", rm)) as Json).items.map((l: Json) => l.id).sort()).toEqual([l1.id, l2.id].sort())
    expect((await w.req("GET", `/v1/locations/${l3.id}`, rm)).status).toBe(404)
    expect((await w.req("PATCH", `/v1/locations/${l3.id}`, rm, { version: 1, contact: "x" })).status).toBe(404)
    expect((await w.audit("roster.office_limit_changed"))[0]).toMatchObject({ entity_id: rm.userId, before: { except: [] }, after: { except: [l3.id] } })
    // unchanged: nothing written
    await w.ok("PUT", `/v1/roster/office-limits/${rm.userId}`, w.p.owner, { except: [l3.id] })
    expect(await w.audit("roster.office_limit_changed")).toHaveLength(1)
    // a limited office role cannot change anyone's limit (including its own)
    expect((await w.req("PUT", `/v1/roster/office-limits/${rm.userId}`, rm, { except: [] })).status).toBe(403)
    // an unrestricted office role can lift it
    await w.ok("PUT", `/v1/roster/office-limits/${rm.userId}`, w.p.admin, { except: [] })
    expect(((await w.ok("GET", "/v1/locations", rm)) as Json).items).toHaveLength(3)
    // not roster office level: supervisor, read-only manager, staff are 422; a ghost user is 404; a user of another tenant is 404
    for (const k of ["location-supervisor", "manager", "employee"]) expect(await w.code("PUT", `/v1/roster/office-limits/${w.p[k].userId}`, w.p.owner, { except: [l1.id] }, 422), k).toBe("not_roster_office")
    expect(await w.code("PUT", "/v1/roster/office-limits/usr_ghost", w.p.owner, { except: [] }, 404)).toBe("member_not_found")
    expect(await w.code("PUT", `/v1/roster/office-limits/${w.otherOwner.userId}`, w.p.owner, { except: [] }, 404)).toBe("member_not_found")
    expect(await w.code("PUT", `/v1/roster/office-limits/${rm.userId}`, w.p.owner, { except: [randomUUID()] }, 422)).toBe("invalid_location")
    expect(await w.code("PUT", `/v1/roster/office-limits/${rm.userId}`, w.p.owner, { except: ["nope"] }, 422)).toBe("invalid_location")
    expect((await w.req("PUT", `/v1/roster/office-limits/${rm.userId}`, w.p["location-supervisor"], { except: [] })).status).toBe(403)
  })
})

describe("roster routes: source rules", () => {
  test("no wall clock in rosters source: Date.now() and new Date() are banned, only deps.clock", async () => {
    const { readdirSync, readFileSync } = await import("node:fs")
    const dir = new URL(".", import.meta.url).pathname
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))) {
      const src = readFileSync(`${dir}${f}`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
      expect(src, f).not.toMatch(/Date\.now\(\)|new Date\(\)/)
    }
  })
})
