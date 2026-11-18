import pg from "pg"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { fakeCacheStamp, fakeClock } from "../../../test/fakes"
import { resetDb } from "../../../test/harness"
import { makeReadModelCache } from "../read-models"
import { sites, type Json, type Who } from "./testkit"

// B8 Task 14: roster items in the attention feed, the dashboard count and Today (FR-RS-12, 33, 40; Review Focus 1). The clock is 2026-11-16T09:00Z (a Monday, Dublin = UTC+0).

const rulesReads = vi.hoisted(() => ({ n: 0 }))
vi.mock("./rules", async (orig) => {
  const m = await orig<typeof import("./rules")>()
  return { ...m, readRules: (...a: Parameters<typeof m.readRules>) => ((rulesReads.n += 1), m.readRules(...a)) }
})

beforeEach(resetDb)

type W = Awaited<ReturnType<typeof sites>>
const feed = async (w: W, who: Who, q = "?limit=100"): Promise<Json> => w.ok("GET", `/v1/attention${q}`, who)
const kinds = (f: Json, kind: string): Json[] => (f.items as Json[]).filter((i) => i.kind === kind)
const version = async (w: W, weekId: string): Promise<number> => Number((await w.rows("select version from roster_weeks where id = $1", [weekId]))[0].version)
const publish = async (w: W, weekId: string, who: Who = w.p.owner): Promise<void> => void (await w.ok("POST", `/v1/roster/weeks/${weekId}/publish`, who, { version: await version(w, weekId) }))
const NEXT = "2026-11-16" // the Monday of the clock's day
/** The location supervisor may read the attention feed in these tests (the template role does not carry it: see the report). */
async function supervisorsSeeFeed(w: W) {
  await w.rows(`update roles set access = access || '{"attention":"read"}'::jsonb where tenant_id = $1 and key = 'location-supervisor'`, [w.tenant.id])
}
/** A published week at each site starting today with one open shift in the next days (Alpha Wed, Bravo Thu). */
async function openShifts(w: W) {
  const a = await w.week(w.p.owner, w.a, NEXT)
  const b = await w.week(w.p.owner, w.b, NEXT)
  const sa = await w.addOk(w.p.owner, a, [{ date: "2026-11-18", userIds: [null], shiftTypeId: w.ta }])
  const sb = await w.addOk(w.p.owner, b, [{ date: "2026-11-19", userIds: [null], shiftTypeId: w.tb }])
  await publish(w, a)
  await publish(w, b)
  return { a, b, sa: sa.shifts[0] as Json, sb: sb.shifts[0] as Json }
}

describe("who sees which roster item (Review Focus 1)", () => {
  test("a supervisor's feed names no other location; an office role with an except list gets none of the excepted site; the owner sees both", async () => {
    const w = await sites()
    await supervisorsSeeFeed(w)
    await w.ok("PUT", `/v1/roster/office-limits/${w.p["roster-manager"].userId}`, w.p.owner, { except: [w.b] })
    const { sa, sb } = await openShifts(w)
    const sup = await feed(w, w.p["location-supervisor"])
    expect(kinds(sup, "roster_open_shift").map((i) => i.rosterRef)).toEqual([sa.id])
    expect(kinds(sup, "roster_open_shift")[0]).toMatchObject({ title: "Open shift on 2026-11-18 08:00-16:00 at Alpha", taskId: null, reportId: null, ref: null, ownerId: null })
    for (const secret of ["Bravo", w.b, sb.id, w.wb, w.tb]) expect(JSON.stringify(sup), secret).not.toContain(secret)
    const rm = await feed(w, w.p["roster-manager"])
    expect(kinds(rm, "roster_open_shift").map((i) => i.rosterRef)).toEqual([sa.id])
    for (const secret of ["Bravo", w.b, sb.id]) expect(JSON.stringify(rm), secret).not.toContain(secret)
    const owner = await feed(w, w.p.owner)
    expect(kinds(owner, "roster_open_shift").map((i) => i.rosterRef)).toEqual([sa.id, sb.id])
  })

  test("plain staff have no attention feed (403): the open shifts they could claim reach them as Today's `openShifts` count: published weeks at the site they are homed at or rostered at that week (claims rules AF1), never another site or a draft week", async () => {
    const w = await sites()
    const { sa, sb, a } = await openShifts(w)
    const openFor = async (who: Who) => {
      w.clock.advance({ minutes: 1 }) // the 30 s read-model cache
      return (await w.ok("GET", "/v1/today", who)).openShifts
    }
    await w.ok("GET", "/v1/attention", w.p.employee, undefined, 403) // staff have no feed
    expect(await openFor(w.p.employee)).toBe(0) // located nowhere yet
    await w.ok("PUT", `/v1/members/${w.p.employee.userId}/home-location`, w.p.owner, { locationId: w.a })
    expect(await openFor(w.p.employee)).toBe(1) // Alpha's, not Bravo's
    expect(JSON.stringify(await w.ok("GET", "/v1/today", w.p.employee))).not.toContain(sb.id)
    // rostered at Bravo that week (a cross-site loan) is located there too
    await w.rows("insert into roster_shifts (tenant_id, week_id, location_id, shift_type_id, role, user_id, date, start_time, end_time, start_at, end_at, created_at, updated_at) select tenant_id, week_id, location_id, shift_type_id, role, $2, '2026-11-20', '08:00', '16:00', '2026-11-20T08:00Z', '2026-11-20T16:00Z', now(), now() from roster_shifts where id = $1", [sb.id, w.p.employee.userId])
    expect(await openFor(w.p.employee)).toBe(2)
    // somebody else, located nowhere, sees none
    expect(await openFor(w.staff2)).toBe(0)
    // a draft week is shown to staff nowhere
    await w.rows("update roster_weeks set status = 'draft' where id = $1", [a])
    expect(await openFor(w.p.employee)).toBe(1)
    expect(sa.id).toBeTruthy()
  })

  test("open shifts: published weeks only, from now to 7 days ahead, at sites the caller sees; a draft week's, a later one's and an ended one's are not items", async () => {
    const w = await sites()
    const a = await w.week(w.p.owner, w.a, NEXT)
    await w.addOk(w.p.owner, a, [{ date: "2026-11-16", userIds: [null], shiftTypeId: w.ta, start: "06:00", end: "08:00" }, { date: "2026-11-16", userIds: [null], shiftTypeId: w.ta, start: "20:00", end: "23:00" }, { date: "2026-11-18", userIds: [null], shiftTypeId: w.ta }])
    expect(kinds(await feed(w, w.p.owner), "roster_open_shift")).toEqual([]) // a draft week: nothing
    await publish(w, a)
    const nextWeek = await w.week(w.p.owner, w.a, "2026-11-23")
    await w.addOk(w.p.owner, nextWeek, [{ date: "2026-11-23", userIds: [null], shiftTypeId: w.ta }, { date: "2026-11-24", userIds: [null], shiftTypeId: w.ta }])
    await publish(w, nextWeek)
    const items = kinds(await feed(w, w.p.owner), "roster_open_shift")
    expect(items.map((i) => i.title)).toEqual(["Open shift on 2026-11-16 20:00-23:00 at Alpha", "Open shift on 2026-11-18 08:00-16:00 at Alpha", "Open shift on 2026-11-23 08:00-16:00 at Alpha"]) // 06:00-08:00 today is over, 20:00 tonight is not; 23 Nov is exactly 7 days away, 24 Nov is 8
    await w.rows("update roster_shifts set user_id = $1 where id = $2", [w.p.employee.userId, items[1].rosterRef]) // taken (straight in the database: the 30 s read-model cache has to expire)
    w.clock.advance({ minutes: 1 })
    expect(kinds(await feed(w, w.p.owner), "roster_open_shift").map((i) => i.title)).toEqual(["Open shift on 2026-11-16 20:00-23:00 at Alpha", "Open shift on 2026-11-23 08:00-16:00 at Alpha"])
  })

  test("unconfirmed shifts: the person's own upcoming shifts of published weeks, until they confirm; staff see the count on Today", async () => {
    const w = await sites()
    const a = await w.week(w.p.owner, w.a, NEXT)
    const added = await w.addOk(w.p.owner, a, [{ date: "2026-11-17", userIds: [w.p.owner.userId, w.p.employee.userId], shiftTypeId: w.ta }])
    const draftOnly = await w.week(w.p.owner, w.b, NEXT)
    await w.addOk(w.p.owner, draftOnly, [{ date: "2026-11-17", userIds: [w.p.owner.userId], shiftTypeId: w.tb, start: "20:00", end: "23:00" }])
    expect(kinds(await feed(w, w.p.owner), "roster_unconfirmed")).toEqual([]) // drafts are not "changed shifts" yet
    await publish(w, a)
    const mine = added.shifts.find((s: Json) => s.userId === w.p.owner.userId)
    const items = kinds(await feed(w, w.p.owner), "roster_unconfirmed")
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ rosterRef: mine.id, title: "Confirm your shift on 2026-11-17 08:00-16:00 at Alpha", ownerId: w.p.owner.userId })
    expect(JSON.stringify(items)).not.toContain(w.p.employee.userId) // not the co-worker's
    const today = await w.ok("GET", "/v1/today", w.p.employee)
    expect(today.roster).toBe(1)
    await w.ok("POST", `/v1/roster/shifts/${mine.id}/confirm`, w.p.owner)
    expect(kinds(await feed(w, w.p.owner), "roster_unconfirmed")).toEqual([])
    expect((await w.ok("GET", "/v1/today", w.p.owner)).roster).toBe(0)
    // an office edit clears the person's confirmation again: the item is back
    await w.ok("PATCH", `/v1/roster/shifts/${mine.id}`, w.p.owner, { version: mine.version, patch: { start: "09:00" }, reason: "Venue request" })
    expect(kinds(await feed(w, w.p.owner), "roster_unconfirmed")).toHaveLength(1)
    expect((await w.ok("GET", "/v1/today", w.p.owner)).roster).toBe(1)
  })

  test("pending change requests are for office roles (a supervisor raised them, so none); pending leave is for the deciders of the person's home site and office, never the requester", async () => {
    const w = await sites()
    await supervisorsSeeFeed(w)
    const a = await w.week(w.p.owner, w.a, NEXT)
    const added = await w.addOk(w.p.owner, a, [{ date: "2026-11-18", userIds: [w.p.employee.userId], shiftTypeId: w.ta }])
    await publish(w, a)
    const sup = w.p["location-supervisor"]
    await w.ok("POST", `/v1/roster/shifts/${added.shifts[0].id}/change-requests`, sup, { patch: { start: "09:00" }, reason: "Venue opens late" }, 201)
    expect(kinds(await feed(w, sup), "roster_change_request")).toEqual([])
    // a request somebody ELSE raised (the office role, on the same shift of another week) is not the supervisor's to decide either
    const b = await w.week(w.p.owner, w.a, "2026-11-23")
    const other = await w.addOk(w.p.owner, b, [{ date: "2026-11-24", userIds: [w.p.employee.userId], shiftTypeId: w.ta }])
    await publish(w, b)
    await w.ok("POST", `/v1/roster/shifts/${other.shifts[0].id}/change-requests`, w.p.owner, { patch: { start: "09:00" }, reason: "Office asks" }, 201)
    expect(kinds(await feed(w, sup), "roster_change_request")).toEqual([])
    const office = kinds(await feed(w, w.p.owner), "roster_change_request")
    expect(office).toHaveLength(1) // the one the OFFICE raised is not its own to decide (self_decision)
    expect(office[0]).toMatchObject({ title: "Change request for the shift on 2026-11-18 at Alpha", ownerId: sup.userId, reason: "Waiting for a decision" })
    expect(kinds(await feed(w, w.p["roster-manager"]), "roster_change_request")).toHaveLength(2)
    // leave of Cian, homed at Alpha
    await w.ok("PUT", `/v1/members/${w.staff2.userId}/home-location`, w.p.owner, { locationId: w.a })
    const leave = await w.ok("POST", "/v1/leave", w.staff2, { from: "2026-12-01", to: "2026-12-05", kind: "annual", note: "" }, 201)
    for (const who of [sup, w.p.owner]) {
      const items = kinds(await feed(w, who), "roster_leave")
      expect(items, who.userId).toHaveLength(1)
      expect(items[0]).toMatchObject({ rosterRef: leave.id, title: "Leave request 2026-12-01 to 2026-12-05", ownerId: w.staff2.userId, owner: "Cian Doyle" })
    }
    expect((await w.ok("GET", "/v1/attention", w.p.owner)).items.filter((i: Json) => i.kind === "roster_leave" && i.ownerId === w.p.owner.userId)).toEqual([])
    // the supervisor of ANOTHER site (Bravo) does not see it
    expect(kinds(await feed(w, w.sup2), "roster_leave")).toEqual([])
    await w.ok("POST", `/v1/leave/${leave.id}/decide`, w.p.owner, { decision: "approve", note: "" })
    expect(kinds(await feed(w, w.p.owner), "roster_leave")).toEqual([])
    // the requester's own request is never in their own feed
    const own = await w.ok("POST", "/v1/leave", w.p.owner, { from: "2026-12-10", to: "2026-12-10", kind: "annual", note: "" }, 201)
    expect(kinds(await feed(w, w.p.owner), "roster_leave").map((i) => i.rosterRef)).not.toContain(own.id)
  })

  test("expiring qualifications are for office roles and only for people in their scope, from 30 days before to 30 days after the expiry; a supervisor does not get them", async () => {
    const w = await sites()
    await supervisorsSeeFeed(w)
    await w.ok("PUT", `/v1/roster/office-limits/${w.p["roster-manager"].userId}`, w.p.owner, { except: [w.b] })
    await w.ok("PUT", `/v1/members/${w.staff3.userId}/home-location`, w.p.owner, { locationId: w.b })
    const put = (who: Who, q: Json[]) => w.ok("PUT", `/v1/members/${who.userId}/qualifications`, w.p.owner, { qualifications: q })
    await put(w.p.employee, [{ type: "first aid", expiresOn: "2026-11-26" }]) // in 10 days, homed nowhere
    await put(w.staff2, [{ type: "sia licence", expiresOn: "2026-11-10" }]) // expired 6 days ago
    await put(w.staff3, [{ type: "first aid", expiresOn: "2026-11-20" }]) // homed at Bravo
    await put(w.p.manager, [{ type: "first aid", expiresOn: "2027-01-31" }]) // far ahead
    await put(w.p.admin, [{ type: "first aid", expiresOn: "2026-09-01" }]) // long expired
    const owner = kinds(await feed(w, w.p.owner), "qualification_expiring")
    expect(owner.map((i) => [i.ownerId, i.title, i.reason])).toEqual([
      [w.staff2.userId, "sia licence expired on 2026-11-10", "Expired 6 days ago"],
      [w.staff3.userId, "first aid expires on 2026-11-20", "Expires in 4 days"],
      [w.p.employee.userId, "first aid expires on 2026-11-26", "Expires in 10 days"],
    ])
    expect(owner[0].owner).toBe("Cian Doyle")
    const rm = kinds(await feed(w, w.p["roster-manager"]), "qualification_expiring")
    expect(rm.map((i) => i.ownerId)).toEqual([w.staff2.userId, w.p.employee.userId]) // Dara is homed at Bravo, which this role is cut from
    expect(JSON.stringify(rm)).not.toContain(w.staff3.userId)
    expect(kinds(await feed(w, w.p["location-supervisor"]), "qualification_expiring")).toEqual([])
  })

  test("a roster draft still unpublished within `draftWarnDays` of its start is an item for the people who edit it; the setting is part of the roster rules and defaults to 3", async () => {
    const w = await sites()
    await supervisorsSeeFeed(w)
    const sup = w.p["location-supervisor"]
    expect((await w.ok("GET", "/v1/roster/rules", w.p.owner)).draftWarnDays).toBe(3)
    const started = await w.week(w.p.owner, w.a, NEXT) // starts today
    const far = await w.week(w.p.owner, w.a, "2026-11-23") // in 7 days
    const hidden = await w.week(w.p.owner, w.b, NEXT)
    const items = kinds(await feed(w, sup), "roster_draft_week")
    expect(items.map((i) => [i.rosterRef, i.title, i.reason])).toEqual([[started, "Roster for the week of 2026-11-16 at Alpha is still a draft", "Starts today"]])
    expect(JSON.stringify(items)).not.toContain(hidden)
    expect(kinds(await feed(w, w.p.owner), "roster_draft_week").map((i) => i.rosterRef).sort()).toEqual([hidden, started].sort())
    const rules = await w.rules(w.p.owner, { severity: {}, draftWarnDays: 7 })
    expect(rules.draftWarnDays).toBe(7)
    expect(kinds(await feed(w, sup), "roster_draft_week").map((i) => i.rosterRef)).toEqual([started, far])
    await publish(w, started)
    expect(kinds(await feed(w, sup), "roster_draft_week").map((i) => i.rosterRef)).toEqual([far])
    // a read-only manager edits nothing: no draft items; an invalid value is 422
    expect(kinds(await feed(w, w.p.manager), "roster_draft_week")).toEqual([])
    const etag = (await w.req("GET", "/v1/roster/rules", w.p.owner)).headers.get("etag")!
    for (const draftWarnDays of [-1, 29, 1.5]) expect(((await (await w.req("PUT", "/v1/roster/rules", w.p.owner, { severity: {}, draftWarnDays }, { "if-match": etag })).json()) as Json).code, String(draftWarnDays)).toBe("invalid_draft_days")
  })
})

describe("the feed, the dashboard and the cache", () => {
  test("the new kinds page with the cursor like the others (no item twice, none missed), and the dashboard's attention count equals the feed total", async () => {
    const w = await sites()
    const { a } = await openShifts(w)
    void a
    await w.ok("PUT", `/v1/members/${w.p.employee.userId}/qualifications`, w.p.owner, { qualifications: [{ type: "first aid", expiresOn: "2026-11-26" }] })
    await w.week(w.p.owner, w.a, "2026-11-23")
    const all = await feed(w, w.p.owner)
    expect(all.items.length).toBe(3) // two open shifts and the expiring licence (the 23 Nov draft is 7 days away: not yet within the default 3)
    expect(all.total).toBe(all.items.length)
    const seen: string[] = []
    let cursor: string | null = null
    for (let i = 0; i < 6; i++) {
      const page: Json = await feed(w, w.p.owner, `?limit=1${cursor ? `&cursor=${cursor}` : ""}`)
      seen.push(...page.items.map((x: Json) => `${x.kind}|${x.rosterRef}`))
      cursor = page.nextCursor
      if (!cursor) break
    }
    expect(seen).toEqual(all.items.map((x: Json) => `${x.kind}|${x.rosterRef}`))
    expect((await w.ok("GET", "/v1/dashboard", w.p.owner)).attentionCount).toBe(all.total)
  })

  test("read-model cache is busted by a roster publish (stamp incremented) so the dashboard shows the new gap within one read", async () => {
    const stamp = fakeCacheStamp()
    const clock = fakeClock()
    const cache = makeReadModelCache(stamp, { clock })
    const w = await sites({ readModelCache: cache, clock })
    const a = await w.week(w.p.owner, w.a, "2026-11-23") // 7 days away: not a draft item yet, so the count only moves by the open shift
    await w.addOk(w.p.owner, a, [{ date: "2026-11-23", userIds: [null], shiftTypeId: w.ta }])
    const before = (await w.ok("GET", "/v1/dashboard", w.p.owner)).attentionCount as number
    expect((await w.ok("GET", "/v1/dashboard", w.p.owner)).attentionCount).toBe(before) // served from the cache
    expect(cache.keys().some((k) => k.includes(":dashboard:"))).toBe(true)
    const stampBefore = await stamp.get(w.tenant.id)
    await publish(w, a)
    expect(await stamp.get(w.tenant.id)).toBeGreaterThan(stampBefore)
    expect((await w.ok("GET", "/v1/dashboard", w.p.owner)).attentionCount).toBe(before + 1) // the new open shift, at once (not after the 30 s TTL)
    expect(kinds(await w.ok("GET", "/v1/attention?limit=100", w.p.owner), "roster_open_shift")).toHaveLength(1)
  })

  test("a tenant without the roster module (M1A) gets no roster items and the count drops by exactly those items", async () => {
    const w = await sites()
    const { sa } = await openShifts(w)
    expect(kinds(await feed(w, w.p.owner), "roster_open_shift").map((i) => i.rosterRef)).toContain(sa.id)
    const withRoster = (await w.ok("GET", "/v1/dashboard", w.p.owner)).attentionCount as number
    await w.rows("insert into module_overrides (tenant_id, module, mode, reason, set_by, set_at) values ($1, 'M1A', 'revoke', 'test', 'p', now())", [w.tenant.id])
    // (the entitlement cache lives at most 60 s; the fake clock has not moved, so move it past that)
    w.clock.advance({ minutes: 2 })
    const without = await feed(w, w.p.owner)
    expect((without.items as Json[]).filter((i) => /^roster_|^qualification_/.test(i.kind))).toEqual([])
    expect((await w.ok("GET", "/v1/dashboard", w.p.owner)).attentionCount).toBe(withRoster - 2)
    expect((await w.ok("GET", "/v1/today", w.p.employee)).roster ?? 0).toBe(0)
  })
})

describe("cost", () => {
  const real = pg.Client.prototype.query
  let count = 0
  beforeEach(() => {
    count = 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pg.Client.prototype.query = function (this: unknown, ...a: any[]) {
      count++
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (real as any).apply(this, a)
    } as typeof real
  })
  afterEach(() => {
    pg.Client.prototype.query = real
  })

  test("GET /v1/dashboard: a caller without roster scope costs exactly what it did (no roster query at all); an office caller adds a bounded number of statements, none when the cache answers", async () => {
    const w = await sites()
    for (const who of [w.p.employee, w.p.owner]) await w.ok("GET", "/v1/today", who) // sign in and stamp last-active before counting
    const read = async (who: Who) => {
      await w.ok("GET", "/v1/today", who) // refreshes the 60 s entitlement cache outside the count (an M1 route: the roster ones are closed without M1A)
      count = 0
      await w.ok("GET", "/v1/dashboard", who)
      return count
    }
    const staffWith = await read(w.p.employee)
    await w.rows("insert into module_overrides (tenant_id, module, mode, reason, set_by, set_at) values ($1, 'M1A', 'revoke', 'test', 'p', now())", [w.tenant.id])
    w.clock.advance({ minutes: 2 })
    const staffWithout = await read(w.p.employee)
    expect(staffWith).toBe(staffWithout) // staff has no attention access: the roster is not touched
    const ownerWithout = await read(w.p.owner)
    await w.rows("delete from module_overrides where tenant_id = $1", [w.tenant.id])
    w.clock.advance({ minutes: 2 })
    const ownerWith = await read(w.p.owner)
    expect(ownerWith - ownerWithout).toBeLessThanOrEqual(12) // the roster context (4 reads) and the six counts
    expect(ownerWith).toBeGreaterThan(ownerWithout)
  })
})

describe("draft-week kind reads the rules once per request (Task 14 review minor)", () => {
  test("with more draft weeks than the cap (count() runs after rows()) the feed still reads the rules setting once", async () => {
    const w = await sites()
    await w.rows(`insert into locations (tenant_id, name, created_at, updated_at) select $1, 'L' || g, now(), now() from generate_series(1, 101) g`, [w.tenant.id])
    await w.rows(`insert into roster_weeks (tenant_id, location_id, week_start, created_at, updated_at) select tenant_id, id, '2026-11-16', now(), now() from locations where tenant_id = $1 and name like 'L%'`, [w.tenant.id])
    rulesReads.n = 0
    const f = await feed(w, w.p.owner, "?limit=100")
    expect(Number(f.total)).toBeGreaterThan(100)
    expect(rulesReads.n).toBe(1)
  })
})
