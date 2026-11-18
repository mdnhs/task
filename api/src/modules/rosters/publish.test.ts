import { beforeEach, describe, expect, test } from "vitest"
import { call, fakeClock, resetDb } from "../../../test/harness"
import { MON, sites, type Json } from "./testkit"

// B8 Task 10: publish, the lock, office edits with a reason, history, confirmation, notifications (FR-RS-23, 24, 35, 37; the core risk of B8).

beforeEach(resetDb)

type W = Awaited<ReturnType<typeof sites>>
const strip = (r: Response, body: string) => ({ status: r.status, ct: r.headers.get("content-type"), code: (JSON.parse(body) as Json).code, headers: [...r.headers.entries()].filter(([k]) => !["x-request-id", "date", "content-length"].includes(k)).sort() })
const publish = (w: W, who: { userId: string; email: string; password: string }, weekId: string, body: Json) => w.req("POST", `/v1/roster/weeks/${weekId}/publish`, who, body)
const publishOk = async (w: W, who: { userId: string; email: string; password: string }, weekId: string, body: Json): Promise<Json> => {
  const r = await publish(w, who, weekId, body)
  const text = await r.text()
  expect(r.status, text).toBe(200)
  return JSON.parse(text)
}
const version = async (w: W, weekId: string): Promise<number> => (await w.rows("select version from roster_weeks where id = $1", [weekId]))[0].version
/** A draft week at Alpha with two people on Monday (and one open shift), the employee also on Tuesday; returns the shift ids. */
async function rostered(w: W, weekId = w.wa) {
  const day = await w.addOk(w.p.owner, weekId, [{ date: MON, userIds: [w.p.employee.userId, w.staff2.userId, null], shiftTypeId: w.ta }])
  const tue = await w.addOk(w.p.owner, weekId, [{ date: "2026-11-03", userIds: [w.p.employee.userId], shiftTypeId: w.ta }])
  return { mon: day.shifts as Json[], tue: tue.shifts[0] as Json }
}
const notices = (w: W, where = "true") => w.rows(`select user_id, title, body, kind from notifications where ${where} order by user_id, id`)

describe("publish (FR-RS-35)", () => {
  test("publish moves the week to published, stamps who and when, writes one history row, one audit row and one roster.week_published event (R8-14 payload)", async () => {
    const w = await sites()
    const { mon, tue } = await rostered(w)
    const out = await publishOk(w, w.p["location-supervisor"], w.wa, { version: await version(w, w.wa) })
    expect(out.week).toMatchObject({ id: w.wa, status: "published", publishedBy: w.p["location-supervisor"].userId, version: 4 })
    expect(out.week.publishedAt).toBe("2026-11-16T09:00:00.000Z")
    expect(out.violations).toEqual([])
    const h = await w.rows("select action, reason, before, after, actor_id from roster_history where week_id = $1 and action = 'week_published'", [w.wa])
    expect(h).toHaveLength(1)
    expect(h[0]).toMatchObject({ actor_id: w.p["location-supervisor"].userId, before: { status: "draft" }, after: { status: "published", shifts: 4 } })
    expect(await w.rows("select 1 from audit_events where action = 'roster.week_published' and entity_id = $1", [w.wa])).toHaveLength(1)
    const ev = await w.rows("select payload, actor_id from domain_events where type = 'roster.week_published'")
    expect(ev).toHaveLength(1)
    expect(Object.keys(ev[0].payload).sort()).toEqual(["locationId", "shiftIds", "weekId", "weekStart"])
    expect(ev[0].payload).toMatchObject({ weekId: w.wa, locationId: w.a, weekStart: MON })
    expect([...ev[0].payload.shiftIds].sort()).toEqual([...mon.map((s) => s.id), tue.id].sort())
    expect(await w.rows("select 1 from domain_events where type = 'roster.shift_changed'")).toHaveLength(0) // drafts publish no shift event
  })

  test("warnings never stop a publish and come back; a block with no reason is 422, a supervisor over a block is 403, office with a reason passes and the override is in history and audit", async () => {
    const w = await sites()
    const early = await w.type(w.a, "Early", { start: "06:00", end: "14:00" })
    await w.addOk(w.p.owner, w.wa, [{ date: MON, userIds: [w.p.employee.userId], shiftTypeId: w.ta }])
    await w.addOk(w.p.owner, w.wa, [{ date: MON, userIds: [w.p.employee.userId], shiftTypeId: early }], { reason: "needed" }) // a double booking (a block) already in the draft
    await w.addOk(w.p.owner, w.wa, [{ date: "2026-11-03", userIds: [w.staff2.userId], shiftTypeId: w.ta }, { date: "2026-11-04", userIds: [w.staff2.userId], shiftTypeId: w.ta, start: "02:00", end: "10:00" }]) // a warning
    const v = await version(w, w.wa)
    const sup = await publish(w, w.p["location-supervisor"], w.wa, { version: v })
    const supBody = (await sup.json()) as Json
    expect([sup.status, supBody.code]).toEqual([403, "rule_blocked_office_required"])
    expect(supBody.violations.map((x: Json) => x.rule)).toContain("double_booking")
    const noReason = await publish(w, w.p.owner, w.wa, { version: v })
    expect([noReason.status, ((await noReason.json()) as Json).code]).toEqual([422, "rule_blocked"])
    expect((await w.fail("POST", `/v1/roster/weeks/${w.wa}/publish`, w.p.owner, { version: v, reason: "ok", overrideRuleIds: ["daily_rest"] }, 422)).code).toBe("rule_blocked") // the blocking rule is not covered
    expect((await w.fail("POST", `/v1/roster/weeks/${w.wa}/publish`, w.p.owner, { version: v, reason: "ok", overrideRuleIds: ["nonsense"] }, 422)).code).toBe("invalid_override")
    expect((await w.rows("select status from roster_weeks where id = $1", [w.wa]))[0].status).toBe("draft")
    expect(await w.rows("select 1 from notifications where title = 'Roster published'")).toHaveLength(0) // a refused publish tells nobody
    expect(await w.rows("select 1 from domain_events where type = 'roster.week_published'")).toHaveLength(0)
    const out = await publishOk(w, w.p.owner, w.wa, { version: v, reason: "Covered by the duty manager", overrideRuleIds: ["double_booking"] })
    expect(out.week.status).toBe("published")
    expect(out.violations.map((x: Json) => [x.rule, x.severity])).toEqual(expect.arrayContaining([["double_booking", "block"], ["daily_rest", "warn"]]))
    const [h] = await w.rows("select reason, after from roster_history where action = 'week_published'")
    expect(h.reason).toBe("Covered by the duty manager")
    expect(h.after.overrides.map((o: Json) => o.rule)).toContain("double_booking")
    const [a] = await w.rows("select after from audit_events where action = 'roster.week_published'")
    expect(a.after.reason).toBe("Covered by the duty manager")
    expect(a.after.overrides.map((o: Json) => o.rule)).toContain("double_booking")
  })

  test("a warning-only week publishes for a supervisor and the warning comes back", async () => {
    const w = await sites()
    await w.addOk(w.p.owner, w.wa, [{ date: MON, userIds: [w.staff2.userId], shiftTypeId: w.ta }, { date: "2026-11-03", userIds: [w.staff2.userId], shiftTypeId: w.ta, start: "02:00", end: "10:00" }])
    const out = await publishOk(w, w.p["location-supervisor"], w.wa, { version: await version(w, w.wa) })
    expect(out.violations.map((x: Json) => [x.rule, x.severity])).toContainEqual(["daily_rest", "warn"])
  })

  test("a stale version is 409 version_conflict; staff and a read-only manager are 403; a hidden, missing or non-uuid week is one identical 404", async () => {
    const w = await sites()
    await rostered(w)
    expect((await w.fail("POST", `/v1/roster/weeks/${w.wa}/publish`, w.p.owner, { version: 1 }, 409)).code).toBe("version_conflict")
    expect((await w.req("POST", `/v1/roster/weeks/${w.wa}/publish`, w.p.owner, { reason: "x" })).status).toBe(400) // version is required
    for (const who of [w.p.employee, w.p.manager]) expect((await publish(w, who, w.wa, { version: await version(w, w.wa) })).status).toBe(403)
    const seen: ReturnType<typeof strip>[] = []
    for (const id of [w.wb, "00000000-0000-4000-8000-000000000000", "nope", "1' or '1'='1"]) {
      const r = await publish(w, w.p["location-supervisor"], encodeURIComponent(id), { version: 1 })
      seen.push(strip(r, await r.text()))
    }
    expect(seen[0]).toMatchObject({ status: 404, code: "not_found" })
    for (const s of seen) expect(s).toEqual(seen[0])
    expect((await w.rows("select status from roster_weeks where id = $1", [w.wb]))[0].status).toBe("draft")
  })

  test("double click publish: the second call is 409 already_published, one notification per person, one event, one history and audit row; two at once: one wins", async () => {
    const w = await sites()
    await rostered(w)
    const v = await version(w, w.wa)
    const both = await Promise.all([publish(w, w.p.owner, w.wa, { version: v }), publish(w, w.p.owner, w.wa, { version: v })])
    expect(both.map((r) => r.status).sort()).toEqual([200, 409])
    const loser = JSON.parse(await both.find((r) => r.status === 409)!.text()) as Json
    expect(loser.code).toBe("already_published")
    expect((await w.fail("POST", `/v1/roster/weeks/${w.wa}/publish`, w.p.owner, { version: v }, 409)).code).toBe("already_published") // a later retry too
    expect(await notices(w, "title = 'Roster published'")).toHaveLength(2) // the employee (two shifts) and staff2, once each
    expect(await w.rows("select 1 from domain_events where type = 'roster.week_published'")).toHaveLength(1)
    expect(await w.rows("select 1 from roster_history where action = 'week_published'")).toHaveLength(1)
    expect(await w.rows("select 1 from audit_events where action = 'roster.week_published'")).toHaveLength(1)
  })

  test("concurrent publish and concurrent edit: exactly one wins, the edit is gated or the publish is stale, no lost update, no deadlock", async () => {
    const w = await sites()
    const sup = w.p["location-supervisor"]
    const outcomes = new Set<string>()
    for (let i = 0; i < 6; i++) {
      const weekStart = ["2026-12-07", "2026-12-14", "2026-12-21", "2026-12-28", "2027-01-04", "2027-01-11"][i]
      const wk = await w.week(w.p.owner, w.a, weekStart)
      const shift = (await w.addOk(w.p.owner, wk, [{ date: weekStart, userIds: [w.p.employee.userId], shiftTypeId: w.ta }])).shifts[0]
      const v = await version(w, wk)
      const [pub, edit] = await Promise.all([publish(w, w.p.owner, wk, { version: v }), w.req("PATCH", `/v1/roster/shifts/${shift.id}`, sup, { version: 1, patch: { start: "09:00", end: "17:00" } })])
      const codes = [pub.status, edit.status]
      const editBody = JSON.parse(await edit.text()) as Json
      const pubBody = JSON.parse(await pub.text()) as Json
      expect(codes.filter((c) => c === 200), `round ${i}: ${JSON.stringify(codes)} ${editBody.code} ${pubBody.code}`).toHaveLength(1)
      expect(codes.some((c) => c >= 500)).toBe(false)
      const [row] = await w.rows("select s.start_time, s.version, w.status from roster_shifts s join roster_weeks w on w.id = s.week_id where s.id = $1", [shift.id])
      if (pub.status === 200) {
        expect([edit.status, editBody.code]).toEqual([403, "roster_locked"]) // the edit saw a published week
        expect(row).toMatchObject({ start_time: "08:00", version: 1, status: "published" }) // and changed nothing
        outcomes.add("publish-first")
      } else {
        expect([pub.status, pubBody.code]).toEqual([409, "version_conflict"]) // the edit landed first: the publisher had not seen it
        expect(row).toMatchObject({ start_time: "09:00", version: 2, status: "draft" })
        outcomes.add("edit-first")
      }
    }
    expect(outcomes.size).toBeGreaterThan(0)
    // nothing was published twice or notified for the losers
    const events = await w.rows("select payload from domain_events where type = 'roster.week_published'")
    expect(new Set(events.map((e) => e.payload.weekId)).size).toBe(events.length)
  })
})

describe("notifications (R8-17)", () => {
  test("each rostered person gets exactly one published notification; two shifts still one; an open shift notifies nobody; the text is generic", async () => {
    const w = await sites()
    await rostered(w)
    await publishOk(w, w.p.owner, w.wa, { version: await version(w, w.wa) })
    const n = await notices(w, "title = 'Roster published'")
    expect(n.map((x) => x.user_id).sort()).toEqual([w.p.employee.userId, w.staff2.userId].sort())
    for (const x of n) {
      expect(x.kind).toBe("member")
      expect(x.body).toBe(`Your shifts for the week starting ${MON} are published. Please confirm them.`)
      for (const leak of ["Aoife", "Cian", "Alpha", "08:00", "16:00", w.a, w.wa]) expect(`${x.title} ${x.body}`.includes(leak), leak).toBe(false)
    }
  })

  test("quiet hours are respected by the existing engine: a person with push and a night window is held until the window ends", async () => {
    const w = await sites({ clock: fakeClock(new Date("2026-11-16T23:30:00Z")) })
    await w.req("GET", "/v1/roster/rules", w.p.employee) // signs the employee in
    const cookie = w.cookies.get(w.p.employee.email)!
    expect((await call(w.app, "POST", "/v1/me/push-tokens", { cookie, tenant: "acme", body: { token: "fcm-token-AAAAAAAAAAAAAAAA", platform: "android" } })).status).toBe(201)
    expect((await call(w.app, "PUT", "/v1/me/notification-preferences", { cookie, tenant: "acme", body: { channels: {}, quietStart: "22:00", quietEnd: "07:00" } })).status).toBe(200)
    await rostered(w)
    await publishOk(w, w.p.owner, w.wa, { version: await version(w, w.wa) })
    const d = await w.rows("select d.channel, d.status, d.send_after from notification_deliveries d join notifications n on n.id = d.notification_id where n.user_id = $1 and n.title = 'Roster published'", [w.p.employee.userId])
    expect(d.map((x) => `${x.channel}:${x.status}`)).toEqual(["push:held"])
    expect(new Date(d[0].send_after).toISOString()).toBe("2026-11-17T07:00:00.000Z")
    expect(await notices(w, "user_id = '" + w.p.employee.userId + "'")).toHaveLength(1) // the in-app notice is never held
  })
})

describe("office edit of a published week (R8-8, R8-17, FR-RS-37)", () => {
  const published = async (w: W) => {
    const s = await rostered(w)
    await publishOk(w, w.p.owner, w.wa, { version: await version(w, w.wa) })
    await w.rows("delete from notifications") // only what the edits send is counted below
    return s
  }

  test("a supervisor is 403 roster_locked on add, move and remove; office without a reason is 422 reason_required; nothing changes", async () => {
    const w = await sites()
    const { mon } = await published(w)
    const sup = w.p["location-supervisor"]
    const s = mon[0]
    const before = await w.rows("select id, version, start_time from roster_shifts order by id")
    const add = await w.add(sup, w.wa, [{ date: MON, userIds: [null], shiftTypeId: w.ta }])
    const move = await w.req("PATCH", `/v1/roster/shifts/${s.id}`, sup, { version: s.version, patch: { start: "09:00" }, reason: "please" })
    const del = await w.req("DELETE", `/v1/roster/shifts/${s.id}?reason=please`, sup)
    for (const r of [add, move, del]) {
      expect(r.status).toBe(403)
      expect(((await r.json()) as Json).code).toBe("roster_locked")
    }
    const o1 = await w.add(w.p.owner, w.wa, [{ date: MON, userIds: [null], shiftTypeId: w.ta }])
    const o2 = await w.req("PATCH", `/v1/roster/shifts/${s.id}`, w.p.owner, { version: s.version, patch: { start: "09:00" } })
    const o3 = await w.req("DELETE", `/v1/roster/shifts/${s.id}`, w.p.owner)
    const o4 = await w.req("DELETE", `/v1/roster/shifts/${s.id}?reason=%20%20`, w.p.owner)
    for (const r of [o1, o2, o3, o4]) {
      expect(r.status).toBe(422)
      expect(((await r.json()) as Json).code).toBe("reason_required")
    }
    expect(await w.rows("select id, version, start_time from roster_shifts order by id")).toEqual(before)
    expect(await w.rows("select 1 from roster_history where action in ('shift_moved','shift_removed') or (action = 'shift_added' and reason is not null)")).toHaveLength(0)
    expect(await notices(w)).toHaveLength(0)
  })

  test("office edit with a reason: history has actor, before, after and reason; audit holds the reason; the person's confirmation is cleared (that person only); they are told once; one roster.shift_changed", async () => {
    const w = await sites()
    const { mon, tue } = await published(w)
    const mine = mon.find((s) => s.userId === w.p.employee.userId)!
    const theirs = mon.find((s) => s.userId === w.staff2.userId)!
    for (const [who, s] of [[w.p.employee, mine], [w.staff2, theirs], [w.p.employee, tue]] as const) await w.ok("POST", `/v1/roster/shifts/${s.id}/confirm`, who)
    expect((await w.rows("select 1 from roster_shifts where confirmed_at is not null"))).toHaveLength(3)
    const r = await w.ok("PATCH", `/v1/roster/shifts/${mine.id}`, w.p.owner, { version: mine.version, patch: { start: "09:00", end: "17:00" }, reason: "Venue opens later" })
    expect(r.shift).toMatchObject({ start: "09:00", end: "17:00", confirmedAt: null, version: 2 })
    expect((await w.rows("select id from roster_shifts where confirmed_at is not null order by id")).map((x) => x.id).sort()).toEqual([theirs.id, tue.id].sort()) // the other people (and the other shift) stay confirmed
    const [h] = await w.rows("select actor_id, reason, before, after from roster_history where shift_id = $1 and action = 'shift_moved'", [mine.id])
    expect(h).toMatchObject({ actor_id: w.p.owner.userId, reason: "Venue opens later", before: { start: "08:00", end: "16:00" }, after: { start: "09:00", end: "17:00" } })
    const [a] = await w.rows("select actor_id, before, after from audit_events where action = 'roster.shift_moved'")
    expect(a).toMatchObject({ actor_id: w.p.owner.userId, before: { start: "08:00" }, after: { start: "09:00", reason: "Venue opens later" } })
    const n = await notices(w)
    expect(n.map((x) => [x.user_id, x.title])).toEqual([[w.p.employee.userId, "Shift changed"]])
    expect(n[0].body).not.toMatch(/\d\d:\d\d|Alpha|Aoife|Cian/)
    const ev = await w.rows("select payload from domain_events where type = 'roster.shift_changed'")
    expect(ev.map((e) => e.payload)).toEqual([{ weekId: w.wa, locationId: w.a, weekStart: MON, action: "moved", shiftIds: [mine.id], userIds: [w.p.employee.userId] }])
    expect(await w.rows("select 1 from domain_events where type = 'roster.week_published'")).toHaveLength(1) // an edit never republishes
  })

  test("add, reassign and remove on a published week tell the right people once; an open shift tells nobody; a draft edit publishes no event", async () => {
    const w = await sites()
    const { mon } = await published(w)
    const mine = mon.find((s) => s.userId === w.p.employee.userId)!
    const open = mon.find((s) => s.userId === null)!
    // add: a new assigned shift and an open one
    const added = await w.addOk(w.p.owner, w.wa, [{ date: "2026-11-05", userIds: [w.staff3.userId, null], shiftTypeId: w.ta }], { reason: "Extra cover" })
    expect((await notices(w)).map((x) => x.user_id)).toEqual([w.staff3.userId])
    expect((await w.rows("select 1 from roster_shifts where id = any($1) and confirmed_at is null", [added.shifts.map((s: Json) => s.id)]))).toHaveLength(2)
    await w.rows("delete from notifications")
    // reassign: both the old and the new person hear, once each
    await w.ok("PATCH", `/v1/roster/shifts/${mine.id}`, w.p.owner, { version: mine.version, patch: { userId: w.staff3.userId }, reason: "Swap agreed" })
    expect((await notices(w)).map((x) => x.user_id).sort()).toEqual([w.p.employee.userId, w.staff3.userId].sort())
    await w.rows("delete from notifications")
    // an open shift filled and an open shift edited: only the person named
    await w.ok("PATCH", `/v1/roster/shifts/${open.id}`, w.p.owner, { version: open.version, patch: { start: "07:00" }, reason: "Earlier start" })
    expect(await notices(w)).toHaveLength(0)
    // remove: the person hears
    expect((await w.req("DELETE", `/v1/roster/shifts/${mine.id}?reason=Cancelled`, w.p.owner)).status).toBe(204)
    expect((await notices(w)).map((x) => x.user_id)).toEqual([w.staff3.userId])
    const [h] = await w.rows("select reason, before, after from roster_history where shift_id = $1 and action = 'shift_removed'", [mine.id])
    expect(h).toMatchObject({ reason: "Cancelled", after: null })
    expect(h.before).toMatchObject({ shiftId: mine.id, userId: w.staff3.userId })
    const ev = await w.rows("select payload from domain_events where type = 'roster.shift_changed' order by occurred_at, id")
    expect(ev.map((e) => e.payload.action).sort()).toEqual(["added", "moved", "moved", "removed"])
    // a draft week: no event, no notification
    const draft = await w.week(w.p.owner, w.a, "2026-11-09")
    await w.rows("delete from domain_events")
    await w.rows("delete from notifications")
    await w.addOk(w.p["location-supervisor"], draft, [{ date: "2026-11-09", userIds: [w.p.employee.userId], shiftTypeId: w.ta }])
    expect(await w.rows("select 1 from domain_events")).toHaveLength(0)
    expect(await notices(w)).toHaveLength(0)
  })

  test("an office edit of a published week passes the same rule gate: a block it causes needs the named overrideRuleIds besides the reason (AE3)", async () => {
    const w = await sites()
    const { mon } = await published(w)
    const early = await w.type(w.a, "Early", { start: "06:00", end: "14:00" })
    const r = await w.addOk(w.p.owner, w.wa, [{ date: MON, userIds: [mon[0].userId], shiftTypeId: early }], { reason: "Extra early cover", overrideRuleIds: ["double_booking"] })
    expect(r.violations.some((v: Json) => v.rule === "double_booking" && v.severity === "block")).toBe(true)
    const [h] = await w.rows("select reason, after from roster_history where shift_id = $1", [r.shifts[0].id])
    expect(h.reason).toBe("Extra early cover")
    expect(h.after.overrides.map((o: Json) => o.rule)).toContain("double_booking")
  })
})

describe("confirm (FR-RS-23)", () => {
  test("only the assigned person confirms, only on a published week; twice is idempotent (one history row); a supervisor for someone is 403", async () => {
    const w = await sites()
    const { mon } = await rostered(w)
    const mine = mon.find((s) => s.userId === w.p.employee.userId)!
    expect((await w.fail("POST", `/v1/roster/shifts/${mine.id}/confirm`, w.p.employee, undefined, 409)).code).toBe("week_not_published") // before publish
    await publishOk(w, w.p.owner, w.wa, { version: await version(w, w.wa) })
    for (const who of [w.p["location-supervisor"], w.p.owner]) expect((await w.fail("POST", `/v1/roster/shifts/${mine.id}/confirm`, who, undefined, 403)).code, who.email).toBe("forbidden")
    expect((await w.fail("POST", `/v1/roster/shifts/${mine.id}/confirm`, w.staff2, undefined, 404)).code).toBe("not_found") // a colleague has no view of the site: the shift does not exist for them
    expect((await w.rows("select 1 from roster_shifts where confirmed_at is not null"))).toHaveLength(0)
    const first = await w.ok("POST", `/v1/roster/shifts/${mine.id}/confirm`, w.p.employee)
    expect(first.confirmedAt).toBe("2026-11-16T09:00:00.000Z")
    expect(first.version).toBe(mine.version) // a confirmation is not an edit
    const again = await w.ok("POST", `/v1/roster/shifts/${mine.id}/confirm`, w.p.employee)
    expect(again.confirmedAt).toBe(first.confirmedAt)
    expect(await w.rows("select 1 from roster_history where shift_id = $1 and action = 'shift_confirmed'", [mine.id])).toHaveLength(1)
    expect(await w.rows("select 1 from audit_events where action = 'roster.shift_confirmed'")).toHaveLength(1)
    // an open shift can be confirmed by nobody
    const open = mon.find((s) => s.userId === null)!
    expect((await w.req("POST", `/v1/roster/shifts/${open.id}/confirm`, w.p["location-supervisor"])).status).toBe(403)
    expect((await w.req("POST", `/v1/roster/shifts/${open.id}/confirm`, w.p.employee)).status).toBe(404) // staff cannot see an open shift of the site
  })

  test("a shift the caller may not see, a missing one and a non-uuid id are one identical 404", async () => {
    const w = await sites()
    const hidden = (await w.addOk(w.p.owner, w.wb, [{ date: MON, userIds: [w.staff2.userId], shiftTypeId: w.tb }])).shifts[0]
    const seen: ReturnType<typeof strip>[] = []
    for (const id of [hidden.id, "00000000-0000-4000-8000-000000000000", "nope"]) {
      const r = await w.req("POST", `/v1/roster/shifts/${id}/confirm`, w.p["location-supervisor"])
      seen.push(strip(r, await r.text()))
    }
    expect(seen[0]).toMatchObject({ status: 404, code: "not_found" })
    for (const s of seen) expect(s).toEqual(seen[0])
  })
})

describe("history (FR-RS-24)", () => {
  test("a supervisor lists only granted locations; another location's history is 404 (identical to missing and non-uuid); JSON holds user ids only, no names", async () => {
    const w = await sites()
    await rostered(w)
    await w.addOk(w.p.owner, w.wb, [{ date: MON, userIds: [w.staff3.userId], shiftTypeId: w.tb }])
    const sup = w.p["location-supervisor"]
    const mine = await w.req("GET", `/v1/roster/weeks/${w.wa}/history`, sup)
    const text = await mine.text()
    expect(mine.status).toBe(200)
    const body = JSON.parse(text) as Json
    expect(body.items.length).toBeGreaterThanOrEqual(5)
    expect(body.items.every((i: Json) => i.locationId === w.a && i.weekId === w.wa)).toBe(true)
    for (const leak of ["Aoife Byrne", "Cian Doyle", "Olive Owner", "Sinead Sup", "Dara Walsh", w.b, w.wb]) expect(text.includes(leak), leak).toBe(false)
    const loc = await w.ok("GET", `/v1/locations/${w.a}/history`, sup)
    expect(loc.items.every((i: Json) => i.locationId === w.a)).toBe(true)
    expect(loc.items.map((i: Json) => i.action)).toContain("supervisors_changed")
    const seen: ReturnType<typeof strip>[] = []
    for (const path of [`/v1/locations/${w.b}/history`, "/v1/locations/00000000-0000-4000-8000-000000000000/history", "/v1/locations/nope/history"]) {
      const r = await w.req("GET", path, sup)
      seen.push(strip(r, await r.text()))
    }
    for (const s of seen) expect(s).toEqual({ ...seen[0], status: 404, code: "not_found" })
    const seenW: ReturnType<typeof strip>[] = []
    for (const id of [w.wb, "00000000-0000-4000-8000-000000000000", "nope"]) {
      const r = await w.req("GET", `/v1/roster/weeks/${id}/history`, sup)
      seenW.push(strip(r, await r.text()))
    }
    for (const s of seenW) expect(s).toEqual(seenW[0])
    expect(seenW[0].status).toBe(404)
    expect((await w.req("GET", `/v1/roster/weeks/${w.wa}/history`, w.p.employee)).status).toBe(404) // staff have no location view
  })

  test("the history cursor is stable with equal timestamps (3 rows, one created_at) and walks newest first without a gap or a repeat", async () => {
    const w = await sites()
    const wk = await w.week(w.p.owner, w.a, "2026-11-09")
    for (const d of ["2026-11-09", "2026-11-10"]) await w.addOk(w.p.owner, wk, [{ date: d, userIds: [null], shiftTypeId: w.ta }]) // the fake clock never moves: every line has one created_at
    const all = (await w.rows("select id, created_at from roster_history where week_id = $1 order by created_at desc, id desc", [wk]))
    expect(all).toHaveLength(3)
    expect(new Set(all.map((r) => new Date(r.created_at).toISOString())).size).toBe(1)
    const got: string[] = []
    let cursor: string | null = null
    for (let i = 0; i < 5 && (i === 0 || cursor); i++) {
      const page: Json = await w.ok("GET", `/v1/roster/weeks/${wk}/history?limit=1${cursor ? `&cursor=${cursor}` : ""}`, w.p.owner)
      got.push(...page.items.map((x: Json) => x.id))
      cursor = page.nextCursor
    }
    expect(got).toEqual(all.map((r) => r.id))
    expect((await w.fail("GET", `/v1/roster/weeks/${wk}/history?cursor=garbage`, w.p.owner, undefined, 400)).code).toBe("invalid_cursor")
    for (const limit of ["0", "101", "x"]) expect((await w.fail("GET", `/v1/roster/weeks/${wk}/history?limit=${limit}`, w.p.owner, undefined, 422)).code).toBe("invalid_filter")
    expect((await w.ok("GET", `/v1/roster/weeks/${wk}/history?limit=100`, w.p.owner)).items).toHaveLength(3)
  })

  test("carry: a home_location_changed line masks the OLD site's uuid for a caller who cannot see that site", async () => {
    const w = await sites()
    await w.ok("PUT", `/v1/members/${w.p.employee.userId}/home-location`, w.p.owner, { locationId: w.b })
    await w.ok("PUT", `/v1/members/${w.p.employee.userId}/home-location`, w.p.owner, { locationId: w.a })
    const sup = await w.req("GET", `/v1/locations/${w.a}/history`, w.p["location-supervisor"])
    const text = await sup.text()
    expect(text.includes(w.b), "the supervisor of Alpha never sees Bravo's id").toBe(false)
    const lines = (JSON.parse(text) as Json).items.filter((i: Json) => i.action === "home_location_changed")
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ before: { userId: w.p.employee.userId, homeLocationId: null }, after: { userId: w.p.employee.userId, homeLocationId: w.a } })
    // the office role that sees both still sees the id
    const office = await w.ok("GET", `/v1/locations/${w.a}/history`, w.p.owner)
    expect(office.items.find((i: Json) => i.action === "home_location_changed").before.homeLocationId).toBe(w.b)
  })

  test("roster history survives deactivation of the person and shows the shift as open after erasure", async () => {
    const w = await sites()
    const { mon } = await rostered(w)
    const mine = mon.find((s) => s.userId === w.p.employee.userId)!
    await w.ok("POST", `/v1/members/${w.p.employee.userId}/deactivate`, w.p.owner)
    const kept = await w.ok("GET", `/v1/roster/weeks/${w.wa}/history`, w.p.owner)
    expect(kept.items.filter((i: Json) => i.action === "shift_added").length).toBeGreaterThanOrEqual(3)
    await w.rows("delete from memberships where user_id = $1", [w.p.employee.userId]) // the erasure: the FK clears only user_id
    const week = await w.ok("GET", `/v1/roster/weeks/${w.wa}`, w.p.owner)
    expect(week.shifts.find((s: Json) => s.id === mine.id).userId).toBeNull()
    expect((await w.ok("GET", `/v1/roster/weeks/${w.wa}/history`, w.p.owner)).items.length).toBe(kept.items.length)
  })
})

describe("office limit notifies the person (carry)", () => {
  test("a changed limit tells the affected roster manager once; an unchanged set tells nobody; the generic text names no site", async () => {
    const w = await sites()
    const rm = w.p["roster-manager"]
    await w.ok("PUT", `/v1/roster/office-limits/${rm.userId}`, w.p.owner, { except: [w.b] })
    const n = await notices(w, `user_id = '${rm.userId}'`)
    expect(n.map((x) => x.title)).toEqual(["Your roster access changed"])
    expect(`${n[0].title} ${n[0].body}`.includes("Bravo")).toBe(false)
    await w.ok("PUT", `/v1/roster/office-limits/${rm.userId}`, w.p.owner, { except: [w.b] }) // unchanged
    expect(await notices(w, `user_id = '${rm.userId}'`)).toHaveLength(1)
    await w.ok("PUT", `/v1/roster/office-limits/${rm.userId}`, w.p.owner, { except: [] })
    expect(await notices(w, `user_id = '${rm.userId}'`)).toHaveLength(2)
  })
})
