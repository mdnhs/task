import { beforeEach, describe, expect, test } from "vitest"
import { dayColumns, type RosterShift, type RosterWeek, type ShiftTemplate, type StaffingTarget } from "@opsdesk/domain/rosters"
import { resetDb } from "../../../test/harness"
import { fakeCacheStamp, fakeClock } from "../../../test/fakes"
import { makeReadModelCache } from "../read-models"
import { MON, sites, type Json, type Who } from "./testkit"

// B8 Task 14: coverage per location and day (FR-RS-12), scope-cut, derived (F17) and cached under the tenant stamp (F18).

beforeEach(resetDb)

type W = Awaited<ReturnType<typeof sites>>
const version = async (w: W, weekId: string): Promise<number> => Number((await w.rows("select version from roster_weeks where id = $1", [weekId]))[0].version)
const coverage = (w: W, who: Who, q = "") => w.ok("GET", `/v1/roster/coverage${q}`, who)
const Q = `?from=${MON}&to=2026-11-08`

/** Alpha: target 3 on Monday, 1 on Tuesday. Monday has two people and one open shift; Tuesday has two people. */
async function alpha(w: W) {
  await w.ok("PUT", `/v1/shift-types/${w.ta}/targets`, w.p.owner, { targets: [{ weekday: 1, count: 3 }, { weekday: 2, count: 1 }] })
  await w.addOk(w.p.owner, w.wa, [{ date: MON, userIds: [w.p.employee.userId, w.staff2.userId, null], shiftTypeId: w.ta }, { date: "2026-11-03", userIds: [w.p.employee.userId, w.staff2.userId], shiftTypeId: w.ta }])
}

describe("GET /v1/roster/coverage (FR-RS-12)", () => {
  test("coverage for a supervisor lists granted locations only; short and over equal the domain dayColumns; open shifts count as short and are counted", async () => {
    const w = await sites()
    await alpha(w)
    await w.addOk(w.p.owner, w.wb, [{ date: MON, userIds: [w.staff3.userId], shiftTypeId: w.tb }])
    const sup = w.p["location-supervisor"]
    const out = await coverage(w, sup, Q)
    expect(out.locations.map((l: Json) => l.name)).toEqual(["Alpha"])
    const days = out.locations[0].days as Json[]
    expect(days).toHaveLength(7)
    const mon = days.find((d) => d.date === MON)!
    expect(mon).toMatchObject({ weekId: w.wa, status: "draft", staff: 2, target: 3, short: 1, over: 0, open: 1 })
    expect(days.find((d) => d.date === "2026-11-03")).toMatchObject({ staff: 2, target: 1, short: 0, over: 1, open: 0 })
    expect(days.find((d) => d.date === "2026-11-04")).toMatchObject({ staff: 0, target: 0, short: 0, over: 0, open: 0 })
    // the same numbers as the domain function over the same rows
    const wk = (await w.ok("GET", `/v1/roster/weeks/${w.wa}`, w.p.owner)) as Json
    const week: RosterWeek = { id: w.wa, locationId: w.a, weekStart: MON, status: "draft", publishedAt: null, publishedBy: null, autoRepeatDays: null }
    const shifts: RosterShift[] = wk.shifts.map((s: Json) => ({ id: s.id, weekId: s.weekId, locationId: s.locationId, date: s.date, personId: s.userId, templateId: s.shiftTypeId, role: s.role, start: s.start, end: s.end, unpaidBreakMin: s.unpaidBreakMin, confirmedAt: null }))
    const templates: ShiftTemplate[] = wk.shiftTypes.map((t: Json) => ({ id: t.id, locationId: t.locationId, name: t.name, start: t.start, end: t.end, unpaidBreakMin: t.unpaidBreakMin, role: t.role, requires: t.requires }))
    const targets: StaffingTarget[] = wk.shiftTypes.flatMap((t: Json) => t.targets.map((x: Json) => ({ locationId: t.locationId, templateId: t.id, weekday: x.weekday, count: x.count })))
    const domain = dayColumns(week, shifts, targets, templates)
    expect(days.map((d) => [d.date, d.staff, d.target, d.short, d.over])).toEqual(domain.map((d) => [d.date, d.count, d.target, d.short, d.over]))
    expect(domain.find((d) => d.date === MON)).toMatchObject({ count: 2, target: 3, short: 1 }) // the open shift is not a person: it is the missing one
    // a supervisor never learns Bravo exists: no name, id or count anywhere
    for (const secret of ["Bravo", w.b, w.wb, w.tb]) expect(JSON.stringify(out), secret).not.toContain(secret)
  })

  test("a location the caller cannot see, a missing one and a non-uuid id are one identical 404; staff (no location view) get an empty list; a read-only manager sees every site", async () => {
    const w = await sites()
    await alpha(w)
    const sup = w.p["location-supervisor"]
    const seen: unknown[] = []
    for (const id of [w.b, "00000000-0000-4000-8000-000000000000", "nope", "1' or '1'='1"]) {
      const r = await w.req("GET", `/v1/roster/coverage?locationId=${encodeURIComponent(id)}`, sup)
      seen.push([r.status, ((await r.json()) as Json).code, [...r.headers.entries()].filter(([k]) => !["x-request-id", "date", "content-length"].includes(k)).sort()])
    }
    expect((seen[0] as unknown[])[0]).toBe(404)
    for (const s of seen) expect(s).toEqual(seen[0])
    expect((await coverage(w, w.p.employee, Q)).locations).toEqual([])
    expect((await coverage(w, w.p.manager, Q)).locations.map((l: Json) => l.name)).toEqual(["Alpha", "Bravo"])
    expect((await coverage(w, sup, `${Q}&locationId=${w.a}`)).locations.map((l: Json) => l.name)).toEqual(["Alpha"])
  })

  test("an office role with an except list gets none of the excepted site", async () => {
    const w = await sites()
    await w.ok("PUT", `/v1/roster/office-limits/${w.p["roster-manager"].userId}`, w.p.owner, { except: [w.b] })
    const out = await coverage(w, w.p["roster-manager"], Q)
    expect(out.locations.map((l: Json) => l.name)).toEqual(["Alpha"])
    expect(JSON.stringify(out)).not.toContain("Bravo")
    expect((await w.req("GET", `/v1/roster/coverage?locationId=${w.b}`, w.p["roster-manager"])).status).toBe(404)
  })

  test("the range cuts days (a week is only partly inside), a location with no week in range is listed with no days, an archived one only when it has weeks; bad ranges are 422 invalid_range", async () => {
    const w = await sites()
    await alpha(w)
    const part = await coverage(w, w.p.owner, "?from=2026-11-03&to=2026-11-04")
    expect(part.locations.find((l: Json) => l.name === "Alpha").days.map((d: Json) => d.date)).toEqual(["2026-11-03", "2026-11-04"])
    const none = await coverage(w, w.p.owner) // default: today (16 Nov) for 7 days: no week exists there
    expect(none).toMatchObject({ from: "2026-11-16", to: "2026-11-22" })
    expect(none.locations.map((l: Json) => [l.name, l.days.length])).toEqual([["Alpha", 0], ["Bravo", 0]])
    await w.rows("delete from roster_shifts where location_id = $1", [w.b])
    await w.rows("delete from roster_weeks where location_id = $1", [w.b])
    await w.ok("POST", `/v1/locations/${w.b}/archive`, w.p.owner)
    expect((await coverage(w, w.p.owner, Q)).locations.map((l: Json) => l.name)).toEqual(["Alpha"])
    for (const q of ["?from=2026-02-30", "?from=2026-11-10&to=2026-11-09", "?from=2026-01-01&to=2026-12-31", "?to=nope"]) expect((await w.fail("GET", `/v1/roster/coverage${q}`, w.p.owner, undefined, 422)).code, q).toBe("invalid_range")
  })

  test("it is derived, not stored (F17): a change is visible at once through a cache that is busted by the write, and publishing moves the status", async () => {
    const stamp = fakeCacheStamp()
    const clock = fakeClock()
    const cache = makeReadModelCache(stamp, { clock })
    const w = await sites({ readModelCache: cache, clock })
    await alpha(w)
    const first = await coverage(w, w.p.owner, Q)
    expect(first.locations[0].days.find((d: Json) => d.date === MON)).toMatchObject({ staff: 2, short: 1, status: "draft" })
    expect(cache.keys().some((k) => k.includes(":coverage:"))).toBe(true) // it IS cached
    const before = await stamp.get(w.tenant.id)
    await w.ok("POST", `/v1/roster/weeks/${w.wa}/publish`, w.p.owner, { version: await version(w, w.wa) })
    expect(await stamp.get(w.tenant.id)).toBeGreaterThan(before) // the publish bumped the tenant stamp
    expect(cache.keys().filter((k) => k.includes(":coverage:"))).toEqual([]) // and dropped this instance's entry
    const after = await coverage(w, w.p.owner, Q)
    expect(after.locations[0].days.find((d: Json) => d.date === MON)).toMatchObject({ status: "published", staff: 2, short: 1 })
    // two callers with different scopes never share an entry, even with the same scope kind (two supervisors of different sites)
    expect((await coverage(w, w.p["location-supervisor"], Q)).locations.map((l: Json) => l.name)).toEqual(["Alpha"])
    expect((await coverage(w, w.sup2, Q)).locations.map((l: Json) => l.name)).toEqual(["Bravo"])
    expect((await coverage(w, w.p.owner, Q)).locations.map((l: Json) => l.name)).toEqual(["Alpha", "Bravo"])
  })
})
