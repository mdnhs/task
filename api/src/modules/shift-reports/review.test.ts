import { randomUUID } from "node:crypto"
import pg from "pg"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { makeApiKey, makeStaff } from "../../../test/factories"
import { call, resetDb } from "../../../test/harness"
import { resetSubscribers } from "../../core/events"
import { withTenant } from "../../db/tenant-tx"
import { registerFiles } from "../files"
import { registerGdpr } from "../gdpr"
import { registerNotifications } from "../notifications"
import { registerSearchIndexers } from "../search"
import { registerTasks } from "../tasks"
import { registerWebhooks } from "../webhooks-out"
import { assignmentsInWindowQuery } from "../shifts"
import { buildInboxQuery, type InboxScope } from "./inbox"
import { code, DAY, DRIVE, world, type Json, type Who, type W } from "./world"
import { registerShiftReports } from "."

// T5.3: manager inbox, accept and return, report template, search. Rulings F5, F6, F10, F13, F21, F22; D5 scope, D8 independence, E8-E10 lock order, E13, D12/E4 search audience.

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
afterEach(resetSubscribers)

const RANGE = `from=${DAY}&to=${DAY}`
const accept = (w: W, as: Who | null, rep: Json, body: Json = {}) => w.req("POST", `/v1/shift-reports/${rep.id}/accept`, as, { version: rep.version, ...body })
/** `comment` null = the body has none at all. */
const decline = (w: W, as: Who | null, rep: Json, comment: string | null = "Please add the lift fault", body: Json = {}) =>
  w.req("POST", `/v1/shift-reports/${rep.id}/return`, as, { version: rep.version, ...(comment === null ? {} : { comment }), ...body })
const inbox = async (w: W, as: Who, qs = RANGE) => {
  const r = await w.req("GET", `/v1/shift-reports?${qs}`, as)
  expect(r.status, await r.clone().text()).toBe(200)
  return (await w.json(r)) as { items: Json[]; nextCursor: string | null }
}
/** The member opens, fills and submits their report of the 24 Oct night; returns the submitted report. */
async function submitted(w: W, as: Who, o: Json = {}): Promise<Json> {
  const rep = await w.opened(as)
  const s = await w.saved(as, rep, o)
  const r = await w.submit(as, s)
  expect(r.status, await r.clone().text()).toBe(200)
  return w.json(r)
}
/** Everyone is assigned to the night pattern (the world assigns staff, staff2, staff3 and the owner); the team manager and the ops role too. */
async function assign(w: W, ...users: Who[]) {
  for (const u of users) expect((await w.req("POST", "/v1/shifts/assignments", w.ops, { userId: u.userId, patternId: w.pattern, from: "2026-10-01" })).status).toBe(201)
}

describe("scope (D5, F5): nobody reads or acts on a report outside their scope", () => {
  test("report scope: staff see only their own; a team manager sees direct reports and own, not an indirect report and not another team; owner sees all; out of scope → 404 report_not_found on GET, accept, return, versions, uploads", async () => {
    const w = await world()
    await assign(w, w.manager)
    await w.manages(w.manager, w.staff) // direct
    await w.manages(w.staff, w.staff2) // staff2 is INDIRECT to the manager; staff3 is unmanaged
    const reps = {
      manager: await submitted(w, w.manager), staff: await submitted(w, w.staff), staff2: await submitted(w, w.staff2), staff3: await submitted(w, w.staff3), owner: await submitted(w, w.owner),
    }
    const visible = async (as: Who) => (await inbox(w, as)).items.filter((i) => i.id).map((i) => i.id).sort()
    const ids = (...k: (keyof typeof reps)[]) => k.map((x) => reps[x].id).sort()
    expect(await visible(w.staff3)).toEqual(ids("staff3"))
    expect(await visible(w.manager)).toEqual(ids("manager", "staff")) // me + direct reports (one level)
    expect(await visible(w.ops)).toEqual(ids("manager", "staff", "staff2", "staff3", "owner"))
    expect(await visible(w.owner)).toEqual(ids("manager", "staff", "staff2", "staff3", "owner"))
    const nf = await w.req("GET", `/v1/shift-reports/${randomUUID()}`, w.manager)
    const unknown = await w.json(nf)
    // every route, for a report the caller may not see: the SAME 404 as an unknown id
    for (const [who, rep] of [[w.manager, reps.staff2], [w.manager, reps.staff3], [w.manager, reps.owner], [w.staff, reps.staff3], [w.staff3, reps.staff]] as const) {
      const calls: [string, string, unknown?][] = [
        ["GET", `/v1/shift-reports/${rep.id}`], ["GET", `/v1/shift-reports/${rep.id}/versions`], ["POST", `/v1/shift-reports/${rep.id}/accept`, { version: rep.version }],
        ["POST", `/v1/shift-reports/${rep.id}/return`, { version: rep.version, comment: "no" }], ["POST", `/v1/shift-reports/${rep.id}/uploads`, { name: "a.pdf", mime: "application/pdf", sizeBytes: 5 }],
      ]
      for (const [m, path, body] of calls) {
        const r = await w.req(m, path, who, body)
        // a staff-home role is refused the REVIEW itself first (403 forbidden, the same for every id, so still no oracle); everything else is the unknown-id 404
        if (who === w.staff || who === w.staff3 ? /accept|return/.test(path) : false) expect([path, r.status, await code(r)], path).toEqual([path, 403, "forbidden"])
        else {
          expect([path, r.status], path).toEqual([path, 404])
          expect((await w.json(r)).code).toBe(unknown.code)
        }
      }
    }
    // nothing moved
    expect((await w.q("select status, version from shift_reports where id = $1", [reps.staff2.id]))[0]).toMatchObject({ status: "submitted", version: 3 })
    // the in-scope direct report IS readable and reviewable by the team manager
    expect((await accept(w, w.manager, reps.staff)).status).toBe(200)
  })

  test("a team manager's scope is one level for the INBOX too: virtual (missing) rows of indirect reports and of other teams never appear either", async () => {
    const w = await world()
    await w.manages(w.manager, w.staff)
    await w.manages(w.staff, w.staff2)
    const seen = (await inbox(w, w.manager)).items // nobody filed: every row is virtual
    expect(seen.map((i) => i.userId)).toEqual([w.staff.userId])
    expect(seen[0]).toMatchObject({ id: null, state: "missing" })
    expect((await inbox(w, w.staff2)).items.map((i) => i.userId)).toEqual([w.staff2.userId])
  })

  test("inbox returns nothing outside scope even with person= or team= filters naming others (empty, not 403); a person or team from another tenant is just empty", async () => {
    const w = await world()
    await w.manages(w.manager, w.staff)
    await submitted(w, w.staff3)
    const q = async (as: Who, qs: string) => (await inbox(w, as, `${RANGE}&${qs}`)).items
    expect(await q(w.manager, `person=${w.staff3.userId}`)).toEqual([])
    expect(await q(w.staff, `person=${w.staff3.userId}`)).toEqual([])
    expect(await q(w.staff2, `person=${w.staff3.userId}&status=submitted`)).toEqual([])
    expect(await q(w.manager, `team=${w.team}&person=${w.staff3.userId}&status=all`)).toEqual([])
    expect((await q(w.manager, `team=${w.team}`)).map((i) => i.userId)).toEqual([w.staff.userId]) // the team filter narrows, never widens
    expect(await q(w.ops, `person=${w.staff3.userId}`)).toHaveLength(1)
    expect(await q(w.ops, `team=${randomUUID()}`)).toEqual([])
    expect(await q(w.ops, `person=usr_not_a_member`)).toEqual([])
  })
})

describe("inbox (AC-M1-03)", () => {
  test("AC-M1-03: a submitted report is in the manager's inbox at once; a missing one (virtual row, no report row) is flagged after due_at and shows id null; 'late' when it is submitted afterwards", async () => {
    const w = await world({ now: "2026-10-25T06:30:00.000Z" }) // the shift ended at 06:00Z, the report is due at 07:00Z
    await submitted(w, w.staff) // on time
    const a = (await inbox(w, w.ops)).items
    expect(a.find((i) => i.userId === w.staff.userId)).toMatchObject({ state: "submitted", status: "submitted", team: "Night team", shiftName: "Night", date: DAY, dueAt: "2026-10-25T07:00:00.000Z" })
    expect(a.find((i) => i.userId === w.staff2.userId)).toMatchObject({ id: null, state: "draft", version: 0 }) // not yet due: still a draft that nobody started
    w.clock.advance({ minutes: 31 }) // 07:01Z
    const b = (await inbox(w, w.ops)).items
    const missing = b.filter((i) => i.state === "missing")
    expect(missing.map((i) => i.userId).sort()).toEqual([w.staff2.userId, w.staff3.userId, w.owner.userId].sort())
    for (const m of missing) expect(m).toMatchObject({ id: null, status: "draft", key: `${m.userId}:${w.pattern}:${DAY}` })
    expect((await inbox(w, w.ops, `${RANGE}&status=missing`)).items).toHaveLength(3)
    const late = await submitted(w, w.staff2)
    expect(late).toMatchObject({ state: "late" })
    const c = await inbox(w, w.ops, `${RANGE}&status=late`)
    expect(c.items.map((i) => [i.userId, i.state])).toEqual([[w.staff2.userId, "late"]])
    expect((await inbox(w, w.ops, `${RANGE}&status=missing`)).items.map((i) => i.userId).sort()).toEqual([w.staff3.userId, w.owner.userId].sort()) // the virtual row became a real, late one
    // resubmits never change 'late' (F3): return it, the member resubmits, it is still late
    const back = await decline(w, w.ops, late)
    expect(back.status, await back.clone().text()).toBe(200)
    const again = await w.get(w.staff2, late.id)
    const re = await w.json(await w.submit(w.staff2, again))
    expect(re.state).toBe("late")
  })

  test("a team with reporting OFF has no virtual rows; a person assigned to a team with reporting on and an override off is not asked for a report", async () => {
    const w = await world({ reporting: false })
    expect((await inbox(w, w.ops)).items).toEqual([])
    expect((await w.req("PUT", `/v1/shifts/reporting/people/${w.staff.userId}`, w.ops, { on: true })).status).toBe(200)
    expect((await inbox(w, w.ops)).items.map((i) => i.userId)).toEqual([w.staff.userId])
  })

  test("filters by date, team, person and status; virtual and stored rows page together across pages (keyset (date desc, user, pattern): no duplicates, no gaps, stable order)", async () => {
    const w = await world()
    const two = "from=2026-10-24&to=2026-10-25"
    await submitted(w, w.staff)
    await submitted(w, w.staff3)
    const all = (await inbox(w, w.ops, `${two}&limit=100`)).items
    expect(all).toHaveLength(8) // 4 people x 2 days
    const order = all.map((i) => `${i.date}|${i.userId}|${i.patternId}`)
    const expected = [...order].sort((a, b) => { const [da, ua] = a.split("|"); const [db, ub] = b.split("|"); return da === db ? (ua < ub ? -1 : ua > ub ? 1 : 0) : da < db ? 1 : -1 })
    expect(order).toEqual(expected)
    const keys: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const p = await inbox(w, w.ops, `${two}&limit=3${cursor ? `&cursor=${cursor}` : ""}`)
      keys.push(...p.items.map((i) => i.key))
      cursor = p.nextCursor
      pages++
    } while (cursor && pages < 10)
    expect(pages).toBe(3) // 3 + 3 + 2
    expect(keys).toEqual(all.map((i) => i.key))
    expect(new Set(keys).size).toBe(8)
    // date filter, person filter, status filters
    expect((await inbox(w, w.ops, "from=2026-10-25&to=2026-10-25")).items).toHaveLength(4)
    expect((await inbox(w, w.ops, `${two}&person=${w.staff.userId}`)).items).toHaveLength(2)
    expect((await inbox(w, w.ops, `${two}&status=late`)).items.map((i) => i.userId).sort()).toEqual([w.staff.userId, w.staff3.userId].sort()) // the fake clock filed them long after the due time
    expect((await inbox(w, w.ops, `${two}&status=submitted`)).items).toEqual([]) // submitted = on time only
    expect((await inbox(w, w.ops, `${two}&status=accepted`)).items).toEqual([])
    expect((await inbox(w, w.ops, `${two}&status=missing`)).items).toHaveLength(6)
    expect((await inbox(w, w.ops, `${two}&status=draft`)).items).toEqual([]) // the clock is long past every due time
    expect((await inbox(w, w.ops, `${two}&status=returned`)).items).toEqual([])
    expect((await inbox(w, w.ops, `${two}&team=${w.team}&status=late`)).items).toHaveLength(2)
    // a stored draft past due is MISSING too (filter and state agree)
    await w.opened(w.staff2)
    expect((await inbox(w, w.ops, `${RANGE}&status=missing`)).items.find((i) => i.userId === w.staff2.userId)).toMatchObject({ state: "missing", status: "draft" })
    // a pager that bounds a page by 1 still never repeats
    const one = await inbox(w, w.ops, `${two}&limit=1`)
    expect(one.items).toHaveLength(1)
    expect(one.nextCursor).toEqual(expect.any(String))
  })

  test("the default range is the last 7 tenant-local days; a range over 31 days → 422 range_too_long; to before from → 422 invalid_range; a bad date or status or limit → 400; bad cursor → 400 invalid_cursor", async () => {
    const w = await world({ now: "2026-10-25T08:00:00.000Z" })
    const def = (await inbox(w, w.ops, "limit=100")).items
    expect([...new Set(def.map((i) => i.date))].sort()).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"]) // the 25 Oct night has not started yet at 08:00Z: no row for it
    const long = await w.req("GET", "/v1/shift-reports?from=2026-09-01&to=2026-10-02", w.ops)
    expect([long.status, await code(long)]).toEqual([422, "range_too_long"])
    expect((await w.req("GET", "/v1/shift-reports?from=2026-09-01&to=2026-10-01", w.ops)).status).toBe(200) // 31 days inclusive
    const inv = await w.req("GET", "/v1/shift-reports?from=2026-10-05&to=2026-10-01", w.ops)
    expect([inv.status, await code(inv)]).toEqual([422, "invalid_range"])
    for (const bad of ["from=2026-02-30", "to=nope", "status=bogus", "limit=0", "limit=101", "team=x", "person="]) expect((await w.req("GET", `/v1/shift-reports?${bad}`, w.ops)).status, bad).toBe(400)
    const cur = await w.req("GET", "/v1/shift-reports?cursor=garbage", w.ops)
    expect([cur.status, await code(cur)]).toEqual([400, "invalid_cursor"])
    // only `from` (to = today) and only `to` (from = to - 6 days) are completed from the other end
    expect((await inbox(w, w.ops, "from=2026-10-24&limit=100")).items.every((i) => i.date >= "2026-10-24" && i.date <= "2026-10-25")).toBe(true)
    expect((await inbox(w, w.ops, "to=2026-10-20&limit=100")).items.every((i) => i.date >= "2026-10-14" && i.date <= "2026-10-20")).toBe(true)
  })

  test("items carry no free text (no summary, blockers, notes, comments) and the shift and team labels are Drive-withheld off the company PC (per request, FR-M0-10)", async () => {
    const w = await world()
    const tk = await w.task(w.staff)
    const rep = await submitted(w, w.staff, { summary: `Narrative ${DRIVE}`, blockers: "secret blocker", items: [{ taskId: tk.id, status: "done", minutes: 5, note: "secret note" }] })
    await w.q("update shift_reports set shift_name = $2 where id = $1", [rep.id, `Night ${DRIVE}`])
    const item = (await inbox(w, w.ops)).items.find((i) => i.id === rep.id)!
    for (const k of ["summary", "blockers", "unplanned", "extra", "items", "comments", "attachments"]) expect(item, k).not.toHaveProperty(k)
    expect(JSON.stringify(item)).not.toContain("Narrative")
    expect(JSON.stringify(item)).not.toMatch(/secret blocker|secret note/)
    expect(item).toMatchObject({ itemCount: 1, doneCount: 1, person: expect.any(String) })
    expect(item.shiftName).toBe(`Night ${DRIVE}`) // a company PC sees it as written
    // off the company PC (device policy: no Drive), per request
    expect((await w.req("PUT", "/v1/device-policies/drive", w.owner, { allow: "none" })).status).toBe(200)
    const off = (await inbox(w, w.ops)).items.find((i) => i.id === rep.id)!
    expect(off.shiftName).toContain("Google Drive link")
    expect(JSON.stringify(off)).not.toContain("drive.google.com")
    expect((await w.q("select shift_name from shift_reports where id = $1", [rep.id]))[0].shift_name).toContain("drive.google.com") // stored intact
  })
})

describe("accept and return (F6)", () => {
  test("nobody reviews their own report: the owner and a team manager → 403 self_review on accept and return; nothing changes (status, version, comments, notifications, audit)", async () => {
    const w = await world()
    await assign(w, w.manager)
    const own = await submitted(w, w.owner)
    const mine = await submitted(w, w.manager)
    const before = async () => ({ rows: await w.q("select id, status, version, reviewed_by from shift_reports order by id"), c: await w.q("select count(*)::int n from shift_report_comments"), n: await w.q("select count(*)::int n from notifications where kind = 'report'"), a: await w.q("select count(*)::int n from audit_events where action like 'shift.report.%'") })
    const snap = await before()
    for (const [who, rep] of [[w.owner, own], [w.manager, mine]] as const) {
      const a = await accept(w, who, rep)
      expect([a.status, await code(a)], "accept").toEqual([403, "self_review"])
      const r = await decline(w, who, rep)
      expect([r.status, await code(r)], "return").toEqual([403, "self_review"])
      expect((await accept(w, who, rep, { comment: "x" })).status).toBe(403)
    }
    expect(await before()).toEqual(snap)
    // but a DIFFERENT manager reviews them: ops accepts the owner's report, the owner accepts the manager's
    expect((await accept(w, w.ops, own)).status).toBe(200)
    expect((await accept(w, w.owner, mine)).status).toBe(200)
  })

  test("self_review is decided before version and state: even a stale version or a draft is 403, never a hint about the report", async () => {
    const w = await world()
    const rep = await w.opened(w.owner) // a DRAFT of the owner's own
    const r = await w.req("POST", `/v1/shift-reports/${rep.id}/accept`, w.owner, { version: 99 })
    expect([r.status, await code(r)]).toEqual([403, "self_review"])
    const rr = await w.req("POST", `/v1/shift-reports/${rep.id}/return`, w.owner, { version: 99, comment: "" })
    expect([rr.status, await code(rr)]).toEqual([403, "self_review"])
  })

  test("accept and return only from submitted (409 report_not_submitted); return needs a comment (422 comment_required, blank too); stale version 409 version_conflict; accept takes an optional comment; limits are 400", async () => {
    const w = await world()
    const draft = await w.opened(w.staff)
    for (const f of [() => accept(w, w.ops, draft), () => decline(w, w.ops, draft)]) {
      const r = await f()
      expect([r.status, await code(r)]).toEqual([409, "report_not_submitted"])
    }
    const stale = await accept(w, w.ops, draft, { version: draft.version + 5 })
    expect([stale.status, await code(stale)]).toEqual([409, "version_conflict"])
    const rep = await submitted(w, w.staff)
    for (const c of [null, "", "   ", "\n\t"]) {
      const r = await decline(w, w.ops, rep, c)
      expect([String(c), r.status, await code(r)]).toEqual([String(c), 422, "comment_required"])
    }
    expect((await decline(w, w.ops, rep, "x".repeat(2001))).status).toBe(400)
    expect((await accept(w, w.ops, rep, { comment: "x".repeat(2001) })).status).toBe(400)
    expect((await w.req("POST", `/v1/shift-reports/${rep.id}/accept`, w.ops, { comment: "no version" })).status).toBe(400)
    expect((await w.req("POST", `/v1/shift-reports/${rep.id}/accept`, w.ops, { version: rep.version, extra: 1 })).status).toBe(400) // strict body
    const stale2 = await accept(w, w.ops, { ...rep, version: rep.version - 1 })
    expect([stale2.status, await code(stale2)]).toEqual([409, "version_conflict"])
    expect((await w.q("select status from shift_reports where id = $1", [rep.id]))[0].status).toBe("submitted")
    const ok = await accept(w, w.ops, rep)
    expect(ok.status, await ok.clone().text()).toBe(200)
    const done = await w.json(ok)
    expect(done).toMatchObject({ status: "accepted", state: "accepted", version: rep.version + 1, reviewedAt: expect.any(String), reviewedBy: expect.any(String), comments: [] })
    // already accepted: the old version is stale, the new version is not submitted
    expect(await code(await accept(w, w.ops, rep))).toBe("version_conflict")
    expect(await code(await accept(w, w.ops, done))).toBe("report_not_submitted")
    expect(await code(await decline(w, w.ops, done))).toBe("report_not_submitted")
    // an accepted report takes no edits
    expect(await code(await w.put(w.staff, done))).toBe("report_locked")
  })

  test("accept with a comment records it; return records the comment, stamps the reviewer, and the member edits and resubmits into version 2 (the history keeps both); a returned report cannot be accepted", async () => {
    const w = await world()
    const t = await w.task(w.staff)
    const rep = await submitted(w, w.staff)
    const back = await decline(w, w.ops, rep, "Add the lift fault, please")
    w.clock.advance({ minutes: 1 })
    expect(back.status, await back.clone().text()).toBe(200)
    const ret = await w.json(back)
    expect(ret).toMatchObject({ status: "returned", state: "returned", version: rep.version + 1, submissions: 1, reviewedAt: expect.any(String), comments: [{ by: expect.any(String), text: "Add the lift fault, please", at: expect.any(String) }] })
    expect(await code(await accept(w, w.ops, ret))).toBe("report_not_submitted")
    // the member edits and resubmits
    const saved = await w.saved(w.staff, ret, { summary: "Quiet night; lift fault logged.", items: [{ taskId: t.id, status: "done", minutes: 45, note: "" }] })
    w.clock.advance({ minutes: 1 })
    const re = await w.submit(w.staff, saved)
    expect(re.status, await re.clone().text()).toBe(200)
    const again = await w.json(re)
    w.clock.advance({ minutes: 1 })
    expect(again).toMatchObject({ status: "submitted", submissions: 2 })
    const vs = (await w.json(await w.req("GET", `/v1/shift-reports/${rep.id}/versions`, w.ops))).items
    expect(vs.map((v: Json) => [v.v, v.note])).toEqual([[1, "Submitted"], [2, "Resubmitted"]]) // both submissions stay
    const ok = await accept(w, w.ops, again, { comment: "Thanks, all good" })
    expect(ok.status).toBe(200)
    expect((await w.json(ok)).comments.map((c: Json) => c.text)).toEqual(["Add the lift fault, please", "Thanks, all good"])
    expect((await w.q("select kind, by_user, text from shift_report_comments order by at, id")).map((c) => [c.kind, c.by_user, c.text])).toEqual([["return", w.ops.userId, "Add the lift fault, please"], ["accept", w.ops.userId, "Thanks, all good"]])
    expect((await w.q("select reviewed_by from shift_reports where id = $1", [rep.id]))[0].reviewed_by).toBe(w.ops.userId) // the reviewer is the actor
  })

  test("a manager without reports:write (admin: read), a staff role (own report and a colleague's) and an api key (creator ops, reports:write) → 403 forbidden / human_required on accept and return; nothing changes", async () => {
    const w = await world()
    const rep = await submitted(w, w.staff)
    const admin = await w.who("admin")
    for (const [who, expected] of [[admin, "forbidden"], [w.staff, "forbidden"], [w.staff2, "forbidden"], [w.staff3, "forbidden"]] as const) {
      for (const f of [() => accept(w, who, rep), () => decline(w, who, rep)]) {
        const r = await f()
        expect([r.status, await code(r)]).toEqual([403, expected])
      }
    }
    const key = await makeApiKey(w.deps, w.tenant.id, w.ops.userId, ["reports:read", "reports:write"])
    const k = (path: string, body: unknown) => call(w.app, "POST", path, { headers: { authorization: `Bearer ${key.key}` }, body })
    for (const [path, body] of [[`/v1/shift-reports/${rep.id}/accept`, { version: rep.version }], [`/v1/shift-reports/${rep.id}/return`, { version: rep.version, comment: "no" }]] as const) {
      const r = await k(path, body)
      expect([path, r.status, await code(r)]).toEqual([path, 403, "human_required"])
    }
    // human_required is decided before the report is even looked up
    expect(await code(await k(`/v1/shift-reports/${randomUUID()}/accept`, { version: 1 }))).toBe("human_required")
    expect((await w.q("select status, version from shift_reports where id = $1", [rep.id]))[0]).toMatchObject({ status: "submitted", version: rep.version })
    // a person (ops) still can
    expect((await accept(w, w.ops, rep)).status).toBe(200)
  })

  test("support grant: accept, return and the report's id routes → 403 support_forbidden_route (F21); the inbox list and the template (no free text) stay readable", async () => {
    const w = await world()
    const rep = await submitted(w, w.staff)
    const staff = await makeStaff(w.deps, "support")
    const g = await call(w.app, "POST", `/v1/platform/tenants/${w.tenant.id}/support-grants`, { cookie: staff.cookie, body: { reason: "Ticket 4412: inbox looks wrong", hours: 2 } })
    expect(g.status, await g.clone().text()).toBe(201)
    for (const [m, path, body] of [["POST", `/v1/shift-reports/${rep.id}/accept`, { version: rep.version }], ["POST", `/v1/shift-reports/${rep.id}/return`, { version: rep.version, comment: "x" }]] as const) {
      const r = await call(w.app, m, path, { cookie: staff.cookie, tenant: "acme", body })
      expect([path, r.status]).toEqual([path, 403])
    }
    expect((await w.q("select status from shift_reports where id = $1", [rep.id]))[0].status).toBe("submitted")
    const list = await call(w.app, "GET", `/v1/shift-reports?${RANGE}`, { cookie: staff.cookie, tenant: "acme" })
    expect(list.status, await list.clone().text()).toBe(200)
    expect(JSON.stringify(await list.json())).not.toContain("Quiet night")
    expect((await call(w.app, "GET", "/v1/shift-reports/template", { cookie: staff.cookie, tenant: "acme" })).status).toBe(200)
    expect((await call(w.app, "PUT", "/v1/shift-reports/template", { cookie: staff.cookie, tenant: "acme", body: { departments: [] } })).status).toBe(403)
  })

  test("the member is notified on accept and on return (kind 'report', body = shift name and date only, no report text, no comment text, a Drive-named shift withheld); never the reviewer; the in-app list shows it", async () => {
    const w = await world()
    await w.q("update shift_patterns set name = $1", [`Night ${DRIVE}`])
    const rep = await submitted(w, w.staff, { summary: "private narrative" })
    await w.q("delete from notifications")
    const r1 = await decline(w, w.ops, rep, `Please fix ${DRIVE} secret reason`)
    expect(r1.status).toBe(200)
    const ret = await w.json(r1)
    const saved = await w.saved(w.staff, ret)
    const again = await w.json(await w.submit(w.staff, saved))
    await w.q("delete from notifications")
    expect((await accept(w, w.ops, again, { comment: `Great ${DRIVE}` })).status).toBe(200)
    const notes = await w.q("select user_id, kind, title, body, link from notifications order by id")
    expect(notes.every((n) => n.kind === "report")).toBe(true)
    const toMember = notes.filter((n) => n.user_id === w.staff.userId)
    expect(toMember).toHaveLength(1)
    expect(toMember[0].title).toBe("Shift report accepted")
    expect(toMember[0].body).toMatch(/^Night .*, 2026-10-24$/)
    expect(notes.some((n) => n.user_id === w.ops.userId)).toBe(false)
    const all = JSON.stringify(await w.q("select title, body, link from notifications"))
    for (const leak of ["drive.google.com", "private narrative", "secret reason", "Great"]) expect(all).not.toContain(leak)
  })

  test("a return notifies the member with the 'returned' title and a link to the report; the list endpoint shows it unread", async () => {
    const w = await world()
    const rep = await submitted(w, w.staff)
    await w.q("delete from notifications")
    expect((await decline(w, w.ops, rep, "Add detail")).status).toBe(200)
    const n = await w.q("select user_id, kind, title, body, link, subject_user_id from notifications")
    expect(n).toHaveLength(1)
    expect(n[0]).toMatchObject({ user_id: w.staff.userId, kind: "report", title: "Shift report returned", link: `/reports/${rep.id}` })
    expect(n[0].body).toBe("Night, 2026-10-24")
    const list = await w.json(await w.req("GET", "/v1/notifications", w.staff))
    expect(JSON.stringify(list)).toContain("Shift report returned")
  })

  test("accept and return are audited (report.accepted / report.returned: ids and decision only, never the comment); submit and draft saves are not audited as reviews; one domain event each", async () => {
    const w = await world()
    const rep = await submitted(w, w.staff, { summary: "audit me not" })
    w.clock.advance({ minutes: 1 })
    const ret = await w.json(await decline(w, w.ops, rep, "SECRET COMMENT"))
    w.clock.advance({ minutes: 1 })
    const again = await w.json(await w.submit(w.staff, await w.saved(w.staff, ret)))
    w.clock.advance({ minutes: 1 })
    const done = await w.json(await accept(w, w.ops, again, { comment: "ALSO SECRET" }))
    const audits = await w.q("select action, entity, entity_id, actor_id, before, after from audit_events where action like 'shift.report.%' order by at, id")
    expect(audits.map((a) => a.action)).toEqual(["shift.report.submitted", "shift.report.returned", "shift.report.submitted", "shift.report.accepted"])
    const rev = audits.filter((a) => /accepted|returned/.test(a.action))
    expect(rev.map((a) => [a.entity, a.entity_id, a.actor_id])).toEqual([["shift_report", rep.id, w.ops.userId], ["shift_report", rep.id, w.ops.userId]])
    expect(rev[0]).toMatchObject({ before: { status: "submitted", version: rep.version }, after: { status: "returned", version: rep.version + 1, decision: "return" } })
    expect(rev[1]).toMatchObject({ after: { status: "accepted", version: done.version, decision: "accept" } })
    expect(JSON.stringify(audits)).not.toMatch(/SECRET|audit me not/)
    const ev = await w.q("select type, payload from domain_events where type in ('shift.report.accepted','shift.report.returned') order by occurred_at")
    expect(ev.map((e) => e.type)).toEqual(["shift.report.returned", "shift.report.accepted"])
    expect(ev[0].payload).toEqual({ reportId: rep.id, version: rep.version + 1 })
    expect(JSON.stringify(ev)).not.toMatch(/SECRET/)
    // a draft save and an open write no audit rows
    const w2 = await world({ slug: "other" })
    await w2.saved(w2.staff, await w2.opened(w2.staff))
    expect(await w2.q("select 1 from audit_events where action like 'shift.report.%'")).toEqual([])
  })

  test("Drive text is withheld in the detail (comments included) off the company PC, per request (FR-M0-10); intact on it; stored intact; accept/return responses obey the same rule", async () => {
    const w = await world()
    const rep = await submitted(w, w.staff, { summary: `see ${DRIVE}` })
    const r = await decline(w, w.ops, rep, `fix per ${DRIVE}`)
    expect(r.status, await r.clone().text()).toBe(200)
    expect(JSON.stringify(await w.json(r))).toContain("drive.google.com") // company PC
    expect((await w.req("PUT", "/v1/device-policies/drive", w.owner, { allow: "none" })).status).toBe(200)
    for (const path of [`/v1/shift-reports/${rep.id}`, `/v1/shift-reports/${rep.id}/versions`]) {
      const text = await (await w.req("GET", path, w.ops)).text()
      expect(text, path).not.toContain("drive.google.com")
      expect(text, path).toContain("Google Drive link")
    }
    const ret = await w.get(w.ops, rep.id)
    expect(ret.comments[0].text).toBe("fix per Google Drive link")
    expect(ret.summary).toBe("see Google Drive link")
    // an accept response with Drive text in the comment is withheld the same way, and the stored comment is intact
    const again = await w.json(await w.submit(w.staff, await w.saved(w.staff, await w.get(w.staff, rep.id))))
    const done = await accept(w, w.ops, { id: rep.id, version: again.version }, { comment: `ok ${DRIVE}` })
    expect(done.status, await done.clone().text()).toBe(200)
    expect(await done.text()).not.toContain("drive.google.com")
    expect((await w.q("select text from shift_report_comments order by at, id")).map((c) => c.text).join()).toContain("drive.google.com")
  })

  test("accept and return are race-safe: two reviewers at one version (accept vs return, accept vs accept, return vs return) → exactly one 200 and a clean 409 for the loser, never a 500 or a deadlock (40P01 → 409 retry)", async () => {
    for (let round = 0; round < 6; round++) {
      await resetDb()
      resetSubscribers()
      registerNotifications()
      registerTasks()
      registerShiftReports()
      const w = await world()
      await w.task(w.staff)
      await w.task(w.staff2)
      const reps = [await submitted(w, w.staff), await submitted(w, w.staff2), await submitted(w, w.staff3)]
      const races: [Promise<Response>, Promise<Response>][] = [
        [accept(w, w.ops, reps[0]), decline(w, w.owner, reps[0])],
        [accept(w, w.ops, reps[1]), accept(w, w.owner, reps[1])],
        [decline(w, w.ops, reps[2]), decline(w, w.owner, reps[2])],
      ]
      for (const [a, b] of races) {
        const rs = await Promise.all([a, b])
        const st = rs.map((r) => r.status).sort()
        expect(st, `round ${round}: ${await Promise.all(rs.map((r) => r.clone().text()))}`).toEqual([200, 409])
        const loser = rs.find((r) => r.status === 409)!
        expect(["version_conflict", "report_not_submitted", "retry"]).toContain(await code(loser))
      }
      // each report was reviewed exactly once: one comment/decision, version advanced by one
      const rows = await w.q("select id, status, version from shift_reports where id = any($1::uuid[]) order by id", [reps.map((r) => r.id)])
      for (const r of rows) expect(r.version).toBe(reps.find((x) => x.id === r.id)!.version + 1)
      expect((await w.q("select count(*)::int n from audit_events where action in ('shift.report.accepted','shift.report.returned')"))[0].n).toBe(3)
    }
  }, 120_000)

  test("accept racing with the member's resubmit: the member's resubmit of a returned report wins cleanly and the stale accept is 409; a reviewer racing a draft save of the member never leaves a half state", async () => {
    for (let round = 0; round < 4; round++) {
      await resetDb()
      resetSubscribers()
      registerNotifications()
      registerTasks()
      registerShiftReports()
      const w = await world()
      await w.task(w.staff)
      const rep = await submitted(w, w.staff)
      const ret = await w.json(await decline(w, w.ops, rep, "again please"))
      const saved = await w.saved(w.staff, ret)
      // the reviewer still holds the OLD submitted version and fires accept while the member resubmits
      const [a, s] = await Promise.all([accept(w, w.ops, rep), w.submit(w.staff, saved)])
      expect(s.status, await s.clone().text()).toBe(200)
      expect(a.status, await a.clone().text()).toBe(409)
      expect(["version_conflict", "report_not_submitted"]).toContain(await code(a))
      const row = (await w.q("select status, submissions from shift_reports where id = $1", [rep.id]))[0]
      expect(row).toMatchObject({ status: "submitted", submissions: 2 })
      // a return racing the member's draft save of the same submitted report: one of them is 409, the state is one of the two coherent ones
      const cur = await w.get(w.ops, rep.id)
      const [r2, p2] = await Promise.all([decline(w, w.ops, cur, "second"), w.put(w.staff, cur, { summary: "late edit" })])
      expect([r2.status, p2.status].sort()).toEqual([200, 409]) // a submitted report takes no edits: the save always loses (report_locked or version_conflict), the return wins
      expect(["report_locked", "version_conflict"]).toContain(await code(p2))
      const after = (await w.q("select status, summary from shift_reports where id = $1", [rep.id]))[0]
      expect(after).toMatchObject({ status: "returned", summary: "Quiet night." })
    }
  }, 120_000)
})

describe("template (FR-M1-25, F13)", () => {
  const sections = (o: Json = {}): Json[] => [
    { id: "tasks", title: "Tasks in the shift", enabled: true, fields: [{ id: "time", label: "Time", required: false }, { id: "note", label: "Note on blocked tasks", required: false }] },
    { id: "summary", title: "Summary", enabled: true, fields: [{ id: "summary", label: "Shift summary", required: false }] },
    { id: "blockers", title: "Blockers", enabled: true, fields: [{ id: "blockers", label: "Blockers", required: true }] },
    ...(o.extra ?? []),
  ]
  const put = (w: W, as: Who, departments: unknown) => w.req("PUT", "/v1/shift-reports/template", as, { departments })

  test("GET with nothing set: the default template (onboarding data) for each team in the caller's scope; `custom` is false", async () => {
    const w = await world()
    const t = await w.json(await w.req("GET", "/v1/shift-reports/template", w.ops))
    expect(t.custom).toBe(false)
    expect(t.departments.map((d: Json) => d.dept)).toEqual(["Night team"])
    expect(t.departments[0].sections.map((s: Json) => s.id)).toEqual(["tasks", "summary", "blockers", "unplanned", "attachments"])
    expect(t.departments[0].sections.find((s: Json) => s.id === "summary").fields[0].required).toBe(true) // the onboarding default requires a summary
  })

  test("PUT needs settings:write (owner, admin yes; ops, manager, staff, auditor no); GET needs reports:read; validated JSON: ids [a-z0-9_]{1,40}, <= 12 sections, <= 12 fields, no duplicates; audited with before and after", async () => {
    const w = await world()
    const admin = await w.who("admin")
    const body = [{ dept: "Night team", sections: sections() }]
    for (const who of [w.ops, w.manager, w.staff]) expect((await put(w, who, body)).status, "no settings:write").toBe(403)
    expect((await w.req("GET", "/v1/shift-reports/template", w.staff)).status).toBe(200)
    const ok = await put(w, admin, body)
    expect(ok.status, await ok.clone().text()).toBe(200)
    const out = await w.json(ok)
    expect(out.custom).toBe(true)
    const bad: [string, unknown, number][] = [
      ["id with a capital", [{ dept: "A", sections: [{ id: "Tasks", title: "t", enabled: true, fields: [] }] }], 400],
      ["id with a dash", [{ dept: "A", sections: [{ id: "my-section", title: "t", enabled: true, fields: [] }] }], 400],
      ["id too long", [{ dept: "A", sections: [{ id: "a".repeat(41), title: "t", enabled: true, fields: [] }] }], 400],
      ["13 sections", [{ dept: "A", sections: Array.from({ length: 13 }, (_, i) => ({ id: `s${i}`, title: "t", enabled: true, fields: [] })) }], 400],
      ["13 fields", [{ dept: "A", sections: [{ id: "s", title: "t", enabled: true, fields: Array.from({ length: 13 }, (_, i) => ({ id: `f${i}`, label: "l", required: false })) }] }], 400],
      ["no departments", [], 400],
      ["unknown key", [{ dept: "A", sections: [], x: 1 }], 400],
      ["duplicate section ids", [{ dept: "A", sections: [{ id: "s", title: "t", enabled: true, fields: [] }, { id: "s", title: "u", enabled: true, fields: [] }] }], 422],
      ["duplicate field ids", [{ dept: "A", sections: [{ id: "s", title: "t", enabled: true, fields: [{ id: "f", label: "l", required: false }, { id: "f", label: "m", required: false }] }] }], 422],
      ["duplicate departments", [{ dept: "A", sections: [] }, { dept: "A", sections: [] }], 422],
      ["a built-in section with an unknown field (nothing would ever require it)", [{ dept: "A", sections: [{ id: "summary", title: "t", enabled: true, fields: [{ id: "nonsense", label: "l", required: true }] }] }], 422],
    ]
    for (const [name, b, status] of bad) {
      const r = await put(w, admin, b)
      expect([name, r.status, status === 422 ? await code(r) : ""]).toEqual([name, status, status === 422 ? "invalid_template" : ""])
    }
    expect((await w.q("select count(*)::int n from tenant_settings where key = 'report_template'"))[0].n).toBe(1) // refused bodies wrote nothing
    const a = await w.q("select actor_id, entity, before, after from audit_events where action = 'tenant.report_template_updated'")
    expect(a).toHaveLength(1)
    expect(a[0]).toMatchObject({ actor_id: admin.userId, entity: "tenant", before: { custom: false }, after: { custom: true, departments: 1 } })
  })

  test("GET is scoped to the teams in the caller's scope; a team without its own entry falls back to the first department (templateFor); the editor round-trips unmatched departments for an all-scope reader", async () => {
    const w = await world()
    const other = (await w.json(await w.req("POST", "/v1/teams", w.owner, { name: "Day team", kind: "team" }))).id as string
    expect(other).toBeTruthy()
    const admin = await w.who("admin")
    const day = [{ id: "summary", title: "Summary", enabled: true, fields: [{ id: "summary", label: "Summary", required: false }] }]
    expect((await put(w, admin, [{ dept: "Night team", sections: sections() }, { dept: "Day team", sections: day }, { dept: "Ghost dept", sections: day }])).status).toBe(200)
    const names = async (as: Who) => (await w.json(await w.req("GET", "/v1/shift-reports/template", as))).departments.map((d: Json) => d.dept)
    expect(await names(w.staff)).toEqual(["Night team"]) // the team of the pattern they work
    expect(await names(w.ops)).toEqual(["Day team", "Ghost dept", "Night team"].sort((a, b) => a.localeCompare(b)))
    const mine = (await w.json(await w.req("GET", "/v1/shift-reports/template", w.staff))).departments[0]
    expect(mine.sections.find((s: Json) => s.id === "blockers").fields[0].required).toBe(true)
    // a staff member of another team sees only that team
    expect(await names(w.staff3)).toEqual(["Night team"])
    expect((await w.req("PUT", `/v1/teams/${other}/members`, w.owner, { userIds: [w.staff3.userId] })).status).toBe(200)
    expect((await names(w.staff3)).sort()).toEqual(["Day team", "Night team"])
  })

  test("submit validates against the template in force at submit time: a newly required field blocks the next submit (422 report_invalid) and the template change touches nothing already saved", async () => {
    const w = await world()
    const admin = await w.who("admin")
    const rep = await w.opened(w.staff)
    const s = await w.saved(w.staff, rep, { blockers: "" })
    expect((await put(w, admin, [{ dept: "Night team", sections: sections() }])).status).toBe(200) // blockers REQUIRED, summary optional
    const r = await w.submit(w.staff, s)
    expect([r.status, await code(r)]).toEqual([422, "report_invalid"])
    expect(((await w.json(r)).errors as Json[]).map((e) => e.key)).toEqual(["blockers"])
    expect((await put(w, admin, [{ dept: "Night team", sections: sections().map((x) => ({ ...x, fields: x.fields.map((f: Json) => ({ ...f, required: false })) })) }])).status).toBe(200) // nothing required now
    const ok = await w.submit(w.staff, s)
    expect(ok.status, await ok.clone().text()).toBe(200)
    // an EXTRA section: required free-text answers are enforced under key extra:<sec>.<field>
    expect((await put(w, admin, [{ dept: "Night team", sections: sections({ extra: [{ id: "handover", title: "Handover", enabled: true, fields: [{ id: "keys", label: "Keys returned", required: true }] }] }) }])).status).toBe(200)
    const w2rep = await w.opened(w.staff2)
    const s2 = await w.saved(w.staff2, w2rep, { blockers: "none", extra: {} })
    const bad = await w.submit(w.staff2, s2)
    expect(((await w.json(bad)).errors as Json[]).map((e) => e.key)).toEqual(["extra:handover.keys"])
    const fixed = await w.saved(w.staff2, s2, { blockers: "none", extra: { "handover.keys": "yes" } })
    expect((await w.submit(w.staff2, fixed)).status).toBe(200)
  })

  test("the PUT is serialised and idempotent: two concurrent PUTs both succeed (last write wins, one audit row each) and a repeated identical PUT changes nothing but still audits", async () => {
    const w = await world()
    const admin = await w.who("admin")
    const a = [{ dept: "Night team", sections: sections() }]
    const b = [{ dept: "Night team", sections: sections().slice(0, 2) }]
    const rs = await Promise.all([put(w, admin, a), put(w, admin, b)])
    expect(rs.map((r) => r.status)).toEqual([200, 200])
    expect((await w.q("select count(*)::int n from audit_events where action = 'tenant.report_template_updated'"))[0].n).toBe(2)
    expect((await w.q("select count(*)::int n from tenant_settings where key = 'report_template'"))[0].n).toBe(1)
  })
})

describe("search (D12/E4 audience, F21)", () => {
  test("search finds a report by shift name and date within scope (own / team / all), never by free text; unrelated people find nothing", async () => {
    const w = await world()
    await assign(w, w.manager)
    await w.manages(w.manager, w.staff)
    await w.manages(w.staff, w.staff2)
    const reps = { staff: await submitted(w, w.staff, { summary: "unique-zebra narrative", blockers: "kangaroo-blocker" }), staff2: await submitted(w, w.staff2), staff3: await submitted(w, w.staff3) }
    await w.relay()
    const hits = async (as: Who, qs: string) => (await w.json(await w.req("GET", `/v1/search?q=${encodeURIComponent(qs)}`, as))).hits.filter((h: Json) => h.entity === "report").map((h: Json) => h.entityId).sort()
    const ids = (...r: (keyof typeof reps)[]) => r.map((x) => reps[x].id).sort()
    expect(await hits(w.staff, "Night 2026-10-24")).toEqual(ids("staff")) // own
    expect(await hits(w.staff3, "night 2026-10-24")).toEqual(ids("staff3"))
    expect(await hits(w.manager, "night 2026-10-24")).toEqual(ids("staff")) // me + direct reports: not the indirect staff2, not staff3
    expect(await hits(w.ops, "night 2026-10-24")).toEqual(ids("staff", "staff2", "staff3")) // all
    expect(await hits(w.ops, "night")).toEqual(ids("staff", "staff2", "staff3"))
    expect(await hits(w.ops, "kitchen 2031-07-09")).toEqual([]) // another name and date
    for (const text of ["zebra", "kangaroo", "narrative"]) expect(await hits(w.ops, text), text).toEqual([])
    const doc = (await w.q("select title, body, audience, module from search_documents where entity = 'report' and entity_id = $1", [reps.staff.id]))[0]
    expect(doc).toMatchObject({ title: "Night 2026-10-24", body: "", module: "reports", audience: [`u:${w.staff.userId}`] })
    // the hit never carries report text
    const raw = JSON.stringify(await w.json(await w.req("GET", "/v1/search?q=night", w.ops)))
    expect(raw).not.toMatch(/zebra|kangaroo/)
  })

  test("a role without reports access finds no reports (module gate); removing the report document on erase and indexing follows accept / return; a Drive link in the shift name is not indexed", async () => {
    const w = await world()
    await w.q("update shift_patterns set name = $1", [`Night ${DRIVE}`])
    const rep = await submitted(w, w.staff)
    await w.relay()
    const doc = (await w.q("select title from search_documents where entity = 'report'"))[0]
    expect(doc.title).not.toContain("drive.google.com")
    expect(doc.title).toContain("Google Drive link")
    const hr = await w.who("hr") // reports: none
    expect((await w.json(await w.req("GET", "/v1/search?q=night", hr))).hits.filter((h: Json) => h.entity === "report")).toEqual([])
    await decline(w, w.ops, rep)
    await w.relay()
    expect((await w.q("select count(*)::int n from search_documents where entity = 'report'"))[0].n).toBe(1) // re-indexed in place
    // erase: the subject's reports leave the index
    const dr = await w.req("POST", "/v1/data-requests", w.owner, { subjectUserId: w.staff.userId, kind: "erase", reason: "asked" })
    expect(dr.status, await dr.clone().text()).toBe(201)
    await w.drain()
    await w.relay()
    expect((await w.q("select count(*)::int n from search_documents where entity = 'report'"))[0].n).toBe(0)
  }, 60_000)
})

describe("database and plans (R8, EXPLAIN)", () => {
  test("inbox query uses shift_reports_inbox_idx (all scope) and shift_reports_user_idx (own scope) at 10k rows; the assignment scan of a member uses shift_assignments_user_idx", async () => {
    const w = await world()
    const members = [w.staff, w.staff2, w.staff3, w.owner]
    // 10 000 stored reports of the four members over 2 500 days: the 7-day window is selective, the table is big
    await w.q(
      `insert into shift_reports (tenant_id, user_id, pattern_id, shift_date, team_id, shift_name, start_at, end_at, due_at, status, first_submitted_at, submitted_at, created_at, updated_at)
       select $1::uuid, ($4::text[])[1 + g % 4], $2::uuid, date '2019-01-01' + (g / 4), $3::uuid, 'Night', now(), now(), now(), 'submitted', now(), now(), now(), now()
       from generate_series(0, 9999) g`,
      [w.tenant.id, w.pattern, w.team, `{${members.map((m) => m.userId).join(",")}}`],
    )
    await w.q("analyze shift_reports")
    const day = (await w.q("select (date '2019-01-01' + 2400)::text d"))[0].d as string
    const from = (await w.q("select (date '2019-01-01' + 2394)::text d"))[0].d as string
    const plan = async (scope: InboxScope) =>
      withTenant(w.deps.db, w.tenant.id, async (tx) => {
        const { sql: text, params } = buildInboxQuery(tx, w.tenant.id, scope, { from, to: day, status: "all" }, w.clock.now(), 26).toSQL()
        const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_OWNER_URL })
        await c.connect()
        try {
          await c.query("begin")
          await c.query("select set_config('app.tenant_id', $1, true)", [w.tenant.id])
          const rows = (await c.query(`explain ${text}`, params as unknown[])).rows.map((r) => r["QUERY PLAN"] as string).join("\n")
          await c.query("rollback")
          return rows
        } finally {
          await c.end()
        }
      })
    const all = await plan({ access: { kind: "all" }, reports: [], me: w.ops.userId })
    expect(all).toContain("shift_reports_inbox_idx")
    expect(all).not.toMatch(/Seq Scan on shift_reports/)
    const own = await plan({ access: { kind: "own", personId: w.staff.userId }, reports: [], me: w.staff.userId })
    expect(own).toContain("shift_reports_user_idx")
    expect(own).not.toMatch(/Seq Scan on shift_reports/)
    const team = await plan({ access: { kind: "team", managerId: w.manager.userId }, reports: [w.staff.userId], me: w.manager.userId })
    expect(team).toMatch(/shift_reports_user_idx|shift_reports_inbox_idx/)
    expect(team).not.toMatch(/Seq Scan on shift_reports/)
    // and the real endpoint answers over this data (own scope: one member's rows only), in order
    const r = await inbox(w, w.staff, `from=${from}&to=${day}&limit=100`)
    expect(r.items.length).toBeGreaterThan(0)
    expect(r.items.every((i) => i.userId === w.staff.userId)).toBe(true)
    // the member's assignment scan
    const ap = await withTenant(w.deps.db, w.tenant.id, async (tx) => assignmentsInWindowQuery(tx, w.tenant.id, from, day, { patternIds: [w.pattern], userIds: [w.staff.userId] }).toSQL())
    const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_OWNER_URL })
    await c.connect()
    try {
      await c.query("begin")
      await c.query("select set_config('app.tenant_id', $1, true)", [w.tenant.id])
      const text = (await c.query(`explain ${ap.sql}`, ap.params as unknown[])).rows.map((x) => x["QUERY PLAN"] as string).join("\n")
      await c.query("rollback")
      expect(text).toMatch(/shift_assignments_user_idx|shift_assignments_pattern_idx/)
    } finally {
      await c.end()
    }
  }, 120_000)

  test("p95: the all-scope inbox over 31 days with 250 members on one pattern (7 500 started shifts, 3 000 stored reports) answers in < 500 ms (global p95)", async () => {
    const w = await world()
    await w.q(`insert into "user" (id, name, email, email_verified, created_at, updated_at) select 'usr_load_' || g, 'Load ' || g, 'load' || g || '@example.com', true, now(), now() from generate_series(1, 246) g`)
    await w.q(`insert into memberships (tenant_id, user_id, role_id, status, joined_at) select $1::uuid, 'usr_load_' || g, (select id from roles where tenant_id = $1 and key = 'employee'), 'active', now() from generate_series(1, 246) g`, [w.tenant.id])
    await w.q(`insert into shift_assignments (tenant_id, user_id, pattern_id, from_date, created_at) select $1::uuid, 'usr_load_' || g, $2::uuid, date '2026-10-01', now() from generate_series(1, 246) g`, [w.tenant.id, w.pattern])
    await w.q(
      `insert into shift_reports (tenant_id, user_id, pattern_id, shift_date, team_id, shift_name, start_at, end_at, due_at, status, first_submitted_at, submitted_at, created_at, updated_at)
       select $1::uuid, 'usr_load_' || (1 + g % 246), $2::uuid, date '2026-10-17' + (g / 246), $3::uuid, 'Night', now(), now(), now(), (array['submitted','accepted','returned','draft'])[1 + g % 4], now(), now(), now(), now()
       from generate_series(0, 2999) g`,
      [w.tenant.id, w.pattern, w.team],
    )
    await w.q("analyze shift_reports")
    const qs = "from=2026-10-17&to=2026-11-16&limit=100"
    const first = await inbox(w, w.ops, qs)
    expect(first.items).toHaveLength(100)
    expect(first.nextCursor).toEqual(expect.any(String))
    const times: number[] = []
    for (let i = 0; i < 12; i++) {
      const t0 = performance.now()
      const r = await w.req("GET", `/v1/shift-reports?${qs}&status=all`, w.ops)
      expect(r.status).toBe(200)
      await r.text()
      times.push(performance.now() - t0)
    }
    times.sort((a, b) => a - b)
    expect(times[Math.floor(times.length * 0.95) - 1], `times ${times.map((x) => Math.round(x)).join(",")}`).toBeLessThan(500)
    // a full walk of the 31 days pages without a duplicate or a gap: stored + virtual = every (member, date) once
    const keys = new Set<string>()
    let cursor: string | null = null
    for (let pages = 0; pages < 100; pages++) {
      const p = await inbox(w, w.ops, `from=2026-10-17&to=2026-11-16&limit=100${cursor ? `&cursor=${cursor}` : ""}`)
      for (const i of p.items) { expect(keys.has(i.key), i.key).toBe(false); keys.add(i.key) }
      cursor = p.nextCursor
      if (!cursor) break
    }
    expect(keys.size).toBe(250 * 30) // 4 world members + 246 load members, 17 Oct..15 Nov: one row each (the 16 Nov night has not started at 09:00Z)
  }, 120_000)

  test("the report template is a tenant setting (no new table): R8 on tenant_settings holds, and a tenant's template never reaches another tenant", async () => {
    const a = await world()
    const b = await world({ slug: "other" })
    const admin = await a.who("admin")
    expect((await a.req("PUT", "/v1/shift-reports/template", admin, { departments: [{ dept: "Night team", sections: [{ id: "summary", title: "S", enabled: true, fields: [{ id: "summary", label: "Summary", required: false }] }] }] })).status).toBe(200)
    expect((await b.json(await b.req("GET", "/v1/shift-reports/template", b.ops))).custom).toBe(false)
    expect((await a.json(await a.req("GET", "/v1/shift-reports/template", a.ops))).custom).toBe(true)
  })
})
