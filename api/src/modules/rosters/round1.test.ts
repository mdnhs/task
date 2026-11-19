import { beforeEach, describe, expect, test } from "vitest"
import { withTenant } from "../../db/tenant-tx"
import { makeMember } from "../../../test/factories"
import { call, resetDb } from "../../../test/harness"
import { notifyRostered } from "./events"
import { MON, sites, type Json } from "./testkit"

// B8 Tasks 9+10, review round 1 (rulings AE1..AE6).

beforeEach(resetDb)
type W = Awaited<ReturnType<typeof sites>>
const version = async (w: W, weekId: string): Promise<number> => (await w.rows("select version from roster_weeks where id = $1", [weekId]))[0].version
const publishOk = async (w: W, weekId: string) => w.ok("POST", `/v1/roster/weeks/${weekId}/publish`, w.p.owner, { version: await version(w, weekId) })

describe("AE1: a deactivated member is never notified", () => {
  test("publish and an office edit tell the active people only; no in-app, no delivery for the deactivated one even with a push token", async () => {
    const w = await sites()
    await w.req("GET", "/v1/roster/rules", w.staff2) // sign in
    const cookie = w.cookies.get(w.staff2.email)!
    expect((await call(w.app, "POST", "/v1/me/push-tokens", { cookie, tenant: "acme", body: { token: "fcm-token-AAAAAAAAAAAAAAAA", platform: "android" } })).status).toBe(201)
    const added = await w.addOk(w.p.owner, w.wa, [{ date: MON, userIds: [w.p.employee.userId, w.staff2.userId], shiftTypeId: w.ta }])
    await w.ok("POST", `/v1/members/${w.staff2.userId}/deactivate`, w.p.owner)
    await w.rows("delete from notifications")
    await publishOk(w, w.wa)
    expect((await w.rows("select user_id from notifications where title = 'Roster published'")).map((r) => r.user_id)).toEqual([w.p.employee.userId])
    const sh = added.shifts.find((s: Json) => s.userId === w.staff2.userId)
    await w.ok("PATCH", `/v1/roster/shifts/${sh.id}`, w.p.owner, { version: 1, patch: { start: "09:00" }, reason: "Later start" })
    const mine = added.shifts.find((s: Json) => s.userId === w.p.employee.userId)
    await w.ok("PATCH", `/v1/roster/shifts/${mine.id}`, w.p.owner, { version: 1, patch: { start: "09:00" }, reason: "Later start" })
    expect((await w.rows("select user_id from notifications where title = 'Shift changed'")).map((r) => r.user_id)).toEqual([w.p.employee.userId])
    expect(await w.rows("select 1 from notification_deliveries d join notifications n on n.id = d.notification_id where n.user_id = $1", [w.staff2.userId])).toHaveLength(0)
  })
})

describe("AE5: notifyRostered costs O(1) lookups", () => {
  test("the query count does not grow with the recipients (50 vs 3) and every recipient still gets one notice", async () => {
    const w = await sites()
    const ids: string[] = []
    for (let i = 0; i < 50; i++) ids.push((await makeMember(w.deps, w.tenant.id, "employee")).userId)
    const run = async (users: string[]) => {
      let n = 0
      await withTenant(w.deps.db, w.tenant.id, async (tx) => {
        const counted = new Proxy(tx, { get: (t, k, r) => { const v = Reflect.get(t, k, r); return ["select", "insert", "update", "delete", "execute"].includes(String(k)) && typeof v === "function" ? (...a: unknown[]) => { n++; return (v as (...x: unknown[]) => unknown).apply(t, a) } : v } })
        await notifyRostered(counted, { tenantId: w.tenant.id }, { deps: w.deps, enqueue: () => {} }, users, "published", MON)
      })
      return n
    }
    const small = await run(ids.slice(0, 3))
    await w.rows("delete from notifications")
    const big = await run(ids)
    expect(big).toBe(small)
    expect(big).toBeLessThanOrEqual(8)
    expect(await w.rows("select 1 from notifications where title = 'Roster published'")).toHaveLength(50)
  }, 120_000)
})

describe("AE2: a cross-site loan is opaque to a supervisor who cannot see the person's home site", () => {
  const loan = async () => {
    const w = await sites()
    await w.ok("PUT", `/v1/members/${w.p.employee.userId}/home-location`, w.p.owner, { locationId: w.b }) // Bravo: hidden to the Alpha supervisor
    await w.ok("PUT", `/v1/members/${w.staff2.userId}/home-location`, w.p.owner, { locationId: w.a }) // a visible person, the control
    return w
  }
  const sup = (w: W) => w.p["location-supervisor"]
  const leaks = (text: string) => ["Aoife", "Byrne", "licence", "qualification", "expired", "leave", "unavailable", "Sia", "sia"].filter((s) => text.includes(s))

  test("(a) the ineligible answer is generic for a person of a hidden site, specific for the office and for a visible person", async () => {
    const w = await loan()
    const armed = await w.type(w.a, "Armed", { requires: ["SIA Licence"] })
    const body = { shifts: [{ date: MON, userIds: [w.p.employee.userId], shiftTypeId: armed }] }
    const r = await w.fail("POST", `/v1/roster/weeks/${w.wa}/shifts`, sup(w), body, 422)
    expect(r.code).toBe("ineligible")
    expect(r.errors).toEqual([{ userId: w.p.employee.userId, date: MON, reason: "ineligible" }])
    expect(leaks(JSON.stringify(r))).toEqual([])
    expect((await w.fail("POST", `/v1/roster/weeks/${w.wa}/shifts`, w.p.owner, body, 422)).errors[0].reason).toBe("qualification_missing")
    expect((await w.fail("POST", `/v1/roster/weeks/${w.wa}/shifts`, sup(w), { shifts: [{ date: MON, userIds: [w.staff2.userId], shiftTypeId: armed }] }, 422)).errors[0].reason).toBe("qualification_missing")
    await w.ok("POST", `/v1/members/${w.p.employee.userId}/deactivate`, w.p.owner)
    expect((await w.fail("POST", `/v1/roster/weeks/${w.wa}/shifts`, sup(w), { shifts: [{ date: MON, userIds: [w.p.employee.userId], shiftTypeId: w.ta }] }, 422)).errors[0].reason).toBe("ineligible") // left reads the same
  })

  test("(b) the members entry of a loaned person has no name for the supervisor, the office still sees it", async () => {
    const w = await loan()
    const r = await w.addOk(sup(w), w.wa, [{ date: MON, userIds: [w.p.employee.userId, w.staff2.userId], shiftTypeId: w.ta }])
    void r
    for (const path of [`/v1/roster/weeks/${w.wa}`, "/v1/roster/weeks?from=2026-11-02"]) {
      const text = await (await w.req("GET", path, sup(w))).text()
      expect(text.includes("Aoife"), path).toBe(false)
      const m = (JSON.parse(text) as Json).members
      expect(m.find((x: Json) => x.userId === w.p.employee.userId).name).toBe("Member")
      expect(m.find((x: Json) => x.userId === w.staff2.userId).name).toBe("Cian Doyle")
    }
    expect((await w.ok("GET", `/v1/roster/weeks/${w.wa}`, w.p.owner)).members.find((x: Json) => x.userId === w.p.employee.userId).name).toBe("Aoife Byrne")
  })

  test("(c) leave, unavailability, other-site shifts and every other message about that person are the generic hidden wording; a visible person keeps the specific text", async () => {
    const w = await loan()
    // approved leave on Monday for both people, and an unavailable window Tuesday for both
    for (const who of [w.p.employee, w.staff2]) {
      const l = await w.ok("POST", "/v1/leave", who, { from: MON, to: MON, kind: "annual" }, 201)
      await w.ok("POST", `/v1/leave/${l.id}/decide`, w.p.owner, { decision: "approve" })
      await w.ok("PUT", "/v1/roster/availability", who, { windows: [{ weekday: 2, from: "08:00", to: "12:00" }] })
    }
    const people = [w.p.employee.userId, w.staff2.userId]
    const blocked = await w.fail("POST", `/v1/roster/weeks/${w.wa}/shifts`, sup(w), { shifts: [{ date: MON, userIds: people, shiftTypeId: w.ta }] }, 422)
    const [loaned, visible] = [blocked.violations.filter((v: Json) => v.personId === w.p.employee.userId), blocked.violations.filter((v: Json) => v.personId === w.staff2.userId)]
    expect(loaned.map((v: Json) => [v.rule, v.message])).toEqual([["elsewhere", "Already rostered elsewhere"]])
    expect(leaks(JSON.stringify(loaned))).toEqual([])
    expect(visible.map((v: Json) => v.rule)).toContain("approved_leave") // the visible person keeps the masked-but-specific line
    // warnings: unavailable and rest, plus a name in a rest message
    const ok = await w.addOk(sup(w), w.wa, [{ date: "2026-11-03", userIds: people, shiftTypeId: w.ta }, { date: "2026-11-04", userIds: people, shiftTypeId: w.ta, start: "02:00", end: "10:00" }])
    const text = JSON.stringify(ok.violations.filter((v: Json) => v.personId === w.p.employee.userId))
    expect(ok.violations.some((v: Json) => v.personId === w.p.employee.userId)).toBe(true)
    expect(leaks(text), text).toEqual([])
    await w.addOk(w.p.owner, w.wa, [{ date: MON, userIds: people, shiftTypeId: w.ta }], { reason: "Covered" }) // the office puts them on the leave day anyway
    // the dry-run check route reads the same
    const check = await w.ok("POST", `/v1/roster/weeks/${w.wa}/check`, sup(w))
    expect(leaks(JSON.stringify(check.violations.filter((v: Json) => v.personId === w.p.employee.userId)))).toEqual([])
    // the office role sees the specifics
    const office = await w.ok("POST", `/v1/roster/weeks/${w.wa}/check`, w.p.owner)
    expect(office.violations.some((v: Json) => v.personId === w.p.employee.userId && /leave/.test(v.message))).toBe(true)
  })
})

describe("R1 (final review): a move that turns an existing generic hidden warning into a block is a NEW violation", () => {
  test("a supervisor's move of a loaned person's shift onto an approved leave day is 422 rule_blocked although a generic warning was already on the shift", async () => {
    const w = await sites()
    await w.ok("PUT", `/v1/members/${w.p.employee.userId}/home-location`, w.p.owner, { locationId: w.b }) // hidden to the Alpha supervisor: every private rule reads "Already rostered elsewhere"
    const sup = w.p["location-supervisor"]
    const l = await w.ok("POST", "/v1/leave", w.p.employee, { from: "2026-11-03", to: "2026-11-03", kind: "annual" }, 201)
    await w.ok("POST", `/v1/leave/${l.id}/decide`, w.p.owner, { decision: "approve" })
    await w.ok("PUT", "/v1/roster/availability", w.p.employee, { windows: [{ weekday: 1, from: "08:00", to: "12:00" }] }) // Monday: an unavailable window over the 08:00-16:00 shift, a warning
    const added = await w.addOk(sup, w.wa, [{ date: MON, userIds: [w.p.employee.userId], shiftTypeId: w.ta }])
    expect(added.violations.map((v: Json) => [v.rule, v.severity, v.message])).toEqual([["elsewhere", "warn", "Already rostered elsewhere"]]) // the existing generic warning
    const s = added.shifts[0]
    const blocked = await w.fail("PATCH", `/v1/roster/shifts/${s.id}`, sup, { version: 1, patch: { date: "2026-11-03" } }, 422)
    expect(blocked.code).toBe("rule_blocked")
    expect(blocked.violations.map((v: Json) => [v.rule, v.severity])).toContainEqual(["elsewhere", "block"])
    expect((await w.rows("select date::text as date from roster_shifts where id = $1", [s.id]))[0].date).toBe(MON) // nothing moved
  })
})

describe("AE3: an office edit of a published week needs explicit overrideRuleIds for a new block", () => {
  const published = async () => {
    const w = await sites()
    const early = await w.type(w.a, "Early", { start: "06:00", end: "14:00" })
    const s = (await w.addOk(w.p.owner, w.wa, [{ date: MON, userIds: [w.p.employee.userId], shiftTypeId: w.ta }, { date: "2026-11-03", userIds: [w.p.employee.userId], shiftTypeId: w.ta }])).shifts
    await publishOk(w, w.wa)
    return { w, early, s }
  }
  test("add: a reason alone is 422 rule_blocked; with the rule id it passes; a wrong or unknown id does not", async () => {
    const { w, early } = await published()
    const body = (extra: Json) => ({ shifts: [{ date: MON, userIds: [w.p.employee.userId], shiftTypeId: early }], reason: "Extra", ...extra })
    expect((await w.fail("POST", `/v1/roster/weeks/${w.wa}/shifts`, w.p.owner, body({}), 422)).code).toBe("rule_blocked")
    expect((await w.fail("POST", `/v1/roster/weeks/${w.wa}/shifts`, w.p.owner, body({ overrideRuleIds: ["daily_rest"] }), 422)).code).toBe("rule_blocked")
    expect((await w.fail("POST", `/v1/roster/weeks/${w.wa}/shifts`, w.p.owner, body({ overrideRuleIds: ["nonsense"] }), 422)).code).toBe("invalid_override")
    expect((await w.rows("select 1 from roster_shifts")).length).toBe(2)
    const ok = await w.addOk(w.p.owner, w.wa, body({ overrideRuleIds: ["double_booking"] }).shifts, { reason: "Extra", overrideRuleIds: ["double_booking"] })
    expect(ok.violations.some((v: Json) => v.rule === "double_booking")).toBe(true)
  })
  test("move: the same contract; the reason stays mandatory", async () => {
    const { w, s } = await published()
    const patch = { date: MON, start: "09:00", end: "17:00" }
    expect((await w.fail("PATCH", `/v1/roster/shifts/${s[1].id}`, w.p.owner, { version: 1, patch, reason: "x" }, 422)).code).toBe("rule_blocked")
    expect((await w.fail("PATCH", `/v1/roster/shifts/${s[1].id}`, w.p.owner, { version: 1, patch, overrideRuleIds: ["double_booking"] }, 422)).code).toBe("reason_required")
    expect((await w.ok("PATCH", `/v1/roster/shifts/${s[1].id}`, w.p.owner, { version: 1, patch, reason: "x", overrideRuleIds: ["double_booking"] })).shift.date).toBe(MON)
  })
})

describe("AE4: history overrides never carry the ids of a hidden site", () => {
  test("a shift id of a site the reader cannot see and a person of a hidden site are dropped from after.overrides", async () => {
    const w = await sites()
    await w.ok("PUT", `/v1/members/${w.p.employee.userId}/home-location`, w.p.owner, { locationId: w.b })
    await w.ok("PUT", `/v1/members/${w.staff2.userId}/home-location`, w.p.owner, { locationId: w.a })
    const hiddenShift = (await w.addOk(w.p.owner, w.wb, [{ date: "2026-11-03", userIds: [null], shiftTypeId: w.tb }])).shifts[0]
    const mine = (await w.addOk(w.p.owner, w.wa, [{ date: MON, userIds: [w.staff2.userId], shiftTypeId: w.ta }])).shifts[0]
    await w.rows("update roster_history set after = after || $2::jsonb where shift_id = $1 and action = 'shift_added'", [mine.id, JSON.stringify({ overrides: [{ rule: "double_booking", shiftId: hiddenShift.id, personId: w.p.employee.userId }, { rule: "daily_rest", shiftId: mine.id, personId: w.staff2.userId }] })])
    const text = await (await w.req("GET", `/v1/roster/weeks/${w.wa}/history`, w.p["location-supervisor"])).text()
    expect(text.includes(hiddenShift.id)).toBe(false)
    expect(text.includes(w.p.employee.userId)).toBe(false)
    const o = (JSON.parse(text) as Json).items.find((i: Json) => i.shiftId === mine.id).after.overrides
    expect(o).toEqual([{ rule: "double_booking", shiftId: null, personId: null }, { rule: "daily_rest", shiftId: mine.id, personId: w.staff2.userId }])
    const office = (await w.ok("GET", `/v1/roster/weeks/${w.wa}/history`, w.p.owner)).items.find((i: Json) => i.shiftId === mine.id).after.overrides
    expect(office[0]).toMatchObject({ shiftId: hiddenShift.id, personId: w.p.employee.userId })
  })
})

describe("AE6: the week version moves with every shift write, a move does not clash with its own old copy, a stale delete is 409", () => {
  test("version bumps on add, patch and delete", async () => {
    const w = await sites()
    const s = (await w.addOk(w.p.owner, w.wa, [{ date: MON, userIds: [w.p.employee.userId], shiftTypeId: w.ta }])).shifts[0]
    expect(await version(w, w.wa)).toBe(2)
    await w.ok("PATCH", `/v1/roster/shifts/${s.id}`, w.p.owner, { version: 1, patch: { start: "09:00" } })
    expect(await version(w, w.wa)).toBe(3)
    expect((await w.req("DELETE", `/v1/roster/shifts/${s.id}?version=2`, w.p.owner)).status).toBe(204)
    expect(await version(w, w.wa)).toBe(4)
  })
  test("a stale ?version= on delete is 409 and removes nothing; the current one removes", async () => {
    const w = await sites()
    const s = (await w.addOk(w.p.owner, w.wa, [{ date: MON, userIds: [w.p.employee.userId], shiftTypeId: w.ta }])).shifts[0]
    await w.ok("PATCH", `/v1/roster/shifts/${s.id}`, w.p.owner, { version: 1, patch: { start: "09:00" } })
    expect((await w.fail("DELETE", `/v1/roster/shifts/${s.id}?version=1`, w.p.owner, undefined, 409)).code).toBe("version_conflict")
    expect((await w.fail("DELETE", `/v1/roster/shifts/${s.id}?version=2x`, w.p.owner, undefined, 409)).code).toBe("version_conflict")
    expect(await w.rows("select 1 from roster_shifts")).toHaveLength(1)
    expect((await w.req("DELETE", `/v1/roster/shifts/${s.id}?version=2`, w.p.owner)).status).toBe(204)
  })
  test("moving a shift does not count its own old copy (weekly hours are not doubled)", async () => {
    const w = await sites()
    await w.rules(w.p.owner, { severity: { avg_48h: "block" }, avgWeekReferenceWeeks: 1 })
    const days = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]
    const shifts = (await w.addOk(w.p.owner, w.wa, days.map((date) => ({ date, userIds: [w.p.employee.userId], shiftTypeId: w.ta })))).shifts // 6 x 8 h = 48 h
    const last = shifts[5]
    const r = await w.ok("PATCH", `/v1/roster/shifts/${last.id}`, w.p.owner, { version: 1, patch: { date: "2026-11-08" } })
    expect(r.shift.date).toBe("2026-11-08")
    expect(r.violations.filter((v: Json) => v.severity === "block")).toEqual([])
  })
})
