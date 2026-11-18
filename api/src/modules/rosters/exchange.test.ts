import { beforeEach, describe, expect, test } from "vitest"
import { resetDb } from "../../../test/harness"
import { sites, type Json, type Who } from "./testkit"

// B8 Task 12: open shifts, claims and swaps with delegated approval (FR-RS-38, 42, 43; R8-11, Review Focus 1 and 2).

beforeEach(resetDb)

type W = Awaited<ReturnType<typeof sites>>
const WK = "2026-11-23" // a Monday after the fake clock (2026-11-16)
const strip = (r: Response, body: string) => ({ status: r.status, ct: r.headers.get("content-type"), code: (JSON.parse(body) as Json).code, headers: [...r.headers.entries()].filter(([k]) => !["x-request-id", "date", "content-length"].includes(k)).sort() })
const version = async (w: W, weekId: string): Promise<number> => (await w.rows("select version from roster_weeks where id = $1", [weekId]))[0].version
const publish = async (w: W, weekId: string) => w.ok("POST", `/v1/roster/weeks/${weekId}/publish`, w.p.owner, { version: await version(w, weekId) })
const claim = (w: W, who: Who, shiftId: string) => w.req("POST", `/v1/roster/shifts/${shiftId}/claim`, who)
const swap = (w: W, who: Who, shiftId: string, toUserId: string, note?: string) => w.req("POST", `/v1/roster/shifts/${shiftId}/swap`, who, { toUserId, ...(note === undefined ? {} : { note }) })
const decide = (w: W, who: Who, id: string, body: Json) => w.req("POST", `/v1/roster/exchanges/${id}/decide`, who, body)
const recommend = (w: W, who: Who, id: string) => w.req("POST", `/v1/roster/exchanges/${id}/recommend`, who)
const cancel = (w: W, who: Who, id: string) => w.req("POST", `/v1/roster/exchanges/${id}/cancel`, who)
const code = async (r: Response): Promise<[number, string]> => [r.status, ((await r.json()) as Json).code]
const claimOk = async (w: W, who: Who, shiftId: string, status = 201): Promise<Json> => w.ok("POST", `/v1/roster/shifts/${shiftId}/claim`, who, undefined, status)
const swapOk = async (w: W, who: Who, shiftId: string, toUserId: string): Promise<Json> => w.ok("POST", `/v1/roster/shifts/${shiftId}/swap`, who, { toUserId }, 201)
const notices = (w: W, where = "true") => w.rows(`select user_id, title, body, kind from notifications where ${where} order by user_id, title`)
/** The shift has started on the fake clock (2026-11-16T09:00Z): its stored instants move to the day before. */
const past = (w: W, shiftId: string) => w.rows("update roster_shifts set start_at = '2026-11-15T08:00:00Z', end_at = '2026-11-15T16:00:00Z' where id = $1", [shiftId])
const delegate = async (w: W, on: boolean) => {
  const loc = await w.ok("GET", `/v1/locations/${w.a}`, w.p.owner)
  await w.ok("PATCH", `/v1/locations/${w.a}`, w.p.owner, { version: loc.version, swapApprovalDelegated: on })
}

/** Alpha for WK: the employee and Cian (staff2) are homed there, Dara (staff3) is homed at Bravo. An open shift Monday 08:00-16:00 and the employee on Tuesday; published or a draft. */
async function world(w: W, state: "draft" | "published" = "published", o: { requires?: string[] } = {}) {
  for (const u of [w.p.employee, w.staff2]) await w.ok("PUT", `/v1/members/${u.userId}/home-location`, w.p.owner, { locationId: w.a })
  await w.ok("PUT", `/v1/members/${w.staff3.userId}/home-location`, w.p.owner, { locationId: w.b })
  const type = o.requires ? await w.type(w.a, "Armed", { requires: o.requires }) : w.ta
  const wk = await w.week(w.p.owner, w.a, WK)
  const open = (await w.addOk(w.p.owner, wk, [{ date: WK, userIds: [null], shiftTypeId: type }])).shifts[0] as Json
  const tue = (await w.addOk(w.p.owner, wk, [{ date: "2026-11-24", userIds: [w.p.employee.userId], shiftTypeId: w.ta }])).shifts[0] as Json
  if (state === "published") await publish(w, wk)
  await w.rows("delete from notifications")
  return { wk, open, tue, type }
}

describe("claim (FR-RS-38)", () => {
  test("a located member claims an open shift of a published, upcoming week: stored, approvers told (generic), history, audit and event; the shift is unchanged until approved", async () => {
    const w = await sites()
    const { open } = await world(w)
    const out = await claimOk(w, w.p.employee, open.id)
    expect(out).toMatchObject({ kind: "claim", shiftId: open.id, locationId: w.a, fromUserId: w.p.employee.userId, toUserId: null, status: "requested", expired: false, date: WK, start: "08:00", end: "16:00" })
    expect((await w.rows("select user_id from roster_shifts where id = $1", [open.id]))[0].user_id).toBeNull()
    expect(await w.rows("select 1 from roster_history where action = 'exchange_requested' and shift_id = $1", [open.id])).toHaveLength(1)
    expect(await w.rows("select 1 from audit_events where action = 'roster.exchange_requested' and entity_id = $1", [out.id])).toHaveLength(1)
    expect((await w.rows("select payload from domain_events where type = 'roster.exchange_requested'"))[0].payload).toMatchObject({ exchangeId: out.id, kind: "claim", shiftId: open.id, locationId: w.a, fromUserId: w.p.employee.userId })
    const n = await notices(w)
    expect(n.map((x) => x.user_id)).toEqual(expect.arrayContaining([w.p.owner.userId, w.p["roster-manager"].userId, w.p["location-supervisor"].userId]))
    expect(n.map((x) => x.user_id)).not.toContain(w.p.employee.userId) // never the requester
    expect(n.map((x) => x.user_id)).not.toContain(w.sup2.userId) // not another site's supervisor
    for (const x of n) for (const leak of ["Aoife", "Alpha", "08:00", w.a, open.id]) expect(`${x.title} ${x.body}`.includes(leak), leak).toBe(false)
    expect(n.every((x) => x.body.includes("{{subject}}"))).toBe(true)
  })

  test("double click: the same open claim is returned (200), one row, one history line", async () => {
    const w = await sites()
    const { open } = await world(w)
    const first = await claimOk(w, w.p.employee, open.id, 201)
    const again = await claimOk(w, w.p.employee, open.id, 200)
    expect(again.id).toBe(first.id)
    expect(await w.rows("select 1 from roster_exchanges")).toHaveLength(1)
    expect(await w.rows("select 1 from roster_history where action = 'exchange_requested'")).toHaveLength(1)
    const [a, b] = await Promise.all([claim(w, w.staff2, open.id), claim(w, w.staff2, open.id)])
    expect([a.status, b.status].sort()).toEqual([200, 201])
    expect(await w.rows("select 1 from roster_exchanges where from_user_id = $1", [w.staff2.userId])).toHaveLength(1)
  })

  test("a claim on a draft week is 409 week_not_published; on an assigned shift 409 shift_not_open; on a shift that has started 409 shift_started", async () => {
    const w = await sites()
    const d = await world(w, "draft")
    expect(await code(await claim(w, w.p.employee, d.open.id))).toEqual([409, "week_not_published"])
    await publish(w, d.wk)
    expect(await code(await claim(w, w.staff2, d.tue.id))).toEqual([409, "shift_not_open"])
    await past(w, d.open.id) // the shift has started
    expect(await code(await claim(w, w.p.employee, d.open.id))).toEqual([409, "shift_started"])
    expect(await w.rows("select 1 from roster_exchanges")).toHaveLength(0)
  })

  test("claim needs eligibility: a missing or an expired required licence is 422 ineligible (nothing stored)", async () => {
    const w = await sites()
    const { open } = await world(w, "published", { requires: ["firearms"] })
    const missing = await claim(w, w.p.employee, open.id)
    const j = (await missing.json()) as Json
    expect([missing.status, j.code]).toEqual([422, "ineligible"])
    expect(j.errors).toEqual([{ userId: w.p.employee.userId, date: WK, reason: "qualification_missing", qualification: "firearms" }])
    await w.ok("PUT", `/v1/members/${w.p.employee.userId}/qualifications`, w.p.owner, { qualifications: [{ type: "firearms", expiresOn: "2026-11-20" }] })
    const expired = (await (await claim(w, w.p.employee, open.id)).json()) as Json
    expect(expired).toMatchObject({ code: "ineligible", errors: [{ reason: "qualification_expired" }] })
    expect(await w.rows("select 1 from roster_exchanges")).toHaveLength(0)
    await w.ok("PUT", `/v1/members/${w.p.employee.userId}/qualifications`, w.p.owner, { qualifications: [{ type: "FIREARMS", expiresOn: "2026-11-23" }] }) // canonical lower case, valid through the shift date
    expect((await claim(w, w.p.employee, open.id)).status).toBe(201)
  })

  test("a person who left since the claim is 422 ineligible at approval", async () => {
    const w = await sites()
    const { open } = await world(w)
    const c = await claimOk(w, w.staff2, open.id)
    await w.rows("update memberships set status = 'deactivated', deactivated_at = now() where user_id = $1", [w.staff2.userId])
    const r = await decide(w, w.p.owner, c.id, { decision: "approve" })
    const j = (await r.json()) as Json
    expect([r.status, j.code]).toEqual([422, "ineligible"])
    expect(j.errors[0].reason).toBe("left")
  })

  test("a member who is neither homed nor rostered at the site gets the same 404 as a missing or non-uuid shift", async () => {
    const w = await sites()
    const { open } = await world(w)
    const reply = async (shiftId: string, who: Who) => {
      const r = await claim(w, who, shiftId)
      return strip(r, await r.text())
    }
    const hidden = await reply(open.id, w.staff3) // homed at Bravo
    expect(hidden.status).toBe(404)
    expect(hidden).toEqual(await reply("00000000-0000-4000-8000-000000000000", w.staff3))
    expect(hidden).toEqual(await reply("not-a-uuid", w.staff3))
    await w.addOk(w.p.owner, (await w.rows("select id from roster_weeks where location_id = $1 and week_start = $2", [w.a, WK]))[0].id, [{ date: "2026-11-25", userIds: [w.staff3.userId], shiftTypeId: w.ta }], { reason: "loan" })
    expect((await claim(w, w.staff3, open.id)).status).toBe(201) // rostered at the site that week: a cross-site loan may claim
  })
})

describe("state guards", () => {
  test("an archived site: claim and swap are 409 location_archived, nothing stored", async () => {
    const w = await sites()
    const { open, tue } = await world(w)
    await w.ok("POST", `/v1/locations/${w.a}/archive`, w.p.owner, undefined)
    expect(await code(await claim(w, w.p.employee, open.id))).toEqual([409, "location_archived"])
    expect(await code(await swap(w, w.p.employee, tue.id, w.staff2.userId))).toEqual([409, "location_archived"])
    expect(await w.rows("select 1 from roster_exchanges")).toHaveLength(0)
  })

  test("a swap of a shift that has started is 409 shift_started; an exchange that expired cannot be recommended", async () => {
    const w = await sites()
    const { open, tue } = await world(w)
    const c = await claimOk(w, w.staff2, open.id)
    await past(w, open.id)
    expect(await code(await recommend(w, w.p["location-supervisor"], c.id))).toEqual([409, "exchange_expired"])
    await past(w, tue.id)
    expect(await code(await swap(w, w.p.employee, tue.id, w.staff2.userId))).toEqual([409, "shift_started"])
  })

  test("an approval that would create an identical shift for the incoming person is 409 shift_exists even with an override", async () => {
    const w = await sites()
    const { wk, tue } = await world(w)
    await w.rows("update roster_weeks set status = 'draft' where id = $1", [wk])
    await w.addOk(w.p.owner, wk, [{ date: "2026-11-24", userIds: [w.staff2.userId], shiftTypeId: w.ta }]) // the very same shift Cian already has
    await w.rows("update roster_weeks set status = 'published' where id = $1", [wk])
    const s = await swapOk(w, w.p.employee, tue.id, w.staff2.userId)
    expect(await code(await decide(w, w.p.owner, s.id, { decision: "approve", overrideReason: "ok", overrideRuleIds: ["double_booking"] }))).toEqual([409, "shift_exists"])
  })
})

describe("two claims on one open shift", () => {
  test("both are stored; approving one leaves the other 409 shift_taken on approval; a concurrent approve of both has exactly one winner", async () => {
    const w = await sites()
    const { open } = await world(w)
    const c1 = await claimOk(w, w.p.employee, open.id)
    const c2 = await claimOk(w, w.staff2, open.id)
    expect(await w.rows("select 1 from roster_exchanges")).toHaveLength(2)
    expect((await decide(w, w.p.owner, c1.id, { decision: "approve" })).status).toBe(200)
    expect((await w.rows("select user_id from roster_shifts where id = $1", [open.id]))[0].user_id).toBe(w.p.employee.userId)
    expect(await code(await decide(w, w.p.owner, c2.id, { decision: "approve" }))).toEqual([409, "shift_taken"])
    expect((await w.rows("select status from roster_exchanges where id = $1", [c2.id]))[0].status).toBe("requested") // still open: the approver may reject it
    expect((await decide(w, w.p.owner, c2.id, { decision: "reject" })).status).toBe(200)
  })

  test("racing approvals: exactly one wins, the shift has one owner", async () => {
    const w = await sites()
    const { open } = await world(w)
    const c1 = await claimOk(w, w.p.employee, open.id)
    const c2 = await claimOk(w, w.staff2, open.id)
    const res = await Promise.all([decide(w, w.p.owner, c1.id, { decision: "approve" }), decide(w, w.p["roster-manager"], c2.id, { decision: "approve" })])
    expect(res.map((r) => r.status).sort()).toEqual([200, 409])
    const owner = (await w.rows("select user_id from roster_shifts where id = $1", [open.id]))[0].user_id
    expect([w.p.employee.userId, w.staff2.userId]).toContain(owner)
    expect(await w.rows("select 1 from roster_exchanges where status = 'approved'")).toHaveLength(1)
  })
})

describe("approval (R8-11)", () => {
  test("approving a claim assigns the shift, bumps versions, clears confirmation, writes history and audit, tells the person and publishes the events", async () => {
    const w = await sites()
    const { open } = await world(w)
    const c = await claimOk(w, w.p.employee, open.id)
    await w.rows("delete from notifications")
    const out = await w.ok("POST", `/v1/roster/exchanges/${c.id}/decide`, w.p.owner, { decision: "approve", note: "Welcome" })
    expect(out.exchange).toMatchObject({ id: c.id, status: "approved", decidedBy: w.p.owner.userId })
    expect(out.shift).toMatchObject({ id: open.id, userId: w.p.employee.userId, confirmedAt: null, version: open.version + 1 })
    expect(out.violations).toEqual([])
    const [h] = await w.rows("select reason, before, after from roster_history where action = 'exchange_approved' and shift_id = $1", [open.id])
    expect(h).toMatchObject({ before: { userId: null }, after: { userId: w.p.employee.userId, exchangeId: c.id } })
    expect(await w.rows("select 1 from audit_events where action = 'roster.exchange_decided' and entity_id = $1", [c.id])).toHaveLength(1)
    expect((await w.rows("select payload from domain_events where type = 'roster.exchange_decided'"))[0].payload).toMatchObject({ exchangeId: c.id, decision: "approve", shiftId: open.id })
    expect(await w.rows("select 1 from domain_events where type = 'roster.shift_changed'")).toHaveLength(1)
    const n = await notices(w)
    expect(n.map((x) => [x.user_id, x.title])).toEqual([[w.p.employee.userId, "Claim approved"]])
    for (const x of n) for (const leak of ["Aoife", "Alpha", "08:00", w.a]) expect(`${x.title} ${x.body}`.includes(leak), leak).toBe(false)
  })

  test("approver matrix: a supervisor approves on a draft week; on a published week only office, unless the location delegates (then the supervisor too); staff never; nobody approves their own", async () => {
    const w = await sites()
    const sup = w.p["location-supervisor"]
    // draft week: a swap from the employee (Tuesday) to Cian
    const d = await world(w, "draft")
    const s1 = await swapOk(w, w.p.employee, d.tue.id, w.staff2.userId)
    expect(await code(await decide(w, w.p.employee, s1.id, { decision: "approve" }))).toEqual([403, "forbidden"]) // staff never
    expect(await code(await decide(w, w.sup2, s1.id, { decision: "approve" }))).toEqual([404, "exchange_not_found"]) // another site's supervisor cannot see it
    expect((await decide(w, sup, s1.id, { decision: "approve" })).status).toBe(200)
    // published week, no delegation: the supervisor is locked out (Review Focus 2), office decides
    await publish(w, d.wk)
    const s2 = await swapOk(w, w.staff2, d.tue.id, w.p.employee.userId) // Cian now holds Tuesday: hand it back
    const locked = await decide(w, sup, s2.id, { decision: "approve" })
    const lj = (await locked.json()) as Json
    expect([locked.status, lj.code]).toEqual([403, "roster_locked"])
    expect((await decide(w, sup, s2.id, { decision: "reject" })).status).toBe(403) // a rejection is a decision too
    expect((await w.rows("select status from roster_exchanges where id = $1", [s2.id]))[0].status).toBe("requested")
    await delegate(w, true)
    expect((await decide(w, sup, s2.id, { decision: "approve" })).status).toBe(200)
    await delegate(w, false)
    // nobody decides their own: the owner (office) claims an open shift and cannot approve it; the roster manager is the target of a swap and cannot approve it
    const wk2 = await w.week(w.p.owner, w.a, "2026-11-30")
    const open2 = (await w.addOk(w.p.owner, wk2, [{ date: "2026-11-30", userIds: [null], shiftTypeId: w.ta }])).shifts[0]
    const mine = (await w.addOk(w.p.owner, wk2, [{ date: "2026-12-01", userIds: [w.p.employee.userId], shiftTypeId: w.ta }])).shifts[0]
    await publish(w, wk2)
    const oc = await claimOk(w, w.p.owner, open2.id)
    expect(await code(await decide(w, w.p.owner, oc.id, { decision: "approve" }))).toEqual([403, "self_decision"])
    await w.ok("PUT", `/v1/members/${w.p["roster-manager"].userId}/home-location`, w.p.owner, { locationId: w.a })
    const toRm = await swapOk(w, w.p.employee, mine.id, w.p["roster-manager"].userId)
    expect(await code(await decide(w, w.p["roster-manager"], toRm.id, { decision: "approve" }))).toEqual([403, "self_decision"])
    expect((await decide(w, w.p.owner, toRm.id, { decision: "approve" })).status).toBe(200) // somebody else may
  })

  test("approval re-runs the rules: a block stops it (422 rule_blocked); office needs overrideReason and the rule ids, which are recorded; a delegated supervisor can never override", async () => {
    const w = await sites()
    const { wk, tue } = await world(w)
    // Cian already works Tuesday afternoon; the employee's Tuesday shift handed to Cian would double book him
    await w.rows("update roster_weeks set status = 'draft' where id = $1", [wk])
    await w.addOk(w.p.owner, wk, [{ date: "2026-11-24", userIds: [w.staff2.userId], shiftTypeId: w.ta, start: "12:00", end: "20:00" }])
    await w.rows("update roster_weeks set status = 'published' where id = $1", [wk])
    const s = await swapOk(w, w.p.employee, tue.id, w.staff2.userId)
    await delegate(w, true)
    const blocked = async (who: Who, body: Json) => {
      const r = await decide(w, who, s.id, { decision: "approve", ...body })
      const j = (await r.json()) as Json
      return [r.status, j.code, (j.violations ?? []).map((v: Json) => v.rule)]
    }
    expect(await blocked(w.p["location-supervisor"], {})).toEqual([422, "rule_blocked", expect.arrayContaining(["double_booking"])])
    expect(await blocked(w.p["location-supervisor"], { overrideReason: "x", overrideRuleIds: ["double_booking"] })).toEqual([422, "rule_blocked", expect.arrayContaining(["double_booking"])]) // a supervisor never overrides
    for (const body of [{}, { overrideReason: "ok" }, { overrideRuleIds: ["double_booking"] }, { overrideReason: "ok", overrideRuleIds: ["daily_rest"] }]) expect((await blocked(w.p.owner, body))[1], JSON.stringify(body)).toBe("rule_blocked")
    expect((await w.rows("select user_id from roster_shifts where id = $1", [tue.id]))[0].user_id).toBe(w.p.employee.userId)
    expect((await w.rows("select status from roster_exchanges where id = $1", [s.id]))[0].status).toBe("requested")
    expect((await blocked(w.p.owner, { overrideReason: "Covered by the duty manager", overrideRuleIds: ["double_booking"] }))[0]).toBe(200)
    const [h] = await w.rows("select reason, after from roster_history where action = 'exchange_approved'")
    expect(h.reason).toBe("Covered by the duty manager")
    expect(h.after.overrides.map((o: Json) => o.rule)).toContain("double_booking")
    expect((await w.rows("select after from audit_events where action = 'roster.exchange_decided'"))[0].after.overrideReason).toBe("Covered by the duty manager")
  })

  test("a swap approval moves the shift, tells both people, the handing-over person is not the new owner; a shift that changed hands meanwhile is 409 shift_changed", async () => {
    const w = await sites()
    const { tue } = await world(w)
    const s = await swapOk(w, w.p.employee, tue.id, w.staff2.userId)
    expect(s).toMatchObject({ kind: "swap", fromUserId: w.p.employee.userId, toUserId: w.staff2.userId, status: "requested" })
    const n0 = await notices(w, "title <> 'Roster published'")
    expect(n0.some((x) => x.user_id === w.staff2.userId && x.title === "Shift swap requested")).toBe(true) // the person it is handed to hears of it
    await w.ok("PATCH", `/v1/roster/shifts/${tue.id}`, w.p.owner, { version: tue.version, patch: { userId: w.staff3.userId }, reason: "reassigned" }).catch(() => undefined)
    // staff3 is homed at Bravo: the office may roster them; the exchange no longer matches the shift
    const r = await decide(w, w.p.owner, s.id, { decision: "approve" })
    expect([r.status, ((await r.json()) as Json).code]).toEqual([409, "shift_changed"])
  })

  test("a swap approval at a published week by office: the shift is Cian's, both are told, confirmation cleared", async () => {
    const w = await sites()
    const { tue } = await world(w)
    await w.ok("POST", `/v1/roster/shifts/${tue.id}/confirm`, w.p.employee)
    const s = await swapOk(w, w.p.employee, tue.id, w.staff2.userId)
    await w.rows("delete from notifications")
    const out = await w.ok("POST", `/v1/roster/exchanges/${s.id}/decide`, w.p.owner, { decision: "approve" })
    expect(out.shift).toMatchObject({ userId: w.staff2.userId, confirmedAt: null })
    expect((await notices(w)).map((x) => [x.user_id, x.title]).sort()).toEqual([[w.p.employee.userId, "Swap approved"], [w.staff2.userId, "Swap approved"]].sort())
  })

  test("reject changes nothing but the exchange: requester told, shift untouched, a decided exchange cannot be decided again", async () => {
    const w = await sites()
    const { open } = await world(w)
    const c = await claimOk(w, w.p.employee, open.id)
    await w.rows("delete from notifications")
    const before = await w.rows("select * from roster_shifts order by id")
    const out = await w.ok("POST", `/v1/roster/exchanges/${c.id}/decide`, w.p.owner, { decision: "reject", note: "Short notice" })
    expect(out).toMatchObject({ exchange: { status: "rejected" }, shift: null })
    expect(await w.rows("select * from roster_shifts order by id")).toEqual(before)
    expect((await notices(w)).map((x) => [x.user_id, x.title])).toEqual([[w.p.employee.userId, "Claim rejected"]])
    expect(await w.rows("select 1 from roster_history where action = 'exchange_rejected'")).toHaveLength(1)
    for (const decision of ["approve", "reject"]) expect(await code(await decide(w, w.p.owner, c.id, { decision }))).toEqual([409, "already_decided"])
    expect(await w.rows("select 1 from roster_exchanges where status = 'requested'")).toHaveLength(0) // the slot is free again: the same person may claim once more
    expect((await claim(w, w.p.employee, open.id)).status).toBe(201)
  })

  test("an exchange whose shift has started cannot be approved (409 exchange_expired) but can be rejected; it reads as expired", async () => {
    const w = await sites()
    const { open } = await world(w)
    const c = await claimOk(w, w.p.employee, open.id)
    await past(w, open.id)
    expect((await w.ok("GET", "/v1/roster/exchanges", w.p.owner)).items[0]).toMatchObject({ id: c.id, status: "requested", expired: true })
    expect(await code(await decide(w, w.p.owner, c.id, { decision: "approve" }))).toEqual([409, "exchange_expired"])
    expect((await decide(w, w.p.owner, c.id, { decision: "reject" })).status).toBe(200)
  })

  test("a bad decision body is 422 and writes nothing; an inactive requester is not told", async () => {
    const w = await sites()
    const { open } = await world(w)
    const c = await claimOk(w, w.p.employee, open.id)
    for (const body of [{ decision: "approve", note: "a\u0000b" }, { decision: "approve", overrideReason: "x".repeat(501) }, { decision: "approve", overrideRuleIds: ["nonsense"] }]) expect((await decide(w, w.p.owner, c.id, body)).status, JSON.stringify(body)).toBe(422)
    expect((await w.rows("select status from roster_exchanges"))[0].status).toBe("requested")
    await w.rows("update memberships set status = 'deactivated' where user_id = $1", [w.p.employee.userId])
    await w.rows("delete from notifications")
    expect((await decide(w, w.p.owner, c.id, { decision: "reject" })).status).toBe(200)
    expect(await notices(w)).toEqual([])
  })
})

describe("recommend and cancel", () => {
  test("a supervisor recommends on a published week (requested to recommended, once; office is told); on a draft week it is 409 week_not_published; the requester and staff may not", async () => {
    const w = await sites()
    const sup = w.p["location-supervisor"]
    const { open, tue, wk } = await world(w)
    const c = await claimOk(w, w.staff2, open.id)
    await w.rows("delete from notifications")
    expect((await recommend(w, w.p.employee, c.id)).status).toBe(403)
    expect((await recommend(w, w.sup2, c.id)).status).toBe(404)
    const r = await w.ok("POST", `/v1/roster/exchanges/${c.id}/recommend`, sup, undefined)
    expect(r.status).toBe("recommended")
    const told = (await notices(w)).map((x) => x.user_id)
    expect(told).toEqual(expect.arrayContaining([w.p.owner.userId, w.p["roster-manager"].userId]))
    expect(told).not.toContain(sup.userId) // not the recommender
    expect(told).not.toContain(w.staff2.userId) // not the requester
    expect((await recommend(w, sup, c.id)).status).toBe(200) // repeat: nothing more written
    expect(await w.rows("select 1 from roster_history where action = 'exchange_recommended'")).toHaveLength(1)
    expect((await decide(w, w.p.owner, c.id, { decision: "approve" })).status).toBe(200) // a recommended exchange is decided like a requested one
    expect(await code(await recommend(w, sup, c.id))).toEqual([409, "already_decided"])
    // a draft week: the supervisor decides directly, nothing to recommend
    await w.rows("update roster_weeks set status = 'draft' where id = $1", [wk])
    const s = await swapOk(w, w.p.employee, tue.id, w.staff2.userId)
    expect(await code(await recommend(w, sup, s.id))).toEqual([409, "week_not_published"])
  })

  test("cancel is the requester's only; a decided or cancelled exchange cannot be decided or cancelled; the slot is free again", async () => {
    const w = await sites()
    const { open } = await world(w)
    const c = await claimOk(w, w.p.employee, open.id)
    expect(await code(await cancel(w, w.staff2, c.id))).toEqual([404, "exchange_not_found"]) // another staff member cannot even see it
    expect(await code(await cancel(w, w.p["location-supervisor"], c.id))).toEqual([403, "forbidden"]) // a supervisor sees it but did not ask
    expect(await code(await cancel(w, w.sup2, c.id))).toEqual([404, "exchange_not_found"])
    const out = await w.ok("POST", `/v1/roster/exchanges/${c.id}/cancel`, w.p.employee, undefined)
    expect(out.status).toBe("cancelled")
    expect(await w.rows("select 1 from roster_history where action = 'exchange_cancelled'")).toHaveLength(1)
    expect(await code(await cancel(w, w.p.employee, c.id))).toEqual([409, "already_decided"])
    for (const decision of ["approve", "reject"]) expect(await code(await decide(w, w.p.owner, c.id, { decision }))).toEqual([409, "already_decided"])
    expect(await code(await recommend(w, w.p["location-supervisor"], c.id))).toEqual([409, "already_decided"])
    expect((await claim(w, w.p.employee, open.id)).status).toBe(201)
  })
})

describe("parties and archived sites", () => {
  test("nobody recommends or decides an exchange they are a party to, nor one about a shift that is now their own", async () => {
    const w = await sites()
    const rm = w.p["roster-manager"]
    const { tue } = await world(w)
    await w.ok("PUT", `/v1/members/${rm.userId}/home-location`, w.p.owner, { locationId: w.a })
    const toRm = await swapOk(w, w.p.employee, tue.id, rm.userId)
    expect(await code(await recommend(w, rm, toRm.id))).toEqual([403, "self_decision"])
    expect(await code(await decide(w, rm, toRm.id, { decision: "reject" }))).toEqual([403, "self_decision"])
    // the shift is handed to the roster manager by an office edit after another swap was asked: the manager is not a party to THAT exchange, but it is about their own shift
    await w.ok("PATCH", `/v1/roster/shifts/${tue.id}`, w.p.owner, { version: tue.version, patch: { userId: rm.userId }, reason: "reassigned" })
    const other = await w.rows("select id from roster_exchanges where to_user_id = $1", [rm.userId])
    await w.rows("update roster_exchanges set to_user_id = $1 where id = $2", [w.staff2.userId, other[0].id]) // the colleague of the open exchange is somebody else now
    expect(await code(await decide(w, rm, other[0].id, { decision: "approve" }))).toEqual([403, "self_decision"])
  })

  test("an approval at a site archived since is 409 location_archived (a rejection still works)", async () => {
    const w = await sites()
    const { open } = await world(w)
    const c = await claimOk(w, w.p.employee, open.id)
    await w.ok("POST", `/v1/locations/${w.a}/archive`, w.p.owner, undefined)
    expect(await code(await decide(w, w.p.owner, c.id, { decision: "approve" }))).toEqual([409, "location_archived"])
    expect((await decide(w, w.p.owner, c.id, { decision: "reject" })).status).toBe(200)
  })
})

describe("swap target visibility (Review Focus 1)", () => {
  test("a swap to a person at a site the requester cannot see is the same 404 as to nobody, and says nothing about them", async () => {
    const w = await sites()
    const { tue } = await world(w)
    const reply = async (toUserId: string) => {
      const r = await swap(w, w.p.employee, tue.id, toUserId)
      return strip(r, await r.text())
    }
    const hidden = await reply(w.staff3.userId) // Dara, homed at Bravo, nowhere on the Alpha week
    expect(hidden.status).toBe(404)
    expect(hidden).toEqual(await reply("usr_does_not_exist"))
    expect(hidden).toEqual(await reply("x".repeat(100)))
    const text = JSON.stringify(await (await swap(w, w.p.employee, tue.id, w.staff3.userId)).json())
    for (const leak of ["Dara", "Bravo", w.b, w.staff3.userId]) expect(text.includes(leak), leak).toBe(false)
    expect(await w.rows("select 1 from roster_exchanges")).toHaveLength(0)
  })

  test("swap rules: only the person on the shift (a supervisor who sees it is 403); not to yourself (422 invalid_swap); a person who left is 422 ineligible; one open swap per shift (409 exchange_open)", async () => {
    const w = await sites()
    const { tue, open } = await world(w)
    expect(await code(await swap(w, w.p["location-supervisor"], tue.id, w.staff2.userId))).toEqual([403, "forbidden"])
    expect((await swap(w, w.staff2, tue.id, w.p.employee.userId)).status).toBe(404) // another staff member cannot see the shift
    expect(await code(await swap(w, w.p.employee, tue.id, w.p.employee.userId))).toEqual([422, "invalid_swap"])
    expect(await code(await swap(w, w.p.employee, open.id, w.staff2.userId))).toEqual([404, "not_found"]) // an open shift has no owner to hand it over, and a member with no location view does not see it
    await w.rows("update memberships set status = 'deactivated' where user_id = $1", [w.staff2.userId])
    const left = (await (await swap(w, w.p.employee, tue.id, w.staff2.userId)).json()) as Json
    expect(left.code).toBe("ineligible")
    expect(JSON.stringify(left.errors)).not.toContain("qualification")
    await w.rows("update memberships set status = 'active', deactivated_at = null where user_id = $1", [w.staff2.userId])
    const first = await swapOk(w, w.p.employee, tue.id, w.staff2.userId)
    const same = await w.ok("POST", `/v1/roster/shifts/${tue.id}/swap`, w.p.employee, { toUserId: w.staff2.userId }, 200)
    expect(same.id).toBe(first.id)
    expect(await code(await swap(w, w.p.employee, tue.id, w.staff3.userId))).toEqual([404, "member_not_found"])
    await w.addOk(w.p.owner, (await w.rows("select id from roster_weeks where week_start = $1 and location_id = $2", [WK, w.a]))[0].id, [{ date: "2026-11-26", userIds: [w.staff3.userId], shiftTypeId: w.ta }], { reason: "loan" })
    expect(await code(await swap(w, w.p.employee, tue.id, w.staff3.userId))).toEqual([409, "exchange_open"]) // visible now, but one swap is already open
  })

  test("the approver who cannot see the incoming person's home site gets a generic ineligible (no qualification name, no status)", async () => {
    const w = await sites()
    await world(w)
    const armed = await w.type(w.a, "Armed", { start: "18:00", end: "22:00", requires: ["firearms"] })
    await w.ok("PUT", `/v1/members/${w.p.employee.userId}/qualifications`, w.p.owner, { qualifications: [{ type: "firearms", expiresOn: null }] })
    const wk2 = await w.week(w.p.owner, w.a, "2026-11-30")
    const mine = (await w.addOk(w.p.owner, wk2, [{ date: "2026-11-30", userIds: [w.p.employee.userId], shiftTypeId: armed }, { date: "2026-12-01", userIds: [w.staff3.userId], shiftTypeId: w.ta }])).shifts[0] // Dara (homed at Bravo) is rostered at Alpha that week: a visible colleague for the employee
    await publish(w, wk2)
    await w.ok("PUT", `/v1/members/${w.staff3.userId}/qualifications`, w.p.owner, { qualifications: [{ type: "firearms", expiresOn: null }] })
    const s = await swapOk(w, w.p.employee, mine.id, w.staff3.userId)
    await w.ok("PUT", `/v1/members/${w.staff3.userId}/qualifications`, w.p.owner, { qualifications: [] }) // the licence lapses before the decision
    await delegate(w, true)
    const r = await decide(w, w.p["location-supervisor"], s.id, { decision: "approve" })
    const j = (await r.json()) as Json
    expect([r.status, j.code]).toEqual([422, "ineligible"])
    expect(j.errors).toEqual([{ userId: w.staff3.userId, date: "2026-11-30", reason: "ineligible" }])
    expect(JSON.stringify(j).includes("firearms")).toBe(false)
    const office = (await (await decide(w, w.p.owner, s.id, { decision: "approve" })).json()) as Json
    expect(office.errors).toEqual([{ userId: w.staff3.userId, date: "2026-11-30", reason: "qualification_missing", qualification: "firearms" }]) // the office sees the specifics
  })
})

describe("reading exchanges", () => {
  test("a supervisor sees the exchanges of their site, office all, staff only their own; filters; a hidden shiftId filter is just empty", async () => {
    const w = await sites()
    const a = await world(w)
    const c = await claimOk(w, w.staff2, a.open.id)
    const s = await swapOk(w, w.p.employee, a.tue.id, w.staff2.userId)
    const wkB = await w.week(w.p.owner, w.b, WK)
    const ob = (await w.addOk(w.p.owner, wkB, [{ date: WK, userIds: [null], shiftTypeId: w.tb }])).shifts[0]
    await publish(w, wkB)
    const cb = await claimOk(w, w.staff3, ob.id)
    const ids = async (who: Who, q = "") => ((await w.ok("GET", `/v1/roster/exchanges${q}`, who)).items as Json[]).map((x) => x.id).sort()
    expect(await ids(w.p["location-supervisor"])).toEqual([c.id, s.id].sort())
    expect(await ids(w.sup2)).toEqual([cb.id])
    expect(await ids(w.p.owner)).toEqual([c.id, s.id, cb.id].sort())
    expect(await ids(w.p.employee)).toEqual([s.id]) // their own swap
    expect(await ids(w.staff2)).toEqual([c.id, s.id].sort()) // their own claim and the swap addressed to them
    expect(await ids(w.p.owner, "?status=approved")).toEqual([])
    expect(await ids(w.p.owner, `?shiftId=${ob.id}`)).toEqual([cb.id])
    expect(await ids(w.p["location-supervisor"], `?shiftId=${ob.id}`)).toEqual([])
    const text = JSON.stringify(await w.ok("GET", "/v1/roster/exchanges", w.p["location-supervisor"]))
    for (const leak of [cb.id, ob.id, w.b, "Bravo", "Dara"]) expect(text.includes(leak), leak).toBe(false)
    expect((await w.req("GET", "/v1/roster/exchanges?status=bogus", w.p.owner)).status).toBe(422)
    expect((await w.req("GET", "/v1/roster/exchanges?shiftId=not-a-uuid", w.p.owner)).status).toBe(422)
  })

  test("newest first with a keyset cursor", async () => {
    const w = await sites()
    const { open, tue } = await world(w)
    const e1 = await claimOk(w, w.staff2, open.id)
    w.clock.advance({ hours: 1 })
    const e2 = await swapOk(w, w.p.employee, tue.id, w.staff2.userId)
    const p1 = await w.ok("GET", "/v1/roster/exchanges?limit=1", w.p.owner)
    expect(p1.items.map((x: Json) => x.id)).toEqual([e2.id])
    const p2 = await w.ok("GET", `/v1/roster/exchanges?limit=1&cursor=${encodeURIComponent(p1.nextCursor)}`, w.p.owner)
    expect(p2.items.map((x: Json) => x.id)).toEqual([e1.id])
    expect(p2.nextCursor).toBeNull()
    expect((await w.req("GET", "/v1/roster/exchanges?limit=0", w.p.owner)).status).toBe(422)
    expect((await w.req("GET", "/v1/roster/exchanges?cursor=zz", w.p.owner)).status).toBe(400)
  })

  test("exchange ids that are hidden, missing or not uuids answer identically (status, code, headers) on decide, recommend and cancel", async () => {
    const w = await sites()
    const { open } = await world(w)
    const c = await claimOk(w, w.staff2, open.id)
    const run = async (id: string, who: Who, kind: "decide" | "recommend" | "cancel") => {
      const r = kind === "decide" ? await decide(w, who, id, { decision: "approve" }) : kind === "recommend" ? await recommend(w, who, id) : await cancel(w, who, id)
      return strip(r, await r.text())
    }
    for (const kind of ["decide", "recommend"] as const) {
      const hidden = await run(c.id, w.sup2, kind)
      expect(hidden.status).toBe(404)
      expect(hidden).toEqual(await run("00000000-0000-4000-8000-000000000000", w.sup2, kind))
      expect(hidden).toEqual(await run("not-a-uuid", w.sup2, kind))
    }
    const hiddenCancel = await run(c.id, w.staff3, "cancel")
    expect(hiddenCancel.status).toBe(404)
    expect(hiddenCancel).toEqual(await run("not-a-uuid", w.staff3, "cancel"))
  })
})

describe("open shift notices (FR-RS-43)", () => {
  test("a new open shift on a published week tells only the active people who are located at the site (home or rostered that week) and qualified; once each, generic text", async () => {
    const w = await sites()
    const armed = await w.type(w.a, "Armed", { start: "18:00", end: "22:00", requires: ["firearms"] })
    const q = (u: Who, t: string | null) => w.ok("PUT", `/v1/members/${u.userId}/qualifications`, w.p.owner, { qualifications: t ? [{ type: t, expiresOn: null }] : [] })
    await world(w)
    for (const u of [w.p.employee, w.staff3]) await q(u, "firearms") // Aoife homed at Alpha, Dara homed at Bravo; Cian (homed at Alpha) has no licence
    const wk = (await w.rows("select id from roster_weeks where week_start = $1 and location_id = $2", [WK, w.a]))[0].id as string
    await w.rows("update roster_weeks set status = 'draft' where id = $1", [wk])
    await w.addOk(w.p.owner, wk, [{ date: "2026-11-27", userIds: [w.staff3.userId], shiftTypeId: w.ta }]) // Dara is rostered at Alpha this week
    await w.rows("update roster_weeks set status = 'published' where id = $1", [wk])
    await w.rows("delete from notifications")
    await w.addOk(w.p.owner, wk, [{ date: "2026-11-28", userIds: [null, null], shiftTypeId: armed }], { reason: "Cover needed" })
    const n = await notices(w, "title = 'Open shift available'")
    expect(n.map((x) => x.user_id).sort()).toEqual([w.p.employee.userId, w.staff3.userId].sort()) // Cian lacks the licence; nobody homed elsewhere and not rostered; once each for two shifts
    for (const x of n) for (const leak of ["Alpha", "Armed", "18:00", w.a, "firearms"]) expect(`${x.title} ${x.body}`.includes(leak), leak).toBe(false)
    expect(n[0].kind).toBe("member")
  })

  test("the poster is never told, an expired or a different qualification does not qualify, and retiming a shift that is already open posts nothing again", async () => {
    const w = await sites()
    const armed = await w.type(w.a, "Armed", { start: "18:00", end: "22:00", requires: ["firearms"] })
    await world(w)
    const wk = (await w.rows("select id from roster_weeks where week_start = $1 and location_id = $2", [WK, w.a]))[0].id as string
    await w.ok("PUT", `/v1/members/${w.p.owner.userId}/home-location`, w.p.owner, { locationId: w.a }) // the poster is located at the site too
    const q = (u: Who, quals: Json[]) => w.ok("PUT", `/v1/members/${u.userId}/qualifications`, w.p.owner, { qualifications: quals })
    await q(w.p.owner, [{ type: "firearms", expiresOn: null }])
    await q(w.p.employee, [{ type: "firearms", expiresOn: "2026-11-27" }]) // lapses the day before the shift
    await q(w.staff2, [{ type: "first aid", expiresOn: null }]) // a licence, but not the one the shift needs
    await w.rows("delete from notifications")
    const posted = await w.addOk(w.p.owner, wk, [{ date: "2026-11-28", userIds: [null], shiftTypeId: armed }], { reason: "Cover needed" })
    expect(await notices(w, "title = 'Open shift available'")).toEqual([])
    await q(w.staff2, [{ type: "firearms", expiresOn: "2026-11-28" }]) // valid through the shift date
    await w.rows("delete from notifications")
    await w.addOk(w.p.owner, wk, [{ date: "2026-11-28", userIds: [null], shiftTypeId: armed }], { reason: "Another one" })
    expect((await notices(w, "title = 'Open shift available'")).map((x) => x.user_id)).toEqual([w.staff2.userId])
    await w.rows("delete from notifications")
    await w.ok("PATCH", `/v1/roster/shifts/${posted.shifts[0].id}`, w.p.owner, { version: posted.shifts[0].version, patch: { start: "19:00" }, reason: "Later start" })
    expect(await notices(w, "title = 'Open shift available'")).toEqual([]) // it was open before: nobody is told again
  })

  test("unassigning a shift on a published week (userId null) posts it as open; a draft week and a deactivated member are silent", async () => {
    const w = await sites()
    const { tue } = await world(w)
    await w.rows("update memberships set status = 'deactivated' where user_id = $1", [w.staff2.userId])
    await w.rows("delete from notifications")
    await w.ok("PATCH", `/v1/roster/shifts/${tue.id}`, w.p.owner, { version: tue.version, patch: { userId: null }, reason: "Aoife is ill" })
    const n = await notices(w, "title = 'Open shift available'")
    expect(n.map((x) => x.user_id)).toEqual([w.p.employee.userId]) // the person it was taken from is homed there and qualified: they may take it back; Cian is inactive
    await w.rows("delete from notifications")
    const wk2 = await w.week(w.p.owner, w.a, "2026-12-07")
    await w.addOk(w.p.owner, wk2, [{ date: "2026-12-07", userIds: [null], shiftTypeId: w.ta }])
    expect(await notices(w, "title = 'Open shift available'")).toEqual([]) // a draft is not posted
  })
})

describe("who may do what", () => {
  test("a read-only manager and staff are 403 on decide and recommend", async () => {
    const w = await sites()
    const { open } = await world(w)
    const c = await claimOk(w, w.p.employee, open.id)
    for (const who of [w.p.manager, w.p.employee]) {
      expect((await decide(w, who, c.id, { decision: "approve" })).status).toBe(403)
      expect((await recommend(w, who, c.id)).status).toBe(403)
    }
  })

  test("nothing is written by a refused call: no history, audit, event or notice", async () => {
    const w = await sites()
    const { open } = await world(w)
    const c = await claimOk(w, w.p.employee, open.id)
    await w.rows("delete from notifications")
    const counts = async () => [(await w.rows("select 1 from roster_history")).length, (await w.rows("select 1 from audit_events")).length, (await w.rows("select 1 from domain_events")).length, (await w.rows("select 1 from notifications")).length]
    const before = await counts()
    await decide(w, w.p["location-supervisor"], c.id, { decision: "approve" }) // published, no delegation: roster_locked
    await decide(w, w.p.owner, c.id, { decision: "maybe" })
    await cancel(w, w.staff2, c.id)
    expect(await counts()).toEqual(before)
  })
})
