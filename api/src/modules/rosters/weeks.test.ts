import { beforeEach, describe, expect, test } from "vitest"
import { resetDb, call } from "../../../test/harness"
import { MON, sites, world, type Json } from "./testkit"

// B8 Task 9: roster weeks (create and read) and their payload cut by scope.

beforeEach(resetDb)

const strip = (r: Response, body: string) => ({ status: r.status, ct: r.headers.get("content-type"), body: JSON.parse(body) as Json, headers: [...r.headers.entries()].filter(([k]) => !["x-request-id", "date"].includes(k)).sort() })
/** The parts of a problem response a prober could compare: everything but the per-request id. */
const shape = ({ status, ct, body, headers }: ReturnType<typeof strip>) => ({ status, ct, code: body.code, title: body.title, headers: headers.filter(([k]) => k !== "content-length") })

describe("create a week (FR-RS-10)", () => {
  test("a Monday creates an empty draft; a second create for the same Monday is 409 week_exists with the existing id", async () => {
    const w = await world()
    const a = await w.loc("Alpha")
    const created = await w.ok("POST", "/v1/roster/weeks", w.p.owner, { locationId: a, weekStart: MON }, 201)
    expect(created).toMatchObject({ locationId: a, weekStart: MON, status: "draft", publishedAt: null, version: 1 })
    expect(created.days).toHaveLength(7)
    const again = await w.fail("POST", "/v1/roster/weeks", w.p.owner, { locationId: a, weekStart: MON }, 409)
    expect(again).toMatchObject({ code: "week_exists", weekId: created.id })
    expect(await w.rows("select 1 from roster_weeks where location_id = $1", [a])).toHaveLength(1)
    expect((await w.rows("select action from roster_history where week_id = $1", [created.id])).map((r) => r.action)).toEqual(["week_created"])
    expect(await w.rows("select 1 from audit_events where action = 'roster.week_created'")).toHaveLength(1)
  })

  test("a non-Monday, an impossible date and a malformed one are 422 invalid_week_start", async () => {
    const w = await world()
    const a = await w.loc("Alpha")
    for (const weekStart of ["2026-11-03", "2026-02-30", "2026-11-0", "monday"]) expect((await w.fail("POST", "/v1/roster/weeks", w.p.owner, { locationId: a, weekStart }, 422)).code, weekStart).toBe("invalid_week_start")
    expect(await w.rows("select 1 from roster_weeks")).toHaveLength(0)
  })

  test("a supervisor creates weeks only at a granted site; another site, a missing one and a non-uuid are one identical 404", async () => {
    const w = await sites()
    expect((await w.ok("POST", "/v1/roster/weeks", w.p["location-supervisor"], { locationId: w.a, weekStart: "2026-11-09" }, 201)).locationId).toBe(w.a)
    const probes = [w.b, "00000000-0000-4000-8000-000000000000", "not-a-uuid", "' or 1=1 --"]
    const seen: ReturnType<typeof shape>[] = []
    for (const locationId of probes) {
      const r = await w.req("POST", "/v1/roster/weeks", w.p["location-supervisor"], { locationId, weekStart: "2026-11-16" })
      seen.push(shape(strip(r, await r.text())))
    }
    expect(seen[0]).toMatchObject({ status: 404, code: "not_found" })
    for (const s of seen) expect(s).toEqual(seen[0]) // header parity too
    expect(await w.rows("select 1 from roster_weeks where week_start = '2026-11-16'")).toHaveLength(0)
  })

  test("an archived location is 409 location_archived; staff and a read-only manager cannot create (403)", async () => {
    const w = await world()
    const a = await w.loc("Alpha")
    await w.ok("POST", `/v1/locations/${a}/archive`, w.p.owner)
    expect((await w.fail("POST", "/v1/roster/weeks", w.p.owner, { locationId: a, weekStart: MON }, 409)).code).toBe("location_archived")
    const b = await w.loc("Bravo")
    for (const who of [w.p.employee, w.p.manager]) expect((await w.req("POST", "/v1/roster/weeks", who, { locationId: b, weekStart: MON })).status).toBe(403)
  })
})

describe("read weeks (FR-RS-10, 11)", () => {
  test("AC-RS-01: a week returns 7 day columns, each person's own start and end, and the count against target (short and over)", async () => {
    const w = await sites()
    await w.ok("PUT", `/v1/shift-types/${w.ta}/targets`, w.p.owner, { targets: [{ weekday: 1, count: 3 }, { weekday: 2, count: 1 }] })
    await w.addOk(w.p.owner, w.wa, [{ date: MON, userIds: [w.p.employee.userId, w.staff2.userId, null], shiftTypeId: w.ta }])
    await w.addOk(w.p.owner, w.wa, [{ date: MON, userIds: [w.staff3.userId], shiftTypeId: w.ta, start: "10:00", end: "18:00" }])
    await w.addOk(w.p.owner, w.wa, [{ date: "2026-11-03", userIds: [w.p.employee.userId, w.staff2.userId], shiftTypeId: w.ta }])
    const r = await w.ok("GET", `/v1/roster/weeks/${w.wa}`, w.p["location-supervisor"])
    const week = r.weeks[0]
    expect(week.days.map((d: Json) => d.date)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"])
    expect(week.days[0]).toMatchObject({ count: 3, target: 3, short: 0, over: 0 }) // three named people, the open shift does not count
    expect(week.days[0].shiftIds).toHaveLength(4)
    expect(week.days[1]).toMatchObject({ count: 2, target: 1, short: 0, over: 1 })
    expect(week.days[2]).toMatchObject({ count: 0, target: 0 })
    const own = r.shifts.find((s: Json) => s.userId === w.staff3.userId)
    expect(own).toMatchObject({ start: "10:00", end: "18:00", date: MON })
    expect(r.shifts.filter((s: Json) => s.userId === w.p.employee.userId && s.date === MON)[0]).toMatchObject({ start: "08:00", end: "16:00" })
    // a short day
    await w.ok("PUT", `/v1/shift-types/${w.ta}/targets`, w.p.owner, { targets: [{ weekday: 1, count: 5 }] })
    expect((await w.ok("GET", `/v1/roster/weeks/${w.wa}`, w.p.owner)).weeks[0].days[0]).toMatchObject({ count: 3, target: 5, short: 2, over: 0 })
  })

  test("the list honours locationId, anchor and view; view=month spans the whole calendar month; an unknown view or a bad range is 422", async () => {
    const w = await sites()
    for (const ws of ["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-30", "2026-12-07"]) await w.week(w.p.owner, w.a, ws)
    const names = async (q: string) => ((await w.ok("GET", `/v1/roster/weeks?${q}`, w.p.owner)).weeks as Json[]).filter((x) => x.locationId === w.a).map((x) => x.weekStart)
    expect(await names(`locationId=${w.a}&from=2026-11-04&view=week`)).toEqual(["2026-11-02"])
    expect(await names(`locationId=${w.a}&from=2026-11-04&view=fortnight`)).toEqual(["2026-11-02", "2026-11-09"])
    const month = await w.ok("GET", `/v1/roster/weeks?locationId=${w.a}&from=2026-11-15&view=month`, w.p.owner)
    expect(month.range).toEqual({ from: "2026-11-01", to: "2026-11-30", view: "month" })
    expect(month.weeks.map((x: Json) => x.weekStart)).toEqual(["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-30"]) // the week of 26 Oct holds 1 Nov, so it belongs to the month view; 7 Dec does not
    expect((await w.ok("GET", `/v1/roster/weeks?locationId=${w.a}&from=2026-11-04&view=day`, w.p.owner)).range).toEqual({ from: "2026-11-04", to: "2026-11-04", view: "day" })
    expect((await w.fail("GET", "/v1/roster/weeks?view=year", w.p.owner, undefined, 422)).code).toBe("invalid_view")
    expect((await w.fail("GET", "/v1/roster/weeks?from=2026-02-30", w.p.owner, undefined, 422)).code).toBe("invalid_range")
    expect((await w.fail("GET", "/v1/roster/weeks?from=2026-01-01&to=2026-12-31", w.p.owner, undefined, 422)).code).toBe("invalid_range")
  })

  test("a supervisor's payload holds no other location and members come without a home location (JSON.stringify check)", async () => {
    const w = await sites()
    await w.ok("PUT", `/v1/members/${w.p.employee.userId}/home-location`, w.p.owner, { locationId: w.a })
    await w.ok("PUT", `/v1/members/${w.staff2.userId}/home-location`, w.p.owner, { locationId: w.b })
    await w.addOk(w.p.owner, w.wa, [{ date: MON, userIds: [w.p.employee.userId], shiftTypeId: w.ta }])
    await w.addOk(w.p.owner, w.wb, [{ date: MON, userIds: [w.staff2.userId], shiftTypeId: w.tb }])
    for (const path of ["/v1/roster/weeks?from=2026-11-02", `/v1/roster/weeks/${w.wa}`]) {
      const r = await w.req("GET", path, w.p["location-supervisor"])
      const text = await r.text()
      expect(r.status).toBe(200)
      for (const hidden of [w.b, w.wb, w.tb, w.staff2.userId, "Bravo", "Cian Doyle", w.sup2.userId]) expect(text.includes(hidden), `${path} leaks ${hidden}`).toBe(false)
      const body = JSON.parse(text) as Json
      expect(body.weeks.map((x: Json) => x.id)).toEqual([w.wa])
      expect(body.shiftTypes.every((t: Json) => t.locationId === w.a)).toBe(true)
      expect(body.members.map((m: Json) => m.userId)).toContain(w.p.employee.userId)
      for (const m of body.members) expect(m.homeLocationId, "a supervisor never sees a home location").toBeNull()
    }
    // an office role sees both sites and a home it can see
    const office = await w.ok("GET", "/v1/roster/weeks?from=2026-11-02", w.p["roster-manager"])
    expect(office.weeks.map((x: Json) => x.id).sort()).toEqual([w.wa, w.wb].sort())
    expect(office.members.find((m: Json) => m.userId === w.staff2.userId).homeLocationId).toBe(w.b)
  })

  test("an office role with an except list never sees the excepted site in any array", async () => {
    const w = await sites()
    await w.ok("PUT", `/v1/roster/office-limits/${w.p["roster-manager"].userId}`, w.p.owner, { except: [w.b] })
    await w.addOk(w.p.owner, w.wb, [{ date: MON, userIds: [w.staff2.userId], shiftTypeId: w.tb }])
    const r = await w.req("GET", "/v1/roster/weeks?from=2026-11-02", w.p["roster-manager"])
    const text = await r.text()
    expect(r.status).toBe(200)
    for (const hidden of [w.b, w.wb, w.tb, "Bravo"]) expect(text.includes(hidden), hidden).toBe(false)
    expect((await w.req("GET", `/v1/roster/weeks/${w.wb}`, w.p["roster-manager"])).status).toBe(404)
  })

  test("GET one week: a hidden week, a missing one and a non-uuid id are one identical 404 (header parity); staff get an empty list", async () => {
    const w = await sites()
    const probes = [w.wb, "00000000-0000-4000-8000-000000000000", "nope", "1; drop table roster_weeks"]
    const seen: ReturnType<typeof shape>[] = []
    for (const id of probes) {
      const r = await w.req("GET", `/v1/roster/weeks/${encodeURIComponent(id)}`, w.p["location-supervisor"])
      seen.push(shape(strip(r, await r.text())))
    }
    expect(seen[0]).toMatchObject({ status: 404, code: "not_found" })
    for (const s of seen) expect(s).toEqual(seen[0])
    const list = await w.ok("GET", "/v1/roster/weeks?from=2026-11-02", w.p.employee)
    expect(list.weeks).toEqual([])
    expect((await w.req("GET", `/v1/roster/weeks/${w.wa}`, w.p.employee)).status).toBe(404)
    // locationId filter: a site the supervisor cannot see is the same plain 404
    const hiddenList = await w.req("GET", `/v1/roster/weeks?locationId=${w.b}`, w.p["location-supervisor"])
    expect(hiddenList.status).toBe(404)
    expect(((await hiddenList.json()) as Json).code).toBe("not_found")
  })

  test("without a session the week routes answer like every route (401)", async () => {
    const w = await sites()
    expect((await call(w.app, "GET", `/v1/roster/weeks/${w.wa}`, { tenant: "acme" })).status).toBe(401)
    expect((await call(w.app, "POST", "/v1/roster/weeks", { tenant: "acme", body: { locationId: w.a, weekStart: MON } })).status).toBe(401)
  })
})

describe("the member list is bounded (B8 T13 carry)", () => {
  test("an office read caps the pick list at 500 with membersTruncated; people ON a shown shift are always included; a small tenant is not truncated", async () => {
    const w = await sites()
    const small = await w.ok("GET", `/v1/roster/weeks/${w.wa}`, w.p.owner)
    expect(small.membersTruncated).toBe(false)
    await w.addOk(w.p.owner, w.wa, [{ date: MON, userIds: [w.p.employee.userId], shiftTypeId: w.ta }])
    // 520 more active people homed nowhere (an office role sees them in the pick list)
    await w.rows(`insert into "user" (id, name, email, email_verified, created_at, updated_at) select 'bulk_' || lpad(g::text, 4, '0'), 'Bulk ' || g, 'bulk' || g || '@example.com', true, now(), now() from generate_series(1, 520) g`)
    await w.rows(
      `insert into memberships (tenant_id, user_id, role_id, status, joined_at) select $1, 'bulk_' || lpad(g::text, 4, '0'), (select id from roles where tenant_id = $1 and key = 'employee'), 'active', now() from generate_series(1, 520) g`,
      [w.tenant.id],
    )
    const big = await w.ok("GET", `/v1/roster/weeks/${w.wa}`, w.p.owner)
    expect(big.membersTruncated).toBe(true)
    expect(big.members.length).toBeLessThanOrEqual(501) // 500 others plus the one on the shift
    expect(big.members.map((m: Json) => m.userId)).toContain(w.p.employee.userId) // the person on the shift is always there
    expect(big.shifts).toHaveLength(1)
    const list = await w.ok("GET", `/v1/roster/weeks?locationId=${w.a}&from=${MON}`, w.p.owner)
    expect(list.membersTruncated).toBe(true)
    // a supervisor's pick list is only people homed at their site: nothing to truncate
    expect((await w.ok("GET", `/v1/roster/weeks/${w.wa}`, w.p["location-supervisor"])).membersTruncated).toBe(false)
  })
})
