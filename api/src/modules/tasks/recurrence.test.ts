import { sql } from "drizzle-orm"
import pg from "pg"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { ownerQuery, ownerTenantQuery } from "../../../test/db"
import { makeMember, makeTenant, signIn } from "../../../test/factories"
import { call, resetDb, testApp } from "../../../test/harness"
import { resetSubscribers } from "../../core/events"
import { runJob } from "../../core/queue/queue"
import { withTenant } from "../../db/tenant-tx"
import { clearModuleOverride } from "../entitlements"
import { registerNotifications } from "../notifications"
import { registerSearchIndexers } from "../search"
import { registerTasks, tasksDsrHandler } from "."

// T4.4: recurrence (job tasks.recurrence) and task templates. Rulings D11, D21, D23, E2, E3.

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Who = { userId: string; email: string; password: string; cookie: string }

beforeEach(async () => {
  await resetDb()
  resetSubscribers()
  registerNotifications()
  registerSearchIndexers()
  registerTasks()
})
afterEach(resetSubscribers)

async function world(over: { timezone?: string } = {}) {
  const t = testApp()
  const tenant = await makeTenant(t.deps, { slug: "acme" })
  await ownerQuery("update tenants set timezone = $1 where id = $2", [over.timezone ?? "Europe/Dublin", tenant.id])
  const who = async (role: string): Promise<Who> => {
    const m = await makeMember(t.deps, tenant.id, role)
    return { userId: m.userId, email: m.email, password: m.password, cookie: (await signIn(t.app, m.email, m.password)).cookie }
  }
  const owner = await who("owner")
  const manager = await who("manager") // manager-home, reportScope "team"
  const ops = await who("ops") // manager-home, all
  const staff = await who("employee")
  const staff2 = await who("employee")
  const req = (method: string, path: string, as: { cookie: string } | null, body?: unknown, slug = "acme") => call(t.app, method, path, { cookie: as?.cookie, tenant: slug, body })
  const json = async (r: Response) => (await r.json()) as Json
  const manages = async (mgr: Who, person: Who) => expect((await req("PUT", `/v1/members/${person.userId}/manager`, owner, { managerId: mgr.userId })).status).toBe(200)
  const base = (o: Json = {}) => ({ title: "Check fire exits", description: "Walk every floor.", priority: 2, start: "2026-11-20T09:00:00", due: "2026-11-20T17:00:00", primary: staff.userId, ...o })
  const mk = async (as: Who, o: Json = {}) => {
    const r = await req("POST", "/v1/tasks", as, base(o))
    expect(r.status, await r.clone().text()).toBe(201)
    return json(r)
  }
  const q = <R = Json>(sqlText: string, params: unknown[] = []) => ownerTenantQuery(tenant.id, sqlText, params) as Promise<R[]>
  return { ...t, tenant, who, owner, manager, ops, staff, staff2, req, json, manages, base, mk, q }
}
type W = Awaited<ReturnType<typeof world>>
const code = async (r: Response) => ((await r.clone().json()) as Json).code as string

/** One job run as if the wall clock read `at`: the job reads time only through deps.clock (ruling E3). */
const rec = (w: W, at: string | number | Date) => runJob("tasks.recurrence", {}, { ...w.deps, clock: { now: () => new Date(at) } })
/** A recurring series (its own task is the first occurrence): by default due 01:30 local on 24 Oct 2026, assigned to staff. */
async function series(w: W, rule: Json, over: Json = {}, as: Who = w.ops): Promise<Json & { id: string }> {
  const t = await w.mk(as, { title: "Daily check", start: "2026-10-24T01:00:00", due: "2026-10-24T01:30:00", ...over })
  const r = await w.req("PUT", `/v1/tasks/${t.id}/repeat`, as, { version: t.version, rule })
  expect(r.status, await r.clone().text()).toBe(200)
  return { ...(await w.json(r)), id: t.id as string }
}
const instances = (w: W, id: string) => w.q<{ d: string; due: string; start: string; ref_no: number }>("select occurrence_date::text d, due_at::text due, start_at::text start, ref_no from tasks where series_id = $1 order by occurrence_date", [id])
const iso = (v: string) => new Date(v).toISOString()
const tick = async (w: W, from: string, to: string, parallel = 1) => {
  for (let t = Date.parse(from); t <= Date.parse(to); t += 15 * 60_000) await Promise.all(Array.from({ length: parallel }, () => rec(w, t)))
}

describe("recurrence job", () => {
  test("recurrence creates exactly one instance per local date across the October DST change, even with two concurrent runs", async () => {
    const w = await world()
    const s = await series(w, { freq: "daily" })
    await tick(w, "2026-10-24T22:00:00Z", "2026-10-26T03:00:00Z", 2) // 01:30 happens twice on the 25th (BST 00:30Z, then GMT 01:30Z)
    const rows = await instances(w, s.id)
    expect(rows.map((r) => r.d)).toEqual(["2026-10-25", "2026-10-26"])
    expect(iso(rows[0].due)).toBe("2026-10-25T00:30:00.000Z") // the EARLIER 01:30
    expect(iso(rows[1].due)).toBe("2026-10-26T01:30:00.000Z")
    expect(new Set(rows.map((r) => r.ref_no)).size).toBe(2)
    expect((await w.q("select repeat_cursor::text c from tasks where id = $1", [s.id]))[0].c).toBe("2026-10-26")
  }, 180_000)

  test("eight truly concurrent runs at one tick: exactly one instance, one ref, one history line, no gaps", async () => {
    const w = await world()
    const s = await series(w, { freq: "daily" })
    await Promise.all(Array.from({ length: 8 }, () => rec(w, "2026-10-25T10:00:00Z")))
    expect((await instances(w, s.id)).map((r) => r.d)).toEqual(["2026-10-25"])
    expect((await w.q("select count(*)::int n from task_history h join tasks t on t.id = h.task_id where t.series_id = $1", [s.id]))[0].n).toBe(1)
    expect((await w.q("select ref_no from tasks order by ref_no")).map((r) => r.ref_no)).toEqual([1000, 1001]) // the series and its one instance
    expect((await w.q("select next_no from task_counters"))[0].next_no).toBe(1002) // …and the losers took no number: no gap in the sequence
    // the unique key itself refuses a second instance for the same local date, whatever the code path
    const err = await w
      .q(`insert into tasks (tenant_id, ref_no, title, start_at, due_at, evidence_rule, series_id, occurrence_date, created_at, updated_at) values ($1, 9999, 'dup', now(), now(), '{}'::jsonb, $2, '2026-10-25', now(), now())`, [w.tenant.id, s.id])
      .catch((e) => e)
    expect(String((err as Error).message)).toContain("tasks_series_occ_uq")
  }, 60_000)

  test("spring-forward: due 01:30 on 2027-03-28 becomes 02:30 local (01:30Z), one instance", async () => {
    const w = await world()
    const s = await series(w, { freq: "daily" }, { start: "2027-03-27T01:00:00", due: "2027-03-27T01:30:00" })
    await tick(w, "2027-03-27T22:00:00Z", "2027-03-28T04:00:00Z", 2)
    const rows = await instances(w, s.id)
    expect(rows.map((r) => r.d)).toEqual(["2027-03-28"])
    expect(iso(rows[0].due)).toBe("2027-03-28T01:30:00.000Z")
    const dto = await w.json(await w.req("GET", `/v1/tasks?ref=TSK-${rows[0].ref_no}`, w.ops))
    expect(dto.items[0].due).toBe("2027-03-28T02:30:00")
    await rec(w, "2027-03-29T05:00:00Z") // the series' time of day is 01:30 local, so the day after is 01:30 BST = 00:30Z
    expect(iso((await instances(w, s.id))[1].due)).toBe("2027-03-29T00:30:00.000Z")
  }, 60_000)

  test("weekly Mon/Wed series with until stops after until; monthly day 31 lands on 30 Nov and 28 Feb", async () => {
    const w = await world()
    // 2026-11-16 is a Monday; the first occurrence is the series itself
    const wk = await series(w, { freq: "weekly", days: [1, 3], until: "2026-11-25" }, { start: "2026-11-16T08:00:00", due: "2026-11-16T09:00:00" })
    const mo = await series(w, { freq: "monthly", dayOfMonth: 31 }, { title: "Month end", start: "2026-10-31T08:00:00", due: "2026-10-31T09:00:00" })
    for (let d = Date.parse("2026-11-16T10:00:00Z"); d <= Date.parse("2027-03-01T10:00:00Z"); d += 86_400_000) await rec(w, d)
    expect((await instances(w, wk.id)).map((r) => r.d)).toEqual(["2026-11-18", "2026-11-23", "2026-11-25"]) // Wed, Mon, Wed; nothing after until
    expect((await instances(w, mo.id)).map((r) => r.d)).toEqual(["2026-11-30", "2026-12-31", "2027-01-31", "2027-02-28"]) // day 31 in a short month = its last day (domain nextOccurrences)
  }, 120_000)

  test("catch-up is capped at 7 days and logs the skipped count once", async () => {
    const w = await world()
    const s = await series(w, { freq: "daily" }, { start: "2026-11-01T08:00:00", due: "2026-11-01T09:00:00" })
    await rec(w, "2026-11-20T10:00:00Z") // 19 days after the first due date: 7 days are created, the 12 older ones are skipped
    expect((await instances(w, s.id)).map((r) => r.d)).toEqual(["2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"])
    const skipped = async () => (await w.q("select text from task_history where task_id = $1 and text like '%skipped%'", [s.id])).map((r) => r.text)
    expect(await skipped()).toEqual(["12 occurrences skipped (outside catch-up window)"])
    await rec(w, "2026-11-20T11:00:00Z")
    await rec(w, "2026-11-21T10:00:00Z")
    expect(await skipped()).toHaveLength(1) // not repeated
    expect((await instances(w, s.id)).map((r) => r.d)).toContain("2026-11-21")
  }, 60_000)

  test("instances inherit the series fields, evidence rule, assignees, checklist and voice file; each has its own ref, a system history line and a notification", async () => {
    const w = await world()
    const dept = await w.json(await w.req("POST", "/v1/teams", w.owner, { name: "Cleaning", kind: "department" }))
    const p = await w.json(await w.req("POST", "/v1/projects", w.ops, { name: "Plan" }))
    const rule = { mode: "required", types: ["photo"], min: 1, instruction: "Before and after", review: "manager" }
    const t = await w.mk(w.ops, { title: "Mop floors", description: "Level 2", priority: 3, labels: ["Safety"], start: "2026-11-16T08:00:00", due: "2026-11-16T17:00:00", primary: w.staff.userId, others: [w.staff2.userId], evidenceRule: rule, teamId: dept.id })
    expect((await w.req("PATCH", `/v1/tasks/${t.id}`, w.ops, { version: 1, projectId: p.id })).status).toBe(200)
    expect((await w.req("POST", `/v1/tasks/${t.id}/checklist`, w.ops, { text: "Bucket" })).status).toBe(201)
    const voice = "6f1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8"
    await w.q("update tasks set voice_file_id = $2, voice_meta = $3::jsonb where id = $1", [t.id, voice, JSON.stringify({ durationSec: 5, mime: "audio/webm" })])
    expect((await w.req("PUT", `/v1/tasks/${t.id}/repeat`, w.ops, { version: 2, rule: { freq: "daily" } })).status).toBe(200)
    await rec(w, "2026-11-17T10:00:00Z")
    const [i] = await w.q("select * from tasks where series_id = $1", [t.id])
    expect(i).toMatchObject({ title: "Mop floors", description: "Level 2", priority: 3, labels: ["safety"], team_id: dept.id, project_id: p.id, status: "not_started", round: 1, creator_id: w.ops.userId, voice_file_id: voice, repeat: null, version: 1 })
    expect(i.evidence_rule).toEqual({ ...rule })
    expect(i.voice_meta).toEqual({ durationSec: 5, mime: "audio/webm" }) // shared with the series (ruling D21)
    expect(new Date(i.start_at as string).toISOString()).toBe("2026-11-17T08:00:00.000Z")
    expect(new Date(i.due_at as string).toISOString()).toBe("2026-11-17T17:00:00.000Z")
    expect(i.ref_no).not.toBe(1000)
    const dto = await w.json(await w.req("GET", `/v1/tasks/${i.id}`, w.ops))
    expect(dto.assignee).toBe(w.staff.userId)
    expect(dto.assignees).toEqual([w.staff2.userId])
    expect(dto.checklist.map((c: Json) => [c.text, c.done])).toEqual([["Bucket", false]])
    expect(dto.timeline).toHaveLength(1)
    expect(dto.timeline[0]).toMatchObject({ kind: "created", text: "Created from recurring task TSK-1000", actorId: "system:recurrence", by: "System" })
    expect([...dto.timeline[0].notified].sort()).toEqual([w.staff.userId, w.staff2.userId].sort())
    const notes = await w.q("select user_id from notifications where kind = 'task' and title = 'New task' and body like $1", [`TSK-${i.ref_no} %`])
    expect(notes.map((n) => n.user_id).sort()).toEqual([w.staff.userId, w.staff2.userId].sort())
    // row, history line and event are stamped by deps.clock (never DB now()): ms precision for the list cursor
    expect(new Date(i.created_at as string).toISOString()).toBe("2026-11-17T10:00:00.000Z")
    expect(new Date((await w.q("select at from task_history where task_id = $1", [i.id]))[0].at as string).toISOString()).toBe("2026-11-17T10:00:00.000Z")
    const ev = await w.q("select payload, actor_id, occurred_at from domain_events where type = 'task.created' and payload->>'taskId' = $1", [i.id])
    expect(ev[0]).toMatchObject({ payload: { taskId: i.id, parentId: null, projectId: p.id, seriesId: t.id }, actor_id: "system:recurrence" })
    expect(new Date(ev[0].occurred_at as string).toISOString()).toBe("2026-11-17T10:00:00.000Z")
  })

  test("an inactive assignee is dropped (a co-assignee is promoted); with nobody left the date is skipped and logged", async () => {
    const w = await world()
    const s = await series(w, { freq: "daily" }, { start: "2026-11-16T08:00:00", due: "2026-11-16T09:00:00", primary: w.staff.userId, others: [w.staff2.userId] })
    await w.q("update memberships set status = 'suspended' where user_id = $1", [w.staff.userId])
    await rec(w, "2026-11-17T10:00:00Z")
    expect((await instances(w, s.id)).map((r) => r.d)).toEqual(["2026-11-17"])
    const a = await w.q("select user_id, is_primary from task_assignees where task_id = (select id from tasks where series_id = $1) order by user_id", [s.id])
    expect(a).toEqual([{ user_id: w.staff2.userId, is_primary: true }])
    await w.q("update memberships set status = 'suspended' where user_id = $1", [w.staff2.userId])
    await rec(w, "2026-11-18T10:00:00Z")
    expect((await instances(w, s.id)).map((r) => r.d)).toEqual(["2026-11-17"]) // 18 Nov skipped: nobody to give it to
    expect((await w.q("select text from task_history where task_id = $1 and text like '%no active assignee%'", [s.id])).map((r) => r.text)).toEqual(["1 occurrence skipped (no active assignee)"])
  })

  test("E2: a team manager's series keeps only themselves and current direct reports; a moved report is dropped", async () => {
    const w = await world()
    await w.manages(w.manager, w.staff)
    const s = await series(w, { freq: "daily" }, { start: "2026-11-16T08:00:00", due: "2026-11-16T09:00:00", primary: w.staff.userId, others: [w.manager.userId] }, w.manager)
    await rec(w, "2026-11-17T10:00:00Z")
    expect((await w.q("select user_id from task_assignees where task_id = (select id from tasks where series_id = $1)", [s.id])).map((r) => r.user_id).sort()).toEqual([w.manager.userId, w.staff.userId].sort())
    await w.q("delete from reporting_lines where user_id = $1", [w.staff.userId]) // the report leaves the manager's team
    await rec(w, "2026-11-18T10:00:00Z")
    const second = await w.q("select user_id, is_primary from task_assignees where task_id = (select id from tasks where series_id = $1 and occurrence_date = '2026-11-18')", [s.id])
    expect(second).toEqual([{ user_id: w.manager.userId, is_primary: true }])
  })

  test("job skips suspended tenants, tenants without M1 and unpaid ones; re-enabling resumes from the cursor within the 7-day window", async () => {
    const w = await world()
    const s = await series(w, { freq: "daily" }, { start: "2026-11-16T08:00:00", due: "2026-11-16T09:00:00" })
    await rec(w, "2026-11-17T10:00:00Z")
    expect(await instances(w, s.id)).toHaveLength(1)
    await ownerQuery("update tenants set status = 'suspended' where id = $1", [w.tenant.id])
    await rec(w, "2026-11-20T10:00:00Z")
    expect(await instances(w, s.id)).toHaveLength(1)
    await ownerQuery("update tenants set status = 'active' where id = $1", [w.tenant.id])
    await w.q("insert into module_overrides (tenant_id, module, mode, reason, set_by, set_at) values ($1, 'M1', 'revoke', 'test', 'p', now())", [w.tenant.id])
    await rec(w, "2026-11-21T10:00:00Z")
    expect(await instances(w, s.id)).toHaveLength(1)
    await clearModuleOverride(w.deps, w.tenant.id, w.owner.userId, "M1")
    await rec(w, "2026-11-22T10:00:00Z")
    expect((await instances(w, s.id)).map((r) => r.d)).toEqual(["2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"]) // data kept, nothing lost within 7 days
    await w.q("update subscriptions set status = 'canceled' where tenant_id = $1", [w.tenant.id])
    await rec(w, "2026-11-23T10:00:00Z")
    expect(await instances(w, s.id)).toHaveLength(6) // a blocked tenant gets no new tasks (ruling C13)
    // another tenant keeps running while this one is skipped
    const other = await makeTenant(w.deps, { slug: "bravo" })
    const ob = await makeMember(w.deps, other.id, "owner")
    const oc = (await signIn(w.app, ob.email, ob.password)).cookie
    const ot = (await (await call(w.app, "POST", "/v1/tasks", { cookie: oc, tenant: "bravo", body: { ...w.base({ start: "2026-11-16T08:00:00", due: "2026-11-16T09:00:00" }), primary: ob.userId } })).json()) as Json
    expect((await call(w.app, "PUT", `/v1/tasks/${ot.id}/repeat`, { cookie: oc, tenant: "bravo", body: { version: 1, rule: { freq: "daily" } } })).status).toBe(200)
    await rec(w, "2026-11-23T10:00:00Z")
    expect((await ownerTenantQuery(other.id, "select count(*)::int n from tasks where series_id = $1", [ot.id]))[0].n).toBe(7)
    expect(await instances(w, s.id)).toHaveLength(6)
  }, 60_000)

  test("archived or purged series stop producing instances", async () => {
    const w = await world()
    const mkS = (title: string) => series(w, { freq: "daily" }, { title, start: "2026-11-16T08:00:00", due: "2026-11-16T09:00:00" })
    const a = await mkS("A")
    const b = await mkS("B")
    const c = await mkS("C")
    await w.q("update tasks set archived_at = now() where id = $1", [a.id])
    await w.q("delete from tasks where id = $1", [b.id]) // purge (T4.5) hard-deletes the row
    await rec(w, "2026-11-18T10:00:00Z")
    expect(await instances(w, a.id)).toHaveLength(0)
    expect(await instances(w, b.id)).toHaveLength(0)
    expect(await instances(w, c.id)).toHaveLength(2)
  })
})

describe("PUT /v1/tasks/{id}/repeat", () => {
  test("per_shift → 422 unsupported_repeat; bad rules → 422 invalid_repeat; staff 403; out of scope 404; instances and subtasks cannot repeat; null clears; stale 409", async () => {
    const w = await world()
    const t = await w.mk(w.ops, { start: "2026-11-16T08:00:00", due: "2026-11-16T09:00:00" })
    const put = (id: string, as: Who, body: Json) => w.req("PUT", `/v1/tasks/${id}/repeat`, as, body)
    expect(await code(await put(t.id, w.ops, { version: 1, rule: { freq: "per_shift" } }))).toBe("unsupported_repeat")
    for (const rule of [{ freq: "weekly" }, { freq: "weekly", days: [] }, { freq: "weekly", days: [7] }, { freq: "monthly" }, { freq: "monthly", dayOfMonth: 32 }, { freq: "daily", until: "2026-11-01" }, { freq: "daily", until: "2026-13-45" }, { freq: "yearly" }]) {
      const r = await put(t.id, w.ops, { version: 1, rule })
      expect(r.status, JSON.stringify(rule)).toBe(422)
      expect(await code(r), JSON.stringify(rule)).toBe("invalid_repeat")
    }
    expect((await put(t.id, w.ops, { rule: { freq: "daily" } })).status).toBe(400) // version is required (E1)
    expect((await put(t.id, w.staff, { version: 1, rule: { freq: "daily" } })).status).toBe(403) // staff see it (assignee) but do not manage
    const hidden = await put(t.id, w.staff2, { version: 1, rule: { freq: "daily" } })
    expect(hidden.status).toBe(404) // another person's task: no oracle
    expect(await code(hidden)).toBe("task_not_found")
    expect((await put(t.id, w.ops, { version: 9, rule: { freq: "daily" } })).status).toBe(409)
    const ok = await put(t.id, w.ops, { version: 1, rule: { freq: "weekly", days: [3, 1, 1] } })
    expect(ok.status).toBe(200)
    const dto = await w.json(ok)
    expect(dto.repeat).toEqual({ freq: "weekly", days: [1, 3] })
    expect(dto.version).toBe(2)
    const h = await w.json(await w.req("GET", `/v1/tasks/${t.id}/history`, w.ops))
    expect(h.items.find((i: Json) => i.kind === "updated")).toMatchObject({ kind: "updated", text: "Updated Repeat", changes: [{ field: "Repeat", from: "", to: "Weekly on Mon, Wed" }] })
    await rec(w, "2026-11-18T10:00:00Z")
    const [inst] = await w.q("select id from tasks where series_id = $1", [t.id])
    expect(await code(await put(inst.id as string, w.ops, { version: 1, rule: { freq: "daily" } }))).toBe("invalid_repeat")
    const sub = await w.json(await w.req("POST", `/v1/tasks/${t.id}/subtasks`, w.ops, { title: "Sub" }))
    expect(await code(await put(sub.id, w.ops, { version: 1, rule: { freq: "daily" } }))).toBe("invalid_repeat")
    const clear = await put(t.id, w.ops, { version: 2, rule: null })
    expect(clear.status).toBe(200)
    expect((await w.json(clear)).repeat).toBeUndefined()
    await rec(w, "2026-11-25T10:00:00Z")
    expect(await instances(w, t.id)).toHaveLength(1) // cleared: nothing new
  })

  test("a team manager manages a report's series; staff cannot see another person's series or its instances", async () => {
    const w = await world()
    await w.manages(w.manager, w.staff)
    const s = await series(w, { freq: "daily" }, { start: "2026-11-16T08:00:00", due: "2026-11-16T09:00:00" }) // ops-made, staff assigned
    expect((await w.req("GET", `/v1/tasks/${s.id}`, w.manager)).status).toBe(200)
    expect((await w.req("GET", `/v1/tasks/${s.id}`, w.staff2)).status).toBe(404)
    expect((await w.req("PUT", `/v1/tasks/${s.id}/repeat`, w.staff2, { version: s.version, rule: null })).status).toBe(404)
    await rec(w, "2026-11-17T10:00:00Z")
    expect((await w.json(await w.req("GET", "/v1/tasks?repeat=recurring", w.staff))).items).toHaveLength(2) // the series and its instance
    expect((await w.json(await w.req("GET", "/v1/tasks?repeat=recurring", w.staff2))).items).toHaveLength(0)
    expect((await w.req("PUT", `/v1/tasks/${s.id}/repeat`, w.manager, { version: s.version, rule: null })).status).toBe(200)
  })
})

describe("templates", () => {
  test("task created with templateId inherits the template evidence rule when the body has none; project default applies when neither is set", async () => {
    const w = await world()
    const tplRule = { mode: "required", types: ["note"], min: 1, instruction: "From template", review: "manager" }
    const projRule = { mode: "optional", types: ["photo"], min: 0, instruction: "From project", review: "manager" }
    const bodyRule = { mode: "required", types: ["pdf"], min: 2, instruction: "From body", review: "manager" }
    const tpl = await w.json(await w.req("POST", "/v1/task-templates", w.ops, { name: "Opening", title: "Open up", evidenceRule: tplRule }))
    const proj = await w.json(await w.req("POST", "/v1/projects", w.ops, { name: "P", defaultEvidenceRule: projRule }))
    const noRule = await w.json(await w.req("POST", "/v1/projects", w.ops, { name: "NoRule" }))
    const mkT = async (extra: Json) => {
      const r = await w.req("POST", "/v1/tasks", w.ops, w.base(extra))
      expect(r.status, await r.clone().text()).toBe(201)
      return (await w.json(r)).evidenceRule
    }
    expect(await mkT({ templateId: tpl.id, evidenceRule: bodyRule, projectId: proj.id })).toMatchObject(bodyRule) // 1. explicit body rule
    expect(await mkT({ templateId: tpl.id, projectId: proj.id })).toMatchObject(tplRule) // 2. template rule beats the project default
    expect(await mkT({ templateId: tpl.id })).toMatchObject(tplRule)
    expect(await mkT({ projectId: proj.id })).toMatchObject(projRule) // 3. project default
    expect(await mkT({ projectId: noRule.id })).toMatchObject({ mode: "none" }) // 4. nothing set
    expect(await mkT({})).toMatchObject({ mode: "none" })
    const t = await w.json(await w.req("POST", "/v1/tasks", w.ops, w.base({ projectId: proj.id })))
    expect(t.projectId).toBe(proj.id)
    // staff cannot place a task into a project; a foreign or unknown template and project are the same 422
    expect(await code(await w.req("POST", "/v1/tasks", w.staff, w.base({ primary: undefined, projectId: proj.id })))).toBe("forbidden")
    expect(await code(await w.req("POST", "/v1/tasks", w.ops, w.base({ templateId: "6f1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8" })))).toBe("invalid_template")
    expect(await code(await w.req("POST", "/v1/tasks", w.ops, w.base({ projectId: "6f1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8" })))).toBe("invalid_project")
    const other = await makeTenant(w.deps, { slug: "bravo" })
    const ob = await makeMember(w.deps, other.id, "owner")
    const oc = (await signIn(w.app, ob.email, ob.password)).cookie
    const otpl = (await (await call(w.app, "POST", "/v1/task-templates", { cookie: oc, tenant: "bravo", body: { name: "Theirs", title: "Theirs" } })).json()) as Json
    expect(await code(await w.req("POST", "/v1/tasks", w.ops, w.base({ templateId: otpl.id })))).toBe("invalid_template")
  })

  test("templates CRUD: staff 403 on write, anyone with tasks:read lists; version guard; other tenant's template → 404 template_not_found; delete is audited; never a voice note", async () => {
    const w = await world()
    const dept = await w.json(await w.req("POST", "/v1/teams", w.owner, { name: "Cleaning", kind: "department" }))
    const body = { name: "Closing", title: "Close up", description: "Lock doors", teamId: dept.id, assignee: w.staff.userId, priority: 3, tags: ["Safety", " safety ", "night"], evidenceRule: { mode: "required", types: ["photo"], min: 1, instruction: "", review: "manager" }, dueOffset: 2, dueTime: "12:00" }
    expect((await w.req("POST", "/v1/task-templates", w.staff, body)).status).toBe(403)
    const created = await w.req("POST", "/v1/task-templates", w.ops, body)
    expect(created.status, await created.clone().text()).toBe(201)
    const tpl = await w.json(created)
    expect(tpl).toMatchObject({ name: "Closing", title: "Close up", description: "Lock doors", dept: "Cleaning", teamId: dept.id, assignee: w.staff.userId, priority: 3, tags: ["safety", "night"], dueOffset: 2, dueTime: "12:00", version: 1 })
    expect(Object.keys(tpl).filter((k) => /voice/i.test(k))).toEqual([]) // ruling D21: a template never carries the voice note
    expect((await w.q("select column_name from information_schema.columns where table_name = 'task_templates' and column_name like '%voice%'")).length).toBe(0)
    const list = await w.json(await w.req("GET", "/v1/task-templates", w.staff))
    expect(list.items.map((i: Json) => i.name)).toEqual(["Closing"])
    expect((await w.req("PATCH", `/v1/task-templates/${tpl.id}`, w.staff, { version: 1, name: "x" })).status).toBe(403)
    expect((await w.req("PATCH", `/v1/task-templates/${tpl.id}`, w.ops, { version: 5, name: "x" })).status).toBe(409)
    expect((await w.req("PATCH", `/v1/task-templates/${tpl.id}`, w.ops, { name: "x" })).status).toBe(400)
    const patched = await w.json(await w.req("PATCH", `/v1/task-templates/${tpl.id}`, w.ops, { version: 1, name: "Closing v2", dueOffset: 0, assignee: null, teamId: null }))
    expect(patched).toMatchObject({ name: "Closing v2", dueOffset: 0, version: 2, dept: "" })
    expect(patched.assignee).toBeUndefined()
    for (const bad of [{ name: "" }, { name: "x".repeat(81) }, { dueOffset: 366 }, { dueTime: "25:00" }, { dueTime: "9:00" }]) expect([400, 422], JSON.stringify(bad)).toContain((await w.req("POST", "/v1/task-templates", w.ops, { ...body, ...bad })).status)
    expect(await code(await w.req("POST", "/v1/task-templates", w.ops, { ...body, assignee: "usr_ghost_000" }))).toBe("invalid_assignee")
    expect(await code(await w.req("POST", "/v1/task-templates", w.ops, { ...body, teamId: "6f1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8" }))).toBe("invalid_team")
    // another tenant's template is a plain 404, for PATCH and DELETE
    const other = await makeTenant(w.deps, { slug: "bravo" })
    const ob = await makeMember(w.deps, other.id, "owner")
    const oc = (await signIn(w.app, ob.email, ob.password)).cookie
    const theirs = (await (await call(w.app, "POST", "/v1/task-templates", { cookie: oc, tenant: "bravo", body: { name: "Theirs", title: "Theirs" } })).json()) as Json
    for (const [m, b] of [["PATCH", { version: 1, name: "x" }], ["DELETE", undefined]] as [string, unknown][]) {
      const r = await w.req(m, `/v1/task-templates/${theirs.id}`, w.ops, b)
      expect(r.status).toBe(404)
      expect(await code(r)).toBe("template_not_found")
    }
    expect((await w.req("DELETE", `/v1/task-templates/${tpl.id}`, w.staff)).status).toBe(403)
    expect((await w.req("DELETE", `/v1/task-templates/${tpl.id}`, w.ops)).status).toBe(204)
    expect(await code(await w.req("DELETE", `/v1/task-templates/${tpl.id}`, w.ops))).toBe("template_not_found")
    const audit = await w.q("select action, entity, entity_id, actor_id, before from audit_events where action like 'task_template.%'")
    expect(audit).toHaveLength(1) // only delete is audited (ruling D7)
    expect(audit[0]).toMatchObject({ action: "task_template.deleted", entity: "task_template", entity_id: tpl.id, actor_id: w.ops.userId })
    expect(audit[0].before).toMatchObject({ name: "Closing v2" })
  })

  test("a team manager's template assignee must be themself or a direct report (E2); deleting the department clears the template's team", async () => {
    const w = await world()
    await w.manages(w.manager, w.staff)
    const tpl = (b: Json) => w.req("POST", "/v1/task-templates", w.manager, { name: "T", title: "T", ...b })
    expect(await code(await tpl({ assignee: w.staff2.userId }))).toBe("assignee_out_of_scope")
    expect((await tpl({ assignee: w.staff.userId })).status).toBe(201)
    expect((await tpl({ assignee: w.manager.userId })).status).toBe(201)
    const dept = await w.json(await w.req("POST", "/v1/teams", w.owner, { name: "Kitchen", kind: "department" }))
    const withTeam = await w.json(await tpl({ teamId: dept.id }))
    expect((await w.req("DELETE", `/v1/teams/${dept.id}`, w.owner)).status).toBe(204)
    expect((await w.q("select team_id from task_templates where id = $1", [withTeam.id]))[0].team_id).toBeNull()
  })

  test("erasing a person nulls their template links (creator and assignee) and keeps the template", async () => {
    const w = await world()
    const tpl = await w.json(await w.req("POST", "/v1/task-templates", w.ops, { name: "T", title: "T", assignee: w.staff.userId }))
    for (const u of [w.staff.userId, w.ops.userId]) await withTenant(w.deps.db, w.tenant.id, (tx) => tasksDsrHandler.erase(tx, w.tenant.id, u, w.clock.now()))
    expect((await w.q("select assignee_id, created_by from task_templates where id = $1", [tpl.id]))[0]).toEqual({ assignee_id: null, created_by: null })
  })

  test("grants: task_templates carries minimal app_user privileges and forced RLS; RLS rejects another tenant", async () => {
    const tbl = async (t: string) => (await ownerQuery(`select privilege_type from information_schema.role_table_grants where grantee = 'app_user' and table_name = $1 order by 1`, [t])).map((r) => r.privilege_type)
    const col = async (t: string) => (await ownerQuery(`select column_name from information_schema.column_privileges where grantee = 'app_user' and table_name = $1 and privilege_type = 'UPDATE' order by 1`, [t])).map((r) => r.column_name)
    expect(await tbl("task_templates")).toEqual(["DELETE", "INSERT", "SELECT"])
    expect(await col("task_templates")).toEqual(["assignee_id", "created_by", "description", "due_offset_days", "due_time", "evidence_rule", "labels", "name", "priority", "team_id", "title", "version"])
    const w = await world()
    const other = await makeTenant(w.deps, { slug: "bravo" })
    await w.json(await w.req("POST", "/v1/task-templates", w.ops, { name: "Mine", title: "Mine" }))
    for (const stmt of [sql`update task_templates set tenant_id = gen_random_uuid()`, sql`update task_templates set created_at = now()`]) {
      const err = await withTenant(w.deps.db, w.tenant.id, (tx) => tx.execute(stmt)).catch((e) => e)
      expect((err as { cause?: { code?: string } })?.cause?.code, String(stmt)).toBe("42501")
    }
    expect((await withTenant(w.deps.db, other.id, (tx) => tx.execute(sql`select 1 from task_templates`))).rows).toHaveLength(0)
    const err = await withTenant(w.deps.db, other.id, (tx) => tx.execute(sql`insert into task_templates (tenant_id, name, title, evidence_rule, created_at) values (${w.tenant.id}, 'x', 'x', '{}'::jsonb, now())`)).catch((e) => e)
    expect((err as { cause?: { code?: string } })?.cause?.code).toBe("42501")
    expect((await ownerQuery("select relforcerowsecurity f from pg_class where relname = 'task_templates'"))[0].f).toBe(true)
  })

  test("EXPLAIN: the template list uses task_templates_list_idx and the live-series scan uses tasks_series_live_idx", async () => {
    const w = await world()
    await w.q(`insert into task_templates (tenant_id, name, title, evidence_rule, created_at) select $1::uuid, 'T' || lpad(g::text, 5, '0'), 'x', '{}'::jsonb, now() from generate_series(1, 3000) g`, [w.tenant.id])
    await w.q(
      `insert into tasks (tenant_id, ref_no, title, start_at, due_at, evidence_rule, repeat, created_at, updated_at)
       select $1::uuid, 2000 + g, 'S' || g, now(), now(), '{}'::jsonb, case when g % 50 = 0 then '{"freq":"daily"}'::jsonb end, now(), now() from generate_series(1, 6000) g`,
      [w.tenant.id],
    )
    await ownerQuery("analyze task_templates")
    await ownerQuery("analyze tasks")
    const { buildTemplatesQuery } = await import("../task-templates/service")
    const { liveSeriesQuery } = await import("./recurrence")
    const plans = await withTenant(w.deps.db, w.tenant.id, async (tx) => [buildTemplatesQuery(tx, w.tenant.id, 26).toSQL(), liveSeriesQuery(tx, w.tenant.id).toSQL()])
    const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_OWNER_URL })
    await c.connect()
    try {
      const out: string[] = []
      for (const p of plans) {
        await c.query("begin")
        await c.query("select set_config('app.tenant_id', $1, true)", [w.tenant.id])
        out.push((await c.query(`explain ${p.sql}`, p.params as unknown[])).rows.map((r) => r["QUERY PLAN"] as string).join("\n"))
        await c.query("rollback")
      }
      expect(out[0]).toContain("task_templates_list_idx")
      expect(out[0]).not.toMatch(/Seq Scan on task_templates/)
      expect(out[1]).toContain("tasks_series_live_idx")
      expect(out[1]).not.toMatch(/Seq Scan on tasks/)
    } finally {
      await c.end()
    }
  }, 60_000)

  test("M1 gate: template routes and PUT /repeat are 403 module_not_entitled without M1; rows untouched", async () => {
    const w = await world()
    const t = await w.mk(w.ops)
    const tpl = await w.json(await w.req("POST", "/v1/task-templates", w.ops, { name: "T", title: "T" }))
    expect((await w.req("GET", "/v1/task-templates", w.ops)).status).toBe(200) // cached now
    await w.q("insert into module_overrides (tenant_id, module, mode, reason, set_by, set_at) values ($1, 'M1', 'revoke', 'test', 'p', now())", [w.tenant.id])
    w.clock.advance({ minutes: 1 })
    for (const [m, path, b] of [
      ["GET", "/v1/task-templates", undefined], ["POST", "/v1/task-templates", { name: "x", title: "x" }], ["PATCH", `/v1/task-templates/${tpl.id}`, { version: 1, name: "x" }],
      ["DELETE", `/v1/task-templates/${tpl.id}`, undefined], ["PUT", `/v1/tasks/${t.id}/repeat`, { version: 1, rule: { freq: "daily" } }],
    ] as [string, string, unknown][]) {
      const r = await w.req(m, path, w.ops, b)
      expect(r.status, `${m} ${path}`).toBe(403)
      expect(await code(r)).toBe("module_not_entitled")
    }
    expect((await w.q("select count(*)::int n from task_templates"))[0].n).toBe(1)
    await clearModuleOverride(w.deps, w.tenant.id, w.owner.userId, "M1")
  })
})
