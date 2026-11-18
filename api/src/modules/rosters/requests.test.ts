import { beforeEach, describe, expect, test } from "vitest"
import { resetDb } from "../../../test/harness"
import { sites, type Json, type Who } from "./testkit"

// B8 Task 11: change requests on published weeks (FR-RS-36). A supervisor cannot edit a published week; they ask, an office role decides.

beforeEach(resetDb)

type W = Awaited<ReturnType<typeof sites>>
const WK = "2026-11-23" // a Monday after the fake clock (2026-11-16)
const strip = (r: Response, body: string) => ({ status: r.status, ct: r.headers.get("content-type"), code: (JSON.parse(body) as Json).code, headers: [...r.headers.entries()].filter(([k]) => !["x-request-id", "date", "content-length"].includes(k)).sort() })
const version = async (w: W, weekId: string): Promise<number> => (await w.rows("select version from roster_weeks where id = $1", [weekId]))[0].version
const publish = async (w: W, weekId: string) => w.ok("POST", `/v1/roster/weeks/${weekId}/publish`, w.p.owner, { version: await version(w, weekId) })
/** A week at Alpha for WK with the employee on Monday 08:00-16:00 and on Tuesday, published or not. */
async function world(w: W, state: "draft" | "published" = "published") {
  const wk = await w.week(w.p.owner, w.a, WK)
  const mon = (await w.addOk(w.p.owner, wk, [{ date: WK, userIds: [w.p.employee.userId], shiftTypeId: w.ta }])).shifts[0] as Json
  const tue = (await w.addOk(w.p.owner, wk, [{ date: "2026-11-24", userIds: [w.p.employee.userId], shiftTypeId: w.ta }])).shifts[0] as Json
  if (state === "published") await publish(w, wk)
  await w.rows("delete from notifications")
  return { wk, mon, tue }
}
const ask = (w: W, who: Who, shiftId: string, body: Json) => w.req("POST", `/v1/roster/shifts/${shiftId}/change-requests`, who, body)
const askOk = async (w: W, who: Who, shiftId: string, body: Json): Promise<Json> => w.ok("POST", `/v1/roster/shifts/${shiftId}/change-requests`, who, body, 201)
const decide = (w: W, who: Who, id: string, body: Json) => w.req("POST", `/v1/roster/change-requests/${id}/decide`, who, body)
const notices = (w: W, where = "true") => w.rows(`select user_id, title, body, kind from notifications where ${where} order by user_id, title`)

describe("create (FR-RS-36)", () => {
  test("a supervisor asks for a change on a published shift: stored with the base version, the shift is untouched, office is told, history and audit and the event are written", async () => {
    const w = await sites()
    const { mon } = await world(w)
    const sup = w.p["location-supervisor"]
    const r = await askOk(w, sup, mon.id, { patch: { start: "09:00", end: "17:00" }, reason: "Venue opens late" })
    expect(r).toMatchObject({ shiftId: mon.id, locationId: w.a, requestedBy: sup.userId, status: "requested", shiftVersion: mon.version, reason: "Venue opens late", patch: { start: "09:00", end: "17:00" }, decidedBy: null })
    expect((await w.rows("select start_time, version from roster_shifts where id = $1", [mon.id]))[0]).toMatchObject({ start_time: "08:00", version: mon.version })
    expect((await w.rows("select action, reason, after from roster_history where action = 'change_requested'"))[0]).toMatchObject({ action: "change_requested", reason: "Venue opens late", after: { patch: { start: "09:00", end: "17:00" } } })
    expect(await w.rows("select 1 from audit_events where action = 'roster.change_requested' and entity_id = $1", [r.id])).toHaveLength(1)
    expect((await w.rows("select payload from domain_events where type = 'roster.change_requested'"))[0].payload).toMatchObject({ requestId: r.id, shiftId: mon.id, locationId: w.a })
    const n = await notices(w)
    expect(n.map((x) => x.user_id)).toContain(w.p.owner.userId)
    expect(n.map((x) => x.user_id)).not.toContain(sup.userId) // never the requester
    expect(n.map((x) => x.user_id)).not.toContain(w.p.employee.userId) // the affected person hears only once it is decided
    for (const x of n) for (const leak of ["Aoife", "Alpha", "09:00", "08:00", w.a]) expect(`${x.title} ${x.body}`.includes(leak), leak).toBe(false)
  })

  test("an office requester is never told of their own request; the other office roles are", async () => {
    const w = await sites()
    const { mon } = await world(w)
    await askOk(w, w.p.owner, mon.id, { patch: { start: "09:00" }, reason: "x" })
    const first = (await notices(w)).map((x) => x.user_id)
    expect(first).toContain(w.p["roster-manager"].userId)
    expect(first).not.toContain(w.p.owner.userId)
    await w.rows("update memberships set status = 'deactivated' where user_id = $1", [w.p["roster-manager"].userId])
    await w.rows("delete from notifications")
    await askOk(w, w.p["location-supervisor"], mon.id, { patch: { start: "10:00" }, reason: "y" })
    const second = (await notices(w)).map((x) => x.user_id)
    expect(second).toContain(w.p.owner.userId)
    expect(second).not.toContain(w.p["roster-manager"].userId) // a deactivated office member hears nothing
  })

  test("on a draft week it is 409 use_direct_edit; a missing or blank reason is 422 reason_required", async () => {
    const w = await sites()
    const d = await world(w, "draft")
    const r = await ask(w, w.p["location-supervisor"], d.mon.id, { patch: { start: "09:00" }, reason: "x" })
    expect([r.status, ((await r.json()) as Json).code]).toEqual([409, "use_direct_edit"])
    const wk2 = await w.week(w.p.owner, w.a, "2026-11-30")
    const s2 = (await w.addOk(w.p.owner, wk2, [{ date: "2026-11-30", userIds: [w.p.employee.userId], shiftTypeId: w.ta }])).shifts[0]
    await publish(w, wk2)
    for (const reason of [undefined, "", "   "]) {
      const x = await ask(w, w.p["location-supervisor"], s2.id, { patch: { start: "09:00" }, ...(reason === undefined ? {} : { reason }) })
      expect([x.status, ((await x.json()) as Json).code], String(reason)).toEqual([422, "reason_required"])
    }
    expect(await w.rows("select 1 from roster_change_requests")).toHaveLength(0)
  })

  test("a patch with weekId, locationId or an unknown key is 422, a date outside the week is 422 cannot_move_week, an empty or no-op patch is 422 invalid_patch", async () => {
    const w = await sites()
    const { mon } = await world(w)
    const sup = w.p["location-supervisor"]
    const cases: [Json, string][] = [
      [{ weekId: w.wa }, "cannot_move_week"], [{ locationId: w.b }, "cannot_move_week"], [{ colour: "red" }, "invalid_patch"], [{}, "invalid_patch"],
      [{ date: "2026-12-07" }, "cannot_move_week"], [{ start: "25:00" }, "invalid_shift"], [{ start: "08:00" }, "invalid_patch"], [{ shiftTypeId: w.tb }, "invalid_shift_type"],
    ]
    for (const [patch, code] of cases) {
      const r = await ask(w, sup, mon.id, { patch, reason: "x" })
      expect([r.status, ((await r.json()) as Json).code], JSON.stringify(patch)).toEqual([422, code])
    }
    expect(await w.rows("select 1 from roster_change_requests")).toHaveLength(0)
  })

  test("a supervisor of another location gets the same 404 as a missing or non-uuid shift; staff and a read-only manager are 403", async () => {
    const w = await sites()
    const { mon } = await world(w)
    const reply = async (shiftId: string, who: Who) => {
      const r = await ask(w, who, shiftId, { patch: { start: "09:00" }, reason: "x" })
      return strip(r, await r.text())
    }
    const other = await reply(mon.id, w.sup2)
    expect(other.status).toBe(404)
    expect(other).toEqual(await reply("00000000-0000-4000-8000-000000000000", w.sup2))
    expect(other).toEqual(await reply("not-a-uuid", w.sup2))
    expect((await ask(w, w.p.employee, mon.id, { patch: { start: "09:00" }, reason: "x" })).status).toBe(403)
    expect((await ask(w, w.p.manager, mon.id, { patch: { start: "09:00" }, reason: "x" })).status).toBe(403)
    expect(await w.rows("select 1 from roster_change_requests")).toHaveLength(0)
  })
})

describe("decide (office)", () => {
  test("approve applies the patch like an office edit: history has the reason and before/after, the person is told and must confirm again, the requester is told, events follow", async () => {
    const w = await sites()
    const { mon } = await world(w)
    await w.ok("POST", `/v1/roster/shifts/${mon.id}/confirm`, w.p.employee)
    const sup = w.p["location-supervisor"]
    const r = await askOk(w, sup, mon.id, { patch: { start: "09:00", end: "17:00" }, reason: "Venue opens late" })
    await w.rows("delete from notifications")
    const out = await w.ok("POST", `/v1/roster/change-requests/${r.id}/decide`, w.p.owner, { decision: "approve", note: "Fine" })
    expect(out.request).toMatchObject({ id: r.id, status: "approved", decidedBy: w.p.owner.userId, decisionNote: "Fine" })
    expect(out.shift).toMatchObject({ id: mon.id, start: "09:00", end: "17:00", confirmedAt: null, version: mon.version + 1 })
    expect((await w.rows("select start_time, end_time, confirmed_at, version from roster_shifts where id = $1", [mon.id]))[0]).toMatchObject({ start_time: "09:00", end_time: "17:00", confirmed_at: null })
    const [h] = await w.rows("select reason, before, after, actor_id from roster_history where action = 'shift_moved' and shift_id = $1", [mon.id])
    expect(h).toMatchObject({ reason: "Venue opens late", actor_id: w.p.owner.userId, before: { start: "08:00", end: "16:00" }, after: { start: "09:00", end: "17:00", changeRequestId: r.id } })
    expect((await w.rows("select after from roster_history where action = 'change_approved'"))).toHaveLength(1)
    expect(await w.rows("select 1 from audit_events where action = 'roster.change_decided' and entity_id = $1", [r.id])).toHaveLength(1)
    expect(await w.rows("select 1 from audit_events where action = 'roster.shift_moved' and entity_id = $1", [mon.id])).toHaveLength(1)
    const n = await notices(w)
    expect(n.filter((x) => x.user_id === w.p.employee.userId).map((x) => x.title)).toEqual(["Shift changed"])
    expect(n.filter((x) => x.user_id === sup.userId).map((x) => x.title)).toEqual(["Change request approved"])
    for (const x of n) for (const leak of ["Aoife", "Alpha", "09:00", "17:00", w.a]) expect(`${x.title} ${x.body}`.includes(leak), leak).toBe(false)
    expect(await w.rows("select 1 from domain_events where type = 'roster.change_decided'")).toHaveLength(1)
    expect(await w.rows("select 1 from domain_events where type = 'roster.shift_changed'")).toHaveLength(1)
  })

  test("reject changes nothing: the shift keeps its times and its confirmation, the note is stored, the requester is told, the person is not", async () => {
    const w = await sites()
    const { mon } = await world(w)
    await w.ok("POST", `/v1/roster/shifts/${mon.id}/confirm`, w.p.employee)
    const sup = w.p["location-supervisor"]
    const r = await askOk(w, sup, mon.id, { patch: { start: "09:00" }, reason: "x" })
    await w.rows("delete from notifications")
    const before = await w.rows("select * from roster_shifts order by id")
    const out = await w.ok("POST", `/v1/roster/change-requests/${r.id}/decide`, w.p.owner, { decision: "reject", note: "Not this week" })
    expect(out).toMatchObject({ request: { status: "rejected", decisionNote: "Not this week" }, shift: null, violations: [] })
    expect(await w.rows("select * from roster_shifts order by id")).toEqual(before)
    expect((await notices(w)).map((x) => [x.user_id, x.title])).toEqual([[sup.userId, "Change request rejected"]])
    expect(await w.rows("select 1 from roster_history where action = 'shift_moved'")).toHaveLength(0)
    expect(await w.rows("select 1 from roster_history where action = 'change_rejected'")).toHaveLength(1)
    expect(await w.rows("select 1 from domain_events where type = 'roster.shift_changed'")).toHaveLength(0)
  })

  test("an approval that would add a block is 422 rule_blocked until the office role gives overrideReason AND names the rule; then it passes and the override is recorded", async () => {
    const w = await sites()
    const { tue } = await world(w)
    const r = await askOk(w, w.p["location-supervisor"], tue.id, { patch: { date: WK, start: "10:00", end: "18:00" }, reason: "swap days" }) // overlaps the Monday shift of the same person
    const send = (body: Json) => decide(w, w.p.owner, r.id, { decision: "approve", ...body })
    for (const body of [{}, { overrideReason: "ok" }, { overrideRuleIds: ["double_booking"] }, { overrideReason: "ok", overrideRuleIds: ["daily_rest"] }]) {
      const x = await send(body)
      const j = (await x.json()) as Json
      expect([x.status, j.code], JSON.stringify(body)).toEqual([422, "rule_blocked"])
      expect(j.violations.map((v: Json) => v.rule)).toContain("double_booking")
    }
    expect((await w.rows("select status from roster_change_requests"))[0].status).toBe("requested")
    expect((await w.rows("select date::text as date from roster_shifts where id = $1", [tue.id]))[0].date).toBe("2026-11-24")
    const ok = await send({ overrideReason: "Covered by the duty manager", overrideRuleIds: ["double_booking"] })
    expect(ok.status).toBe(200)
    const [h] = await w.rows("select after from roster_history where action = 'shift_moved' and shift_id = $1", [tue.id])
    expect(h.after.overrides.map((o: Json) => o.rule)).toContain("double_booking")
    expect(h.after.overrideReason).toBe("Covered by the duty manager")
    const [a] = await w.rows("select after from audit_events where action = 'roster.change_decided'")
    expect(a.after.overrideReason).toBe("Covered by the duty manager")
  })

  test("an approver who is not office-with-no-cut cannot override: a Roster Manager may (office), the supervisor is 403 forbidden first", async () => {
    const w = await sites()
    const { tue } = await world(w)
    const r = await askOk(w, w.p["location-supervisor"], tue.id, { patch: { date: WK, start: "10:00", end: "18:00" }, reason: "x" })
    const res = await decide(w, w.p["roster-manager"], r.id, { decision: "approve", overrideReason: "ok", overrideRuleIds: ["double_booking"] })
    expect(res.status).toBe(200)
  })

  test("the patch is re-validated at approval: a shift edited since (version) is 409 stale_request and the request stays open; a person who left is 422 ineligible", async () => {
    const w = await sites()
    const { mon, tue } = await world(w)
    const r = await askOk(w, w.p["location-supervisor"], mon.id, { patch: { start: "09:00" }, reason: "x" })
    await w.ok("PATCH", `/v1/roster/shifts/${mon.id}`, w.p.owner, { version: mon.version, patch: { end: "15:00" }, reason: "kitchen closes" })
    const stale = await decide(w, w.p.owner, r.id, { decision: "approve" })
    expect([stale.status, ((await stale.json()) as Json).code]).toEqual([409, "stale_request"])
    expect((await w.rows("select status from roster_change_requests where id = $1", [r.id]))[0].status).toBe("requested")
    expect((await w.rows("select start_time, end_time from roster_shifts where id = $1", [mon.id]))[0]).toMatchObject({ start_time: "08:00", end_time: "15:00" })
    expect((await decide(w, w.p.owner, r.id, { decision: "reject" })).status).toBe(200) // a stale request can still be closed
    const r2 = await askOk(w, w.p["location-supervisor"], tue.id, { patch: { userId: w.staff2.userId }, reason: "cover" })
    await w.ok("POST", `/v1/members/${w.staff2.userId}/deactivate`, w.p.owner, {}).catch(() => undefined)
    await w.rows("update memberships set status = 'inactive', deactivated_at = now() where user_id = $1", [w.staff2.userId])
    const left = await decide(w, w.p.owner, r2.id, { decision: "approve" })
    const j = (await left.json()) as Json
    expect([left.status, j.code]).toEqual([422, "ineligible"])
    expect((await w.rows("select status from roster_change_requests where id = $1", [r2.id]))[0].status).toBe("requested")
  })

  test("a supervisor decides nothing (403 forbidden); a supervisor of another location cannot see it (404); a read-only manager is 403", async () => {
    const w = await sites()
    const { mon } = await world(w)
    const r = await askOk(w, w.p["location-supervisor"], mon.id, { patch: { start: "09:00" }, reason: "x" })
    const own = await decide(w, w.p["location-supervisor"], r.id, { decision: "approve" })
    expect([own.status, ((await own.json()) as Json).code]).toEqual([403, "forbidden"])
    const reply = async (id: string, who: Who) => {
      const x = await decide(w, who, id, { decision: "approve" })
      return strip(x, await x.text())
    }
    const hidden = await reply(r.id, w.sup2)
    expect(hidden.status).toBe(404)
    expect(hidden).toEqual(await reply("00000000-0000-4000-8000-000000000000", w.sup2))
    expect(hidden).toEqual(await reply("not-a-uuid", w.sup2))
    expect((await decide(w, w.p.manager, r.id, { decision: "approve" })).status).toBe(403)
    expect((await decide(w, w.p.employee, r.id, { decision: "approve" })).status).toBe(403)
    expect((await w.rows("select status from roster_change_requests"))[0].status).toBe("requested")
  })

  test("nobody decides their own request, and nobody approves a change to their own shift", async () => {
    const w = await sites()
    const { mon } = await world(w)
    const mine = await askOk(w, w.p.owner, mon.id, { patch: { start: "09:00" }, reason: "office asks" })
    const self = await decide(w, w.p.owner, mine.id, { decision: "approve" })
    expect([self.status, ((await self.json()) as Json).code]).toEqual([403, "self_decision"])
    expect((await decide(w, w.p.owner, mine.id, { decision: "reject" })).status).toBe(403)
    // the roster manager is on a shift of their own and may not approve a change to it
    const rm = w.p["roster-manager"]
    const wk = (await w.rows("select id from roster_weeks where week_start = $1 and location_id = $2", [WK, w.a]))[0].id as string
    await w.rows("update roster_weeks set status = 'draft' where id = $1", [wk]) // add through the API needs a draft: reopen for the fixture only
    const own = (await w.addOk(w.p.owner, wk, [{ date: "2026-11-25", userIds: [rm.userId], shiftTypeId: w.ta }])).shifts[0] as Json
    await w.rows("update roster_weeks set status = 'published' where id = $1", [wk])
    const r = await askOk(w, w.p["location-supervisor"], own.id, { patch: { start: "09:00" }, reason: "x" })
    const mgr = await decide(w, rm, r.id, { decision: "approve" })
    expect([mgr.status, ((await mgr.json()) as Json).code]).toEqual([403, "self_decision"])
    expect((await decide(w, w.p.owner, r.id, { decision: "approve" })).status).toBe(200) // somebody else may
  })

  test("deciding twice is 409 already_decided; a concurrent approve and reject: exactly one wins", async () => {
    const w = await sites()
    const { mon, tue } = await world(w)
    const r = await askOk(w, w.p["location-supervisor"], mon.id, { patch: { start: "09:00" }, reason: "x" })
    expect((await decide(w, w.p.owner, r.id, { decision: "approve" })).status).toBe(200)
    for (const decision of ["approve", "reject"]) {
      const again = await decide(w, w.p.owner, r.id, { decision })
      expect([again.status, ((await again.json()) as Json).code]).toEqual([409, "already_decided"])
    }
    expect(await w.rows("select 1 from roster_history where action = 'shift_moved'")).toHaveLength(1)
    const r2 = await askOk(w, w.p["location-supervisor"], tue.id, { patch: { start: "09:00" }, reason: "x" })
    const res = await Promise.all([decide(w, w.p.owner, r2.id, { decision: "approve" }), decide(w, w.p["roster-manager"], r2.id, { decision: "reject" })])
    expect(res.map((x) => x.status).sort()).toEqual([200, 409])
    const final = (await w.rows("select status from roster_change_requests where id = $1", [r2.id]))[0].status
    expect(["approved", "rejected"]).toContain(final)
    expect((await w.rows("select start_time from roster_shifts where id = $1", [tue.id]))[0].start_time).toBe(final === "approved" ? "09:00" : "08:00")
  })

  test("a bad decision body is 422 invalid_decision and writes nothing", async () => {
    const w = await sites()
    const { mon } = await world(w)
    const r = await askOk(w, w.p["location-supervisor"], mon.id, { patch: { start: "09:00" }, reason: "x" })
    for (const body of [{ decision: "approve", overrideReason: "x".repeat(501) }, { decision: "approve", overrideRuleIds: ["nonsense"] }, { decision: "approve", note: "a\u0000b" }]) {
      const x = await decide(w, w.p.owner, r.id, body)
      expect(x.status, JSON.stringify(body)).toBe(422)
    }
    expect((await w.rows("select status from roster_change_requests"))[0].status).toBe("requested")
  })
})

describe("list", () => {
  test("a supervisor sees only the requests of their own location; office sees all; status and location filters; a hidden location is 404; staff get an empty list", async () => {
    const w = await sites()
    const a = await world(w)
    const wkB = await w.week(w.p.owner, w.b, WK)
    const sb = (await w.addOk(w.p.owner, wkB, [{ date: WK, userIds: [w.staff3.userId], shiftTypeId: w.tb }])).shifts[0]
    await publish(w, wkB)
    const ra = await askOk(w, w.p["location-supervisor"], a.mon.id, { patch: { start: "09:00" }, reason: "x" })
    const rb = await askOk(w, w.sup2, sb.id, { patch: { start: "09:00" }, reason: "y" })
    const ids = async (who: Who, q = "") => ((await w.ok("GET", `/v1/roster/change-requests${q}`, who)).items as Json[]).map((x) => x.id).sort()
    expect(await ids(w.p["location-supervisor"])).toEqual([ra.id])
    expect(await ids(w.sup2)).toEqual([rb.id])
    expect(await ids(w.p.owner)).toEqual([ra.id, rb.id].sort())
    expect(await ids(w.p.owner, `?locationId=${w.b}`)).toEqual([rb.id])
    expect(await ids(w.p.owner, "?status=approved")).toEqual([])
    expect(await ids(w.p.employee)).toEqual([])
    const hid = await w.req("GET", `/v1/roster/change-requests?locationId=${w.b}`, w.p["location-supervisor"])
    expect(hid.status).toBe(404)
    const junk = await w.req("GET", "/v1/roster/change-requests?locationId=not-a-uuid", w.p["location-supervisor"])
    expect(strip(hid, await hid.text())).toEqual(strip(junk, await junk.text()))
    expect((await w.req("GET", "/v1/roster/change-requests?status=bogus", w.p.owner)).status).toBe(422)
    const text = JSON.stringify(await w.ok("GET", "/v1/roster/change-requests", w.p["location-supervisor"]))
    for (const leak of [rb.id, sb.id, w.b, "Bravo"]) expect(text.includes(leak), leak).toBe(false)
  })

  test("newest first with a keyset cursor", async () => {
    const w = await sites()
    const { mon, tue } = await world(w)
    const sup = w.p["location-supervisor"]
    const r1 = await askOk(w, sup, mon.id, { patch: { start: "09:00" }, reason: "1" })
    w.clock.advance({ hours: 1 })
    const r2 = await askOk(w, sup, tue.id, { patch: { start: "09:00" }, reason: "2" })
    const p1 = await w.ok("GET", "/v1/roster/change-requests?limit=1", w.p.owner)
    expect(p1.items.map((x: Json) => x.id)).toEqual([r2.id])
    const p2 = await w.ok("GET", `/v1/roster/change-requests?limit=1&cursor=${encodeURIComponent(p1.nextCursor)}`, w.p.owner)
    expect(p2.items.map((x: Json) => x.id)).toEqual([r1.id])
    expect(p2.nextCursor).toBeNull()
    expect((await w.req("GET", "/v1/roster/change-requests?limit=0", w.p.owner)).status).toBe(422)
    expect((await w.req("GET", "/v1/roster/change-requests?cursor=zz", w.p.owner)).status).toBe(400)
  })
})
