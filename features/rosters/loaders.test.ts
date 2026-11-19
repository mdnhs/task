import { describe, expect, test } from "vitest"
import { loadCoverage, loadExchange, loadExchanges, loadLeaveQueue, loadWeekHistory, loadLocationAdmin, loadMyRoster, loadQualifications, loadRosterData, loadRosterPeople, loadRules } from "./loaders"
import { openAccess, exchangeDto, historyDto, leaveDto, locationDto, mineShiftDto, rulesDto, shiftDto, shiftTypeDto, weekDto, weeksDto, LID, UID } from "./fixtures"

type Call = { path: string; o: { path?: Record<string, string>; query?: Record<string, string>; onResponse?: (r: Response) => void } | undefined }
function fake(answers: Record<string, unknown | ((o: Call["o"]) => unknown)>) {
  const calls: Call[] = []
  const api = {
    get: async (path: string, o?: Call["o"]) => {
      calls.push({ path, o })
      if (!(path in answers)) throw new Error(`unexpected GET ${path}`)
      const a = answers[path]
      const v = typeof a === "function" ? (a as (o: Call["o"]) => unknown)(o) : a
      o?.onResponse?.(new Response("{}", { headers: { etag: '"e1"' } }))
      return v
    },
  }
  return { api: api as never, calls }
}

describe("roster readers", () => {
  test("B8 Task 22: the people list is the week payload's members as the API cut them (one day view), with the cap flag and the caller's level; licences keep the API's expiry state", async () => {
    const { api, calls } = fake({
      "/v1/roster/weeks": { ...weeksDto, membersTruncated: true, members: [{ userId: UID, name: "Member", active: true, homeLocationId: null }], access: { level: "office", canEdit: true, locked: false, lockReason: null } },
      "/v1/members/{userId}/qualifications": { userId: UID, items: [{ type: "sia licence", expiresOn: "2026-11-30", expired: false, dueSoon: true, extra: 1 }] },
    })
    const p = await loadRosterPeople(api)
    expect(calls[0]!.o!.query).toEqual({ view: "day" })
    expect(p).toEqual({ members: [{ id: UID, name: "Member", active: true, homeLocationId: null }], truncated: true, access: { level: "office", canEdit: true, locked: false, lockReason: null } })
    expect(await loadQualifications(api, UID)).toEqual([{ type: "sia licence", expiresOn: "2026-11-30", expired: false, dueSoon: true }]) // the stray field is dropped
    expect(calls[1]!.o!.path).toEqual({ userId: UID })
    const { api: bad } = fake({ "/v1/members/{userId}/qualifications": { userId: UID, items: [{ type: "x", expiresOn: null, expired: false }] } })
    await expect(loadQualifications(bad, UID)).rejects.toThrow() // a missing dueSoon is never read as "not due"
  })


  test("getRosterData sends only the query and maps the payload; the API's cut is never re-cut", async () => {
    const { api, calls } = fake({ "/v1/roster/weeks": weeksDto, "/v1/locations": { items: [locationDto] } })
    const d = await loadRosterData(api, { locationId: LID, from: "2026-11-02", view: "week" })
    expect(calls.find((c) => c.path === "/v1/roster/weeks")!.o!.query).toEqual({ locationId: LID, from: "2026-11-02", view: "week" })
    expect(d.weeks).toHaveLength(1)
    expect(d.shifts[0]!.personId).toBe(UID)
    expect(d.locations[0]!.name).toBe("Harbour Street")
    // no client-side re-scoping: a shift of a location that is not in the list is kept as the API sent it
    const { api: a2 } = fake({ "/v1/roster/weeks": { ...weeksDto, shifts: [{ ...shiftDto, locationId: "11111111-1111-4111-8111-111111111111" }] }, "/v1/locations": { items: [] } })
    expect((await loadRosterData(a2, {})).shifts).toHaveLength(1)
  })

  test("getLocationAdminData reads the location, its shift types (archived too) and its history", async () => {
    const { api, calls } = fake({ [`/v1/locations/{id}`]: locationDto, "/v1/locations/{id}/shift-types": { items: [shiftTypeDto] }, "/v1/locations/{id}/history": { items: [historyDto], nextCursor: null } })
    const d = await loadLocationAdmin(api, LID)
    expect(d.location.id).toBe(LID)
    expect(d.shiftTypes).toHaveLength(1)
    expect(d.history.items[0]!.by).toBe(UID)
    expect(calls.every((c) => c.o?.path?.id === LID)).toBe(true)
    expect(calls.find((c) => c.path.endsWith("shift-types"))!.o!.query).toEqual({ includeArchived: "true" })
  })

  test("getMyRoster merges mine, availability and own leave", async () => {
    const { api, calls } = fake({
      "/v1/roster/mine": { from: "2026-11-16", to: "2026-12-13", items: [mineShiftDto], truncated: false, access: openAccess },
      "/v1/roster/availability": { windows: [{ weekday: 1, from: "09:00", to: "12:00" }] },
      "/v1/leave": { items: [leaveDto], nextCursor: null },
    })
    const d = await loadMyRoster(api, { from: "2026-11-16", to: "2026-12-13" }, UID)
    expect(d.shifts[0]!.locationName).toBe("Harbour Street")
    expect(d.availability).toEqual([{ personId: UID, weekday: 1, from: "09:00", to: "12:00" }])
    expect(d.leave[0]!.personId).toBe(UID)
    expect(calls.find((c) => c.path === "/v1/leave")!.o!.query).toMatchObject({ userId: UID })
    expect(calls.find((c) => c.path === "/v1/roster/mine")!.o!.query).toEqual({ from: "2026-11-16", to: "2026-12-13" })
  })

  test("getLeaveQueue asks for requested leave only", async () => {
    const { api, calls } = fake({ "/v1/leave": { items: [leaveDto], nextCursor: "c1" } })
    const d = await loadLeaveQueue(api)
    expect(d.nextCursor).toBe("c1")
    expect(calls[0]!.o!.query).toMatchObject({ status: "requested" })
  })

  test("getExchange returns the exchanges and the open shifts of published weeks in range", async () => {
    const pub = { ...weekDto, status: "published" }
    const { api, calls } = fake({
      "/v1/roster/exchanges": { items: [exchangeDto], nextCursor: null },
      "/v1/roster/weeks": { ...weeksDto, weeks: [pub], shifts: [{ ...shiftDto, userId: null }, shiftDto] },
    })
    const d = await loadExchange(api, { from: "2026-11-02", to: "2026-11-08", status: "requested" })
    expect(d.items).toHaveLength(1)
    expect(d.openShifts.map((s) => s.personId)).toEqual([null])
    expect(calls.find((c) => c.path === "/v1/roster/exchanges")!.o!.query).toEqual({ status: "requested" })
    // a draft week's open shifts are not on offer
    const { api: a2 } = fake({ "/v1/roster/exchanges": { items: [], nextCursor: null }, "/v1/roster/weeks": { ...weeksDto, shifts: [{ ...shiftDto, userId: null }] } })
    expect((await loadExchange(a2, {})).openShifts).toEqual([])
  })

  test("rules come with their ETag, coverage maps", async () => {
    const { api } = fake({ "/v1/roster/rules": rulesDto, "/v1/roster/coverage": { from: "a", to: "b", locations: [] } })
    expect((await loadRules(api)).etag).toBe('"e1"')
    expect((await loadCoverage(api, {})).locations).toEqual([])

  })
})

describe("roster panel readers (Task 21)", () => {
  test("the history page asks for its cursor and its size; the exchange list is one page with no week lookup", async () => {
    const { api, calls } = fake({ "/v1/roster/weeks/{id}/history": { items: [historyDto], nextCursor: "c2" }, "/v1/roster/exchanges": { items: [exchangeDto], nextCursor: null } })
    const h = await loadWeekHistory(api, "w1", "c1", 20)
    expect(calls[0]!.o).toMatchObject({ path: { id: "w1" }, query: { cursor: "c1", limit: "20" } })
    expect(h.nextCursor).toBe("c2")
    expect(h.items[0]!.reason).toBe("Cover")
    await loadWeekHistory(api, "w1")
    expect(calls[1]!.o!.query).toEqual({})
    const x = await loadExchanges(api)
    expect(x.items[0]!.kind).toBe("claim")
    expect(calls.map((c) => c.path)).not.toContain("/v1/roster/weeks")
  })
})
