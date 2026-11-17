import { sql } from "drizzle-orm"
import pg from "pg"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { ownerQuery, ownerTenantQuery } from "../../../test/db"
import { makeApiKey, makeMember, makeTenant, signIn } from "../../../test/factories"
import { call, resetDb, testApp } from "../../../test/harness"
import { relayOnce, resetSubscribers } from "../../core/events"
import { runJob } from "../../core/queue/queue"
import { withTenant } from "../../db/tenant-tx"
import { clearModuleOverride } from "../entitlements"
import { registerFiles } from "../files"
import { registerNotifications } from "../notifications"
import { registerSearchIndexers } from "../search"
import { applyTaskUpdate, registerTasks, type TaskCtx } from "."
import { archiveQuery, boardCountsQuery, boardItemsQuery, calendarQuery } from "./views"

// T4.5: archive, restore, audited purge, retention job and the board / calendar / archive queries. Rulings D3, D5, D6, D7, D13, D14, D21, E4, E5.

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Who = { userId: string; email: string; password: string; cookie: string }
const NO_EVIDENCE = { mode: "none", types: [], min: 0, instruction: "", review: "manager" }

beforeEach(async () => {
  await resetDb()
  resetSubscribers()
  registerNotifications()
  registerFiles()
  registerSearchIndexers()
  registerTasks()
})
afterEach(resetSubscribers)

async function world(over: { timezone?: string } = {}) {
  const t = testApp()
  const tenant = await makeTenant(t.deps, { slug: "acme", sessionIdleHours: 2160 }) // the clock jumps by weeks: sessions must not idle out
  await ownerQuery("update tenants set timezone = $1 where id = $2", [over.timezone ?? "Europe/Dublin", tenant.id])
  const who = async (role: string, tenantId = tenant.id): Promise<Who> => {
    const m = await makeMember(t.deps, tenantId, role)
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
const versionOf = async (w: W, id: string) => ((await w.q("select version from tasks where id = $1", [id]))[0]?.version as number | undefined) ?? 1
const archive = async (w: W, id: string, as: Who = w.ops, version?: number) => w.req("POST", `/v1/tasks/${id}/archive`, as, { version: version ?? (await versionOf(w, id)) })
const restore = (w: W, id: string, as: Who = w.ops) => w.req("POST", `/v1/tasks/${id}/restore`, as, {})
const purge = (w: W, id: string, as: Who = w.owner) => w.req("DELETE", `/v1/tasks/${id}`, as)
const arch = async (w: W, id: string, as: Who = w.ops) => expect((await archive(w, id, as)).status).toBe(200)
const relay = async (w: W) => {
  for (let i = 0; i < 5 && (await relayOnce(w.deps)) > 0; i++);
}
const drain = async (w: W) => {
  for (let i = 0; i < 6 && w.queue.jobs.length > 0; i++) for (const j of w.queue.jobs.splice(0)) await runJob(j.name, j.data, w.deps)
}
const sweep = (w: W, deps = w.deps) => runJob("tasks.archive-purge", {}, deps)
const ids = (r: Json) => (r.items as Json[]).map((i) => i.id)
const exists = async (w: W, id: string) => (await w.q("select 1 from tasks where id = $1", [id])).length === 1

/** Intent → browser-style PUT → complete (the object is in its final place). Returns the file id. */
async function attach(w: W, as: Who, taskId: string, o: { purpose?: string; mime?: string; content?: string } = {}) {
  const buf = Buffer.from(o.content ?? "hello pdf")
  const r = await w.req("POST", `/v1/tasks/${taskId}/uploads`, as, { purpose: o.purpose ?? "attachment", name: "secret-name.pdf", mime: o.mime ?? "application/pdf", sizeBytes: buf.length })
  expect(r.status, await r.clone().text()).toBe(201)
  const j = await w.json(r)
  const { "Content-Length": _len, ...headers } = j.upload.headers as Record<string, string>
  expect((await fetch(j.upload.url, { method: "PUT", headers, body: buf })).status).toBe(200)
  expect((await w.req("POST", `/v1/tasks/${taskId}/uploads/${j.fileId}/complete`, as)).status).toBe(200)
  return j.fileId as string
}
const objectOf = async (w: W, fileId: string) => w.deps.storage.head(((await w.q("select key from files where id = $1", [fileId]))[0] as { key: string }).key)

describe("archive and restore", () => {
  test("archived tasks are excluded from list, board, calendar, search and knock-on, and return on restore", async () => {
    const w = await world()
    const a = await w.mk(w.ops, { title: "Zebra alpha", start: "2026-11-20T09:00:00", due: "2026-11-20T17:00:00" })
    const d = await w.mk(w.ops, { title: "Zebra dependant", start: "2026-11-21T09:00:00", due: "2026-11-21T17:00:00" })
    expect((await w.req("PUT", `/v1/tasks/${d.id}/dependencies`, w.ops, { version: 1, dependsOnIds: [a.id] })).status).toBe(200)
    await relay(w)
    const search = async (as: Who) => ((await w.json(await w.req("GET", "/v1/search?q=zebra", as))).hits as Json[]).filter((h) => h.entity === "task").map((h) => h.entityId)
    const preview = async () => (await w.json(await w.req("POST", `/v1/tasks/${a.id}/reschedule/preview`, w.ops, { start: "2026-11-20T09:00:00", due: "2026-11-23T17:00:00" }))).moves as Json[]
    const everywhere = async () => ({
      list: ids(await w.json(await w.req("GET", "/v1/tasks", w.ops))),
      board: ((await w.json(await w.req("GET", "/v1/tasks/board", w.ops))).columns as Json[]).flatMap((c) => ids(c)),
      calendar: ((await w.json(await w.req("GET", "/v1/tasks/calendar?from=2026-11-16&to=2026-11-30", w.ops))).days as Json[]).flatMap((x) => (x.tasks as Json[]).map((t) => t.id)),
      search: await search(w.owner),
      knock: (await preview()).map((m) => m.taskId),
    })
    const before = await everywhere()
    expect(before.list).toContain(d.id)
    expect(before.board).toContain(d.id)
    expect(before.calendar).toContain(d.id)
    expect(before.search).toContain(d.id)
    expect(before.knock).toContain(d.id)

    expect((await archive(w, d.id)).status).toBe(200)
    await relay(w) // the indexer also runs from the event; the document is already gone inside the request
    const during = await everywhere()
    for (const where of ["list", "board", "calendar", "search", "knock"] as const) expect(during[where], where).not.toContain(d.id)
    expect(during.list).toContain(a.id)
    expect((await w.req("GET", `/v1/tasks/${d.id}`, w.ops)).status).toBe(404)
    // the edge is kept (restore needs it); the archived dependant is only left out
    expect((await w.q("select 1 from task_dependencies where task_id = $1", [d.id])).length).toBe(1)
    // applyTaskUpdate skips an archived task and writes nothing
    const ctx: TaskCtx = { tenantId: w.tenant.id, tz: "Europe/Dublin", me: w.ops.userId, actorId: w.ops.userId, role: { home: "manager", access: { tasks: "write" } } as never, scope: { kind: "all" }, reports: [], drive: true, now: w.clock.now() }
    const histBefore = (await w.q("select count(*)::int n from task_history"))[0].n
    const res = await withTenant(w.deps.db, w.tenant.id, (tx) => applyTaskUpdate(tx, ctx, { id: "arch-1", ref: d.ref, itemStatus: "done", minutes: 5, note: "", at: "2026-11-20T10:00:00", source: "report" } as never))
    expect(res).toBe("skipped_archived")
    expect((await w.q("select count(*)::int n from task_history"))[0].n).toBe(histBefore)
    // only the archive list has it
    const list = await w.json(await w.req("GET", "/v1/tasks/archive", w.ops))
    expect(ids(list)).toEqual([d.id])

    expect((await restore(w, d.id)).status).toBe(200)
    await relay(w)
    const after = await everywhere()
    for (const where of ["list", "board", "calendar", "search", "knock"] as const) expect(after[where], where).toContain(d.id)
    expect(ids(await w.json(await w.req("GET", "/v1/tasks/archive", w.ops)))).toEqual([])
    const row = (await w.q("select archived_at, archived_by, archive_batch_id from tasks where id = $1", [d.id]))[0]
    expect(row).toEqual({ archived_at: null, archived_by: null, archive_batch_id: null })
  }, 60_000)

  test("archive cascades to open subtasks; restore brings back the same batch only", async () => {
    const w = await world()
    const p = await w.mk(w.ops, { title: "Parent" })
    const sub = async (title: string) => {
      const r = await w.req("POST", `/v1/tasks/${p.id}/subtasks`, w.ops, { title })
      expect(r.status, await r.clone().text()).toBe(201)
      return w.json(r)
    }
    const s1 = await sub("Open one")
    const s2 = await sub("Open two")
    const s3 = await sub("Done one")
    const s4 = await sub("Archived earlier")
    await w.q("update tasks set status = 'completed' where id = $1", [s3.id])
    await arch(w, s4.id) // its own batch
    const r = await archive(w, p.id)
    expect(r.status).toBe(200)
    const rows = await w.q<{ id: string; archived_at: string | null; archive_batch_id: string | null; version: number; archived_by: string | null }>("select id, archived_at, archive_batch_id, version, archived_by from tasks where parent_id = $1 or id = $1 order by ref_no", [p.id])
    const by = new Map(rows.map((x) => [x.id, x]))
    const batch = by.get(p.id)!.archive_batch_id
    expect(batch).toEqual(expect.any(String))
    expect(by.get(s1.id)!.archive_batch_id).toBe(batch)
    expect(by.get(s2.id)!.archive_batch_id).toBe(batch)
    expect(by.get(s3.id)!.archived_at).toBeNull() // completed subtasks stay live
    expect(by.get(s4.id)!.archive_batch_id).not.toBe(batch) // another batch, untouched
    expect(by.get(s1.id)!.archived_by).toBe(w.ops.userId)
    expect(by.get(s1.id)!.version).toBe(2) // every archived row bumps its version
    expect((await w.q("select count(*)::int n from task_history where kind = 'archived'"))[0].n).toBe(4) // parent, s1, s2, s4
    expect((await restore(w, s1.id)).status).toBe(200) // restoring a member brings the whole batch back
    const live = await w.q<{ id: string }>("select id from tasks where archived_at is null")
    expect(live.map((x) => x.id).sort()).toEqual([p.id, s1.id, s2.id, s3.id].sort())
    expect((await w.q("select archived_at from tasks where id = $1", [s4.id]))[0].archived_at).not.toBeNull()
  })

  test("restore after 30 days → 410 archive_expired; at 29d23h → 200 (fake clock)", async () => {
    const w = await world()
    const a = await w.mk(w.ops, { title: "A" })
    const b = await w.mk(w.ops, { title: "B" })
    await arch(w, a.id)
    await arch(w, b.id)
    w.clock.advance({ days: 29, hours: 23 })
    expect((await restore(w, a.id)).status).toBe(200)
    w.clock.advance({ hours: 1 })
    const r = await restore(w, b.id)
    expect(r.status).toBe(410)
    expect(await code(r)).toBe("archive_expired")
    expect((await w.q("select archived_at from tasks where id = $1", [b.id]))[0].archived_at).not.toBeNull() // still archived until the job purges it
  })

  test("only managers archive or restore (D6), scope applies (404), version is checked, archived twice is 409, a live task cannot be restored", async () => {
    const w = await world()
    await w.manages(w.manager, w.staff)
    const mine = await w.mk(w.manager, { title: "Team task" }) // staff is a report of manager
    const theirs = await w.mk(w.ops, { title: "Not mine", primary: w.staff2.userId })
    expect(await code(await archive(w, mine.id, w.staff))).toBe("forbidden") // an assignee is not a manager
    expect(await code(await archive(w, mine.id, w.staff2))).toBe("task_not_found") // out of scope
    expect(await code(await archive(w, theirs.id, w.manager))).toBe("task_not_found") // a team manager cannot touch an out-of-team task
    expect((await archive(w, mine.id, w.ops, 7)).status).toBe(409)
    expect(await code(await archive(w, mine.id, w.ops, 7))).toBe("version_conflict")
    expect((await w.req("POST", `/v1/tasks/${mine.id}/archive`, w.ops, {})).status).toBe(400) // version missing: validation
    expect(await code(await restore(w, mine.id))).toBe("task_not_archived")
    expect((await archive(w, mine.id, w.manager)).status).toBe(200)
    expect(await code(await archive(w, mine.id, w.manager, 2))).toBe("task_archived")
    expect(await code(await restore(w, mine.id, w.staff))).toBe("forbidden")
    expect(await code(await restore(w, mine.id, w.staff2))).toBe("task_not_found")
    expect((await restore(w, mine.id, w.manager)).status).toBe(200) // the team manager restores their own
    expect((await w.q("select archived_at from tasks where id = $1", [mine.id]))[0].archived_at).toBeNull()
    // another tenant's id is the same 404
    const other = await makeTenant(w.deps, { slug: "bravo" })
    const ob = await makeMember(w.deps, other.id, "owner")
    const oc = (await signIn(w.app, ob.email, ob.password)).cookie
    expect(await code(await call(w.app, "POST", `/v1/tasks/${mine.id}/archive`, { cookie: oc, tenant: "bravo", body: { version: 1 } }))).toBe("task_not_found")
  })

  test("PATCH, status, complete and assignees on an archived task → 409 task_archived and write nothing", async () => {
    const w = await world()
    const t = await w.mk(w.ops)
    await arch(w, t.id)
    const before = await w.q("select version, title, status from tasks where id = $1", [t.id])
    const rs = await Promise.all([
      w.req("PATCH", `/v1/tasks/${t.id}`, w.ops, { version: 2, title: "x" }),
      w.req("POST", `/v1/tasks/${t.id}/status`, w.staff, { version: 2, to: "in_progress" }),
      w.req("POST", `/v1/tasks/${t.id}/complete`, w.staff, { version: 2 }),
      w.req("PUT", `/v1/tasks/${t.id}/assignees`, w.ops, { version: 2, primary: w.staff2.userId, others: [] }),
    ])
    expect(rs.map((r) => r.status)).toEqual([409, 409, 409, 409])
    for (const r of rs) expect(await code(r)).toBe("task_archived")
    expect(await w.q("select version, title, status from tasks where id = $1", [t.id])).toEqual(before)
  })

  test("archive vs a concurrent PATCH at the same version: exactly one wins, never both", async () => {
    const w = await world()
    for (let round = 0; round < 4; round++) {
      const t = await w.mk(w.ops)
      const [a, p] = await Promise.all([archive(w, t.id, w.ops, 1), w.req("PATCH", `/v1/tasks/${t.id}`, w.ops, { version: 1, title: "Renamed" })])
      expect([a.status, p.status].filter((s) => s === 200)).toHaveLength(1)
      const loser = a.status === 200 ? p : a
      expect(loser.status).toBe(409)
      expect(["version_conflict", "task_archived"]).toContain(await code(loser))
      const row = (await w.q("select title, archived_at, version from tasks where id = $1", [t.id]))[0]
      expect(row.version).toBe(2)
      expect(row.archived_at !== null).toBe(a.status === 200)
      expect(row.title === "Renamed").toBe(p.status === 200)
    }
  }, 120_000)

  test("archive and restore write audit rows with no title or names, publish ids-only events, and keep the audit chain gap-free", async () => {
    const w = await world()
    const t = await w.mk(w.ops, { title: "Secret client visit", description: "Call Mary O'Neill" })
    await arch(w, t.id)
    w.clock.advance({ days: 1 })
    expect((await restore(w, t.id)).status).toBe(200)
    const rows = await w.q<{ action: string; entity: string; entity_id: string; actor_id: string; before: Json; after: Json; seq: number }>("select seq, action, entity, entity_id, actor_id, before, after from audit_events where action like 'task.%' order by seq")
    expect(rows.map((r) => r.action)).toEqual(["task.archived", "task.restored"])
    for (const r of rows) {
      expect(r).toMatchObject({ entity: "task", entity_id: t.id, actor_id: w.ops.userId })
      const text = JSON.stringify([r.before, r.after])
      expect(text).not.toMatch(/Secret|Mary|Walk every/)
    }
    expect(rows[0].before).toMatchObject({ ref: t.ref })
    expect(rows[1].after).toMatchObject({ ref: t.ref })
    const events = await w.q<{ type: string; payload: Json }>("select type, payload from domain_events where type in ('task.archived','task.restored') order by occurred_at, id")
    expect(events.map((e) => e.type)).toEqual(["task.archived", "task.restored"])
    for (const e of events) expect(Object.keys(e.payload)).toEqual(["taskId"])
    const seqs = (await w.q<{ seq: number }>("select seq from audit_events order by seq")).map((r) => Number(r.seq))
    expect(seqs).toEqual(seqs.map((_, i) => i + 1))
  })

  test("archiving a series source stops its instances; archived instances are not counted as missing", async () => {
    const w = await world()
    const s = await w.mk(w.ops, { start: "2026-11-16T08:00:00", due: "2026-11-16T09:00:00" })
    expect((await w.req("PUT", `/v1/tasks/${s.id}/repeat`, w.ops, { version: 1, rule: { freq: "daily" } })).status).toBe(200)
    await arch(w, s.id)
    w.clock.advance({ days: 3 })
    await runJob("tasks.recurrence", {}, w.deps)
    expect((await w.q("select count(*)::int n from tasks where series_id = $1", [s.id]))[0].n).toBe(0)
  })
})

describe("purge (manual)", () => {
  test("purge needs settings:write and a human: manager 403, api key 403 human_required, admin 204; audit has task.purged with ref only", async () => {
    const w = await world()
    const t = await w.mk(w.ops, { title: "Private payroll visit", description: "Mary O'Neill 12 Main St" })
    await arch(w, t.id)
    expect((await purge(w, t.id, w.manager)).status).toBe(403)
    expect((await purge(w, t.id, w.ops)).status).toBe(403) // ops manages tasks but is not a tenant admin
    expect((await purge(w, t.id, w.staff)).status).toBe(403)
    const key = await makeApiKey(w.deps, w.tenant.id, w.owner.userId, ["settings:write", "tasks:write"])
    const viaKey = await call(w.app, "DELETE", `/v1/tasks/${t.id}`, { headers: { authorization: `Bearer ${key.key}` } })
    expect(viaKey.status).toBe(403)
    expect(await code(viaKey)).toBe("human_required")
    expect(await exists(w, t.id)).toBe(true)
    const r = await purge(w, t.id)
    expect(r.status).toBe(204)
    expect(await exists(w, t.id)).toBe(false)
    const audit = await w.q<{ action: string; entity_id: string; actor_id: string; before: Json; after: unknown }>("select action, entity_id, actor_id, before, after from audit_events where action = 'task.purged'")
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ entity_id: t.id, actor_id: w.owner.userId, after: null })
    expect(audit[0].before).toEqual({ ref: t.ref, archivedAt: "2026-11-16T09:00:00.000Z" })
    expect(JSON.stringify(audit[0])).not.toMatch(/payroll|Mary|Main St/)
    expect((await w.q("select payload from domain_events where type = 'task.purged'")).map((e) => e.payload)).toEqual([{ taskId: t.id }])
    expect((await purge(w, t.id)).status).toBe(404) // already gone
  })

  test("purge of a live task → 409 task_not_archived and nothing changes; unknown and other-tenant ids are 404", async () => {
    const w = await world()
    const t = await w.mk(w.ops)
    const r = await purge(w, t.id)
    expect(r.status).toBe(409)
    expect(await code(r)).toBe("task_not_archived")
    expect(await exists(w, t.id)).toBe(true)
    expect((await w.q("select count(*)::int n from audit_events where action = 'task.purged'"))[0].n).toBe(0)
    expect(await code(await purge(w, "00000000-0000-4000-8000-000000000000"))).toBe("task_not_found")
    const other = await makeTenant(w.deps, { slug: "bravo" })
    const ob = await makeMember(w.deps, other.id, "owner")
    const oc = (await signIn(w.app, ob.email, ob.password)).cookie
    await arch(w, t.id)
    expect(await code(await call(w.app, "DELETE", `/v1/tasks/${t.id}`, { cookie: oc, tenant: "bravo" }))).toBe("task_not_found")
    expect(await exists(w, t.id)).toBe(true)
  })

  test("purge removes the task, every child row and both directions of dependency edges as app_user; dependants stay valid; subtasks and instances are detached", async () => {
    const w = await world()
    const t = await w.mk(w.ops, { title: "Doomed", start: "2026-11-16T08:00:00", due: "2026-11-16T09:00:00" })
    const dep = await w.mk(w.ops, { title: "Needs doomed" })
    const root = await w.mk(w.ops, { title: "Doomed needs this" })
    expect((await w.req("PUT", `/v1/tasks/${dep.id}/dependencies`, w.ops, { version: 1, dependsOnIds: [t.id] })).status).toBe(200)
    expect((await w.req("PUT", `/v1/tasks/${t.id}/dependencies`, w.ops, { version: 1, dependsOnIds: [root.id] })).status).toBe(200)
    expect((await w.req("POST", `/v1/tasks/${t.id}/checklist`, w.ops, { text: "Item" })).status).toBe(201)
    expect((await w.req("POST", `/v1/tasks/${t.id}/comments`, w.ops, { body: "hello" })).status).toBe(201)
    const sub = await w.json(await w.req("POST", `/v1/tasks/${t.id}/subtasks`, w.ops, { title: "Child" }))
    await w.q("update tasks set status = 'completed' where id = $1", [sub.id]) // a live completed child survives its parent
    const sub2 = await w.json(await w.req("POST", `/v1/tasks/${t.id}/subtasks`, w.ops, { title: "Open child" }))
    await w.q("insert into task_time_entries (tenant_id, task_id, user_id, minutes, update_id, at) values ($1, $2, $3, 5, 'u1', now())", [w.tenant.id, t.id, w.ops.userId])
    // the task is a recurring series with an instance
    expect((await w.req("PUT", `/v1/tasks/${t.id}/repeat`, w.ops, { version: await versionOf(w, t.id), rule: { freq: "daily" } })).status).toBe(200)
    w.clock.advance({ days: 1 })
    await runJob("tasks.recurrence", {}, w.deps)
    const inst = await w.q<{ id: string; series_id: string; occurrence_date: string }>("select id, series_id, occurrence_date::text from tasks where series_id = $1", [t.id])
    expect(inst).toHaveLength(1)
    await arch(w, t.id)
    // the open child was archived with it (own purge later), the completed child stays live
    expect((await w.q("select archived_at from tasks where id = $1", [sub2.id]))[0].archived_at).not.toBeNull()
    const maxRef = (await w.q("select max(ref_no)::int m from tasks"))[0].m as number
    const r = await purge(w, t.id)
    expect(r.status, await r.clone().text()).toBe(204)
    for (const tbl of ["task_assignees", "task_history", "task_checklist_items", "task_comments", "task_time_entries", "task_dependencies"]) {
      expect((await w.q(`select count(*)::int n from ${tbl} where task_id = $1 ${tbl === "task_dependencies" ? "or depends_on_id = $1" : ""}`, [t.id]))[0].n, tbl).toBe(0)
    }
    expect(await exists(w, t.id)).toBe(false)
    const kids = await w.q<{ id: string; parent_id: string | null; version: number }>("select id, parent_id, version from tasks where id = any($1::uuid[]) order by ref_no", [[sub.id, sub2.id]])
    expect(kids.map((k) => k.parent_id)).toEqual([null, null])
    const i2 = (await w.q<{ series_id: string | null; occurrence_date: string | null }>("select series_id, occurrence_date from tasks where id = $1", [inst[0].id]))[0]
    expect(i2).toEqual({ series_id: null, occurrence_date: null })
    // the dependant's DTO is valid and lists no dependency; the other tasks are untouched
    const d = await w.json(await w.req("GET", `/v1/tasks/${dep.id}`, w.ops))
    expect(d.dependsOn).toEqual([])
    expect(d.dependsOnIds).toEqual([])
    const rt = await w.json(await w.req("GET", `/v1/tasks/${root.id}`, w.ops))
    expect(rt.id).toBe(root.id)
    // and the dependency graph can be edited again (no dangling edge, cycle checks still work)
    expect((await w.req("PUT", `/v1/tasks/${root.id}/dependencies`, w.ops, { version: 1, dependsOnIds: [dep.id] })).status).toBe(200)
    // the refs are never reused
    const next = await w.mk(w.ops)
    expect(Number(next.ref.slice(4))).toBeGreaterThan(maxRef)
  }, 60_000)

  test("purge removes the search document at once and a restore re-indexes with the tagged audience", async () => {
    const w = await world()
    const t = await w.mk(w.ops, { title: "Quokka crossing" })
    await relay(w)
    const hits = async (as: Who) => ((await w.json(await w.req("GET", "/v1/search?q=quokka", as))).hits as Json[]).filter((h) => h.entity === "task").length
    expect(await hits(w.owner)).toBe(1)
    expect(await hits(w.staff)).toBe(1)
    await arch(w, t.id)
    expect(await hits(w.owner)).toBe(0) // before any relay: removed inside the request
    await relay(w)
    expect(await hits(w.owner)).toBe(0)
    expect((await restore(w, t.id)).status).toBe(200)
    expect(await hits(w.owner)).toBe(1) // re-indexed inside the request
    await relay(w)
    expect(await hits(w.staff)).toBe(1) // the assignee finds it again
    expect(await hits(w.staff2)).toBe(0)
    const doc = (await w.q<{ audience: string[] }>("select audience from search_documents where entity = 'task' and entity_id = $1", [t.id]))[0]
    expect(doc.audience).toEqual([`a:${w.staff.userId}`, `o:${w.ops.userId}`].sort())
    await arch(w, t.id)
    expect((await purge(w, t.id)).status).toBe(204)
    await relay(w)
    expect(await w.q("select 1 from search_documents where entity = 'task' and entity_id = $1", [t.id])).toHaveLength(0)
    expect(await hits(w.owner)).toBe(0)
  })

  test("purge deletes evidence and attachment files through file.delete-object after commit, deletes pending uploads too, and nothing is deleted before commit", async () => {
    const w = await world()
    const t = await w.mk(w.ops, { title: "With files" })
    const f1 = await attach(w, w.ops, t.id, { content: "one" })
    const f2 = await attach(w, w.ops, t.id, { content: "two" })
    const pendingIntent = await w.json(await w.req("POST", `/v1/tasks/${t.id}/uploads`, w.ops, { purpose: "attachment", name: "x.pdf", mime: "application/pdf", sizeBytes: 5 }))
    const other = await w.mk(w.ops, { title: "Other" })
    const keep = await attach(w, w.ops, other.id, { content: "other" })
    w.queue.jobs.length = 0
    expect(await objectOf(w, f1)).not.toBeNull()
    await arch(w, t.id)
    expect(await objectOf(w, f1)).not.toBeNull() // archive keeps every file
    expect((await purge(w, t.id)).status).toBe(204)
    expect(w.queue.jobs.filter((j) => j.name === "file.delete-object")).toHaveLength(3) // f1, f2 and the unfinished upload
    expect((await w.q<{ status: string }>("select status from files where id = any($1::uuid[]) order by id", [[f1, f2, pendingIntent.fileId]])).map((x) => x.status)).toEqual(["deleted", "deleted", "deleted"])
    expect(await objectOf(w, f1)).not.toBeNull() // the job has not run yet
    await drain(w)
    expect(await objectOf(w, f1)).toBeNull()
    expect(await objectOf(w, f2)).toBeNull()
    expect((await w.q("select count(*)::int n from files where object_removed_at is not null"))[0].n).toBe(3)
    expect(await objectOf(w, keep)).not.toBeNull() // another task's file is untouched
    expect((await w.q("select count(*)::int n from task_files where task_id = $1", [t.id]))[0].n).toBe(0)
    const auditText = JSON.stringify(await w.q("select before, after from audit_events where action = 'task.purged'"))
    expect(auditText).not.toContain("secret-name")
  }, 60_000)

  test("a voice file still referenced by another task is kept (and re-homed); the last reference deletes it", async () => {
    const w = await world()
    const s = await w.mk(w.ops, { title: "Series source", start: "2026-11-16T08:00:00", due: "2026-11-16T09:00:00" })
    const voice = await attach(w, w.ops, s.id, { purpose: "voice", mime: "audio/webm", content: "voice" })
    const att = await attach(w, w.ops, s.id, { content: "attachment" })
    expect((await w.req("PUT", `/v1/tasks/${s.id}/repeat`, w.ops, { version: 1, rule: { freq: "daily" } })).status).toBe(200)
    await w.q("update tasks set voice_file_id = $2 where id = $1", [s.id, voice])
    w.clock.advance({ days: 1 })
    await runJob("tasks.recurrence", {}, w.deps) // the instance copies the series' voice file id (D21)
    const inst = (await w.q<{ id: string; voice_file_id: string }>("select id, voice_file_id from tasks where series_id = $1", [s.id]))[0]
    expect(inst.voice_file_id).toBe(voice)
    await arch(w, s.id)
    expect((await purge(w, s.id)).status).toBe(204)
    await drain(w)
    expect(await objectOf(w, att)).toBeNull() // the attachment goes
    expect((await w.q("select status from files where id = $1", [voice]))[0].status).not.toBe("deleted")
    expect(await objectOf(w, voice)).not.toBeNull() // the shared voice file stays
    expect((await w.q("select task_id from task_files where file_id = $1", [voice]))[0].task_id).toBe(inst.id) // re-homed: still reachable through a task
    // the instance is the last holder: archiving and purging it removes the voice file
    await arch(w, inst.id)
    expect((await purge(w, inst.id)).status).toBe(204)
    await drain(w)
    expect(await objectOf(w, voice)).toBeNull()
    expect((await w.q("select status from files where id = $1", [voice]))[0].status).toBe("deleted")
  }, 60_000)

  test("purge vs restore of the same task, concurrently: one wins, the other is a clean 404 or 409, state is consistent", async () => {
    const w = await world()
    for (let round = 0; round < 6; round++) {
      const t = await w.mk(w.ops)
      await arch(w, t.id)
      const [p, r] = await Promise.all([purge(w, t.id), restore(w, t.id)])
      expect([p.status, r.status], `round ${round}`).toSatisfy((s: number[]) => (s[0] === 204 && s[1] === 404) || (s[0] === 409 && s[1] === 200))
      if (p.status === 204) expect(await exists(w, t.id)).toBe(false)
      else expect((await w.q("select archived_at from tasks where id = $1", [t.id]))[0].archived_at).toBeNull()
    }
  }, 120_000)

  test("an upload intent takes the task row FOR SHARE: while the task is being removed it waits and answers 404, never a foreign key 500", async () => {
    const w = await world()
    const t = await w.mk(w.ops)
    const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_OWNER_URL })
    await c.connect()
    try {
      await c.query("begin")
      await c.query("select set_config('app.tenant_id', $1, true)", [w.tenant.id])
      await c.query("select id from tasks where id = $1 for update", [t.id]) // what a purge in progress holds
      let settled = false
      const pending = w.req("POST", `/v1/tasks/${t.id}/uploads`, w.ops, { purpose: "attachment", name: "a.pdf", mime: "application/pdf", sizeBytes: 5 }).then((r) => ((settled = true), r))
      await new Promise((res) => setTimeout(res, 600))
      expect(settled).toBe(false) // blocked on the row lock
      await c.query("delete from tasks where id = $1", [t.id])
      await c.query("commit")
      const r = await pending
      expect(r.status).toBe(404)
      expect(await code(r)).toBe("task_not_found")
    } finally {
      await c.end()
    }
    expect((await w.q("select count(*)::int n from task_files"))[0].n).toBe(0)
  }, 60_000)

  test("upload intents racing archive-then-purge: every answer is 201 or 404, and afterwards no file of the task is left undeleted", async () => {
    const w = await world()
    for (let round = 0; round < 4; round++) {
      const t = await w.mk(w.ops)
      const intent = () => w.req("POST", `/v1/tasks/${t.id}/uploads`, w.ops, { purpose: "attachment", name: "a.pdf", mime: "application/pdf", sizeBytes: 5 })
      const remove = async () => {
        const a = await archive(w, t.id)
        const p = a.status === 200 ? await purge(w, t.id) : a // an intent in flight holds the row, so archive waits for it, never fails
        return [a, p] as const
      }
      const [i1, i2, [a, p], i3, i4] = await Promise.all([intent(), intent(), remove(), intent(), intent()])
      for (const r of [i1, i2, i3, i4]) expect([201, 404], await r.clone().text()).toContain(r.status)
      expect([a.status, p.status], `round ${round}`).toEqual([200, 204])
      expect(await exists(w, t.id)).toBe(false)
      expect((await w.q("select count(*)::int n from files where status <> 'deleted' and id in (select file_id from task_files)"))[0].n).toBe(0)
      expect((await w.q("select count(*)::int n from task_files where task_id = $1", [t.id]))[0].n).toBe(0)
    }
    expect((await w.q("select count(*)::int n from files where status <> 'deleted'"))[0].n).toBe(0) // every intent that won was deleted with its task
  }, 120_000)
})

describe("retention job tasks.archive-purge", () => {
  test("purges at 30 days (not at 29d23h), audits as system:archive-retention, a second run does nothing, restore works until then", async () => {
    const w = await world()
    const old = await w.mk(w.ops, { title: "Old" })
    const young = await w.mk(w.ops, { title: "Young" })
    await arch(w, old.id)
    w.clock.advance({ days: 10 })
    await arch(w, young.id)
    w.clock.advance({ days: 19, hours: 23 }) // old: 29d23h
    await sweep(w)
    expect(await exists(w, old.id)).toBe(true)
    w.clock.advance({ hours: 1 }) // old: exactly 30 days
    await Promise.all([sweep(w), sweep(w)]) // two concurrent runs
    expect(await exists(w, old.id)).toBe(false)
    expect(await exists(w, young.id)).toBe(true)
    const audit = await w.q<{ actor_id: string; before: Json; entity_id: string }>("select actor_id, before, entity_id from audit_events where action = 'task.purged'")
    expect(audit).toHaveLength(1) // idempotent: the loser of the race purged nothing twice
    expect(audit[0].actor_id).toBe("system:archive-retention")
    expect(audit[0].entity_id).toBe(old.id)
    await sweep(w)
    expect((await w.q("select count(*)::int n from audit_events where action = 'task.purged'"))[0].n).toBe(1)
    expect((await w.q("select payload from domain_events where type = 'task.purged'")).map((e) => e.payload)).toEqual([{ taskId: old.id }])
    expect((await restore(w, young.id)).status).toBe(200)
  }, 60_000)

  test("skips suspended tenants, tenants without M1 and unpaid ones and keeps their data; another tenant is still purged", async () => {
    const w = await world()
    const t = await w.mk(w.ops)
    await arch(w, t.id)
    const other = await makeTenant(w.deps, { slug: "bravo" })
    const ob = await makeMember(w.deps, other.id, "owner")
    const oc = (await signIn(w.app, ob.email, ob.password)).cookie
    const ot = (await (await call(w.app, "POST", "/v1/tasks", { cookie: oc, tenant: "bravo", body: { ...w.base(), primary: ob.userId } })).json()) as Json
    expect((await call(w.app, "POST", `/v1/tasks/${ot.id}/archive`, { cookie: oc, tenant: "bravo", body: { version: 1 } })).status).toBe(200)
    w.clock.advance({ days: 31 })
    await ownerQuery("update tenants set status = 'suspended' where id = $1", [w.tenant.id])
    await sweep(w)
    expect(await exists(w, t.id)).toBe(true)
    expect((await ownerTenantQuery(other.id, "select 1 from tasks where id = $1", [ot.id])).length).toBe(0) // bravo was purged
    await ownerQuery("update tenants set status = 'active' where id = $1", [w.tenant.id])
    await w.q("insert into module_overrides (tenant_id, module, mode, reason, set_by, set_at) values ($1, 'M1', 'revoke', 'test', 'p', now())", [w.tenant.id])
    await sweep(w)
    expect(await exists(w, t.id)).toBe(true)
    await clearModuleOverride(w.deps, w.tenant.id, w.owner.userId, "M1")
    await w.q("update subscriptions set status = 'canceled' where tenant_id = $1", [w.tenant.id])
    await sweep(w)
    expect(await exists(w, t.id)).toBe(true) // billing-blocked: data kept (C13)
    await w.q("update subscriptions set status = 'active' where tenant_id = $1", [w.tenant.id])
    await sweep(w)
    expect(await exists(w, t.id)).toBe(false)
  }, 60_000)

  test("batches of 200: 450 old archived tasks are all purged by one run; each is audited once", async () => {
    const w = await world()
    await w.mk(w.ops) // makes the tenant counter
    await w.q(
      `insert into tasks (tenant_id, ref_no, title, evidence_rule, start_at, due_at, created_at, updated_at, creator_id, archived_at, archived_by, archive_batch_id)
       select $1::uuid, 5000 + g, 'Old ' || g, $2::jsonb, now(), now(), now(), now(), $3, $4::timestamptz - interval '40 days', 'system:test', gen_random_uuid() from generate_series(1, 450) g`,
      [w.tenant.id, JSON.stringify(NO_EVIDENCE), w.owner.userId, w.clock.now()],
    )
    await sweep(w)
    expect((await w.q("select count(*)::int n from tasks where archived_at is not null"))[0].n).toBe(0)
    expect((await w.q("select count(*)::int n from audit_events where action = 'task.purged'"))[0].n).toBe(450)
  }, 280_000)

  test("partial failure leaves a consistent state: the failing task stays archived with its files, the rest are purged, and the next run finishes", async () => {
    const w = await world()
    const bad = await w.mk(w.ops, { title: "Bad" })
    const good = await w.mk(w.ops, { title: "Good" })
    const fBad = await attach(w, w.ops, bad.id, { content: "bad" })
    const fGood = await attach(w, w.ops, good.id, { content: "good" })
    await arch(w, bad.id)
    await arch(w, good.id)
    w.queue.jobs.length = 0
    w.clock.advance({ days: 31 })
    await ownerQuery(`create or replace function tmp_block_delete() returns trigger language plpgsql as $$ begin if old.id = '${bad.id}' then raise exception 'blocked on purpose'; end if; return old; end $$`)
    await ownerQuery("create trigger tmp_block before delete on tasks for each row execute function tmp_block_delete()")
    try {
      await sweep(w)
      expect(await exists(w, bad.id)).toBe(true)
      expect(await exists(w, good.id)).toBe(false)
      expect((await w.q("select status from files where id = $1", [fBad]))[0].status).not.toBe("deleted") // rolled back with its task
      expect((await w.q("select count(*)::int n from task_files where task_id = $1", [bad.id]))[0].n).toBe(1)
      expect((await w.q("select count(*)::int n from audit_events where action = 'task.purged' and entity_id = $1", [bad.id]))[0].n).toBe(0)
      expect((await w.q("select count(*)::int n from domain_events where type = 'task.purged' and payload->>'taskId' = $1", [bad.id]))[0].n).toBe(0)
      expect(w.queue.jobs.filter((j) => (j.data as Json).fileId === fBad)).toHaveLength(0)
    } finally {
      await ownerQuery("drop trigger tmp_block on tasks")
    }
    await sweep(w)
    expect(await exists(w, bad.id)).toBe(false)
    await drain(w)
    expect(await objectOf(w, fBad)).toBeNull()
    expect(await objectOf(w, fGood)).toBeNull()
  }, 60_000)

  test("a lost delete-object job is recovered: the next run re-queues deletions that never completed, and the job marks the file when the object is gone", async () => {
    const w = await world()
    const t = await w.mk(w.ops)
    const f = await attach(w, w.ops, t.id, { content: "orphan?" })
    await arch(w, t.id)
    w.clock.advance({ days: 31 })
    await sweep(w)
    expect(await exists(w, t.id)).toBe(false)
    w.queue.jobs.length = 0 // the enqueue was lost (Redis down after the commit)
    expect(await objectOf(w, f)).not.toBeNull()
    await sweep(w) // the reconcile pass finds a deleted task file without an object_removed_at
    expect(w.queue.jobs.filter((j) => j.name === "file.delete-object" && (j.data as Json).fileId === f)).toHaveLength(1)
    await drain(w)
    expect(await objectOf(w, f)).toBeNull()
    expect((await w.q("select object_removed_at from files where id = $1", [f]))[0].object_removed_at).not.toBeNull()
    await sweep(w)
    expect(w.queue.jobs).toHaveLength(0) // nothing left to retry
  }, 60_000)
})

describe("archive list", () => {
  test("cursor pages newest first, shows daysLeft in tenant time, is manager-only and scoped", async () => {
    const w = await world()
    await w.manages(w.manager, w.staff)
    const mine = await w.mk(w.manager, { title: "Team one" })
    const mine2 = await w.mk(w.manager, { title: "Team two" })
    const theirs = await w.mk(w.ops, { title: "Not team", primary: w.staff2.userId })
    await arch(w, mine.id)
    w.clock.advance({ days: 1 })
    await arch(w, theirs.id)
    w.clock.advance({ days: 1 })
    await arch(w, mine2.id)
    w.clock.advance({ days: 3 })
    const p1 = await w.json(await w.req("GET", "/v1/tasks/archive?limit=2", w.ops))
    expect(ids(p1)).toEqual([mine2.id, theirs.id])
    expect(p1.nextCursor).toEqual(expect.any(String))
    const p2 = await w.json(await w.req("GET", `/v1/tasks/archive?limit=2&cursor=${p1.nextCursor}`, w.ops))
    expect(ids(p2)).toEqual([mine.id])
    expect(p2.nextCursor).toBeNull()
    expect(p1.items[0]).toMatchObject({ daysLeft: 27, archivedBy: w.ops.userId })
    expect(p2.items[0].daysLeft).toBe(25)
    expect(p1.items[1].daysLeft).toBe(26)
    expect(p1.items[0].archivedAt).toBe("2026-11-18T09:00:00")
    expect(await code(await w.req("GET", "/v1/tasks/archive?cursor=garbage", w.ops))).toBe("invalid_cursor")
    // a team manager sees only the archived tasks in their scope; staff are refused
    expect(ids(await w.json(await w.req("GET", "/v1/tasks/archive", w.manager)))).toEqual([mine2.id, mine.id])
    expect((await w.req("GET", "/v1/tasks/archive", w.staff)).status).toBe(403)
  })
})

describe("board", () => {
  test("columns follow STATUS_ORDER with counts that respect the caller's scope; items are capped at 50 and page per column", async () => {
    const w = await world()
    await w.manages(w.manager, w.staff)
    const one = await w.mk(w.manager, { title: "Mine", priority: 1 })
    await w.mk(w.ops, { title: "Not in scope", primary: w.staff2.userId })
    await w.q("update tasks set status = 'blocked' where id = $1", [one.id])
    const board = await w.json(await w.req("GET", "/v1/tasks/board", w.manager))
    expect((board.columns as Json[]).map((c) => c.status)).toEqual(["not_started", "in_progress", "blocked", "submitted", "changes_requested", "completed", "cancelled"])
    expect((board.columns as Json[]).map((c) => c.count)).toEqual([0, 0, 1, 0, 0, 0, 0])
    expect(ids(board.columns[2])).toEqual([one.id])
    const all = await w.json(await w.req("GET", "/v1/tasks/board", w.ops))
    expect((all.columns as Json[]).map((c) => c.count)).toEqual([1, 0, 1, 0, 0, 0, 0])
    const filtered = await w.json(await w.req("GET", "/v1/tasks/board?priority=1", w.ops))
    expect((filtered.columns as Json[]).map((c) => c.count)).toEqual([0, 0, 1, 0, 0, 0, 0])
    // 120 more not-started tasks: 50 per page, paged with column + cursor
    await w.q(
      `insert into tasks (tenant_id, ref_no, title, evidence_rule, start_at, due_at, created_at, updated_at, creator_id)
       select $1::uuid, 3000 + g, 'Seed ' || g, $2::jsonb, now(), date_trunc('milliseconds', now()) + (g || ' minutes')::interval, now(), now(), $3 from generate_series(1, 120) g`,
      [w.tenant.id, JSON.stringify(NO_EVIDENCE), w.owner.userId],
    )
    const big = await w.json(await w.req("GET", "/v1/tasks/board", w.owner))
    const col = (big.columns as Json[])[0]
    expect(col.count).toBe(121)
    expect(col.items).toHaveLength(50)
    expect(col.nextCursor).toEqual(expect.any(String))
    const p2 = await w.json(await w.req("GET", `/v1/tasks/board?column=not_started&cursor=${col.nextCursor}`, w.owner))
    expect(p2.columns).toHaveLength(1)
    expect(p2.columns[0].items).toHaveLength(50)
    const p3 = await w.json(await w.req("GET", `/v1/tasks/board?column=not_started&cursor=${p2.columns[0].nextCursor}`, w.owner))
    expect(p3.columns[0].items).toHaveLength(21)
    expect(p3.columns[0].nextCursor).toBeNull()
    const seen = new Set([...ids(col), ...ids(p2.columns[0]), ...ids(p3.columns[0])])
    expect(seen.size).toBe(121)
    expect((await w.req("GET", `/v1/tasks/board?cursor=${col.nextCursor}`, w.owner)).status).toBe(400) // a cursor needs its column
    expect(await code(await w.req("GET", `/v1/tasks/board?column=in_progress&cursor=garbage`, w.owner))).toBe("invalid_cursor")
  }, 60_000)
})

describe("calendar", () => {
  test("groups by tenant-local due date across DST: 01:00 clock change in Europe/Dublin on 25 Oct 2026", async () => {
    const w = await world()
    const a = await w.mk(w.ops, { title: "Late 24th local", start: "2026-10-24T09:00:00", due: "2026-10-25T00:30:00" }) // 23:30Z on the 24th... local 25th? see below
    const b = await w.mk(w.ops, { title: "Next day", start: "2026-10-25T09:00:00", due: "2026-10-26T00:30:00" })
    const c = await w.mk(w.ops, { title: "Edge", start: "2026-10-24T09:00:00", due: "2026-10-24T23:30:00" })
    expect(a.dueAt).toBe("2026-10-24T23:30:00.000Z")
    expect(b.dueAt).toBe("2026-10-26T00:30:00.000Z")
    const cal = await w.json(await w.req("GET", "/v1/tasks/calendar?from=2026-10-24&to=2026-10-27", w.ops))
    expect((cal.days as Json[]).map((d) => d.date)).toEqual(["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"])
    const byDay = Object.fromEntries((cal.days as Json[]).map((d) => [d.date, (d.tasks as Json[]).map((t) => t.id)]))
    expect(byDay["2026-10-25"]).toEqual([a.id]) // due 2026-10-25T00:30 local = 23:30Z on the 24th: the 25th
    expect(byDay["2026-10-26"]).toEqual([b.id]) // due 2026-10-26T00:30 local = 00:30Z: the 26th
    expect(byDay["2026-10-24"]).toEqual([c.id])
    expect(byDay["2026-10-27"]).toEqual([])
    // a range that starts on the 25th includes the task at 23:30Z on the 24th and excludes the 24th's own
    const narrow = await w.json(await w.req("GET", "/v1/tasks/calendar?from=2026-10-25&to=2026-10-25", w.ops))
    expect((narrow.days as Json[]).flatMap((d) => (d.tasks as Json[]).map((t) => t.id))).toEqual([a.id])
    // the card carries the local and UTC due and no heavy detail
    const card = (cal.days as Json[])[1].tasks[0]
    expect(card).toMatchObject({ id: a.id, ref: a.ref, title: "Late 24th local", due: "2026-10-25T00:30:00", dueAt: "2026-10-24T23:30:00.000Z", status: "not_started" })
    expect(card.timeline).toBeUndefined()
  })

  test("range rules: more than 42 days, from after to, and malformed dates are 422 invalid_range; 42 days is fine; scope applies", async () => {
    const w = await world()
    await w.manages(w.manager, w.staff)
    const mine = await w.mk(w.manager, { title: "Mine", due: "2026-11-20T17:00:00" })
    const theirs = await w.mk(w.ops, { title: "Theirs", primary: w.staff2.userId, due: "2026-11-20T18:00:00" })
    for (const qs of ["from=2026-11-01&to=2026-12-13", "from=2026-11-10&to=2026-11-09", "from=2026-13-01&to=2026-13-02", "from=abc&to=2026-11-01", "from=2026-11-01"]) {
      const r = await w.req("GET", `/v1/tasks/calendar?${qs}`, w.ops)
      expect(r.status, qs).toBe(422)
      expect(await code(r), qs).toBe("invalid_range")
    }
    const ok = await w.json(await w.req("GET", "/v1/tasks/calendar?from=2026-11-01&to=2026-12-12", w.ops))
    expect(ok.days).toHaveLength(42)
    const flat = async (as: Who) => ((await w.json(await w.req("GET", "/v1/tasks/calendar?from=2026-11-16&to=2026-11-30", as))).days as Json[]).flatMap((d) => (d.tasks as Json[]).map((t) => t.id))
    expect(await flat(w.manager)).toEqual([mine.id])
    expect(await flat(w.ops)).toEqual([mine.id, theirs.id])
    expect(await flat(w.staff2)).toEqual([theirs.id])
  })
})

describe("query plans at 10k tasks (EXPLAIN)", () => {
  test("board, calendar and archive queries use tasks_live_status_due_idx / tasks_live_due_idx / tasks_archived_idx", async () => {
    const w = await world()
    await w.mk(w.owner)
    await w.q(
      `insert into tasks (tenant_id, ref_no, title, evidence_rule, status, start_at, due_at, created_at, updated_at, creator_id, archived_at, archived_by, archive_batch_id)
       select $1::uuid, 2000 + g, 'Seed ' || g, $2::jsonb, (array['not_started','in_progress','blocked','completed'])[1 + g % 4], now(), date_trunc('milliseconds', now()) + (g || ' minutes')::interval, now(), now(), $3,
         case when g % 10 = 0 then now() - (g || ' minutes')::interval end, case when g % 10 = 0 then 'x' end, case when g % 10 = 0 then gen_random_uuid() end
       from generate_series(1, 10000) g`,
      [w.tenant.id, JSON.stringify(NO_EVIDENCE), w.owner.userId],
    )
    await ownerQuery("vacuum analyze tasks")
    const ctx: TaskCtx = { tenantId: w.tenant.id, tz: "Europe/Dublin", me: w.owner.userId, actorId: w.owner.userId, role: null as never, scope: { kind: "all" }, reports: [], drive: true, now: w.clock.now() }
    const plans = await withTenant(w.deps.db, w.tenant.id, async (tx) => ({
      board: boardItemsQuery(tx, ctx, {}, "in_progress", 51).toSQL(),
      counts: boardCountsQuery(tx, ctx, {}).toSQL(),
      calendar: calendarQuery(tx, ctx, new Date("2026-11-16T00:00:00Z"), new Date("2026-11-20T00:00:00Z"), 1001).toSQL(),
      archive: archiveQuery(tx, ctx, undefined, 26).toSQL(),
    }))
    const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_OWNER_URL })
    await c.connect()
    const explain = async (p: { sql: string; params: unknown[] }) => {
      await c.query("begin")
      await c.query("select set_config('app.tenant_id', $1, true)", [w.tenant.id])
      const rows = (await c.query(`explain ${p.sql}`, p.params as unknown[])).rows.map((r) => r["QUERY PLAN"] as string).join("\n")
      await c.query("rollback")
      return rows
    }
    try {
      const board = await explain(plans.board)
      expect(board).toContain("tasks_live_status_due_idx")
      expect(board).not.toMatch(/Seq Scan on tasks/)
      const cal = await explain(plans.calendar)
      expect(cal).toContain("tasks_live_due_idx")
      expect(cal).not.toMatch(/Seq Scan on tasks/)
      const arch2 = await explain(plans.archive)
      expect(arch2).toContain("tasks_archived_idx")
      expect(arch2).not.toMatch(/Seq Scan on tasks/)
      // the grouped count is one aggregate over the tenant's live rows (a scan is the right plan for an all-rows count); it is timed below instead
      expect(await explain(plans.counts)).toMatch(/Aggregate/)
    } finally {
      await c.end()
    }
    const t0 = Date.now()
    expect((await w.req("GET", "/v1/tasks/board", w.owner)).status).toBe(200)
    expect((await w.req("GET", "/v1/tasks/archive", w.owner)).status).toBe(200)
    expect(Date.now() - t0).toBeLessThan(5000)
  }, 120_000)
})

describe("grants", () => {
  test("tasks keeps DELETE for purge; task_files gains UPDATE(task_id) only for re-homing a shared voice file; child tables get no DELETE (cascade as owner)", async () => {
    const tbl = async (t: string) => (await ownerQuery(`select privilege_type from information_schema.role_table_grants where grantee = 'app_user' and table_name = $1 order by 1`, [t])).map((r) => r.privilege_type)
    const col = async (t: string) => (await ownerQuery(`select column_name from information_schema.column_privileges where grantee = 'app_user' and table_name = $1 and privilege_type = 'UPDATE' order by 1`, [t])).map((r) => r.column_name)
    expect(await tbl("tasks")).toEqual(["DELETE", "INSERT", "SELECT"])
    expect(await col("task_files")).toEqual(["created_by", "task_id"])
    expect(await tbl("task_files")).toEqual(["INSERT", "SELECT"])
    for (const t of ["task_history", "task_comments", "task_time_entries"]) expect(await tbl(t)).not.toContain("DELETE")
    expect(await col("tasks")).toContain("archive_batch_id")
    // the tasks DELETE is bound by RLS: another tenant's session deletes nothing
    const w = await world()
    const t = await w.mk(w.ops)
    const other = await makeTenant(w.deps, { slug: "bravo" })
    const res = await withTenant(w.deps.db, other.id, (tx) => tx.execute(sql`delete from tasks where id = ${t.id}`))
    expect((res as { rowCount?: number }).rowCount ?? 0).toBe(0)
    expect(await exists(w, t.id)).toBe(true)
  })
})
