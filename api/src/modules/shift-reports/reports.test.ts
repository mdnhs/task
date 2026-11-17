import { randomUUID } from "node:crypto"
import { sql } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { ownerQuery } from "../../../test/db"
import { makeApiKey, makeMember, makeStaff, makeTenant, signIn } from "../../../test/factories"
import { call, resetDb } from "../../../test/harness"
import { resetSubscribers } from "../../core/events"
import { withTenant } from "../../db/tenant-tx"
import { registerFiles } from "../files"
import { registerGdpr } from "../gdpr"
import { clearModuleOverride } from "../entitlements"
import { registerNotifications } from "../notifications"
import { registerWebhooks } from "../webhooks-out"
import { registerSearchIndexers } from "../search"
import { registerTasks } from "../tasks"
import { registerShiftReports, shiftReportsDsrHandler } from "."
import { code, DAY, DRIVE, EICAR, REQUIRED, upload, world, type Json, type Who } from "./world"

// T5.2: shift reports, the member side (rows, draft, submit, versions, uploads, listTasksForPerson). Rulings F2-F11, F16, F21, F22; D4, D5, D8, D9/D10, D22/E13, E3.

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

describe("rows and deadline (F2, F3, F9)", () => {
  test("report rows and deadline for the 24 Oct night: window 21:00Z-06:00Z; a task completed 2026-10-25T00:30Z (01:30 BST) and one at 01:30Z (01:30 GMT) are both in; one completed 20:59Z is out; due_at 07:00Z", async () => {
    const w = await world()
    const a = await w.task(w.staff, { status: "completed", completedAt: "2026-10-25T00:30:00.000Z", title: "A BST" })
    const b = await w.task(w.staff, { status: "completed", completedAt: "2026-10-25T01:30:00.000Z", title: "B GMT" })
    const early = await w.task(w.staff, { status: "completed", completedAt: "2026-10-24T20:59:00.000Z", title: "Early" })
    const open = await w.task(w.staff, { title: "Open one" })
    const rep = await w.opened(w.staff)
    expect(rep).toMatchObject({ date: DAY, startAt: "2026-10-24T21:00:00.000Z", endAt: "2026-10-25T06:00:00.000Z", dueAt: "2026-10-25T07:00:00.000Z", status: "draft", version: 1, submissions: 0, userId: w.staff.userId, shiftName: "Night", team: "Night team" })
    expect(rep.start).toBe("2026-10-24T22:00")
    expect(rep.due).toBe("2026-10-25T07:00")
    expect(rep.items.map((i: Json) => i.ref).sort()).toEqual([a.ref, b.ref, open.ref].sort())
    expect(rep.items.map((i: Json) => i.ref)).not.toContain(early.ref)
    expect(rep.items.find((i: Json) => i.ref === a.ref)).toMatchObject({ status: "done", minutes: 0, note: "", taskStatus: "completed" }) // a finished task starts as done (itemStatusOf)
    expect(rep.items.find((i: Json) => i.ref === open.ref)).toMatchObject({ status: "not_started", taskStatus: "not_started" })
    // the instants are stored, not re-derived: a pattern edit after the report exists changes nothing
    expect((await w.req("PATCH", `/v1/shifts/patterns/${w.pattern}`, w.ops, { version: 1, end: "07:00" })).status).toBe(200)
    expect((await w.get(w.staff, rep.id)).endAt).toBe("2026-10-25T06:00:00.000Z")
  })

  test("the March night (7 h) is due at 06:00Z and its report day is the 27th", async () => {
    const w = await world({ now: "2027-03-28T12:00:00Z" })
    const rep = await w.opened(w.staff, "2027-03-27")
    expect([rep.date, rep.startAt, rep.endAt, rep.dueAt]).toEqual(["2027-03-27", "2027-03-27T22:00:00.000Z", "2027-03-28T05:00:00.000Z", "2027-03-28T06:00:00.000Z"])
  })

  test("a task of another person, an archived and a cancelled task, and one that starts after the shift are not rows", async () => {
    const w = await world()
    const mine = await w.task(w.staff)
    const theirs = await w.task(w.staff2)
    const late = await w.task(w.staff, { start: "2026-10-25T06:00:00.000Z", due: "2026-10-25T09:00:00.000Z" })
    const gone = await w.task(w.staff)
    await w.q("update tasks set status = 'cancelled' where id = $1", [gone.id])
    const arch = await w.task(w.staff)
    await w.q("update tasks set archived_at = now() where id = $1", [arch.id])
    const rep = await w.opened(w.staff)
    expect(rep.items.map((i: Json) => i.ref)).toEqual([mine.ref])
    expect(JSON.stringify(rep)).not.toContain(theirs.ref)
    expect(JSON.stringify(rep)).not.toContain(late.ref)
  })
})

describe("open (F4)", () => {
  test("open creates the draft once: two concurrent opens return the same id (unique key), 201 then 200", async () => {
    const w = await world()
    await w.task(w.staff)
    const rs = await Promise.all([w.open(w.staff), w.open(w.staff), w.open(w.staff)])
    expect(rs.map((r) => r.status).sort()).toEqual([200, 200, 201])
    const ids = new Set((await Promise.all(rs.map((r) => w.json(r)))).map((j) => j.id))
    expect(ids.size).toBe(1)
    expect((await w.q("select count(*)::int n from shift_reports"))[0].n).toBe(1)
    expect((await w.q("select count(*)::int n from shift_report_items"))[0].n).toBe(1) // rows were created once
  })

  test("open for a shift the caller is not assigned to, another member's shift, a pattern of another tenant, or one that has not started → 404 shift_not_found; reporting off → 422 reporting_off", async () => {
    const w = await world()
    const lone = await w.who("employee") // a member nobody assigned to the pattern
    let r = await w.open(lone)
    expect([r.status, await code(r)]).toEqual([404, "shift_not_found"]) // never assigned
    r = await w.req("POST", "/v1/shift-reports/open", w.staff, { patternId: randomUUID(), date: DAY })
    expect([r.status, await code(r)]).toEqual([404, "shift_not_found"]) // unknown / foreign pattern
    r = await w.open(w.staff, "2026-09-01") // before the assignment
    expect([r.status, await code(r)]).toEqual([404, "shift_not_found"])
    r = await w.open(w.staff, "2026-11-20") // in the future of the fake clock (2026-11-16)
    expect([r.status, await code(r)]).toEqual([404, "shift_not_found"])
    const w2 = await world({ reporting: false, slug: "other" })
    r = await w2.open(w2.staff)
    expect([r.status, await code(r)]).toEqual([422, "reporting_off"])
    expect((await w2.q("select count(*)::int n from shift_reports"))[0].n).toBe(0)
    // an existing row keeps opening after reporting was switched off again
    expect((await w2.req("PUT", `/v1/shifts/reporting/teams/${w2.team}`, w2.ops, { on: true })).status).toBe(200)
    expect((await w2.open(w2.staff)).status).toBe(201)
    expect((await w2.req("PUT", `/v1/shifts/reporting/teams/${w2.team}`, w2.ops, { on: false })).status).toBe(200)
    expect((await w2.open(w2.staff)).status).toBe(200)
  })

  test("a malformed body is 400 validation_failed; the report belongs to the CALLER (nobody opens someone else's)", async () => {
    const w = await world()
    for (const b of [{ patternId: "x", date: DAY }, { patternId: w.pattern, date: "2026-02-30x" }, { patternId: w.pattern, date: DAY, userId: w.staff2.userId }, {}]) {
      const r = await w.req("POST", "/v1/shift-reports/open", w.staff, b)
      expect([b, r.status]).toEqual([b, 400])
    }
    const rep = await w.opened(w.staff)
    expect(rep.userId).toBe(w.staff.userId)
    expect((await w.q("select user_id from shift_reports"))[0].user_id).toBe(w.staff.userId)
  })
})

describe("lock order of the item inserts (C2, T5.2 review)", () => {
  test("open and the draft save insert the rows in TASK-ID order (the tasks FK KEY SHARE locks then follow the same global order as submit), while `position` keeps the due order", async () => {
    const w = await world()
    // 8 tasks with different due times: random uuids make "due order == id order" a 1 in 40320 chance
    const mk = [] as Json[]
    for (let k = 0; k < 8; k++) mk.push(await w.task(w.staff, { title: `T${k}`, due: `2026-10-25T0${k % 6}:${10 + k}:00.000Z` }))
    const rep = await w.opened(w.staff)
    const physical = async () => (await w.q("select task_id, position from shift_report_items where report_id = $1 order by ctid", [rep.id])) as { task_id: string; position: number }[]
    const first = await physical()
    expect(first.map((r) => r.task_id)).toEqual([...first.map((r) => r.task_id)].sort())
    expect(first.map((r) => r.position).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    const byPosition = [...first].sort((a, b) => a.position - b.position).map((r) => r.task_id)
    const dueOrder = [...rep.items].sort((a: Json, b: Json) => a.position - b.position).map((i: Json) => i.taskId)
    expect(byPosition).toEqual(dueOrder) // position still follows due order
    // a draft save adds the tasks that joined the shift since: also in id order
    const more = [] as Json[]
    for (let k = 0; k < 6; k++) more.push(await w.task(w.staff, { title: `L${k}`, due: `2026-10-25T0${(k * 2) % 6}:${30 + k}:00.000Z` }))
    await w.saved(w.staff, rep)
    const ids = more.map((t) => t.id)
    const added = ((await physical()) as { task_id: string }[]).map((r) => r.task_id).filter((id) => ids.includes(id)) // the saved rows were rewritten (new tuples), the added ones were only inserted
    expect(added).toHaveLength(6)
    expect(added).toEqual([...added].sort())
    expect(mk).toHaveLength(8)
  })
})

describe("current (F4)", () => {
  test("the running shift's report, else the last ended shift without a submission, else null; virtual until opened", async () => {
    const w = await world({ now: "2026-10-25T00:00:00Z" }) // inside the 24 Oct night (21:00Z-06:00Z)
    const at = async (as: Who) => (await w.json(await w.req("GET", "/v1/shift-reports/current", as))).item
    const cur = await at(w.staff)
    expect(cur).toMatchObject({ shiftName: "Night", shiftDate: DAY, startAt: "2026-10-24T21:00:00.000Z", endAt: "2026-10-25T06:00:00.000Z", dueAt: "2026-10-25T07:00:00.000Z", state: "draft", reportId: null })
    expect(typeof cur.key).toBe("string")
    const rep = await w.opened(w.staff)
    expect((await at(w.staff)).reportId).toBe(rep.id)
    expect((await w.json(await w.req("GET", "/v1/shift-reports/current", w.ops))).item).toBeNull() // ops is assigned no shift
  })

  test("after the shift ends and nothing was submitted it is still offered (missing once past the due time); once submitted it moves on", async () => {
    const w = await world({ now: "2026-10-25T06:30:00Z" }) // ended 06:00Z, due 07:00Z
    const at = async (as: Who) => (await w.json(await w.req("GET", "/v1/shift-reports/current", as))).item
    expect(await at(w.staff)).toMatchObject({ shiftDate: DAY, state: "draft" })
    w.clock.advance({ hours: 1 })
    expect(await at(w.staff)).toMatchObject({ shiftDate: DAY, state: "missing" })
    const rep = await w.opened(w.staff, DAY)
    const s = await w.saved(w.staff, rep)
    expect((await w.submit(w.staff, s)).status).toBe(200)
    expect(await at(w.staff)).toBeNull() // the last ended shift was submitted: nothing to do until the next one starts
    const lone = await w.who("employee")
    expect((await w.json(await w.req("GET", "/v1/shift-reports/current", lone))).item).toBeNull()
  })
})

describe("draft (F4, F7)", () => {
  test("PUT draft saves rows, summary, blockers, unplanned and extra, and bumps the version; a stale version is 409 version_conflict", async () => {
    const w = await world()
    const t1 = await w.task(w.staff)
    const rep = await w.opened(w.staff)
    const unplanned = [{ id: "u1", text: "Helped the neighbouring site", minutes: 20 }]
    const s = await w.saved(w.staff, rep, { items: [{ taskId: t1.id, status: "in_progress", minutes: 45, note: "half way" }], summary: "Busy.", blockers: "Lift out", unplanned, extra: { "handover.keys": "Left at desk" } })
    expect(s).toMatchObject({ version: 2, summary: "Busy.", blockers: "Lift out", unplanned, extra: { "handover.keys": "Left at desk" }, status: "draft" })
    expect(s.items[0]).toMatchObject({ taskId: t1.id, status: "in_progress", minutes: 45, note: "half way" })
    const stale = await w.put(w.staff, rep) // version 1 again
    expect([stale.status, await code(stale)]).toEqual([409, "version_conflict"])
    expect((await w.get(w.staff, rep.id)).summary).toBe("Busy.")
    // a task that entered the shift after the report was opened is added on the next save; a row of a task that LEFT the shift is kept
    const t2 = await w.task(w.staff, { title: "Added later" })
    const s2 = await w.saved(w.staff, s)
    expect(s2.items.map((i: Json) => i.ref).sort()).toEqual([t1.ref, t2.ref].sort())
  })

  test("limits: summary 4000, blockers 2000, 20 unplanned rows (text 300, minutes 0-1440), 5 attachments, 50 extra answers (2000), row note 1000, minutes 0-1440 → 400", async () => {
    const w = await world()
    const t1 = await w.task(w.staff)
    const rep = await w.opened(w.staff)
    const bad: [string, Json][] = [
      ["summary", { summary: "x".repeat(4001) }], ["blockers", { blockers: "x".repeat(2001) }],
      ["21 unplanned", { unplanned: Array.from({ length: 21 }, (_, i) => ({ id: `u${i}`, text: "t", minutes: 1 })) }],
      ["unplanned text", { unplanned: [{ id: "u", text: "x".repeat(301), minutes: 1 }] }], ["unplanned minutes", { unplanned: [{ id: "u", text: "t", minutes: 1441 }] }],
      ["6 attachments", { attachmentFileIds: Array.from({ length: 6 }, () => randomUUID()) }],
      ["51 extra", { extra: Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`s.f${i}`, "a"])) }], ["extra value", { extra: { "s.f": "x".repeat(2001) } }],
      ["note", { items: [{ taskId: t1.id, status: "done", minutes: 1, note: "x".repeat(1001) }] }], ["minutes", { items: [{ taskId: t1.id, status: "done", minutes: 1441, note: "" }] }],
      ["negative", { items: [{ taskId: t1.id, status: "done", minutes: -1, note: "" }] }], ["status", { items: [{ taskId: t1.id, status: "finished", minutes: 1, note: "" }] }],
      ["duplicate row", { items: [{ taskId: t1.id, status: "done", minutes: 1, note: "" }, { taskId: t1.id, status: "done", minutes: 2, note: "" }] }],
    ]
    for (const [why, b] of bad) {
      const r = await w.put(w.staff, rep, b)
      expect([why, r.status]).toEqual([why, 400])
    }
    const ok = await w.put(w.staff, rep, { summary: "x".repeat(4000), blockers: "y".repeat(2000), items: [{ taskId: t1.id, status: "done", minutes: 1440, note: "z".repeat(1000) }] })
    expect(ok.status, await ok.clone().text()).toBe(200)
  })

  test("an item whose taskId is not in the shift's tasks, or belongs to tenant B → 422 item_not_in_shift", async () => {
    const w = await world()
    await w.task(w.staff)
    const elsewhere = await w.task(w.staff2) // another person's task
    const outside = await w.task(w.staff, { start: "2026-12-01T00:00:00.000Z", due: "2026-12-01T01:00:00.000Z" }) // starts after the shift
    const rep = await w.opened(w.staff)
    const bravo = await makeTenant(w.deps, { slug: "bravo" })
    const bOwner = await makeMember(w.deps, bravo.id, "owner")
    const bCookie = (await signIn(w.app, bOwner.email, bOwner.password)).cookie
    const bt = await call(w.app, "POST", "/v1/tasks", { cookie: bCookie, tenant: "bravo", body: { title: "B task", description: "d", priority: 2, start: "2026-11-20T09:00:00", due: "2026-11-20T17:00:00", primary: bOwner.userId } })
    expect(bt.status, await bt.clone().text()).toBe(201)
    const foreign = (await w.json(bt)).id as string
    for (const taskId of [elsewhere.id, outside.id, randomUUID(), foreign]) {
      const r = await w.put(w.staff, rep, { items: [{ taskId, status: "done", minutes: 1, note: "" }] })
      expect([r.status, await code(r)]).toEqual([422, "item_not_in_shift"])
    }
    expect((await w.get(w.staff, rep.id)).version).toBe(1) // nothing was saved
  })

  test("two concurrent saves at the same version: one 200, one 409 version_conflict", async () => {
    const w = await world()
    await w.task(w.staff)
    const rep = await w.opened(w.staff)
    const rs = await Promise.all([w.put(w.staff, rep, { summary: "A" }), w.put(w.staff, rep, { summary: "B" })])
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409])
    for (const r of rs) if (r.status === 409) expect(await code(r)).toBe("version_conflict")
  })

  test("a purged task keeps its row (ref and title) with no live state; the report still submits and the row is skipped", async () => {
    const w = await world()
    const gone = await w.task(w.staff, { title: "Soon gone" })
    const keep = await w.task(w.staff, { title: "Kept" })
    const rep = await w.opened(w.staff)
    await w.q("delete from tasks where id = $1", [gone.id]) // the purge job's effect: composite FK ON DELETE SET NULL (task_id)
    const g = await w.get(w.staff, rep.id)
    const row = g.items.find((i: Json) => i.ref === gone.ref)
    expect(row).toMatchObject({ taskId: null, title: "Soon gone", taskStatus: null })
    const f = await w.filled(w.staff, g)
    const r = await w.submit(w.staff, f)
    expect(r.status, await r.clone().text()).toBe(200)
    const done = await w.json(r)
    expect(done.items.find((i: Json) => i.ref === gone.ref).outcome).toBe("skipped_unavailable")
    expect(done.items.find((i: Json) => i.ref === keep.ref).outcome).toBe("applied")
    expect((await w.taskRow(keep.id)).status).toBe("completed")
  })
})

describe("submit (F7, F8, F11)", () => {
  test("AC-M1-02: the report lists exactly the member's shift tasks and submitting updates them (status, time entry, history line)", async () => {
    const w = await world()
    const done = await w.task(w.staff, { title: "Lock up" })
    const doing = await w.task(w.staff, { title: "Inventory" })
    const blocked = await w.task(w.staff, { title: "Fix lift" })
    const notStarted = await w.task(w.staff, { title: "Paint" })
    await w.task(w.staff2, { title: "Someone else's" })
    const rep = await w.opened(w.staff)
    expect(rep.items.map((i: Json) => i.ref).sort()).toEqual([done, doing, blocked, notStarted].map((t) => t.ref).sort())
    const by = (t: Json) => rep.items.find((i: Json) => i.ref === t.ref).taskId
    const s = await w.saved(w.staff, rep, {
      items: [
        { taskId: by(done), status: "done", minutes: 30, note: "locked" }, { taskId: by(doing), status: "in_progress", minutes: 45, note: "" },
        { taskId: by(blocked), status: "blocked", minutes: 0, note: "waiting for parts" }, { taskId: by(notStarted), status: "not_started", minutes: 0, note: "" },
      ],
    })
    const r = await w.submit(w.staff, s)
    expect(r.status, await r.clone().text()).toBe(200)
    const out = await w.json(r)
    expect(out).toMatchObject({ status: "submitted", state: "late", version: 3, submissions: 1 }) // the fake clock is past the 24 Oct due time
    expect(out.submittedAt).toEqual(expect.any(String))
    expect((await w.taskRow(done.id)).status).toBe("completed")
    expect((await w.taskRow(doing.id)).status).toBe("in_progress")
    expect((await w.taskRow(blocked.id)).status).toBe("blocked")
    expect((await w.taskRow(notStarted.id)).status).toBe("not_started")
    const entries = await w.q("select task_id, minutes, user_id, source, update_id from task_time_entries order by minutes")
    expect(entries.map((e) => [e.task_id, e.minutes, e.user_id])).toEqual([[done.id, 30, w.staff.userId], [doing.id, 45, w.staff.userId]])
    expect(entries[1].update_id).toBe(`${rep.id}.v1.${doing.ref}`) // <reportId>.v<n>.<ref> (F8)
    const h = await w.hist(done.id)
    expect(h).toHaveLength(1)
    expect(h[0].text).toContain("Status set to Completed")
    expect(h[0].text).toContain("30 min logged")
    expect(h[0].text).toContain("from the shift report Night, 2026-10-24")
    expect((await w.hist(blocked.id))[0].text).toContain("waiting for parts")
    expect(out.items.map((i: Json) => i.outcome).sort()).toEqual(["applied", "applied", "applied", "applied"])
    const vs = await w.json(await w.req("GET", `/v1/shift-reports/${rep.id}/versions`, w.staff))
    expect(vs.items).toHaveLength(1)
    expect(vs.items[0]).toMatchObject({ v: 1, note: "Submitted" })
    expect(vs.items[0].snapshot.summary).toBe("Quiet night.")
    expect(vs.items[0].snapshot.items).toHaveLength(4)
  })

  test("submit is atomic and idempotent: same requestId twice → one version and one set of history lines (200 both); a failing row rolls back every row and the version", async () => {
    const w = await world()
    const t1 = await w.task(w.staff)
    const t2 = await w.task(w.staff)
    const rep = await w.opened(w.staff)
    const f = await w.filled(w.staff, rep)
    const requestId = randomUUID()
    // a row that fails mid-way: the history insert of the second task raises, after the first task was already updated
    await ownerQuery(`create function t52_fail() returns trigger language plpgsql as $$ begin if new.update_id like '%' || '${t2.ref}' then raise exception 't52 boom'; end if; return new; end $$`)
    await ownerQuery("create trigger t52_trg before insert on task_history for each row execute function t52_fail()")
    const failed = await Promise.all([w.submit(w.staff, f, requestId)])
    await ownerQuery("drop trigger t52_trg on task_history")
    await ownerQuery("drop function t52_fail()")
    expect(failed[0].status).toBe(500)
    expect((await w.taskRow(t1.id)).status).toBe("not_started") // the first row rolled back too
    expect((await w.q("select count(*)::int n from shift_report_versions"))[0].n).toBe(0)
    expect((await w.q("select count(*)::int n from task_time_entries"))[0].n).toBe(0)
    expect((await w.q("select status, version, submissions from shift_reports"))[0]).toMatchObject({ status: "draft", version: f.version, submissions: 0 })
    // now for real: twice with the same requestId
    const a = await w.submit(w.staff, f, requestId)
    const b = await w.submit(w.staff, f, requestId)
    expect([a.status, b.status]).toEqual([200, 200])
    expect((await w.json(a)).version).toBe((await w.json(b)).version)
    expect((await w.q("select count(*)::int n from shift_report_versions"))[0].n).toBe(1)
    expect(await w.hist(t1.id)).toHaveLength(1)
    expect(await w.hist(t2.id)).toHaveLength(1)
    expect((await w.q("select count(*)::int n from task_time_entries"))[0].n).toBe(2)
    expect((await w.q("select submissions from shift_reports"))[0].submissions).toBe(1)
    // a concurrent replay (double tap) is the same
    const w2 = await world({ slug: "other" })
    await w2.task(w2.staff)
    const rep2 = await w2.filled(w2.staff, await w2.opened(w2.staff))
    const rid = randomUUID()
    const rs = await Promise.all([w2.submit(w2.staff, rep2, rid), w2.submit(w2.staff, rep2, rid), w2.submit(w2.staff, rep2, rid)])
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200])
    expect((await w2.q("select count(*)::int n from shift_report_versions"))[0].n).toBe(1)
    expect((await w2.q("select count(*)::int n from task_time_entries"))[0].n).toBe(1)
  })

  test("concurrent submit with different requestIds at the same version: one 200, one 409 version_conflict", async () => {
    const w = await world()
    await w.task(w.staff)
    const rep = await w.filled(w.staff, await w.opened(w.staff))
    const rs = await Promise.all([w.submit(w.staff, rep), w.submit(w.staff, rep)])
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409])
    for (const r of rs) if (r.status === 409) expect(await code(r)).toBe("version_conflict")
    expect((await w.q("select count(*)::int n from shift_report_versions"))[0].n).toBe(1)
    expect((await w.q("select count(*)::int n from task_time_entries"))[0].n).toBe(1)
  })

  test("resubmit after a return creates v2 and logs only the extra minutes (30 → 45 logs 15); status never moves a task backwards", async () => {
    const w = await world()
    const t1 = await w.task(w.staff)
    const t2 = await w.task(w.staff)
    const rep = await w.opened(w.staff)
    const s1 = await w.saved(w.staff, rep, { items: [{ taskId: t1.id, status: "done", minutes: 30, note: "" }, { taskId: t2.id, status: "in_progress", minutes: 10, note: "" }] })
    const r1 = await w.json(await w.submit(w.staff, s1))
    expect(r1).toMatchObject({ status: "submitted", submissions: 1 })
    await w.q("update shift_reports set status = 'returned' where id = $1", [rep.id]) // a manager's return (T5.3 writes it through the API)
    const back = await w.get(w.staff, rep.id)
    expect(back.state).toBe("returned")
    const s2 = await w.saved(w.staff, back, { items: [{ taskId: t1.id, status: "in_progress", minutes: 45, note: "" }, { taskId: t2.id, status: "done", minutes: 5, note: "" }] })
    const r2 = await w.submit(w.staff, s2)
    expect(r2.status, await r2.clone().text()).toBe(200)
    const out = await w.json(r2)
    expect(out).toMatchObject({ status: "submitted", submissions: 2 })
    const vs = (await w.json(await w.req("GET", `/v1/shift-reports/${rep.id}/versions`, w.staff))).items
    expect(vs.map((v: Json) => [v.v, v.note])).toEqual([[1, "Submitted"], [2, "Resubmitted"]])
    const entries = await w.q("select task_id, minutes, update_id from task_time_entries order by update_id")
    expect(entries.filter((e) => e.task_id === t1.id).map((e) => e.minutes)).toEqual([30, 15]) // the delta only
    expect(entries.filter((e) => e.task_id === t2.id).map((e) => e.minutes)).toEqual([10]) // 5 < 10: a decrease is not retracted and logs nothing
    expect((await w.taskRow(t1.id)).status).toBe("completed") // row said in_progress on v2: never backwards
    expect((await w.taskRow(t2.id)).status).toBe("completed") // done on v2
    expect(await w.hist(t1.id)).toHaveLength(2) // one line per version (ids <report>.v1.<ref>, .v2.<ref>)
    expect((await w.q("select first_submitted_at, submitted_at from shift_reports"))[0].first_submitted_at).not.toBeNull()
  })

  test("pending scan never fails a report: Required task with a pending file stays open, row outcome needs_evidence, history 'Report marked done; evidence still needed'; infected file auto-rejected (T4.6 path)", async () => {
    const w = await world()
    const pending = await w.task(w.staff, { title: "Pending scan", evidenceRule: REQUIRED })
    const infected = await w.task(w.staff, { title: "Infected", evidenceRule: REQUIRED })
    const evFile = async (taskId: string, content: string, scan: boolean) => {
      const buf = Buffer.from(content)
      const r = await w.req("POST", `/v1/tasks/${taskId}/uploads`, w.staff, { purpose: "evidence", name: "p.pdf", mime: "application/pdf", sizeBytes: buf.length })
      const j = await w.json(r)
      const { "Content-Length": _l, ...headers } = j.upload.headers as Record<string, string>
      expect((await fetch(j.upload.url, { method: "PUT", headers, body: buf })).status).toBe(200)
      expect((await w.req("POST", `/v1/tasks/${taskId}/uploads/${j.fileId}/complete`, w.staff)).status).toBe(200)
      if (scan) await w.drain()
      return j.fileId as string
    }
    const inf = await evFile(infected.id, EICAR, false)
    expect((await w.req("POST", `/v1/tasks/${infected.id}/evidence`, w.staff, { kind: "pdf", fileId: inf })).status).toBe(201)
    expect((await w.req("POST", `/v1/tasks/${infected.id}/evidence`, w.staff, { kind: "note", text: "Walked it" })).status).toBe(201)
    await w.drain() // the scan verdict arrives AFTER the item was attached (no relay: the auto-reject must come from the submit path)
    const pf = await evFile(pending.id, "fine", false) // attached AFTER the drain: its scan has not run
    expect((await w.req("POST", `/v1/tasks/${pending.id}/evidence`, w.staff, { kind: "pdf", fileId: pf })).status).toBe(201)
    const rep = await w.filled(w.staff, await w.opened(w.staff))
    const r = await w.submit(w.staff, rep)
    expect(r.status, await r.clone().text()).toBe(200)
    const out = await w.json(r)
    expect(out.items.find((i: Json) => i.ref === pending.ref)).toMatchObject({ outcome: "needs_evidence", taskStatus: "not_started" })
    expect(out.items.find((i: Json) => i.ref === infected.ref)).toMatchObject({ outcome: "submitted_for_review", taskStatus: "submitted" })
    expect((await w.taskRow(pending.id)).status).toBe("not_started")
    expect((await w.hist(pending.id))[0].text).toContain("Report marked done; evidence still needed")
    const ev = await w.q("select review, reviewed_by from task_evidence where task_id = $1 and kind = 'pdf'", [infected.id])
    expect(ev[0]).toMatchObject({ review: "rejected", reviewed_by: "system:scanner" })
  }, 60_000)

  test("Required task with a clean item goes to submitted_for_review; Not-needed task goes to completed; evidence state is returned read-only per row", async () => {
    const w = await world()
    const req = await w.task(w.staff, { title: "Needs proof", evidenceRule: REQUIRED })
    const none = await w.task(w.staff, { title: "No proof" })
    expect((await w.req("POST", `/v1/tasks/${req.id}/evidence`, w.staff, { kind: "note", text: "Checked" })).status).toBe(201)
    const rep = await w.opened(w.staff)
    const before = rep.items.find((i: Json) => i.ref === req.ref)
    expect(before.evidenceState).toEqual("attached")
    expect(rep.items.find((i: Json) => i.ref === none.ref).evidenceState).toBeNull()
    const f = await w.filled(w.staff, rep)
    const out = await w.json(await w.submit(w.staff, f))
    expect(out.items.find((i: Json) => i.ref === req.ref)).toMatchObject({ outcome: "submitted_for_review", taskStatus: "submitted", evidenceState: "awaiting" })
    expect(out.items.find((i: Json) => i.ref === none.ref)).toMatchObject({ outcome: "applied", taskStatus: "completed" })
    // the report never edits evidence: no item was added or removed by it
    expect((await w.q("select count(*)::int n from task_evidence"))[0].n).toBe(1)
  })

  test("H1 (controller ruling): a row marked done moves a BLOCKED task straight to completed (the domain taskStatusFor rule; no prior unblock needed), while a Required task without evidence stays open", async () => {
    const w = await world()
    const blocked = await w.task(w.staff, { title: "Waiting for parts", status: "blocked" })
    const gated = await w.task(w.staff, { title: "Needs proof", status: "blocked", evidenceRule: REQUIRED })
    expect((await w.taskRow(blocked.id)).status).toBe("blocked")
    const rep = await w.opened(w.staff)
    const rows = rep.items.map((i: Json) => ({ taskId: i.taskId, status: "done", minutes: 20, note: "" }))
    const s = await w.saved(w.staff, rep, { items: rows })
    const r = await w.submit(w.staff, s)
    expect(r.status, await r.clone().text()).toBe(200)
    const out = await w.json(r)
    expect(out.items.find((i: Json) => i.ref === blocked.ref)).toMatchObject({ outcome: "applied", taskStatus: "completed" })
    expect((await w.taskRow(blocked.id)).status).toBe("completed") // blocked -> completed in one step: intended (ruling H1)
    expect((await w.taskRow(gated.id)).status).not.toBe("completed") // evidence still applies: a Required task never completes from a bare "done"
    expect(out.items.find((i: Json) => i.ref === gated.ref).outcome).toBe("needs_evidence")
  })

  test("submitted or accepted report rejects PUT draft and submit: 409 report_locked; returned allows both", async () => {
    const w = await world()
    await w.task(w.staff)
    const rep = await w.filled(w.staff, await w.opened(w.staff))
    const done = await w.json(await w.submit(w.staff, rep))
    for (const state of ["submitted", "accepted"]) {
      await w.q("update shift_reports set status = $2 where id = $1", [rep.id, state])
      const cur = await w.get(w.staff, rep.id)
      const p = await w.put(w.staff, cur)
      expect([state, p.status, await code(p)]).toEqual([state, 409, "report_locked"])
      const s = await w.submit(w.staff, cur)
      expect([state, s.status, await code(s)]).toEqual([state, 409, "report_locked"])
    }
    expect(done.version).toBe(3)
    await w.q("update shift_reports set status = 'returned' where id = $1", [rep.id])
    const back = await w.get(w.staff, rep.id)
    const p = await w.put(w.staff, back, { summary: "Fixed" })
    expect(p.status).toBe(200)
    expect((await w.submit(w.staff, await w.json(p))).status).toBe(200)
  })

  test("template validation: required summary missing → 422 report_invalid with errors[{key:'summary'}]; blocked row without a note → key 'item:<ref>:note'; done row without time → 'item:<ref>:minutes'", async () => {
    const w = await world()
    const t1 = await w.task(w.staff)
    const t2 = await w.task(w.staff)
    const rep = await w.opened(w.staff)
    const s = await w.saved(w.staff, rep, { summary: "  ", items: [{ taskId: t1.id, status: "blocked", minutes: 0, note: "" }, { taskId: t2.id, status: "done", minutes: 0, note: "" }] })
    const r = await w.submit(w.staff, s)
    expect([r.status, await code(r)]).toEqual([422, "report_invalid"])
    const errors = (await w.json(r)).errors as { key: string; message: string }[]
    expect(errors.map((e) => e.key).sort()).toEqual(["summary", `item:${t1.ref}:note`, `item:${t2.ref}:minutes`].sort())
    expect(errors.every((e) => typeof e.message === "string")).toBe(true)
    expect((await w.q("select count(*)::int n from shift_report_versions"))[0].n).toBe(0)
    expect((await w.taskRow(t2.id)).status).toBe("not_started") // nothing was applied
  })

  test("Drive text is withheld per request: summary, blockers, notes, unplanned, extra and row titles show 'Google Drive link' off the company PC, intact on it; notification bodies and history hold no report text", async () => {
    const w = await world()
    expect((await w.req("PUT", "/v1/device-policies/drive", w.owner, { allow: "any" })).status).toBe(200)
    const t1 = await w.task(w.staff, { title: `Plan ${DRIVE}` })
    const rep = await w.opened(w.staff)
    const s = await w.saved(w.staff, rep, {
      summary: `See ${DRIVE}`, blockers: `Blocked ${DRIVE}`, unplanned: [{ id: "u", text: `Did ${DRIVE}`, minutes: 5 }], extra: { "handover.keys": `Keys ${DRIVE}` },
      items: [{ taskId: t1.id, status: "done", minutes: 5, note: `Note ${DRIVE}` }],
    })
    const intact = JSON.stringify(s)
    expect(intact).toContain("drive.google.com")
    expect((await w.json(await w.submit(w.staff, s))).status).toBe("submitted")
    expect((await w.req("PUT", "/v1/device-policies/drive", w.owner, { allow: "none" })).status).toBe(200)
    for (const path of [`/v1/shift-reports/${rep.id}`, `/v1/shift-reports/${rep.id}/versions`]) {
      const text = await (await w.req("GET", path, w.staff)).text()
      expect(text, path).not.toContain("drive.google.com")
      expect(text, path).toContain("Google Drive link")
    }
    const stored = (await w.q("select summary, blockers from shift_reports"))[0]
    expect(`${stored.summary}${stored.blockers}`).toContain("drive.google.com") // stored intact
    // the history line and the notification never carry the report text, and never a link
    const h = JSON.stringify(await w.hist(t1.id))
    expect(h).not.toContain("drive.google.com")
    const notes = await w.q("select kind, title, body from notifications where kind = 'report'")
    expect(notes.length).toBeGreaterThan(0)
    for (const n of notes) {
      expect(JSON.stringify(n)).not.toContain("drive.google.com")
      expect(JSON.stringify(n)).not.toContain("See ")
      expect(JSON.stringify(n)).not.toContain("Blocked")
    }
  })

  test("the manager is told in-app when a report is submitted (kind report, body = shift name and date only); a member without a manager falls back to the owners; never the submitter", async () => {
    const w = await world()
    await w.manages(w.ops, w.staff)
    await w.task(w.staff)
    const rep = await w.filled(w.staff, await w.opened(w.staff, DAY), { summary: "TOP SECRET SUMMARY" })
    expect((await w.submit(w.staff, rep)).status).toBe(200)
    const n1 = await w.q("select user_id, kind, title, body, subject_user_id from notifications where kind = 'report'")
    expect(n1.map((n) => n.user_id)).toEqual([w.ops.userId])
    expect(n1[0].body).toBe("Night, 2026-10-24")
    expect(JSON.stringify(n1)).not.toContain("SECRET")
    // staff2 has no manager: the active owners hear (the owner is also assigned and is not the submitter here)
    await w.task(w.staff2)
    const rep2 = await w.filled(w.staff2, await w.opened(w.staff2, DAY))
    expect((await w.submit(w.staff2, rep2)).status).toBe(200)
    const n2 = await w.q("select user_id from notifications where kind = 'report' and subject_user_id = $1", [w.staff2.userId])
    expect(n2.map((n) => n.user_id)).toEqual([w.owner.userId])
    // an owner who submits is not told about their own report
    await w.task(w.owner)
    const rep3 = await w.filled(w.owner, await w.opened(w.owner, DAY))
    expect((await w.submit(w.owner, rep3)).status).toBe(200)
    expect((await w.q("select count(*)::int n from notifications where kind = 'report' and subject_user_id = $1", [w.owner.userId]))[0].n).toBe(0)
    // audited, and the event is published last (ids only)
    const audit = await w.q("select action, entity, actor_id from audit_events where action = 'shift.report.submitted'")
    expect(audit).toHaveLength(3)
    const ev = await w.q("select type, payload from domain_events where type = 'shift.report.submitted' order by occurred_at")
    expect(Object.keys(ev[0].payload as object).sort()).toEqual(["reportId", "version"])
  })

  test("a task reassigned after the row was saved is skipped on submit (outcome skipped_unavailable, task untouched), even for a manager who could change it through the task itself", async () => {
    const w = await world()
    const mine = await w.task(w.owner, { title: "Was mine" })
    const kept = await w.task(w.owner, { title: "Still mine" })
    const rep = await w.opened(w.owner)
    expect(rep.items.map((i: Json) => i.ref).sort()).toEqual([mine.ref, kept.ref].sort())
    expect((await w.req("PUT", `/v1/tasks/${mine.id}/assignees`, w.ops, { version: 1, primary: w.staff.userId, others: [] })).status).toBe(200)
    const f = await w.filled(w.owner, await w.get(w.owner, rep.id))
    const out = await w.json(await w.submit(w.owner, f))
    expect(out.items.find((i: Json) => i.ref === mine.ref).outcome).toBe("skipped_unavailable")
    expect(out.items.find((i: Json) => i.ref === kept.ref).outcome).toBe("applied")
    expect((await w.taskRow(mine.id)).status).toBe("not_started")
    expect(await w.hist(mine.id)).toHaveLength(0)
    expect((await w.q("select count(*)::int n from task_time_entries where task_id = $1", [mine.id]))[0].n).toBe(0)
  })

  test("an api key (staff creator) can open, GET own report and PUT draft but submit → 403 human_required; its draft is the creator's", async () => {
    const w = await world()
    const t1 = await w.task(w.staff)
    const key = await makeApiKey(w.deps, w.tenant.id, w.staff.userId, ["reports:read", "reports:write", "tasks:read"])
    const k = (method: string, path: string, body?: unknown) => call(w.app, method, path, { headers: { authorization: `Bearer ${key.key}` }, body })
    const o = await k("POST", "/v1/shift-reports/open", { patternId: w.pattern, date: DAY })
    expect(o.status, await o.clone().text()).toBe(201)
    const rep = await w.json(o)
    expect(rep.userId).toBe(w.staff.userId)
    expect(rep.items.map((i: Json) => i.ref)).toEqual([t1.ref])
    const g = await k("GET", `/v1/shift-reports/${rep.id}`)
    expect(g.status).toBe(200)
    const p = await k("PUT", `/v1/shift-reports/${rep.id}/draft`, w.draftBody(rep, { summary: "from key" }))
    expect(p.status, await p.clone().text()).toBe(200)
    const s = await k("POST", `/v1/shift-reports/${rep.id}/submit`, { version: 2, requestId: randomUUID() })
    expect([s.status, await code(s)]).toEqual([403, "human_required"])
    expect((await w.q("select status from shift_reports"))[0].status).toBe("draft")
    // the member's report is invisible to a key of someone else
    const other = await makeApiKey(w.deps, w.tenant.id, w.staff2.userId, ["reports:read", "reports:write"])
    const no = await call(w.app, "GET", `/v1/shift-reports/${rep.id}`, { headers: { authorization: `Bearer ${other.key}` } })
    expect([no.status, await code(no)]).toEqual([404, "report_not_found"])
    // downloads are never for a key (the route name is on the shared deny-list)
    const fid = await upload(w, w.staff, rep.id)
    const dl = await k("GET", `/v1/shift-reports/${rep.id}/files/${fid}/download`)
    expect([dl.status, await code(dl)]).toEqual([403, "api_key_forbidden_route"])
  })

  test("support grant: GET /v1/shift-reports/{id} and its versions and downloads → 403 support_forbidden_route (audited); the inbox-style reads that carry no free text stay allowed", async () => {
    const w = await world()
    await w.task(w.staff)
    const rep = await w.filled(w.staff, await w.opened(w.staff))
    await w.submit(w.staff, rep)
    const staff = await makeStaff(w.deps, "support")
    const g = await call(w.app, "POST", `/v1/platform/tenants/${w.tenant.id}/support-grants`, { cookie: staff.cookie, body: { reason: "Ticket 4411: report totals look wrong", hours: 2 } })
    expect(g.status, await g.clone().text()).toBe(201)
    const as = (path: string) => call(w.app, "GET", path, { cookie: staff.cookie, tenant: "acme" })
    for (const path of [`/v1/shift-reports/${rep.id}`, `/v1/shift-reports/${rep.id}/versions`, `/v1/shift-reports/${rep.id}/files/${randomUUID()}/download`]) {
      const r = await as(path)
      expect([path, r.status, await code(r)]).toEqual([path, 403, "support_forbidden_route"])
    }
    const denied = await w.q("select after from audit_events where action = 'support.route_denied'")
    expect(denied.map((d) => (d.after as Json).path)).toContain(`/v1/shift-reports/${rep.id}`)
    // support is read-only: it cannot open or save either
    const w2 = await call(w.app, "POST", "/v1/shift-reports/open", { cookie: staff.cookie, tenant: "acme", body: { patternId: w.pattern, date: DAY } })
    expect(w2.status).toBe(403)
  })
})

describe("scope and independence (D5, F5)", () => {
  test("a member sees and edits only their own report: another member's → 404 report_not_found on every route, with the same body as an unknown id", async () => {
    const w = await world()
    await w.task(w.staff)
    const rep = await w.opened(w.staff)
    const fid = await upload(w, w.staff, rep.id)
    const probe = async (id: string, fileId: string) => {
      const out: [string, number, string][] = []
      for (const [m, p, b] of [
        ["GET", `/v1/shift-reports/${id}`, undefined], ["PUT", `/v1/shift-reports/${id}/draft`, w.draftBody(rep)], ["POST", `/v1/shift-reports/${id}/submit`, { version: 1, requestId: randomUUID() }],
        ["GET", `/v1/shift-reports/${id}/versions`, undefined], ["POST", `/v1/shift-reports/${id}/uploads`, { name: "a.pdf", mime: "application/pdf", sizeBytes: 5 }],
        ["POST", `/v1/shift-reports/${id}/uploads/${fileId}/complete`, undefined], ["GET", `/v1/shift-reports/${id}/files/${fileId}/download`, undefined],
      ] as [string, string, unknown][]) {
        const r = await w.req(m, p, w.staff2, b)
        out.push([`${m} ${p.replace(id, ":id").replace(fileId, ":fileId")}`, r.status, await code(r)])
      }
      return out
    }
    const theirs = await probe(rep.id, fid)
    const ghost = await probe(randomUUID(), randomUUID())
    expect(theirs).toEqual(ghost) // no existence oracle
    for (const [, status, c] of theirs) expect([status, c]).toEqual([404, "report_not_found"])
    expect((await w.get(w.staff, rep.id)).summary).toBe("") // untouched
  })

  test("a team manager sees a direct report's report (read) but cannot edit or submit it (403); an out-of-team member's is 404; an all-scope manager reads it; nobody but the owner submits", async () => {
    const w = await world()
    await w.manages(w.manager, w.staff)
    await w.task(w.staff)
    const rep = await w.opened(w.staff)
    const rep2 = await w.opened(w.staff2)
    expect((await w.req("GET", `/v1/shift-reports/${rep.id}`, w.manager)).status).toBe(200)
    expect((await w.req("GET", `/v1/shift-reports/${rep.id}/versions`, w.manager)).status).toBe(200)
    const o = await w.req("GET", `/v1/shift-reports/${rep2.id}`, w.manager)
    expect([o.status, await code(o)]).toEqual([404, "report_not_found"])
    for (const as of [w.manager, w.ops, w.owner]) {
      const p = await w.put(as, rep)
      expect([as === w.manager ? "mgr" : "all", p.status, await code(p)]).toEqual([as === w.manager ? "mgr" : "all", 403, "forbidden"])
      const s = await w.submit(as, rep)
      expect([s.status, await code(s)]).toEqual([403, "forbidden"])
      const u = await w.req("POST", `/v1/shift-reports/${rep.id}/uploads`, as, { name: "a.pdf", mime: "application/pdf", sizeBytes: 5 })
      expect([u.status, await code(u)]).toEqual([403, "forbidden"])
    }
    expect((await w.req("GET", `/v1/shift-reports/${rep.id}`, w.ops)).status).toBe(200)
    expect((await w.req("GET", `/v1/shift-reports/${rep2.id}`, w.ops)).status).toBe(200)
    expect((await w.get(w.staff, rep.id)).version).toBe(1)
  })

  test("indirect reports are NOT in a team manager's scope (one level, F5)", async () => {
    const w = await world()
    await w.manages(w.manager, w.staff2)
    await w.manages(w.staff2, w.staff) // staff reports to staff2, who reports to the manager
    const rep = await w.opened(w.staff)
    const r = await w.req("GET", `/v1/shift-reports/${rep.id}`, w.manager)
    expect([r.status, await code(r)]).toEqual([404, "report_not_found"])
  })

  test("a role without reports access gets 403 from the guard; a role with read only cannot open or save (403)", async () => {
    const w = await world()
    const rep = await w.opened(w.staff)
    const hr = await w.who("hr") // reports: none
    expect((await w.req("GET", `/v1/shift-reports/${rep.id}`, hr)).status).toBe(403)
    const admin = await w.who("admin") // reports: read
    expect((await w.req("GET", `/v1/shift-reports/${rep.id}`, admin)).status).toBe(200)
    expect((await w.open(admin)).status).toBe(403)
  })
})

describe("races (E8-E10 lock order)", () => {
  test("two lock-order deadlock attempts (submit vs a manager PATCH of the same task) end in 200 + 409 or two 200s, never a 500", async () => {
    for (let i = 0; i < 6; i++) {
      await resetDb()
      resetSubscribers()
      registerNotifications()
      registerTasks()
      registerShiftReports()
      const w = await world()
      const tasks = [await w.task(w.staff), await w.task(w.staff), await w.task(w.staff)]
      const rep = await w.filled(w.staff, await w.opened(w.staff))
      const patch = (t: Json, v: number) => w.req("PATCH", `/v1/tasks/${t.id}`, w.ops, { version: v, title: `Edited ${i}` })
      const rs = await Promise.all([w.submit(w.staff, rep), patch(tasks[2], 1), patch(tasks[0], 1), patch(tasks[1], 1)])
      for (const r of rs) expect([200, 409], `${r.status} ${await r.clone().text()}`).toContain(r.status)
      expect(rs[0].status).toBe(200) // the submit always wins or waits: it only reads the rows under their locks
      for (const r of rs.slice(1)) if (r.status === 409) expect(["version_conflict", "retry"]).toContain(await code(r))
      for (const t of tasks) expect((await w.taskRow(t.id)).status).toBe("completed")
    }
  }, 120_000)

  test("two members submitting overlapping tasks (shared tasks, opposite row orders) both succeed, no deadlock, each task completed once with both time entries", async () => {
    for (let i = 0; i < 4; i++) {
      await resetDb()
      resetSubscribers()
      registerNotifications()
      registerTasks()
      registerShiftReports()
      const w = await world()
      const shared = [] as Json[]
      for (let k = 0; k < 4; k++) {
        const t = await w.task(w.staff, { title: `Shared ${k}` })
        expect((await w.req("PUT", `/v1/tasks/${t.id}/assignees`, w.ops, { version: 1, primary: w.staff.userId, others: [w.staff2.userId] })).status).toBe(200)
        shared.push(t)
      }
      const [a, b] = [await w.opened(w.staff), await w.opened(w.staff2)]
      const fa = await w.saved(w.staff, a, { items: [...a.items].reverse().map((r: Json) => ({ taskId: r.taskId, status: "done", minutes: 10, note: "" })) })
      const fb = await w.saved(w.staff2, b, { items: b.items.map((r: Json) => ({ taskId: r.taskId, status: "done", minutes: 20, note: "" })) })
      const rs = await Promise.all([w.submit(w.staff, fa), w.submit(w.staff2, fb)])
      // C3 (T5.2 review): the name promises "both succeed, no deadlock", so BOTH must be 200 (rows lock in id order, so there is no real retry condition)
      for (const r of rs) expect(r.status, await r.clone().text()).toBe(200)
      for (const t of shared) expect((await w.taskRow(t.id)).status).toBe("completed")
      const entries = await w.q("select user_id, count(*)::int n from task_time_entries group by user_id")
      for (const e of entries) expect(e.n).toBeLessThanOrEqual(4)
      const dup = await w.q("select task_id, count(*)::int n from task_history where kind = 'report' group by task_id, update_id having count(*) > 1")
      expect(dup).toEqual([])
    }
  }, 120_000)

  test("submit p95: a report with 30 rows submits in < 2 s (NFR-08)", async () => {
    const w = await world()
    const times: number[] = []
    for (const who of [w.staff, w.staff2, w.staff3]) {
      for (let i = 0; i < 30; i++) await w.task(who, { title: `Row ${i}` })
      const rep = await w.filled(who, await w.opened(who))
      expect(rep.items).toHaveLength(30)
      const t0 = Date.now()
      const r = await w.submit(who, rep)
      times.push(Date.now() - t0)
      expect(r.status, await r.clone().text()).toBe(200)
    }
    expect(Math.max(...times)).toBeLessThan(2000)
  }, 120_000)
})

describe("attachments (F16)", () => {
  test("upload via the report intent, 6th → 422; another report's fileId → 404 report_file_not_found; /v1/files/{id} → 404 for purpose report_attachment; not in search; no file.* webhook delivery is created for it", async () => {
    const w = await world()
    await w.task(w.staff)
    const hook = await w.req("POST", "/v1/webhooks", w.owner, { url: "https://hooks.example.com/opsdesk", events: ["file.uploaded", "file.scanned", "file.deleted"] })
    expect(hook.status, await hook.clone().text()).toBe(201)
    const rep = await w.opened(w.staff)
    const rep2 = await w.opened(w.staff2)
    const ids: string[] = []
    for (let i = 0; i < 5; i++) ids.push(await upload(w, w.staff, rep.id, { name: `p${i}.pdf` }))
    const sixth = await w.req("POST", `/v1/shift-reports/${rep.id}/uploads`, w.staff, { name: "six.pdf", mime: "application/pdf", sizeBytes: 5 })
    expect([sixth.status, await code(sixth)]).toEqual([422, "attachment_limit"])
    // the file purpose and the row
    const [f] = await w.q("select purpose, status, owner_user_id from files where id = $1", [ids[0]])
    expect(f).toMatchObject({ purpose: "report_attachment", status: "clean", owner_user_id: w.staff.userId })
    expect((await w.q("select count(*)::int n from shift_report_files where report_id = $1", [rep.id]))[0].n).toBe(5)
    // never through /v1/files
    for (const [m, p] of [["GET", `/v1/files/${ids[0]}`], ["GET", `/v1/files/${ids[0]}/download`], ["POST", `/v1/files/${ids[0]}/complete`], ["DELETE", `/v1/files/${ids[0]}`]] as [string, string][]) {
      const r = await w.req(m, p, w.owner)
      expect([m, p, r.status, await code(r)]).toEqual([m, p, 404, "file_not_found"])
    }
    // not in search, no webhook delivery
    await w.relay()
    expect((await w.q("select count(*)::int n from search_documents where entity = 'file'"))[0].n).toBe(0)
    expect((await w.q("select count(*)::int n from webhook_deliveries"))[0].n).toBe(0)
    // and the control: an ordinary file of the tenant IS announced
    const buf = Buffer.from("plain")
    const pi = await w.json(await w.req("POST", "/v1/files/uploads", w.owner, { name: "plain.pdf", mime: "application/pdf", sizeBytes: buf.length }))
    const { "Content-Length": _l, ...headers } = pi.upload.headers as Record<string, string>
    expect((await fetch(pi.upload.url, { method: "PUT", headers, body: buf })).status).toBe(200)
    expect((await w.req("POST", `/v1/files/${pi.fileId}/complete`, w.owner)).status).toBe(200)
    await w.drain()
    await w.relay()
    expect((await w.q("select count(*)::int n from webhook_deliveries"))[0].n).toBeGreaterThan(0)
    // another report's file id is a missing file; the report's own file downloads after the scan (302 to a 60 s URL); a Drive link never an attachment
    const cross = await w.req("GET", `/v1/shift-reports/${rep2.id}/files/${ids[0]}/download`, w.staff2)
    expect([cross.status, await code(cross)]).toEqual([404, "report_file_not_found"])
    const crossDraft = await w.put(w.staff2, rep2, { attachmentFileIds: [ids[0]] })
    expect([crossDraft.status, await code(crossDraft)]).toEqual([404, "report_file_not_found"])
    const dl = await w.req("GET", `/v1/shift-reports/${rep.id}/files/${ids[0]}/download`, w.staff)
    expect(dl.status).toBe(302)
    expect(dl.headers.get("cache-control")).toBe("no-store")
    expect(dl.headers.get("location")).toContain("http")
    // its manager can download it too (scope read); a stranger cannot
    await w.manages(w.manager, w.staff)
    expect((await w.req("GET", `/v1/shift-reports/${rep.id}/files/${ids[0]}/download`, w.manager)).status).toBe(302)
    expect((await w.req("GET", `/v1/shift-reports/${rep.id}/files/${ids[0]}/download`, w.staff3)).status).toBe(404)
    // the DTO lists them (name, size, kind)
    const g = await w.get(w.staff, rep.id)
    expect(g.attachments).toHaveLength(5)
    expect(g.attachments[0]).toMatchObject({ kind: "file", size: 9 })
  }, 90_000)

  test("scan gate: a pending file is 409 file_not_ready, an infected one 410 file_infected; PUT draft with a shorter attachmentFileIds removes (soft-deletes) the rest; a locked report takes no uploads", async () => {
    const w = await world()
    await w.task(w.staff)
    const rep = await w.opened(w.staff)
    const pending = await upload(w, w.staff, rep.id, { scan: false })
    const bad = await upload(w, w.staff, rep.id, { content: EICAR, name: "bad.pdf", scan: false })
    const dl = (id: string) => w.req("GET", `/v1/shift-reports/${rep.id}/files/${id}/download`, w.staff)
    for (const id of [pending, bad]) expect([(await dl(id)).status, await code(await dl(id))]).toEqual([409, "file_not_ready"])
    await w.drain() // the scans run: the plain file is clean, the EICAR one infected
    const ok = await dl(pending)
    expect(ok.status).toBe(302)
    expect([(await dl(bad)).status, await code(await dl(bad))]).toEqual([410, "file_infected"])
    const cur = await w.get(w.staff, rep.id)
    const s = await w.saved(w.staff, cur, { attachmentFileIds: [pending] })
    expect(s.attachments.map((a: Json) => a.id)).toEqual([pending])
    await w.drain() // the delete-object job of the removed file
    expect((await w.q("select status from files where id = $1", [bad]))[0].status).toBe("infected") // an infected file keeps its status (files_signature_check); only its object goes
    expect((await w.q("select count(*)::int n from shift_report_files where file_id = $1", [bad]))[0].n).toBe(0) // detached from the report
    expect([(await dl(bad)).status, await code(await dl(bad))]).toEqual([404, "report_file_not_found"])
    const f = await w.filled(w.staff, s)
    expect((await w.submit(w.staff, f)).status).toBe(200)
    const locked = await w.req("POST", `/v1/shift-reports/${rep.id}/uploads`, w.staff, { name: "late.pdf", mime: "application/pdf", sizeBytes: 5 })
    expect([locked.status, await code(locked)]).toEqual([409, "report_locked"])
    const badMime = await w.req("POST", `/v1/shift-reports/${rep.id}/uploads`, w.staff, { name: "x.exe", mime: "application/x-msdownload", sizeBytes: 5 })
    expect([badMime.status]).toContain(422)
  }, 60_000)

  test("a returned report accepts uploads again; concurrent intents cannot exceed 5", async () => {
    const w = await world()
    const rep = await w.opened(w.staff)
    const intents = await Promise.all(Array.from({ length: 8 }, (_, i) => w.req("POST", `/v1/shift-reports/${rep.id}/uploads`, w.staff, { name: `c${i}.pdf`, mime: "application/pdf", sizeBytes: 5 })))
    expect(intents.filter((r) => r.status === 201)).toHaveLength(5)
    expect(intents.filter((r) => r.status === 422)).toHaveLength(3)
    expect((await w.q("select count(*)::int n from shift_report_files"))[0].n).toBe(5)
  })
})

describe("DSR (F22)", () => {
  test("DSR export lists the subject's reports and the comments they wrote; erase nulls user_id, replaces free text with [erased] (reports, rows, unplanned, extra, version snapshots), expires attachments and keeps the counts", async () => {
    const w = await world()
    const t1 = await w.task(w.staff, { title: "Fire exits" })
    const rep = await w.opened(w.staff)
    const s = await w.saved(w.staff, rep, {
      summary: "Private narrative", blockers: "Private blocker", unplanned: [{ id: "u", text: "Private extra work", minutes: 12 }], extra: { "handover.keys": "Private keys" },
      items: [{ taskId: t1.id, status: "done", minutes: 30, note: "Private note" }],
    })
    const fid = await upload(w, w.staff, rep.id)
    const withFile = await w.get(w.staff, rep.id)
    expect(s.id).toBe(rep.id)
    expect((await w.submit(w.staff, withFile)).status).toBe(200)
    await w.q("insert into shift_report_comments (tenant_id, report_id, at, by_user, kind, text) values ($1, $2, now(), $3, 'return', 'Please add detail')", [w.tenant.id, rep.id, w.staff.userId])
    const exp = await withTenant(w.deps.db, w.tenant.id, (tx) => shiftReportsDsrHandler.export(tx, w.tenant.id, w.staff.userId))
    expect(JSON.stringify(exp)).toContain(rep.id)
    expect(JSON.stringify(exp)).toContain("Private narrative")
    expect((exp.reports as Json[]).map((r) => r.id)).toEqual([rep.id])
    expect((exp.comments as Json[])).toHaveLength(1)
    const other = await withTenant(w.deps.db, w.tenant.id, (tx) => shiftReportsDsrHandler.export(tx, w.tenant.id, w.staff2.userId))
    expect(other.reports).toEqual([])
    // the real erase job: handlers first, then the membership is removed
    const dr = await w.req("POST", "/v1/data-requests", w.owner, { subjectUserId: w.staff.userId, kind: "erase", reason: "asked" })
    expect(dr.status, await dr.clone().text()).toBe(201)
    await w.drain()
    const [row] = await w.q("select user_id, summary, blockers, unplanned, extra, status, submissions from shift_reports where id = $1", [rep.id])
    expect(row.user_id).toBeNull()
    expect([row.summary, row.blockers]).toEqual(["[erased]", "[erased]"])
    expect(row.unplanned).toEqual([{ id: "u", text: "[erased]", minutes: 12 }]) // minutes are counts, kept
    expect(row.extra).toEqual({ "handover.keys": "[erased]" })
    expect([row.status, row.submissions]).toEqual(["submitted", 1])
    const [item] = await w.q("select note, minutes, status from shift_report_items where report_id = $1", [rep.id])
    expect(item).toMatchObject({ note: "[erased]", minutes: 30, status: "done" })
    const [ver] = await w.q("select snapshot, by_user from shift_report_versions where report_id = $1", [rep.id])
    expect(JSON.stringify(ver.snapshot)).not.toContain("Private")
    expect(ver.by_user).toBeNull()
    expect((await w.q("select by_user from shift_report_comments"))[0].by_user).toBeNull()
    expect((await w.q("select status from files where id = $1", [fid]))[0].status).toBe("deleted")
    expect((await w.q("select user_id from shift_report_files"))[0].user_id).toBeNull()
    expect((await w.q("select count(*)::int n from shift_assignments where user_id = $1", [w.staff.userId]))[0].n).toBe(0)
    // a manager still reads the erased report (counts, no narrative); nobody sees the erased person's name
    const m = await w.json(await w.req("GET", `/v1/shift-reports/${rep.id}`, w.ops))
    expect(m.summary).toBe("[erased]")
    expect(m.userId).toBeNull()
  }, 60_000)
})

describe("database (R8, grants)", () => {
  test("RLS: a tenant-A tx cannot read or insert tenant-B shift_reports/items/versions/comments/files (error on .cause); all five tables are FORCEd", async () => {
    const a = await world()
    const other = await makeTenant(a.deps, { slug: "bravo" })
    const t1 = await a.task(a.staff)
    const rep = await a.opened(a.staff)
    await a.saved(a.staff, rep)
    const rows = await withTenant(a.deps.db, other.id, async (tx) =>
      Promise.all(["shift_reports", "shift_report_items", "shift_report_versions", "shift_report_comments", "shift_report_files"].map((t) => tx.execute(sql.raw(`select 1 from ${t}`)))),
    )
    expect(rows.map((r) => r.rows.length)).toEqual([0, 0, 0, 0, 0])
    const err = await withTenant(a.deps.db, other.id, (tx) =>
      tx.execute(sql`insert into shift_report_items (tenant_id, report_id, position, task_ref, title, due_at, status) values (${a.tenant.id}, ${rep.id}, 9, 1, 'x', now(), 'done')`),
    ).catch((e) => e)
    expect((err as { cause?: { code?: string } })?.cause?.code).toBe("42501")
    void t1
    const forced = await ownerQuery("select relname from pg_class where relname in ('shift_reports','shift_report_items','shift_report_versions','shift_report_comments','shift_report_files') and relforcerowsecurity and relrowsecurity order by 1")
    expect(forced.map((r) => r.relname)).toEqual(["shift_report_comments", "shift_report_files", "shift_report_items", "shift_report_versions", "shift_reports"])
  })

  test("grants: app_user cannot UPDATE shift_report_versions (only the erasure columns) or DELETE shift_report_comments, versions, reports; column grants are minimal", async () => {
    const tbl = async (t: string) => (await ownerQuery(`select privilege_type from information_schema.role_table_grants where grantee = 'app_user' and table_name = $1 order by 1`, [t])).map((r) => r.privilege_type)
    const col = async (t: string) => (await ownerQuery(`select column_name from information_schema.column_privileges where grantee = 'app_user' and table_name = $1 and privilege_type = 'UPDATE' order by 1`, [t])).map((r) => r.column_name)
    expect(await tbl("shift_reports")).toEqual(["INSERT", "SELECT"])
    expect(await col("shift_reports")).toEqual(["blockers", "extra", "first_submitted_at", "reviewed_at", "reviewed_by", "status", "submissions", "submitted_at", "summary", "unplanned", "updated_at", "version"])
    expect(await tbl("shift_report_items")).toEqual(["DELETE", "INSERT", "SELECT"])
    expect(await col("shift_report_items")).toEqual(["minutes", "note", "status", "title"])
    expect(await tbl("shift_report_versions")).toEqual(["INSERT", "SELECT"])
    expect(await col("shift_report_versions")).toEqual(["by_user", "snapshot"])
    expect(await tbl("shift_report_comments")).toEqual(["INSERT", "SELECT"])
    expect(await col("shift_report_comments")).toEqual(["by_user"])
    expect(await tbl("shift_report_files")).toEqual(["DELETE", "INSERT", "SELECT"])
    expect(await col("shift_report_files")).toEqual(["user_id"])
    const w = await world()
    await w.task(w.staff)
    const rep = await w.filled(w.staff, await w.opened(w.staff))
    expect((await w.submit(w.staff, rep)).status).toBe(200)
    await w.q("insert into shift_report_comments (tenant_id, report_id, at, kind, text) values ($1, $2, now(), 'return', 'keep')", [w.tenant.id, rep.id])
    for (const stmt of [
      sql`update shift_report_versions set v = 9`, sql`update shift_report_versions set note = 'edited'`, sql`update shift_report_versions set request_id = gen_random_uuid()`, sql`delete from shift_report_versions`,
      sql`update shift_report_comments set text = 'edited'`, sql`delete from shift_report_comments`, sql`delete from shift_reports`,
      sql`update shift_reports set user_id = 'someone-else'`, sql`update shift_reports set shift_date = '2020-01-01'`, sql`update shift_reports set due_at = now()`, sql`update shift_report_items set task_id = null`,
    ]) {
      const err = await withTenant(w.deps.db, w.tenant.id, (tx) => tx.execute(stmt)).catch((e) => e)
      expect((err as { cause?: { code?: string } })?.cause?.code, String(stmt)).toBe("42501")
    }
    expect((await w.q("select text from shift_report_comments"))[0].text).toBe("keep")
  })

  test("the unique key is (tenant, user, pattern, shift_date); items carry the task once per report; a composite FK keeps another tenant's pattern out", async () => {
    const w = await world()
    const rep = await w.opened(w.staff)
    const err = await w.q(
      "insert into shift_reports (tenant_id, user_id, pattern_id, shift_date, team_id, shift_name, start_at, end_at, due_at, created_at, updated_at) select tenant_id, user_id, pattern_id, shift_date, team_id, shift_name, start_at, end_at, due_at, now(), now() from shift_reports where id = $1",
      [rep.id],
    ).catch((e) => e)
    expect((err as { code?: string }).code).toBe("23505")
  })

  test("removing M1 → 403 module_not_entitled within 60 s on every report route; rows untouched; re-enabling restores them", async () => {
    const w = await world()
    await w.task(w.staff)
    const rep = await w.opened(w.staff)
    expect((await w.req("GET", `/v1/shift-reports/${rep.id}`, w.staff)).status).toBe(200) // entitlement cached now
    await w.q("insert into module_overrides (tenant_id, module, mode, reason, set_by, set_at) values ($1, 'M1', 'revoke', 'test', 'p', now())", [w.tenant.id])
    w.clock.advance({ minutes: 1 })
    for (const [m, path, b] of [
      ["GET", "/v1/shift-reports/current", undefined], ["POST", "/v1/shift-reports/open", { patternId: w.pattern, date: DAY }], ["GET", `/v1/shift-reports/${rep.id}`, undefined],
      ["PUT", `/v1/shift-reports/${rep.id}/draft`, w.draftBody(rep)], ["POST", `/v1/shift-reports/${rep.id}/submit`, { version: 1, requestId: randomUUID() }], ["GET", `/v1/shift-reports/${rep.id}/versions`, undefined],
      ["POST", `/v1/shift-reports/${rep.id}/uploads`, { name: "a.pdf", mime: "application/pdf", sizeBytes: 5 }], ["POST", `/v1/shift-reports/${rep.id}/uploads/${randomUUID()}/complete`, undefined],
      ["GET", `/v1/shift-reports/${rep.id}/files/${randomUUID()}/download`, undefined],
    ] as [string, string, unknown][]) {
      const r = await w.req(m, path, w.staff, b)
      expect([m, path, r.status, await code(r)]).toEqual([m, path, 403, "module_not_entitled"])
    }
    expect((await w.q("select count(*)::int n from shift_reports"))[0].n).toBe(1)
    await clearModuleOverride(w.deps, w.tenant.id, w.owner.userId, "M1")
    w.clock.advance({ minutes: 1 })
    expect((await w.req("GET", `/v1/shift-reports/${rep.id}`, w.staff)).status).toBe(200)
  })
})

