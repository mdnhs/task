import { beforeEach, describe, expect, test, vi } from "vitest"
import { resetDb } from "../../../test/harness"
import { resetSubscribers } from "../../core/events"
import { registerFiles } from "../files"
import { registerGdpr } from "../gdpr"
import { registerNotifications } from "../notifications"
import { registerSearchIndexers } from "../search"
import { registerTasks } from "../tasks"
import { registerWebhooks } from "../webhooks-out"
import { DAY, world, type Json, type W, type Who } from "./world"
import { registerShiftReports } from "."

const occCalls = vi.hoisted(() => ({ n: 0 }))
vi.mock("../shifts", async (orig) => {
  const m = await orig<typeof import("../shifts")>()
  return { ...m, occurrencesBetween: (...a: Parameters<typeof m.occurrencesBetween>) => ((occCalls.n += 1), m.occurrencesBetween(...a)) }
})

// B8 Task 15: the inbox's status counts (one aggregate, scope-cut, the same filters as the list) and the real minutes late / open of every item (instants, DST-safe).

beforeEach(async () => {
  await resetDb()
  resetSubscribers()
  registerNotifications()
  registerFiles()
  registerSearchIndexers()
  registerTasks()
  registerShiftReports()
  registerGdpr()
  registerWebhooks()
})

const RANGE = `from=${DAY}&to=${DAY}`
type Page = { items: Json[]; nextCursor: string | null; counts: Record<"all" | "open" | "missing" | "late" | "returned" | "accepted", number> }
const inbox = async (w: W, as: Who, qs = RANGE): Promise<Page> => {
  const r = await w.req("GET", `/v1/shift-reports?${qs}`, as)
  expect(r.status, await r.clone().text()).toBe(200)
  return (await w.json(r)) as Page
}
async function file(w: W, as: Who): Promise<Json> {
  const rep = await w.opened(as)
  const r = await w.submit(as, await w.saved(as, rep))
  expect(r.status, await r.clone().text()).toBe(200)
  return w.json(r)
}

/**
 * The 24 Oct night (due 07:00Z next day). At 05:00Z: manager and staff3 and staff2 file ON TIME; staff opens a draft; the owner has nothing. Ops accepts staff2 and returns staff3. At 07:30Z
 * (past due) staff submits LATE. Result: owner missing (virtual), staff late, staff2 accepted, staff3 returned, manager submitted on time (open).
 */
async function night() {
  const w = await world({ now: "2026-10-25T05:00:00.000Z" })
  for (const u of [w.manager]) expect((await w.req("POST", "/v1/shifts/assignments", w.ops, { userId: u.userId, patternId: w.pattern, from: "2026-10-01" })).status).toBe(201)
  await w.manages(w.manager, w.staff3)
  const m = await file(w, w.manager)
  const s2 = await file(w, w.staff2)
  const s3 = await file(w, w.staff3)
  await w.opened(w.staff)
  expect((await w.req("POST", `/v1/shift-reports/${s2.id}/accept`, w.ops, { version: s2.version })).status).toBe(200)
  expect((await w.req("POST", `/v1/shift-reports/${s3.id}/return`, w.ops, { version: s3.version, comment: "Please add the lift fault" })).status).toBe(200)
  w.clock.advance({ minutes: 150 }) // 07:30Z
  const s = await w.saved(w.staff, await w.get(w.staff, (await inbox(w, w.staff)).items[0].id))
  const late = await w.submit(w.staff, s)
  expect(late.status, await late.clone().text()).toBe(200)
  return { w, m, s2, s3 }
}

const STATES = { open: ["draft", "submitted"], missing: ["missing"], late: ["late"], returned: ["returned"], accepted: ["accepted"] } as const

describe("inbox counts (B8 T15)", () => {
  test("counts equal the number of items of each state under the same filters and scope, for every role (all, team manager, staff); the parts add up to all", async () => {
    const { w } = await night()
    const roles: [string, Who, number][] = [["ops (all)", w.ops, 5], ["team manager (self + direct report)", w.manager, 2], ["staff (own)", w.staff, 1]]
    for (const [name, who, total] of roles) {
      for (const qs of [RANGE, `${RANGE}&team=${w.team}`, `${RANGE}&person=${w.staff.userId}`, `${RANGE}&status=late`, `${RANGE}&limit=1`]) {
        const p = await inbox(w, who, qs)
        const full = (await inbox(w, who, `${RANGE}${qs.includes("team=") ? `&team=${w.team}` : ""}${qs.includes("person=") ? `&person=${w.staff.userId}` : ""}&limit=100`)).items
        const by = (k: keyof typeof STATES) => full.filter((i) => (STATES[k] as readonly string[]).includes(i.state)).length
        expect(p.counts, `${name} ${qs}`).toEqual({ all: full.length, open: by("open"), missing: by("missing"), late: by("late"), returned: by("returned"), accepted: by("accepted") })
        const c = p.counts
        expect(c.open + c.missing + c.late + c.returned + c.accepted).toBe(c.all)
      }
      expect((await inbox(w, who)).counts.all, name).toBe(total)
    }
    expect((await inbox(w, w.ops)).counts).toEqual({ all: 5, open: 1, missing: 1, late: 1, returned: 1, accepted: 1 })
  })

  test("a team manager's counts include only their own and direct reports' items, never the tenant total; a person or team outside the scope counts zero everywhere, the same shape as a team with no reports", async () => {
    const { w } = await night()
    const m = await inbox(w, w.manager)
    expect(m.counts).toEqual({ all: 2, open: 1, missing: 0, late: 0, returned: 1, accepted: 0 })
    expect(JSON.stringify(m)).not.toContain(w.staff2.userId)
    const zero = { all: 0, open: 0, missing: 0, late: 0, returned: 0, accepted: 0 }
    expect((await inbox(w, w.manager, `${RANGE}&person=${w.staff2.userId}`)).counts).toEqual(zero) // out of scope
    expect((await inbox(w, w.manager, `${RANGE}&team=${crypto.randomUUID()}`)).counts).toEqual(zero) // not a team of this tenant
    expect((await inbox(w, w.staff, `${RANGE}&person=${w.staff3.userId}`)).counts).toEqual(zero)
  })

  test("a virtual row (no report yet) counts: missing once past its due time, open before it", async () => {
    const w = await world({ now: "2026-10-25T05:00:00.000Z" })
    expect((await inbox(w, w.ops)).counts).toEqual({ all: 4, open: 4, missing: 0, late: 0, returned: 0, accepted: 0 })
    w.clock.advance({ minutes: 130 })
    expect((await inbox(w, w.ops)).counts).toEqual({ all: 4, open: 0, missing: 4, late: 0, returned: 0, accepted: 0 })
  })
})

describe("AG2: counts only on the first page, one window pass", () => {
  test("a page after a cursor answers counts: null (no count work); the first page has them; a first page walks the 31-day virtual window in ONE occurrence read, not one per 3 days", async () => {
    const { w } = await night()
    const first = await inbox(w, w.ops, `${RANGE}&limit=2`)
    expect(first.nextCursor).not.toBeNull()
    expect(first.counts.all).toBe(5)
    occCalls.n = 0
    const next = (await w.json(await w.req("GET", `/v1/shift-reports?${RANGE}&limit=2&cursor=${first.nextCursor}`, w.ops))) as Omit<Page, "counts"> & { counts: unknown }
    expect(next.counts).toBeNull()
    expect(next.items.length).toBeGreaterThan(0)
    // the cursor page reads occurrences for the LIST only (at most the chunks it needs), never the whole window for counts
    const afterPage = occCalls.n
    occCalls.n = 0
    const wide = await inbox(w, w.ops, `from=2026-09-25&to=2026-10-25&limit=1`)
    expect(wide.counts.all).toBeGreaterThanOrEqual(5)
    // list walk stops after the first chunk (limit 1), counts take exactly one pass over the whole 31 days
    expect(occCalls.n).toBeLessThanOrEqual(1 + 1 + 1)
    expect(afterPage).toBeLessThanOrEqual(2)
  })
})

describe("minutes late and open (B8 T15)", () => {
  test("a report 90 real minutes past due across the 25 Oct 2026 clock change is 90 (not 30 or 150); open is the real time from the shift's end to the first submission", async () => {
    const { w, s2 } = await night()
    // due 00:30Z (01:30 summer time, before the clocks go back at 01:00Z), first submitted 02:00Z (02:00 winter time); the shift ended 22:30Z the evening before
    await w.q("update shift_reports set due_at = '2026-10-25T00:30:00Z', first_submitted_at = '2026-10-25T02:00:00Z', end_at = '2026-10-24T22:30:00Z' where id = $1", [s2.id])
    const item = (await inbox(w, w.ops)).items.find((i) => i.id === s2.id)!
    expect(item).toMatchObject({ state: "accepted", minutesLate: 90, minutesOpen: 210 }) // wall-clock arithmetic would say 30 and 150
  })

  test("late is first submission minus due; a missing or draft report counts up to now; an on-time or not-yet-due one is 0; a running shift has no open minutes", async () => {
    const { w, m } = await night()
    const items = (await inbox(w, w.ops)).items
    const of = (id: string | undefined) => items.find((i) => i.id === id)!
    // staff: draft opened at 05:00Z, submitted at 07:30Z against 07:00Z
    expect(items.find((i) => i.userId === w.staff.userId)).toMatchObject({ state: "late", minutesLate: 30, minutesOpen: 90 }) // ended 06:00Z, filed 07:30Z
    // the on-time manager report: filed 05:00Z, before it ended: nothing late, nothing open
    expect(of(m.id)).toMatchObject({ minutesLate: 0, minutesOpen: 0 })
    // the owner never filed: missing since 07:00Z, now 07:30Z
    expect(items.find((i) => i.userId === w.owner.userId)).toMatchObject({ id: null, state: "missing", minutesLate: 30, minutesOpen: 90 })
    w.clock.advance({ minutes: 60 })
    expect((await inbox(w, w.ops)).items.find((i) => i.userId === w.owner.userId)).toMatchObject({ minutesLate: 90, minutesOpen: 150 })
  })
})
