import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import pg from "pg"
import { afterAll, beforeEach, describe, expect, test } from "vitest"
import { ownerTenantQuery } from "../../../test/db"
import { makeMember, makeTenant, signIn } from "../../../test/factories"
import { call, resetDb, testApp } from "../../../test/harness"

// B8 Task 7: leave requests, approval (D8) and availability (FR-RS-41, R8-7).

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Who = { userId: string; email: string; password: string }
beforeEach(resetDb)

async function world() {
  const t = testApp()
  const tenant = await makeTenant(t.deps, { slug: "acme" })
  const other = await makeTenant(t.deps, { slug: "other" })
  const p: Record<string, Who> = {}
  for (const k of ["owner", "admin", "roster-manager", "location-supervisor", "manager", "employee"]) p[k] = await makeMember(t.deps, tenant.id, k)
  const sup2 = await makeMember(t.deps, tenant.id, "location-supervisor") // supervises another site
  const staff2 = await makeMember(t.deps, tenant.id, "employee")
  const foreign = await makeMember(t.deps, other.id, "employee")
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
  const rows = (sql: string, params: unknown[] = []) => ownerTenantQuery(tenant.id, sql, params) as Promise<Json[]>
  const loc = async (name: string) => (await ok("POST", "/v1/locations", p.owner, { name }, 201)).id as string
  const home = (who: Who, locationId: string | null) => ok("PUT", `/v1/members/${who.userId}/home-location`, p.owner, { locationId })
  const ask = (who: Who, from: string, to: string, o: Json = {}) => ok("POST", "/v1/leave", who, { from, to, kind: "annual", note: "", ...o }, 201)
  return { ...t, tenant, other, p, sup2, staff2, foreign, req, ok, code, rows, loc, home, ask }
}

/** Alpha (supervised by `location-supervisor`, staff homed there) and Bravo (supervised by sup2). */
async function sites() {
  const w = await world()
  const [a, b] = [await w.loc("Alpha"), await w.loc("Bravo")]
  await w.ok("PUT", `/v1/locations/${a}/supervisors`, w.p.owner, { userIds: [w.p["location-supervisor"].userId] })
  await w.ok("PUT", `/v1/locations/${b}/supervisors`, w.p.owner, { userIds: [w.sup2.userId] })
  await w.home(w.p.employee, a)
  return { ...w, a, b }
}

describe("leave requests (FR-RS-41)", () => {
  test("staff creates leave; overlapping own approved leave is 409 leave_overlap", async () => {
    const w = await sites()
    const staff = w.p.employee
    const l = await w.ask(staff, "2026-12-01", "2026-12-05", { kind: " annual ", note: "Skiing" })
    expect(l).toMatchObject({ userId: staff.userId, from: "2026-12-01", to: "2026-12-05", kind: "annual", status: "requested", note: "Skiing", decidedBy: null, decidedAt: null, decisionNote: null })
    expect(typeof l.id).toBe("string")
    await w.ok("POST", `/v1/leave/${l.id}/decide`, w.p["location-supervisor"], { decision: "approve", note: "" })
    for (const [from, to] of [["2026-12-05", "2026-12-08"], ["2026-11-28", "2026-12-01"], ["2026-12-02", "2026-12-03"], ["2026-11-01", "2026-12-31"]]) {
      expect(await w.code("POST", "/v1/leave", staff, { from, to, kind: "annual", note: "" }, 409), `${from}..${to}`).toBe("leave_overlap")
    }
    await w.ask(staff, "2026-12-06", "2026-12-08") // the next day is free
    // a still-open request blocks a duplicate as well; a rejected or cancelled one does not
    expect(await w.code("POST", "/v1/leave", staff, { from: "2026-12-07", to: "2026-12-07", kind: "sick", note: "" }, 409)).toBe("leave_overlap")
    const open = (await w.rows("select id from leave_requests where from_date = '2026-12-06'"))[0].id
    await w.ok("POST", `/v1/leave/${open}/cancel`, staff)
    await w.ask(staff, "2026-12-07", "2026-12-07", { kind: "sick" })
    // other people's leave never collides
    await w.ask(w.staff2, "2026-12-01", "2026-12-05")
    // the event carries ids only
    const ev = await w.rows("select payload from domain_events where type = 'roster.leave_requested' order by occurred_at")
    expect(ev.length).toBe(4)
    expect(Object.keys(ev[0].payload).sort()).toEqual(["leaveId", "userId"])
  })

  test("invalid leave is 422 with a specific code; the fields are bounded", async () => {
    const w = await sites()
    const staff = w.p.employee
    const bad: [Json, string][] = [
      [{ from: "2026-12-05", to: "2026-12-01", kind: "annual", note: "" }, "invalid_leave"],
      [{ from: "2026-02-30", to: "2026-03-01", kind: "annual", note: "" }, "invalid_leave"],
      [{ from: "12/01/2026", to: "2026-12-02", kind: "annual", note: "" }, "invalid_leave"],
      [{ from: "2026-12-01", to: "2026-12-02", kind: "   ", note: "" }, "invalid_leave"],
      [{ from: "2026-12-01", to: "2026-12-02", kind: "x".repeat(41), note: "" }, "invalid_leave"],
      [{ from: "2026-12-01", to: "2026-12-02", kind: "annual", note: "n".repeat(501) }, "invalid_leave"],
      [{ from: "2026-12-01", to: "2028-12-02", kind: "annual", note: "" }, "invalid_leave"], // longer than a year
    ]
    for (const [body, c] of bad) expect(await w.code("POST", "/v1/leave", staff, body, 422), JSON.stringify(body)).toBe(c)
    expect(await w.rows("select 1 from leave_requests")).toEqual([])
  })

  test("supervisor of the home location approves; a supervisor of another location gets 404 for that leave", async () => {
    const w = await sites()
    const staff = w.p.employee
    const l = await w.ask(staff, "2026-12-01", "2026-12-05")
    const url = `/v1/leave/${l.id}/decide`
    expect(await w.code("POST", url, w.sup2, { decision: "approve", note: "" }, 404)).toBe("leave_not_found")
    expect((await w.ok("GET", "/v1/leave", w.sup2)).items).toEqual([]) // never reaches a caller outside scope
    const d = await w.ok("POST", url, w.p["location-supervisor"], { decision: "approve", note: "Enjoy" })
    expect(d).toMatchObject({ id: l.id, status: "approved", decidedBy: w.p["location-supervisor"].userId, decisionNote: "Enjoy" })
    expect(typeof d.decidedAt).toBe("string")
    const [audit] = await w.rows("select action, entity, entity_id, before, after from audit_events where action = 'roster.leave_decided'")
    expect(audit).toMatchObject({ entity: "leave_request", entity_id: l.id })
    expect(audit.before).toMatchObject({ status: "requested" })
    expect(audit.after).toMatchObject({ status: "approved", decidedBy: w.p["location-supervisor"].userId })
    const ev = await w.rows("select payload from domain_events where type = 'roster.leave_decided'")
    expect(ev.map((e) => e.payload)).toEqual([{ leaveId: l.id, userId: staff.userId, decision: "approve" }])
    // the requester is told; the note reaches them
    const [n] = await w.rows("select title, body from notifications where user_id = $1 and title ilike '%approved%'", [staff.userId])
    expect(n.body).toContain("Enjoy")
    // read-only manager and staff cannot decide at all (403 at the guard), whatever the id
    for (const who of [w.p.manager, w.staff2]) expect((await w.req("POST", url, who, { decision: "reject", note: "" })).status, who.email).toBe(403)
  })

  test("a rejection stores the note; a rejected request is final", async () => {
    const w = await sites()
    const l = await w.ask(w.p.employee, "2026-12-01", "2026-12-05")
    const d = await w.ok("POST", `/v1/leave/${l.id}/decide`, w.p["location-supervisor"], { decision: "reject", note: "Short staffed" })
    expect(d).toMatchObject({ status: "rejected", decisionNote: "Short staffed" })
    expect(await w.code("POST", `/v1/leave/${l.id}/decide`, w.p.owner, { decision: "approve", note: "" }, 409)).toBe("already_decided")
    await w.ask(w.p.employee, "2026-12-01", "2026-12-05") // a rejected request does not block a new one
    const l3 = await w.ask(w.p.employee, "2027-02-01", "2027-02-05")
    const bad = await w.req("POST", `/v1/leave/${l3.id}/decide`, w.p["location-supervisor"], { decision: "maybe", note: "" })
    expect([400, 422]).toContain(bad.status)
    expect((await w.rows("select status from leave_requests where id = $1", [l3.id]))[0].status).toBe("requested")
  })

  test("office role approves for a person homed nowhere; an office role with an except list cannot decide for someone homed at the excepted site (404)", async () => {
    const w = await sites()
    const rm = w.p["roster-manager"]
    await w.ok("PUT", `/v1/roster/office-limits/${rm.userId}`, w.p.owner, { except: [w.b] })
    await w.home(w.staff2, w.b) // staff2 homed at the excepted Bravo; employee at Alpha; w.p.manager homed nowhere but read-only
    const nowhere = await makeMember(w.deps, w.tenant.id, "employee")
    const [atB, atA, atNone] = [await w.ask(w.staff2, "2026-12-01", "2026-12-02"), await w.ask(w.p.employee, "2026-12-01", "2026-12-02"), await w.ask(nowhere, "2026-12-01", "2026-12-02")]
    expect(await w.code("POST", `/v1/leave/${atB.id}/decide`, rm, { decision: "approve", note: "" }, 404)).toBe("leave_not_found")
    expect((await w.ok("GET", "/v1/leave", rm)).items.map((i: Json) => i.id).sort()).toEqual([atA.id, atNone.id].sort())
    expect((await w.ok("POST", `/v1/leave/${atNone.id}/decide`, rm, { decision: "approve", note: "" })).status).toBe("approved") // homed nowhere
    expect((await w.ok("POST", `/v1/leave/${atA.id}/decide`, rm, { decision: "reject", note: "" })).status).toBe("rejected") // a visible site: an office role may decide even though a supervisor exists
    // an unrestricted office role (admin) decides for the excepted site too; a supervisor never decides for a person homed nowhere
    expect((await w.ok("POST", `/v1/leave/${atB.id}/decide`, w.p.admin, { decision: "approve", note: "" })).status).toBe("approved")
    const nowhere2 = await makeMember(w.deps, w.tenant.id, "employee")
    const n2 = await w.ask(nowhere2, "2026-12-01", "2026-12-02")
    expect(await w.code("POST", `/v1/leave/${n2.id}/decide`, w.p["location-supervisor"], { decision: "approve", note: "" }, 404)).toBe("leave_not_found")
  })

  test("nobody decides their own leave (403)", async () => {
    const w = await sites()
    for (const who of [w.p.owner, w.p.admin, w.p["roster-manager"], w.p["location-supervisor"]]) {
      const l = await w.ask(who, "2026-12-01", "2026-12-02")
      expect(await w.code("POST", `/v1/leave/${l.id}/decide`, who, { decision: "approve", note: "" }, 403), who.email).toBe("self_decision")
      expect((await w.rows("select status from leave_requests where id = $1", [l.id]))[0].status).toBe("requested")
    }
  })

  test("decide twice is 409 already_decided; two concurrent decides: one 200 one 409", async () => {
    const w = await sites()
    const l = await w.ask(w.p.employee, "2026-12-01", "2026-12-05")
    const url = `/v1/leave/${l.id}/decide`
    const rs = await Promise.all([w.req("POST", url, w.p["location-supervisor"], { decision: "approve", note: "" }), w.req("POST", url, w.p.admin, { decision: "reject", note: "" })])
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409])
    const loser = rs.find((r) => r.status === 409)!
    expect(((await loser.json()) as Json).code).toBe("already_decided")
    expect(await w.rows("select 1 from audit_events where action = 'roster.leave_decided'")).toHaveLength(1)
    expect(await w.rows("select 1 from domain_events where type = 'roster.leave_decided'")).toHaveLength(1)
  })

  test("cancel: the requester cancels an open or approved request; a colleague who can see it gets 403, one who cannot 404; cancelled is final", async () => {
    const w = await sites()
    const staff = w.p.employee
    const l = await w.ask(staff, "2026-12-01", "2026-12-05")
    expect(await w.code("POST", `/v1/leave/${l.id}/cancel`, w.staff2, undefined, 404)).toBe("leave_not_found")
    expect(await w.code("POST", `/v1/leave/${l.id}/cancel`, w.p["location-supervisor"], undefined, 403)).toBe("forbidden")
    await w.ok("POST", `/v1/leave/${l.id}/decide`, w.p["location-supervisor"], { decision: "approve", note: "" })
    expect((await w.ok("POST", `/v1/leave/${l.id}/cancel`, staff)).status).toBe("cancelled")
    expect(await w.code("POST", `/v1/leave/${l.id}/cancel`, staff, undefined, 409)).toBe("leave_not_open")
    expect(await w.code("POST", `/v1/leave/${l.id}/decide`, w.p.admin, { decision: "approve", note: "" }, 409)).toBe("already_decided")
    const l2 = await w.ask(staff, "2026-12-01", "2026-12-05") // the dates are free again
    await w.ok("POST", `/v1/leave/${l2.id}/decide`, w.p.admin, { decision: "reject", note: "" })
    expect(await w.code("POST", `/v1/leave/${l2.id}/cancel`, staff, undefined, 409)).toBe("leave_not_open") // rejected is final too
  })

  test("GET /v1/leave: own, supervisor (people homed at their locations), office (all within scope); filters; a read-only manager and staff see only their own", async () => {
    const w = await sites()
    const [x, y] = [w.p.employee, w.staff2] // x homed at Alpha, y at Bravo
    await w.home(y, w.b)
    const lx = await w.ask(x, "2026-12-01", "2026-12-05")
    const ly = await w.ask(y, "2026-12-10", "2026-12-12", { kind: "sick" })
    const lo = await w.ask(w.p.owner, "2027-01-04", "2027-01-05")
    await w.ok("POST", `/v1/leave/${lx.id}/decide`, w.p["location-supervisor"], { decision: "approve", note: "" })
    const ids = async (who: Who, q = "") => (await w.ok("GET", `/v1/leave${q}`, who)).items.map((i: Json) => i.id).sort()
    expect(await ids(x)).toEqual([lx.id])
    expect(await ids(y)).toEqual([ly.id])
    expect(await ids(w.p["location-supervisor"])).toEqual([lx.id]) // Alpha only: no Bravo person, no person homed nowhere
    expect(await ids(w.sup2)).toEqual([ly.id])
    expect(await ids(w.p.admin)).toEqual([lx.id, ly.id, lo.id].sort())
    expect(await ids(w.p.manager)).toEqual([]) // read-only manager: own only (none)
    expect(await ids(w.p.admin, "?status=approved")).toEqual([lx.id])
    expect(await ids(w.p.admin, `?userId=${y.userId}`)).toEqual([ly.id])
    expect(await ids(w.p.admin, "?from=2026-12-04&to=2026-12-10")).toEqual([lx.id, ly.id].sort()) // overlaps the range
    expect(await ids(w.p.admin, "?from=2026-12-06&to=2026-12-09")).toEqual([])
    expect(await ids(w.p["location-supervisor"], `?userId=${y.userId}`)).toEqual([]) // outside scope: empty, never an error
    for (const q of ["?status=bogus", "?from=2026-13-01", "?to=nope"]) expect(await w.code("GET", `/v1/leave${q}`, w.p.admin, undefined, 422), q).toBe("invalid_filter")
    // the list never leaves the tenant
    await ownerTenantQuery(w.other.id, "insert into leave_requests (tenant_id, user_id, from_date, to_date, kind, created_at, updated_at) values ($1, $2, '2026-12-01', '2026-12-02', 'annual', now(), now())", [w.other.id, w.foreign.userId])
    expect(JSON.stringify(await w.ok("GET", "/v1/leave", w.p.admin))).not.toContain(w.foreign.userId)
  })

  test("a non-uuid leave id answers exactly like a missing one (cancel and decide, every caller)", async () => {
    const w = await sites()
    const l = await w.ask(w.p.employee, "2026-12-01", "2026-12-05")
    const shape = async (method: string, path: string, who: Who, body?: unknown) => {
      const r = await w.req(method, path, who, body)
      const j = (await r.json()) as Json
      return { status: r.status, code: j.code, title: j.title, detail: j.detail, type: j.type, ct: r.headers.get("content-type") }
    }
    for (const who of [w.p.owner, w.p["location-supervisor"], w.sup2, w.p.employee]) {
      for (const [m, tail, body] of [["POST", "cancel", undefined], ["POST", "decide", { decision: "approve", note: "" }]] as const) {
        if (tail === "decide" && who === w.p.employee) continue // staff has no write guard
        const missing = await shape(m, `/v1/leave/${randomUUID()}/${tail}`, who, body)
        for (const bad of ["not-a-uuid", "1", "%27%20or%201%3D1", "00000000-0000-0000-0000-00000000000"]) expect(await shape(m, `/v1/leave/${bad}/${tail}`, who, body), `${who.email} ${tail} ${bad}`).toEqual(missing)
        expect(missing.status).toBe(404)
        expect(missing.code).toBe("leave_not_found")
      }
    }
    expect((await w.rows("select status from leave_requests where id = $1", [l.id]))[0].status).toBe("requested")
  })

  test("leave routes on a tenant without M1A are 403 module_not_entitled", async () => {
    const t = testApp()
    const tenant = await makeTenant(t.deps, { slug: "small", subscription: { planId: "starter" } })
    const o = await makeMember(t.deps, tenant.id, "owner")
    const cookie = (await signIn(t.app, o.email, o.password)).cookie
    const calls: [string, string, unknown][] = [["GET", "/v1/leave", undefined], ["POST", "/v1/leave", { from: "2026-12-01", to: "2026-12-02", kind: "annual", note: "" }], ["POST", `/v1/leave/${randomUUID()}/cancel`, undefined], ["POST", `/v1/leave/${randomUUID()}/decide`, { decision: "approve", note: "" }], ["GET", "/v1/roster/availability", undefined], ["PUT", "/v1/roster/availability", { windows: [] }]]
    for (const [m, path, body] of calls) {
      const r = await call(t.app, m, path, { cookie, tenant: "small", body })
      expect(r.status, `${m} ${path}`).toBe(403)
      expect(((await r.json()) as Json).code).toBe("module_not_entitled")
    }
  })

  test("notification to approvers names no other site's people: supervisors of the home site if any (else office roles that cover it), the requester only through the subject token", async () => {
    const w = await sites()
    const rm = w.p["roster-manager"]
    await w.ok("PUT", `/v1/roster/office-limits/${rm.userId}`, w.p.owner, { except: [w.b] })
    await w.home(w.staff2, w.b)
    await w.ask(w.p.employee, "2026-12-01", "2026-12-02") // homed at Alpha
    const who = async (title: string) => (await w.rows("select user_id, body, subject_user_id, kind, link from notifications where title = $1 order by user_id", [title])).map((r) => r.user_id).sort()
    expect(await who("Leave requested")).toEqual([w.p["location-supervisor"].userId]) // the Alpha supervisor; not the Bravo one, not an office role while a supervisor exists
    const [n] = await w.rows("select body, subject_user_id from notifications where title = 'Leave requested'")
    expect(n.subject_user_id).toBe(w.p.employee.userId)
    expect(n.body).toContain("{{subject}}")
    expect(n.body).not.toContain("Alpha")
    expect(n.body).not.toContain("Bravo")
    // a site with no supervisor: the office roles that cover it, minus anyone excepted from it
    const c = await w.loc("Charlie")
    const third = await makeMember(w.deps, w.tenant.id, "employee")
    await w.home(third, c)
    await w.ask(third, "2026-12-01", "2026-12-02")
    expect((await who("Leave requested")).includes(w.sup2.userId)).toBe(false)
    const forC = (await w.rows("select user_id from notifications where title = 'Leave requested' and subject_user_id = $1", [third.userId])).map((r) => r.user_id).sort()
    expect(forC).toEqual([w.p.admin.userId, w.p.owner.userId, rm.userId].sort())
    // homed at the site rm is excepted from (none supervised): rm is not told
    await ownerTenantQuery(w.tenant.id, "delete from location_supervisors where location_id = $1", [w.b])
    await w.ask(w.staff2, "2026-12-01", "2026-12-02")
    const forB = (await w.rows("select user_id from notifications where title = 'Leave requested' and subject_user_id = $1", [w.staff2.userId])).map((r) => r.user_id).sort()
    expect(forB).toEqual([w.p.admin.userId, w.p.owner.userId].sort())
    // the requester never gets their own request notice
    expect(forB).not.toContain(w.staff2.userId)
  })
})

describe("availability (FR-RS-41)", () => {
  test("GET is empty at first; PUT replaces the set atomically; an overnight window 22:00-06:00 stores two rows; invalid windows are 422 and change nothing", async () => {
    const w = await sites()
    const staff = w.p.employee
    expect(await w.ok("GET", "/v1/roster/availability", staff)).toEqual({ windows: [] })
    const put = await w.ok("PUT", "/v1/roster/availability", staff, { windows: [{ weekday: 1, from: "09:00", to: "12:00" }, { weekday: 5, from: "22:00", to: "06:00" }] })
    expect(put.windows).toEqual([{ weekday: 1, from: "09:00", to: "12:00" }, { weekday: 5, from: "22:00", to: "24:00" }, { weekday: 6, from: "00:00", to: "06:00" }]) // Friday night spills into Saturday
    expect(await w.rows("select weekday, from_time, to_time from roster_availability where user_id = $1 order by weekday", [staff.userId])).toEqual([
      { weekday: 1, from_time: "09:00", to_time: "12:00" }, { weekday: 5, from_time: "22:00", to_time: "24:00" }, { weekday: 6, from_time: "00:00", to_time: "06:00" },
    ])
    // Saturday night wraps to Sunday (6 -> 0); 22:00-00:00 is one row to 24:00
    const wrap = await w.ok("PUT", "/v1/roster/availability", staff, { windows: [{ weekday: 6, from: "23:00", to: "02:00" }, { weekday: 2, from: "20:00", to: "00:00" }] })
    expect(wrap.windows).toEqual([{ weekday: 0, from: "00:00", to: "02:00" }, { weekday: 2, from: "20:00", to: "24:00" }, { weekday: 6, from: "23:00", to: "24:00" }])
    // the stored (split) set can be sent back unchanged: idempotent
    expect((await w.ok("PUT", "/v1/roster/availability", staff, { windows: wrap.windows })).windows).toEqual(wrap.windows)
    // duplicates collapse
    expect((await w.ok("PUT", "/v1/roster/availability", staff, { windows: [{ weekday: 1, from: "09:00", to: "10:00" }, { weekday: 1, from: "09:00", to: "10:00" }] })).windows).toEqual([{ weekday: 1, from: "09:00", to: "10:00" }])
    // an invalid window anywhere in the body: 422, the old set stays
    const before = (await w.ok("GET", "/v1/roster/availability", staff)).windows
    const bad: Json[] = [
      { weekday: 7, from: "09:00", to: "10:00" }, { weekday: -1, from: "09:00", to: "10:00" }, { weekday: 1.5, from: "09:00", to: "10:00" },
      { weekday: 1, from: "9:00", to: "10:00" }, { weekday: 1, from: "09:00", to: "25:00" }, { weekday: 1, from: "24:00", to: "24:00" }, { weekday: 1, from: "10:00", to: "10:00" }, { weekday: 1, from: "10:60", to: "11:00" },
    ]
    for (const b of bad) expect(await w.code("PUT", "/v1/roster/availability", staff, { windows: [{ weekday: 3, from: "08:00", to: "09:00" }, b] }, 422), JSON.stringify(b)).toBe("invalid_availability")
    expect(await w.code("PUT", "/v1/roster/availability", staff, { windows: Array.from({ length: 51 }, (_, i) => ({ weekday: i % 7, from: "01:00", to: `0${(i % 8) + 2}:00` })) }, 422)).toBe("invalid_availability")
    expect((await w.ok("GET", "/v1/roster/availability", staff)).windows).toEqual(before)
    // nobody reads or writes another person's set: the route is the caller's own
    expect((await w.ok("GET", "/v1/roster/availability", w.staff2)).windows).toEqual([])
    expect((await w.ok("PUT", "/v1/roster/availability", w.staff2, { windows: [] })).windows).toEqual([])
    expect((await w.ok("GET", "/v1/roster/availability", staff)).windows).toEqual(before)
    // empty clears
    expect((await w.ok("PUT", "/v1/roster/availability", staff, { windows: [] })).windows).toEqual([])
  })

  test("a failed PUT after the delete rolls the old set back (atomic): a window the database refuses leaves the set intact", async () => {
    const w = await sites()
    const staff = w.p.employee
    await w.ok("PUT", "/v1/roster/availability", staff, { windows: [{ weekday: 2, from: "08:00", to: "09:00" }] })
    await ownerTenantQuery(w.tenant.id, "alter table roster_availability add constraint test_block check (weekday <> 4)")
    expect((await w.req("PUT", "/v1/roster/availability", staff, { windows: [{ weekday: 3, from: "08:00", to: "09:00" }, { weekday: 4, from: "08:00", to: "09:00" }] })).status).toBeGreaterThanOrEqual(500)
    await ownerTenantQuery(w.tenant.id, "alter table roster_availability drop constraint test_block")
    expect((await w.ok("GET", "/v1/roster/availability", staff)).windows).toEqual([{ weekday: 2, from: "08:00", to: "09:00" }])
  })
})

describe("migration 0046 SQL run for real", () => {
  const owner = new pg.Pool({ connectionString: process.env.TEST_DATABASE_OWNER_URL, max: 2 })
  afterAll(() => owner.end())
  const file = readFileSync(new URL("../../db/migrations/0046_leave_decision_note.sql", import.meta.url), "utf8")

  test("the real file replayed as app_owner WITHOUT tenant context over 3 tenants adds one nullable column and leaves every leave row as it was", async () => {
    const ids: string[] = []
    for (const label of ["A", "B", "C"]) {
      const id = randomUUID()
      const u = `u-${randomUUID()}`
      await owner.query("insert into tenants (id, slug, name) values ($1, $2, $3)", [id, `l-${id.slice(0, 8)}`, label])
      await owner.query(`insert into "user" (id, name, email) values ($1, $2, $3)`, [u, label, `${u}@example.test`])
      const c = await owner.connect()
      try {
        await c.query("begin")
        await c.query("select set_config('app.tenant_id', $1, true)", [id])
        const role = (await c.query("insert into roles (tenant_id, key, label, home, access) values ($1, 'staff', 'Staff', '/', '{}') returning id", [id])).rows[0].id
        await c.query("insert into memberships (tenant_id, user_id, role_id, status, joined_at) values ($1, $2, $3, 'active', now())", [id, u, role])
        for (const d of ["2026-12-01", "2026-12-10"]) await c.query("insert into leave_requests (tenant_id, user_id, from_date, to_date, kind, status, created_at, updated_at) values ($1, $2, $3, $3, 'annual', 'approved', now(), now())", [id, u, d])
        await c.query("commit")
      } finally {
        c.release()
      }
      ids.push(id)
    }
    const c = await owner.connect()
    try {
      await c.query("begin") // rolled back
      expect(String((await c.query("select current_setting('app.tenant_id', true) as t")).rows[0].t ?? "")).toBe("")
      await c.query("alter table leave_requests drop column decision_note") // the state before 0046
      for (const stmt of file.split("--> statement-breakpoint")) if (stmt.trim()) await c.query(stmt)
      expect(String((await c.query("select current_setting('app.tenant_id', true) as t")).rows[0].t ?? "")).toBe("")
      expect((await c.query("select is_nullable, data_type from information_schema.columns where table_name = 'leave_requests' and column_name = 'decision_note'")).rows).toEqual([{ is_nullable: "YES", data_type: "text" }])
      let seen = 0
      for (const id of ids) {
        await c.query("select set_config('app.tenant_id', $1, true)", [id])
        const rows = (await c.query("select status, decision_note from leave_requests")).rows
        expect(rows).toEqual([{ status: "approved", decision_note: null }, { status: "approved", decision_note: null }])
        seen += rows.length
      }
      expect(seen).toBe(6)
      await c.query("select set_config('app.tenant_id', '', true)")
      expect((await c.query("select count(*)::int as n from leave_requests")).rows[0].n).toBe(0)
    } finally {
      await c.query("rollback")
      c.release()
    }
  })

  test("the journal and the 0046 snapshot follow 0045", () => {
    const j = JSON.parse(readFileSync(new URL("../../db/migrations/meta/_journal.json", import.meta.url), "utf8")) as { entries: { idx: number; tag: string }[] }
    expect(j.entries.slice(45, 47).map((e) => [e.idx, e.tag])).toEqual([[45, "0045_member_lifecycle"], [46, "0046_leave_decision_note"]])
    const s = JSON.parse(readFileSync(new URL("../../db/migrations/meta/0046_snapshot.json", import.meta.url), "utf8")) as { prevId: string }
    const prev = JSON.parse(readFileSync(new URL("../../db/migrations/meta/0045_snapshot.json", import.meta.url), "utf8")) as { id: string }
    expect(s.prevId).toBe(prev.id)
  })
})
