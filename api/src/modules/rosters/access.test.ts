import { beforeEach, describe, expect, test } from "vitest"
import { resetDb } from "../../../test/harness"
import { sites, type Json } from "./testkit"

// B8 Task 19b (ruling AI1): the `access` object of the week and my-roster payloads, computed ONLY from the existing authority (rosterAccess + weekEditGate).

beforeEach(resetDb)

type W = Awaited<ReturnType<typeof sites>>
const publish = async (w: W, weekId: string): Promise<void> => {
  const version = Number((await w.rows("select version from roster_weeks where id = $1", [weekId]))[0].version)
  await w.ok("POST", `/v1/roster/weeks/${weekId}/publish`, w.p.owner, { version })
}
const weekAccess = async (w: W, who: Parameters<W["ok"]>[2], weekId: string): Promise<Json> => (await w.ok("GET", `/v1/roster/weeks/${weekId}`, who)).weeks[0].access
const open = { level: "supervisor", canEdit: true, locked: false, lockReason: null }

describe("week payload access (AI1)", () => {
  test("a draft week: owner (office) and the supervisor of the location may edit; no lock", async () => {
    const w = await sites()
    expect(await weekAccess(w, w.p.owner, w.wa)).toEqual({ ...open, level: "office" })
    expect(await weekAccess(w, w.p["roster-manager"], w.wa)).toEqual({ ...open, level: "office" })
    expect(await weekAccess(w, w.p["location-supervisor"], w.wa)).toEqual(open)
    expect((await w.ok("GET", `/v1/roster/weeks?locationId=${w.a}&from=2026-11-02`, w.p["location-supervisor"])).weeks[0].access).toEqual(open)
  })

  test("a published week: a supervisor is locked (roster_locked, cannot edit), an office role may edit but must give a reason", async () => {
    const w = await sites()
    await publish(w, w.wa)
    expect(await weekAccess(w, w.p["location-supervisor"], w.wa)).toEqual({ level: "supervisor", canEdit: false, locked: true, lockReason: "roster_locked" })
    expect(await weekAccess(w, w.p.owner, w.wa)).toEqual({ level: "office", canEdit: true, locked: false, lockReason: "reason_required" })
    // the draft week of the other site is untouched
    expect(await weekAccess(w, w.p.owner, w.wb)).toEqual({ ...open, level: "office" })
  })

  test("a supervisor of ANOTHER location cannot read this week at all (404, nothing to carry an access object)", async () => {
    const w = await sites()
    await w.fail("GET", `/v1/roster/weeks/${w.wa}`, w.sup2, undefined, 404)
    expect((await w.ok("GET", `/v1/roster/weeks?from=2026-11-02`, w.sup2)).weeks.map((x: Json) => x.locationId)).toEqual([w.b])
  })

  test("a read-only manager sees the week with level null, cannot edit and is not locked (forbidden)", async () => {
    const w = await sites()
    await publish(w, w.wa)
    const expected = { level: null, canEdit: false, locked: false, lockReason: "forbidden" }
    expect(await weekAccess(w, w.p.manager, w.wa)).toEqual(expected)
    expect(await weekAccess(w, w.p.manager, w.wb)).toEqual(expected)
  })

  test("the list carries a top-level access for an empty range too (draft semantics), and publish/create answers carry the week's access", async () => {
    const w = await sites()
    const empty = await w.ok("GET", "/v1/roster/weeks?locationId=" + w.a + "&from=2027-03-01", w.p["location-supervisor"])
    expect(empty.weeks).toEqual([])
    expect(empty.access).toEqual(open)
    expect((await w.ok("GET", "/v1/roster/weeks?from=2027-03-01", w.p.manager)).access).toEqual({ level: null, canEdit: false, locked: false, lockReason: "forbidden" })
    const created = await w.ok("POST", "/v1/roster/weeks", w.p["location-supervisor"], { locationId: w.a, weekStart: "2026-11-09" }, 201)
    expect(created.access).toEqual(open)
    const published = await w.ok("POST", `/v1/roster/weeks/${created.id}/publish`, w.p.owner, { version: created.version })
    expect(published.week.access).toEqual({ level: "office", canEdit: true, locked: false, lockReason: "reason_required" })
  })

  test("access is not new authority: what it says matches what the write does (supervisor locked => 403 roster_locked; office needs a reason; open => 201)", async () => {
    const w = await sites()
    await publish(w, w.wa)
    const shift = [{ date: "2026-11-03", userIds: [w.p.employee.userId], shiftTypeId: w.ta }]
    expect((await w.fail("POST", `/v1/roster/weeks/${w.wa}/shifts`, w.p["location-supervisor"], { shifts: shift }, 403)).code).toBe("roster_locked")
    expect((await w.fail("POST", `/v1/roster/weeks/${w.wa}/shifts`, w.p.owner, { shifts: shift }, 422)).code).toBe("reason_required")
    await w.ok("POST", `/v1/roster/weeks/${w.wb}/shifts`, w.sup2, { shifts: [{ ...shift[0], shiftTypeId: w.tb }] }, 201)
  })
})

describe("my roster access (AI1)", () => {
  test("every role gets an access object cut from the same authority; plain staff: level null, canEdit false", async () => {
    const w = await sites()
    const q = "?from=2026-11-01&to=2026-11-30"
    const staff = { level: null, canEdit: false, locked: false, lockReason: "forbidden" }
    expect((await w.ok("GET", `/v1/roster/mine${q}`, w.p.employee)).access).toEqual(staff)
    expect((await w.ok("GET", `/v1/roster/mine${q}`, w.p.manager)).access).toEqual(staff)
    // my roster only shows PUBLISHED weeks: a supervisor is locked there, an office role needs a reason
    expect((await w.ok("GET", `/v1/roster/mine${q}`, w.p["location-supervisor"])).access).toEqual({ level: "supervisor", canEdit: false, locked: true, lockReason: "roster_locked" })
    expect((await w.ok("GET", `/v1/roster/mine${q}`, w.p.owner)).access).toEqual({ level: "office", canEdit: true, locked: false, lockReason: "reason_required" })
  })
})
