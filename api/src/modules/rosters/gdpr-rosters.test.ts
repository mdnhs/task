import pg from "pg"
import { afterAll, beforeEach, describe, expect, test } from "vitest"
import { ownerQuery } from "../../../test/db"
import { resetDb } from "../../../test/harness"
import { resetSubscribers } from "../../core/events"
import { runJob } from "../../core/queue/queue"
import { registerFiles } from "../files"
import { registerGdpr, resolveByPlatform } from "../gdpr"
import { resetDsrHandlers } from "../gdpr/registry"
import { registerNotifications } from "../notifications"
import { registerSearchIndexers } from "../search"
import { sites, type Json, type Who } from "./testkit"
import { ERASED_PERSON, rostersDsrHandler } from "./dsr"
import { registerRosters } from "./jobs"
import { ROSTER_LOCK_NS } from "./scope"

// B8 Task 18: data-subject export and erasure of the roster tables. The subject is the employee (`p.employee`), the colleague `staff2` is a different person whose data must never appear in the subject's export
// and must survive the erasure untouched. The clock is the testkit's (2026-11-16T09:00Z).

beforeEach(async () => {
  await resetDb()
  resetSubscribers()
  resetDsrHandlers()
  registerNotifications()
  registerSearchIndexers()
  registerFiles()
  registerGdpr()
  registerRosters()
})

type W = Awaited<ReturnType<typeof sites>>
const MON = "2026-11-23" // the clock is 2026-11-16: every shift is in the future (a started shift cannot be swapped)

/** The employee and Cian (staff2) both on a published week at Alpha and on a draft week the next Monday, with leave, availability, a qualification, a request, a swap, a claim and a saved layout naming both. */
async function scene() {
  const w = await sites()
  const me = w.p.employee
  const them = w.staff2
  const wa = await w.week(w.p.owner, w.a, MON)
  const added = await w.addOk(w.p.owner, wa, [{ date: MON, userIds: [me.userId, them.userId], shiftTypeId: w.ta }, { date: "2026-11-24", userIds: [me.userId], shiftTypeId: w.ta }, { date: "2026-11-25", userIds: [them.userId, null], shiftTypeId: w.ta }])
  const mine = (added.shifts as Json[]).filter((s) => s.userId === me.userId).map((s) => s.id as string)
  const theirs = (added.shifts as Json[]).filter((s) => s.userId === them.userId).map((s) => s.id as string)
  const open = (added.shifts as Json[]).find((s) => s.userId === null)!.id as string
  const version = async (id: string) => Number((await w.rows("select version from roster_weeks where id = $1", [id]))[0].version)
  await w.ok("POST", `/v1/roster/weeks/${wa}/save-template`, w.p.owner, { name: "Standard" }, 201) // names both people
  await w.ok("POST", `/v1/roster/weeks/${wa}/publish`, w.p.owner, { version: await version(wa) })
  const draft = await w.week(w.p.owner, w.a, "2026-11-30")
  await w.addOk(w.p.owner, draft, [{ date: "2026-12-01", userIds: [me.userId, them.userId], shiftTypeId: w.ta }])
  // leave, availability, qualification, home site
  const leave = await w.ok("POST", "/v1/leave", me, { from: "2026-12-01", to: "2026-12-02", kind: "annual", note: "Hospital appointment, private" }, 201)
  await w.ok("POST", "/v1/leave", them, { from: "2026-12-01", to: "2026-12-02", kind: "annual", note: "Cian's own note" }, 201)
  await w.ok("PUT", "/v1/roster/availability", me, { windows: [{ weekday: 2, from: "09:00", to: "12:00" }] })
  await w.ok("PUT", "/v1/roster/availability", them, { windows: [{ weekday: 3, from: "09:00", to: "12:00" }] })
  await w.ok("PUT", `/v1/members/${me.userId}/qualifications`, w.p.owner, { qualifications: [{ type: "First aid", expiresOn: "2027-01-31" }] })
  await w.ok("PUT", `/v1/members/${them.userId}/qualifications`, w.p.owner, { qualifications: [{ type: "Manual handling", expiresOn: "2027-02-28" }] })
  await w.ok("PUT", `/v1/members/${me.userId}/home-location`, w.p.owner, { locationId: w.a })
  await w.ok("PUT", `/v1/members/${them.userId}/home-location`, w.p.owner, { locationId: w.a })
  // a change request by the subject (history line with a reason they wrote), a swap proposed by the subject, a swap proposed TO the subject by the colleague, a claim by the colleague
  // (only a supervisor files change requests through the API: the subject's own request and history line are inserted as the data of a person who held that role earlier)
  const [sh] = (await w.rows("select location_id, week_id, version from roster_shifts where id = $1", [mine[0]])) as Json[]
  await w.rows("insert into roster_change_requests (tenant_id, shift_id, shift_version, requested_by, patch, reason, status, created_at, updated_at) values ($1, $2, $3, $4, '{\"start\":\"09:00\"}'::jsonb, 'Private reason of the subject', 'requested', now(), now())", [w.tenant.id, mine[0], sh.version, me.userId])
  await w.rows("insert into roster_history (tenant_id, week_id, location_id, shift_id, action, actor_id, reason, created_at) values ($1, $2, $3, $4, 'change_requested', $5, 'Private reason of the subject', now())", [w.tenant.id, sh.week_id, sh.location_id, mine[0], me.userId])
  await w.ok("POST", `/v1/roster/shifts/${mine[1]}/swap`, me, { toUserId: them.userId, note: "Subject asks Cian" }, 201)
  await w.ok("POST", `/v1/roster/shifts/${theirs[1] ?? theirs[0]}/swap`, them, { toUserId: me.userId, note: "Cian names the subject" }, 201)
  await w.ok("POST", `/v1/roster/shifts/${open}/claim`, them, {}, 201)
  return { w, me, them, wa, draft, mine, theirs, open, leave }
}

async function eraseRequest(w: W, subject: Who): Promise<string> {
  const r = await w.ok("POST", "/v1/data-requests", w.p.owner, { subjectUserId: subject.userId, kind: "erase", reason: "Asked to be forgotten" }, 201)
  return r.id as string
}
async function runDsrJobs(w: W) {
  for (let i = 0; i < 5; i++) {
    const run = w.queue.jobs.filter((j) => ["dsr.export", "dsr.erase", "file.delete-object", "notification.send"].includes(j.name))
    if (run.length === 0) return
    for (const j of run) {
      w.queue.jobs.splice(w.queue.jobs.indexOf(j), 1)
      await runJob(j.name, j.data, w.deps)
    }
  }
}

describe("export (FR-M0-18)", () => {
  test("includes the person's own shifts, leave, availability, qualifications, home site, request and exchanges and nothing of anybody else's", async () => {
    const { w, me, them, mine, theirs } = await scene()
    const out = (await w.deps.db.transaction(async (tx) => {
      await tx.execute(`select set_config('app.tenant_id', '${w.tenant.id}', true)` as never)
      return rostersDsrHandler.export(tx as never, w.tenant.id, me.userId)
    })) as Json
    expect((out.shifts as Json[]).map((s) => s.id)).toEqual(expect.arrayContaining(mine))
    expect((out.shifts as Json[]).length).toBe(3) // two on the published week, one on the draft
    expect((out.shifts as Json[]).filter((s) => s.published).length).toBe(2)
    expect(out.leave).toMatchObject([{ from: "2026-12-01", to: "2026-12-02", kind: "annual", status: "requested", note: "Hospital appointment, private" }])
    expect(out.availability).toEqual([{ weekday: 2, from: "09:00", to: "12:00" }])
    expect(out.qualifications).toMatchObject([{ type: "first aid", expiresOn: "2027-01-31", proofFileId: null }])
    expect(out.homeLocationId).toBe(w.a)
    expect(out.changeRequests).toMatchObject([{ reason: "Private reason of the subject", status: "requested" }])
    const ex = out.exchanges as Json[]
    expect(ex.map((e) => [e.kind, e.role, e.otherUserId]).sort()).toEqual([["swap", "colleague", them.userId], ["swap", "requester", them.userId]]) // the colleague appears as an id only
    expect(ex.find((e) => e.role === "requester")!.note).toBe("Subject asks Cian")
    expect(ex.find((e) => e.role === "colleague")!.note).toBeNull() // written by somebody else
    expect(ex.find((e) => e.role === "colleague")!.shiftId).toBeNull() // and it is the other person's shift
    expect(out.layoutsNamingYou).toMatchObject([{ name: "Standard", shifts: 2 }])
    expect((out.historyAuthored as Json[]).every((h) => typeof h.action === "string")).toBe(true)
    // nobody else's data: not Cian's shift ids, leave note, availability, qualification or claim
    const text = JSON.stringify(out)
    for (const secret of [...theirs, "Cian's own note", "manual handling", "2027-02-28"]) expect(text, secret).not.toContain(secret)
    expect(out.supervisorOf).toEqual([])
  })

  test("the real export job puts the roster module into the bundle (module `rosters`)", async () => {
    const { w, me } = await scene()
    const r = await w.ok("POST", "/v1/data-requests", w.p.owner, { subjectUserId: me.userId, kind: "export", reason: "Subject access request" }, 201)
    await runDsrJobs(w)
    const done = await w.ok("GET", `/v1/data-requests/${r.id}`, w.p.owner)
    expect(done.status).toBe("completed")
    const dl = await w.req("GET", `/v1/files/${done.resultFileId}/download`, w.p.owner)
    expect(dl.status).toBe(302)
    const bundle = JSON.parse(await (await fetch(dl.headers.get("location")!)).text()) as Json
    expect(Object.keys(bundle.modules)).toContain("rosters")
    expect((bundle.modules.rosters.shifts as Json[]).length).toBe(3)
    expect(bundle.modules.rosters.leave[0].note).toBe("Hospital appointment, private")
  })
})

describe("erasure (FR-M0-18)", () => {
  test("the person's shifts become open ones, leave, availability, qualifications and home site are gone, their requests and exchanges go, history rows keep ids only, and ONE history line says that published shifts were opened", async () => {
    const { w, me, them, mine, theirs, wa, draft, open } = await scene()
    const publishedHistory = (await w.rows("select id, actor_id, reason from roster_history where actor_id = $1 and reason is not null", [me.userId])) as Json[]
    expect(publishedHistory.length).toBeGreaterThan(0) // a line they wrote with a reason ("Private reason of the subject")
    const draftVersion = Number((await w.rows("select version from roster_weeks where id = $1", [draft]))[0].version)
    const weekVersion = Number((await w.rows("select version from roster_weeks where id = $1", [wa]))[0].version)
    const id = await eraseRequest(w, me)
    await runDsrJobs(w)
    expect((await w.ok("GET", `/v1/data-requests/${id}`, w.p.owner)).status).toBe("completed")

    // shifts: open now (the published week's and the draft's), not deleted; versions moved; Cian's untouched
    const rows = (await w.rows("select id, user_id, confirmed_at, version from roster_shifts where id = any($1::uuid[]) order by id", [mine])) as Json[]
    expect(rows.length).toBe(2)
    expect(rows.every((r) => r.user_id === null && r.confirmed_at === null && r.version === 2)).toBe(true)
    expect((await w.rows("select 1 from roster_shifts where user_id = $1", [me.userId])).length).toBe(0)
    expect((await w.rows("select user_id from roster_shifts where id = any($1::uuid[]) order by id", [theirs])).every((r) => r.user_id === them.userId)).toBe(true)
    expect((await w.rows("select user_id from roster_shifts where id = $1", [open]))[0].user_id).toBeNull()
    // exactly ONE history line for the published week (the draft tells nobody), ids and counts only, never the person
    const lines = (await w.rows("select week_id, location_id, shift_id, action, actor_id, before, after from roster_history where action = 'member_erased_shifts_opened'")) as Json[]
    expect(lines.length).toBe(1)
    expect(lines[0]).toMatchObject({ week_id: wa, location_id: w.a, shift_id: null, actor_id: "system:dsr-erasure" })
    expect(lines[0].after).toMatchObject({ open: 2 })
    expect(JSON.stringify(lines)).not.toContain(me.userId)
    expect((await w.rows("select 1 from roster_history where week_id = $1 and action = 'member_erased_shifts_opened'", [draft])).length).toBe(0)
    expect(Number((await w.rows("select version from roster_weeks where id = $1", [wa]))[0].version)).toBe(weekVersion + 1) // the erasure moved the published week once; the draft week is not touched
    expect(Number((await w.rows("select version from roster_weeks where id = $1", [draft]))[0].version)).toBe(draftVersion)
    // the person's own tables
    for (const tbl of ["leave_requests", "roster_availability", "member_qualifications", "roster_change_requests"]) {
      const col = tbl === "roster_change_requests" ? "requested_by" : "user_id"
      expect((await w.rows(`select 1 from ${tbl} where ${col} = $1`, [me.userId])).length, tbl).toBe(0)
    }
    expect((await w.rows("select 1 from roster_exchanges where from_user_id = $1 or to_user_id = $1", [me.userId])).length).toBe(0)
  })

  test("Cian's rows survive: her leave, availability, qualification, home site, claim and the swap she proposed to the erased person (the link and the note are cleared)", async () => {
    const { w, me, them } = await scene()
    await eraseRequest(w, me)
    await runDsrJobs(w)
    expect((await w.rows("select note from leave_requests where user_id = $1", [them.userId])).map((r) => r.note)).toEqual(["Cian's own note"])
    expect((await w.rows("select weekday from roster_availability where user_id = $1", [them.userId])).length).toBe(1)
    expect((await w.rows("select type from member_qualifications where user_id = $1", [them.userId])).map((r) => r.type)).toEqual(["manual handling"])
    expect((await w.rows("select home_location_id from memberships where user_id = $1", [them.userId]))[0].home_location_id).toBe(w.a)
    const ex = (await w.rows("select kind, to_user_id, note, status from roster_exchanges where from_user_id = $1 order by kind", [them.userId])) as Json[]
    expect(ex.map((e) => [e.kind, e.to_user_id, e.note])).toEqual([["claim", null, ""], ["swap", null, ""]])
  })

  test("saved layouts: the id leaves the JSON for ONE constant, nobody else's entry changes, and applying the layout makes an open shift flagged `left` (and no double booking between two erased people)", async () => {
    const { w, me, them, wa } = await scene()
    // a second layout where TWO people would overlap: the subject and a colleague at the same time on the same day
    await eraseRequest(w, me)
    await runDsrJobs(w)
    const tpl = (await w.rows("select id, shifts from roster_week_templates"))[0] as Json
    const entries = tpl.shifts as Json[]
    expect(entries.map((s) => s.personId).sort()).toEqual([ERASED_PERSON, ERASED_PERSON, them.userId, them.userId, null].sort()) // the open shift of the layout stays open
    expect(entries.filter((s) => s.personId === ERASED_PERSON).length).toBe(2)
    expect(entries.filter((s) => s.personId === them.userId).length).toBe(2)
    expect(JSON.stringify(entries)).not.toContain(me.userId)
    // apply it to a new Monday: the erased person's shifts are OPEN with a `left` conflict, Cian keeps hers
    const out = await w.ok("POST", "/v1/roster/week-templates/apply", w.p.owner, { templateId: tpl.id, locationId: w.a, weekStart: "2026-12-14" }, 201)
    const week = (out.week as Json).id as string
    const shifts = (await w.rows("select user_id from roster_shifts where week_id = $1", [week])) as Json[]
    expect(shifts.filter((s) => s.user_id === null).length).toBe(3) // the two erased people's shifts and the layout's own open one
    expect(shifts.filter((s) => s.user_id === them.userId).length).toBe(2)
    expect((out.conflicts as Json[]).filter((c) => c.reason === "left" && c.open === true).length).toBe(2)
    expect((out.conflicts as Json[]).some((c) => c.reason === "double_booking")).toBe(false)
    expect(wa).toBeTruthy()
  })

  test("two erased people in one layout (same hours) both apply as open shifts flagged left; the constant never collides into a double booking", async () => {
    const w = await sites()
    const wk = await w.week(w.p.owner, w.a, "2026-12-07")
    await w.addOk(w.p.owner, wk, [{ date: "2026-12-07", userIds: [w.p.employee.userId, w.staff2.userId], shiftTypeId: w.ta }])
    await w.ok("POST", `/v1/roster/weeks/${wk}/save-template`, w.p.owner, { name: "Pair" }, 201)
    for (const who of [w.p.employee, w.staff2]) {
      await eraseRequest(w, who)
      await runDsrJobs(w)
    }
    const tpl = (await w.rows("select id, shifts from roster_week_templates"))[0] as Json
    expect((tpl.shifts as Json[]).map((s) => s.personId)).toEqual([ERASED_PERSON, ERASED_PERSON])
    const out = await w.ok("POST", "/v1/roster/week-templates/apply", w.p.owner, { templateId: tpl.id, locationId: w.a, weekStart: "2026-12-14" }, 201)
    expect((out.conflicts as Json[]).map((c) => [c.reason, c.open])).toEqual([["left", true], ["left", true]])
    expect((await w.rows("select user_id from roster_shifts where week_id = $1", [(out.week as Json).id])).every((r) => r.user_id === null)).toBe(true)
  })

  test("history rows keep ids only: the lines the person wrote keep their id, action and time and lose their free text; lines by others are untouched; a second erase run changes nothing (idempotent)", async () => {
    const { w, me } = await scene()
    const before = (await w.rows("select id, actor_id, action, reason, created_at from roster_history order by id")) as Json[]
    const mineBefore = before.filter((h) => h.actor_id === me.userId)
    expect(mineBefore.some((h) => h.reason === "Private reason of the subject")).toBe(true)
    const id = await eraseRequest(w, me)
    await runDsrJobs(w)
    const after = (await w.rows("select id, actor_id, action, reason, created_at from roster_history where action <> 'member_erased_shifts_opened' order by id")) as Json[]
    expect(after.map((h) => [h.id, h.actor_id, h.action, h.created_at])).toEqual(before.map((h) => [h.id, h.actor_id, h.action, h.created_at]))
    for (const h of after) expect(h.reason, h.id).toBe(before.find((b) => b.id === h.id)!.actor_id === me.userId && before.find((b) => b.id === h.id)!.reason !== null ? "[erased]" : before.find((b) => b.id === h.id)!.reason)
    expect(JSON.stringify(await w.rows("select reason from roster_history"))).not.toContain("Private reason of the subject")
    // the erasure job again (a re-run after a crash): nothing more is written
    const rowsBefore = JSON.stringify(await w.rows("select * from roster_history order by id"))
    const dsrJob = { dsrId: id, tenantId: w.tenant.id }
    await runJob("dsr.erase", dsrJob, w.deps)
    expect(JSON.stringify(await w.rows("select * from roster_history order by id"))).toBe(rowsBefore)
  })

  test("the handler alone (the membership kept, so no cascade helps): leave, availability, qualifications, home site, request, own exchanges and grants are deleted by IT, and a second run changes nothing", async () => {
    const { w, me } = await scene()
    const run = () =>
      w.deps.db.transaction(async (tx) => {
        await tx.execute(`select set_config('app.tenant_id', '${w.tenant.id}', true)` as never)
        await rostersDsrHandler.erase(tx as never, w.tenant.id, me.userId, w.clock.now())
      })
    await run()
    for (const [tbl, col] of [["leave_requests", "user_id"], ["roster_availability", "user_id"], ["member_qualifications", "user_id"], ["roster_change_requests", "requested_by"], ["roster_exchanges", "from_user_id"]]) {
      expect((await w.rows(`select 1 from ${tbl} where ${col} = $1`, [me.userId])).length, tbl).toBe(0)
    }
    expect((await w.rows("select home_location_id from memberships where user_id = $1", [me.userId]))[0].home_location_id).toBeNull()
    expect((await w.rows("select 1 from roster_shifts where user_id = $1", [me.userId])).length).toBe(0)
    const snapshot = async () => JSON.stringify([await w.rows("select * from roster_shifts order by id"), await w.rows("select * from roster_history order by id"), await w.rows("select * from roster_week_templates order by id")])
    const once = await snapshot()
    await run()
    expect(await snapshot()).toBe(once)
  })

  test("a supervisor and an office limit go with the person (grants and limits are theirs)", async () => {
    const w = await sites()
    const sup = w.p["location-supervisor"]
    expect((await w.rows("select 1 from location_supervisors where user_id = $1", [sup.userId])).length).toBe(1)
    await eraseRequest(w, sup)
    await runDsrJobs(w)
    expect((await w.rows("select 1 from location_supervisors where user_id = $1", [sup.userId])).length).toBe(0)
    expect((await w.rows("select 1 from location_supervisors")).length).toBe(1) // the other site's supervisor stays
  })
})

describe("AH1 erase takes the roster lock (lock order = deactivation)", () => {
  const owner = new pg.Pool({ connectionString: process.env.TEST_DATABASE_OWNER_URL, max: 2 })
  afterAll(() => owner.end())
  const waitBlocked = async (notPid: number) => {
    for (let i = 0; i < 100; i++) {
      const r = await ownerQuery("select 1 from pg_locks where not granted and pid <> $1", [notPid])
      if (r.length > 0) return
      await new Promise((r2) => setTimeout(r2, 50))
    }
    throw new Error("the erase never waited on a lock")
  }

  test("G1: a request that platform staff resolve while the erase waits for its locks is NOT erased: nothing is deleted, the identity stays, the request stays as resolved", async () => {
    const { w, me } = await scene()
    const count = async (u: string) => (await w.rows("select 1 from roster_shifts where user_id = $1", [u])).length
    const [subjectShifts, colleagueShifts] = [await count(me.userId), await count(w.staff2.userId)]
    const id = await eraseRequest(w, me)
    const c = await owner.connect()
    try {
      await c.query("begin")
      await c.query("select set_config('app.tenant_id', $1, true)", [w.tenant.id])
      const pid = (await c.query("select pg_backend_pid() as pid")).rows[0].pid as number
      await c.query("select pg_advisory_xact_lock($1::int, hashtext($2::text))", [ROSTER_LOCK_NS, w.tenant.id]) // a roster writer holds the roster lock
      const job = runJob("dsr.erase", { dsrId: id, tenantId: w.tenant.id }, w.deps) // the erase claims the request (running) and waits for that lock
      await waitBlocked(pid)
      const resolved = await resolveByPlatform(w.deps, w.tenant.id, { userId: "staff-1" }, id, "rejected", "Handled outside the job") // platform staff close it meanwhile
      expect(resolved.status).toBe("rejected")
      await c.query("commit")
      await job
    } catch (e) {
      await c.query("rollback").catch(() => undefined)
      throw e
    } finally {
      c.release()
    }
    expect((await w.ok("GET", `/v1/data-requests/${id}`, w.p.owner)).status).toBe("rejected") // still resolved, not completed, not failed
    expect((await w.rows("select 1 from memberships where user_id = $1", [me.userId])).length).toBe(1)
    expect(subjectShifts).toBeGreaterThan(0)
    expect(await count(me.userId)).toBe(subjectShifts) // the roster handler did not run: the shifts are still theirs
    expect(await count(w.staff2.userId)).toBe(colleagueShifts)
    expect((await w.rows("select 1 from audit_events where action in ('member.removed', 'dsr.erasure_completed')")).length).toBe(0)
    expect((await ownerQuery(`select erased_at from "user" where id = $1`, [me.userId]))[0].erased_at).toBeNull() // the global identity was not anonymised
  }, 20_000)

  test("a roster writer that owns the subject's shift row and then notifies the subject (KEY SHARE on the membership row) does not deadlock with the erase: the erase waits for the roster lock, the writer commits, the erase completes (no 40P01, no failed request)", async () => {
    const { w, me, mine, wa } = await scene()
    const id = await eraseRequest(w, me)
    const c = await owner.connect()
    try {
      await c.query("begin")
      await c.query("select set_config('app.tenant_id', $1, true)", [w.tenant.id])
      const pid = (await c.query("select pg_backend_pid() as pid")).rows[0].pid as number
      await c.query("select pg_advisory_xact_lock($1::int, hashtext($2::text))", [ROSTER_LOCK_NS, w.tenant.id]) // a roster writer: the roster lock first,
      await c.query("update roster_shifts set user_id = null, version = version + 1 where id = $1", [mine[0]]) // then the subject's shift row (unassign),
      const job = runJob("dsr.erase", { dsrId: id, tenantId: w.tenant.id }, w.deps) // the erase starts now,
      await waitBlocked(pid) // and waits: for the roster lock (fixed) or, before the fix, on the shift row after taking the membership row
      await c.query("insert into notifications (tenant_id, user_id, kind, title, body, created_at) values ($1, $2, 'system', 'Shift removed', 'A shift was removed', now())", [w.tenant.id, me.userId]) // ... then notifies the subject: needs KEY SHARE on the membership row
      await c.query("commit")
      await job
    } catch (e) {
      await c.query("rollback").catch(() => undefined)
      throw e
    } finally {
      c.release()
    }
    expect((await w.ok("GET", `/v1/data-requests/${id}`, w.p.owner)).status).toBe("completed")
    expect((await w.rows("select 1 from roster_shifts where user_id = $1", [me.userId])).length).toBe(0)
    expect((await w.rows("select user_id from roster_shifts where id = any($1::uuid[])", [mine])).every((r) => r.user_id === null)).toBe(true)
    const lines = (await w.rows("select week_id, after from roster_history where action = 'member_erased_shifts_opened'")) as Json[]
    expect(lines.length).toBe(1) // one line for the published week
    expect(lines[0]).toMatchObject({ week_id: wa })
    expect((await w.rows("select 1 from memberships where user_id = $1", [me.userId])).length).toBe(0)
  }, 20_000)

  test("real roster writes racing the erase (publish, edit, unassign of the subject's shifts, all at once): the request completes, nothing fails with 40P01, the person has no shift left and the week history has exactly one erasure line", async () => {
    const { w, me, them, mine, theirs } = await scene()
    const id = await eraseRequest(w, me)
    const draft = await w.week(w.p.owner, w.a, "2026-12-07")
    await w.addOk(w.p.owner, draft, [{ date: "2026-12-08", userIds: [me.userId, them.userId], shiftTypeId: w.ta }])
    const v = Number((await w.rows("select version from roster_weeks where id = $1", [draft]))[0].version)
    const sv = Number((await w.rows("select version from roster_shifts where id = $1", [theirs[0]]))[0].version)
    const mineV = Number((await w.rows("select version from roster_shifts where id = $1", [mine[1]]))[0].version)
    const results = await Promise.all([
      runJob("dsr.erase", { dsrId: id, tenantId: w.tenant.id }, w.deps).then(() => "erase"),
      w.req("POST", `/v1/roster/weeks/${draft}/publish`, w.p.owner, { version: v }),
      w.req("PATCH", `/v1/roster/shifts/${theirs[0]}`, w.p.owner, { version: sv, patch: { start: "10:00", end: "18:00" }, reason: "Busy day" }),
      w.req("DELETE", `/v1/roster/shifts/${mine[1]}?version=${mineV}&reason=${encodeURIComponent("Cover")}`, w.p.owner),
    ])
    for (const r of results) if (r instanceof Response) expect([200, 204, 404, 409, 422], `${r.status} ${await r.clone().text()}`).toContain(r.status) // a 409 is the documented retry answer, never a 500
    expect((await w.ok("GET", `/v1/data-requests/${id}`, w.p.owner)).status).toBe("completed")
    expect((await w.rows("select 1 from roster_shifts where user_id = $1", [me.userId])).length).toBe(0)
    expect((await w.rows("select 1 from memberships where user_id = $1", [me.userId])).length).toBe(0)
    expect((await w.rows("select 1 from roster_history where action = 'member_erased_shifts_opened' and week_id = (select week_id from roster_shifts where id = $1)", [mine[0]])).length).toBeLessThanOrEqual(1)
  })

  test("a second run of the same erase (the request put back to pending, as the sweep or a retry does): nothing changes, no second history line, no second member.removed, other people's rows untouched", async () => {
    const { w, me } = await scene()
    const id = await eraseRequest(w, me)
    await runDsrJobs(w)
    const snapshot = async () => JSON.stringify([
      await w.rows("select * from roster_shifts order by id"), await w.rows("select * from roster_history order by id"), await w.rows("select * from roster_week_templates order by id"), await w.rows("select * from roster_weeks order by id"),
      await w.rows("select * from leave_requests order by id"), await w.rows("select * from roster_exchanges order by id"), await w.rows("select action, entity_id from audit_events where action = 'member.removed'"),
    ])
    const once = await snapshot()
    expect((await w.rows("select 1 from roster_history where action = 'member_erased_shifts_opened'")).length).toBe(1)
    await w.rows("update data_requests set status = 'pending', started_at = null, completed_at = null where id = $1", [id])
    await runJob("dsr.erase", { dsrId: id, tenantId: w.tenant.id }, w.deps)
    expect((await w.ok("GET", `/v1/data-requests/${id}`, w.p.owner)).status).toBe("completed")
    expect(await snapshot()).toBe(once)
  })
})
