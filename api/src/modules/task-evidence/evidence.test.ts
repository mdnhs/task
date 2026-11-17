import { sql } from "drizzle-orm"
import pg from "pg"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { ownerQuery, ownerTenantQuery } from "../../../test/db"
import { makeApiKey, makeMember, makeStaff, makeTenant, signIn } from "../../../test/factories"
import { call, resetDb, testApp, testEnv } from "../../../test/harness"
import { relayOnce, resetSubscribers } from "../../core/events"
import { runJob } from "../../core/queue/queue"
import { withTenant } from "../../db/tenant-tx"
import { registerFiles } from "../files"
import { registerNotifications } from "../notifications"
import { registerSearchIndexers } from "../search"
import { applyTaskUpdate, registerTasks, tasksDsrHandler, type TaskCtx } from "../tasks"
import { galleryQuery } from "."

// T4.6: evidence rules, items, review modes, verify / reject (verifier independence, ruling D8), the scan gate (D10), Drive links (D22). Rulings D4, D7, D8, D9, D10, D19, D22, D23.

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Who = { userId: string; email: string; password: string; cookie: string }
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
const RULE = { mode: "required", types: ["pdf", "photo", "note", "drive", "checklist", "image"], min: 1, instruction: "", review: "manager" }
const rule = (o: Json = {}) => ({ ...RULE, ...o })
const NIL = "00000000-0000-4000-8000-000000000000"

beforeEach(async () => {
  await resetDb()
  resetSubscribers()
  registerNotifications()
  registerFiles()
  registerSearchIndexers()
  registerTasks()
})
afterEach(resetSubscribers)

async function world(over: { timezone?: string; env?: Partial<typeof testEnv> } = {}) {
  const t = testApp(over.env ? { env: { ...testEnv, ...over.env } } : {})
  const tenant = await makeTenant(t.deps, { slug: "acme", sessionIdleHours: 2160 })
  await ownerQuery("update tenants set timezone = $1 where id = $2", [over.timezone ?? "Europe/Dublin", tenant.id])
  const who = async (role: string, tenantId = tenant.id): Promise<Who> => {
    const m = await makeMember(t.deps, tenantId, role)
    return { userId: m.userId, email: m.email, password: m.password, cookie: (await signIn(t.app, m.email, m.password)).cookie }
  }
  const owner = await who("owner")
  const manager = await who("manager") // team scope
  const ops = await who("ops") // all scope
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
const versionOf = async (w: W, id: string) => (await w.q("select version from tasks where id = $1", [id]))[0].version as number
const statusOf = async (w: W, id: string) => (await w.q("select status from tasks where id = $1", [id]))[0].status as string
const relay = async (w: W) => {
  for (let i = 0; i < 5 && (await relayOnce(w.deps)) > 0; i++);
}
const drain = async (w: W) => {
  for (let i = 0; i < 6 && w.queue.jobs.length > 0; i++) for (const j of w.queue.jobs.splice(0)) await runJob(j.name, j.data, w.deps)
}
const addEv = (w: W, as: Who, taskId: string, body: Json) => w.req("POST", `/v1/tasks/${taskId}/evidence`, as, body)
const note = async (w: W, as: Who, taskId: string, text = "Done and checked") => {
  const r = await addEv(w, as, taskId, { kind: "note", text })
  expect(r.status, await r.clone().text()).toBe(201)
  return w.json(r)
}
const complete = async (w: W, as: Who, taskId: string) => w.req("POST", `/v1/tasks/${taskId}/complete`, as, { version: await versionOf(w, taskId) })
const verify = async (w: W, as: Who | { key: string }, taskId: string, o: Json = {}) => {
  const body = { version: await versionOf(w, taskId), ...o }
  if ("key" in as) return call(w.app, "POST", `/v1/tasks/${taskId}/verify`, { headers: { authorization: `Bearer ${as.key}` }, body })
  return w.req("POST", `/v1/tasks/${taskId}/verify`, as, body)
}
const reject = async (w: W, as: Who | { key: string }, taskId: string, o: Json = {}) => {
  const body = { version: await versionOf(w, taskId), reason: "Photo is blurry", ...o }
  if ("key" in as) return call(w.app, "POST", `/v1/tasks/${taskId}/reject`, { headers: { authorization: `Bearer ${as.key}` }, body })
  return w.req("POST", `/v1/tasks/${taskId}/reject`, as, body)
}
/** Intent → browser-style PUT → complete → scan job. Returns the file id (scanned unless `scan` is false). */
async function evFile(w: W, as: Who, taskId: string, o: { mime?: string; content?: string; scan?: boolean } = {}) {
  const buf = Buffer.from(o.content ?? "hello pdf")
  const r = await w.req("POST", `/v1/tasks/${taskId}/uploads`, as, { purpose: "evidence", name: "secret-name.pdf", mime: o.mime ?? "application/pdf", sizeBytes: buf.length })
  expect(r.status, await r.clone().text()).toBe(201)
  const j = await w.json(r)
  const { "Content-Length": _len, ...headers } = j.upload.headers as Record<string, string>
  expect((await fetch(j.upload.url, { method: "PUT", headers, body: buf })).status).toBe(200)
  expect((await w.req("POST", `/v1/tasks/${taskId}/uploads/${j.fileId}/complete`, as)).status).toBe(200)
  if (o.scan !== false) await drain(w)
  return j.fileId as string
}
const pdf = async (w: W, as: Who, taskId: string) => {
  const fileId = await evFile(w, as, taskId)
  const r = await addEv(w, as, taskId, { kind: "pdf", fileId })
  expect(r.status, await r.clone().text()).toBe(201)
  return w.json(r)
}
/** A Required (min 1, manager review) task assigned to `staff` (or `staff2`), one note attached by the assignee and completed → submitted. */
async function submitted(w: W, o: Json = {}) {
  const t = await w.mk(w.ops, { evidenceRule: rule(), ...o })
  const asStaff = (o.primary ?? w.staff.userId) === w.staff.userId ? w.staff : w.staff2
  await note(w, asStaff, t.id)
  const r = await complete(w, asStaff, t.id)
  expect(r.status, await r.clone().text()).toBe(200)
  expect((await w.json(r)).status).toBe("submitted")
  return t
}
const evRows = (w: W, taskId: string) => w.q("select id, review, round, reviewed_by, locked_at, reason, created_by from task_evidence where task_id = $1 order by round, created_at, id", [taskId])
const auditCount = async (w: W) => (await w.q("select count(*)::int n from audit_events where action in ('task.evidence_verified','task.evidence_rejected')"))[0].n as number

describe("rule and attach", () => {
  test("AC-M1-08: 'Not needed' closes with one call; Required min 2 PDF cannot close with 1 (422 evidence_required); a rejected item reopens the task for the assignee", async () => {
    const w = await world()
    const none = await w.mk(w.ops)
    const done = await w.json(await complete(w, w.staff, none.id))
    expect(done.status).toBe("completed")

    const t = await w.mk(w.ops, { evidenceRule: rule({ types: ["pdf"], min: 2, review: "manager" }) })
    await pdf(w, w.staff, t.id)
    const blocked = await complete(w, w.staff, t.id)
    expect(blocked.status).toBe(422)
    expect(await code(blocked)).toBe("evidence_required")
    await pdf(w, w.staff, t.id)
    const sub = await w.json(await complete(w, w.staff, t.id))
    expect(sub.status).toBe("submitted")
    expect(sub.evidenceState).toBe("awaiting")
    expect(sub.submittedAt).toBeTruthy()
    // a reviewer rejects one item: the task goes back to the assignee in round 2 and the item stays as an earlier version
    const ids = (await evRows(w, t.id)).map((e) => e.id)
    const rej = await reject(w, w.ops, t.id, { evidenceIds: [ids[0]], reason: "Wrong room" })
    expect(rej.status, await rej.clone().text()).toBe(200)
    const back = await w.json(rej)
    expect(back.status).toBe("changes_requested")
    expect(back.round).toBe(2)
    expect(back.evidenceState).toBe("rejected")
    expect(back.evidence.find((e: Json) => e.id === ids[0])).toMatchObject({ review: "rejected", reason: "Wrong room", round: 1 })
    // the assignee can work again: the rejected item no longer counts, so Complete is blocked until a replacement arrives
    expect(await code(await complete(w, w.staff, t.id))).toBe("evidence_required")
    await pdf(w, w.staff, t.id)
    const again = await w.json(await complete(w, w.staff, t.id))
    expect(again.status).toBe("submitted")
    const comments = await w.json(await w.req("GET", `/v1/tasks/${t.id}/comments`, w.ops))
    expect(comments.items.some((c: Json) => c.body.includes("Wrong room"))).toBe(true) // the reason is a comment
  }, 60_000)

  test("AC-M1-05: proof-required task cannot be completed without proof; manager sees the photo with capturedAt and source and verifies it", async () => {
    const w = await world()
    const t = await w.mk(w.ops, { evidenceRule: rule({ types: ["photo"], min: 1 }) })
    expect(await code(await complete(w, w.staff, t.id))).toBe("evidence_required")
    const fileId = await evFile(w, w.staff, t.id, { mime: "image/jpeg", content: "jpeg bytes" })
    const captured = "2026-11-16T08:55:00.000Z" // 5 min before the test clock (2026-11-16T09:00Z)
    const r = await addEv(w, w.staff, t.id, { kind: "photo", fileId, source: "camera", capturedAt: captured })
    expect(r.status, await r.clone().text()).toBe(201)
    const item = await w.json(r)
    expect(item).toMatchObject({ kind: "photo", source: "camera", capturedAt: captured, fileStatus: "clean", review: "pending", round: 1, locked: false })
    expect((await complete(w, w.staff, t.id)).status).toBe(200)
    const seen = await w.json(await w.req("GET", `/v1/tasks/${t.id}`, w.ops))
    expect(seen.evidence[0]).toMatchObject({ kind: "photo", source: "camera", capturedAt: captured, locked: true })
    const v = await verify(w, w.ops, t.id)
    expect(v.status, await v.clone().text()).toBe(200)
    const out = await w.json(v)
    expect(out.status).toBe("completed")
    expect(out.evidenceState).toBe("verified")
    expect(out.completedAt).toBeTruthy()
    expect(out.submittedAt).toBeTruthy() // kept: lateness is judged from the submit moment
    expect(out.evidence[0]).toMatchObject({ review: "accepted" })
    expect((await w.q("select device_id from task_evidence"))[0].device_id).toBeNull() // an unregistered browser has no device id
  }, 60_000)

  test("capture metadata: capturedAt in the future or older than 30 days is 422; location (or any unknown field) is refused; sizes come from env", async () => {
    const w = await world({ env: { TASK_EVIDENCE_MAX_BYTES: 1000 } })
    const t = await w.mk(w.ops, { evidenceRule: rule() })
    const fileId = await evFile(w, w.staff, t.id, { mime: "image/jpeg" })
    expect(await code(await addEv(w, w.staff, t.id, { kind: "photo", fileId, source: "camera", capturedAt: "2026-11-16T10:00:00.000Z" }))).toBe("invalid_captured_at")
    expect(await code(await addEv(w, w.staff, t.id, { kind: "photo", fileId, source: "camera", capturedAt: "2026-10-01T10:00:00.000Z" }))).toBe("invalid_captured_at")
    const loc = await addEv(w, w.staff, t.id, { kind: "photo", fileId, location: { lat: 1, lng: 2 } })
    expect(loc.status).toBe(400)
    expect((await w.q("select count(*)::int n from task_evidence"))[0].n).toBe(0)
    const big = await w.req("POST", `/v1/tasks/${t.id}/uploads`, w.staff, { purpose: "evidence", name: "big.pdf", mime: "application/pdf", sizeBytes: 5000 })
    expect(await code(big)).toBe("file_too_large")
  }, 60_000)

  test("attach rules: type allowed by the rule, file of THIS task and of the caller, mime fits the kind, one file one item, notes and checklist snapshot, drive url shape", async () => {
    const w = await world()
    const t = await w.mk(w.ops, { evidenceRule: rule({ types: ["pdf", "note", "checklist"] }) })
    const other = await w.mk(w.ops, { evidenceRule: rule() })
    expect(await code(await addEv(w, w.staff, t.id, { kind: "photo", fileId: NIL }))).toBe("evidence_type_not_allowed")
    expect(await code(await addEv(w, w.staff, t.id, { kind: "pdf", fileId: NIL }))).toBe("file_not_found")
    const otherFile = await evFile(w, w.staff, other.id)
    expect(await code(await addEv(w, w.staff, t.id, { kind: "pdf", fileId: otherFile }))).toBe("file_not_found") // another task's file
    const att = await w.json(await w.req("POST", `/v1/tasks/${t.id}/uploads`, w.staff, { purpose: "attachment", name: "x.pdf", mime: "application/pdf", sizeBytes: 5 }))
    expect(await code(await addEv(w, w.staff, t.id, { kind: "pdf", fileId: att.fileId }))).toBe("file_not_found") // an attachment is not evidence
    const f = await evFile(w, w.staff, t.id)
    expect(await code(await addEv(w, w.ops, t.id, { kind: "pdf", fileId: f }))).toBe("file_not_found") // only the uploader of a file may attach it
    expect(await code(await addEv(w, w.staff, t.id, { kind: "pdf" }))).toBe("invalid_evidence")
    expect(await code(await addEv(w, w.staff, t.id, { kind: "note" }))).toBe("invalid_evidence")
    expect(await code(await addEv(w, w.staff, t.id, { kind: "note", text: "x", fileId: f }))).toBe("invalid_evidence")
    expect((await addEv(w, w.staff, t.id, { kind: "pdf", fileId: f })).status).toBe(201)
    expect(await code(await addEv(w, w.staff, t.id, { kind: "pdf", fileId: f }))).toBe("invalid_evidence") // one file, one item
    // a pdf kind needs a pdf mime
    const img = await evFile(w, w.staff, t.id, { mime: "image/png", content: "png" })
    expect(await code(await addEv(w, w.staff, t.id, { kind: "pdf", fileId: img }))).toBe("invalid_evidence")
    // checklist snapshot comes from the task, not from the client
    await w.req("POST", `/v1/tasks/${t.id}/checklist`, w.ops, { text: "A" })
    const c2 = await w.json(await w.req("POST", `/v1/tasks/${t.id}/checklist`, w.ops, { text: "B" }))
    await w.req("PATCH", `/v1/tasks/${t.id}/checklist/${c2.id}`, w.staff, { done: true })
    const cl = await w.json(await addEv(w, w.staff, t.id, { kind: "checklist", text: "Checklist 9/9" }))
    expect(cl.name).toBe("Checklist 1/2")
    // drive url must be a drive link
    const open = await w.mk(w.ops, { evidenceRule: rule() })
    expect(await code(await addEv(w, w.staff, open.id, { kind: "drive", url: "https://example.com/x" }))).toBe("invalid_evidence")
    // an outsider (staff2) cannot even see the task
    expect(await code(await addEv(w, w.staff2, t.id, { kind: "note", text: "hi" }))).toBe("task_not_found")
    // an item cannot be added to a closed task
    const done = await w.mk(w.ops)
    await complete(w, w.staff, done.id)
    expect(await code(await addEv(w, w.staff, done.id, { kind: "note", text: "late" }))).toBe("evidence_locked")
  }, 90_000)

  test("PUT /evidence-rule: creator or manager, version checked, invalid rule 422, named reviewer must be an active member with tasks:write; also strict on create (D23)", async () => {
    const w = await world()
    const t = await w.mk(w.ops)
    const put = (as: Who, rl: Json, version?: number) => w.req("PUT", `/v1/tasks/${t.id}/evidence-rule`, as, { version: version ?? 1, rule: rl })
    expect(await code(await put(w.staff, rule()))).toBe("forbidden") // assignee, not creator or manager
    expect((await put(w.ops, rule())).status).toBe(200)
    expect(await code(await put(w.ops, rule(), 1))).toBe("version_conflict")
    expect(await code(await put(w.ops, rule({ types: [] }), 2))).toBe("invalid_evidence_rule")
    expect(await code(await put(w.ops, rule({ min: 0 }), 2))).toBe("invalid_evidence_rule") // strict: not silently raised to 1
    expect(await code(await put(w.ops, rule({ review: "named" }), 2))).toBe("invalid_evidence_rule")
    expect(await code(await put(w.ops, rule({ review: "named", reviewer: "usr_ghost" }), 2))).toBe("invalid_reviewer")
    const bravo = await makeTenant(w.deps, { slug: "bravo" })
    const foreign = await makeMember(w.deps, bravo.id, "employee")
    expect(await code(await put(w.ops, rule({ review: "named", reviewer: foreign.userId }), 2))).toBe("invalid_reviewer")
    await w.q(`update roles set access = access || '{"tasks":"none"}'::jsonb where key = 'payroll'`)
    const noTasks = await w.who("payroll") // a role without tasks:read
    expect(await code(await put(w.ops, rule({ review: "named", reviewer: noTasks.userId }), 2))).toBe("invalid_reviewer")
    const readOnly = await w.who("hr") // tasks:read only: could see the task but never verify (ruling E9)
    expect(await code(await put(w.ops, rule({ review: "named", reviewer: readOnly.userId }), 2))).toBe("invalid_reviewer")
    expect(await code(await w.req("POST", "/v1/tasks", w.ops, w.base({ evidenceRule: rule({ review: "named", reviewer: readOnly.userId }) })))).toBe("invalid_reviewer")
    expect((await put(w.ops, rule({ review: "named", reviewer: w.staff2.userId }), 2)).status).toBe(200)
    // the named reviewer now sees the task
    expect((await w.req("GET", `/v1/tasks/${t.id}`, w.staff2)).status).toBe(200)
    // creation is just as strict as the PUT for a body rule
    expect(await code(await w.req("POST", "/v1/tasks", w.ops, w.base({ evidenceRule: rule({ min: 0 }) })))).toBe("invalid_evidence_rule")
    expect(await code(await w.req("POST", "/v1/tasks", w.ops, w.base({ evidenceRule: rule({ review: "named", reviewer: noTasks.userId }) })))).toBe("invalid_reviewer")
    // a submitted task's rule is locked
    const s = await submitted(w)
    expect(await code(await w.req("PUT", `/v1/tasks/${s.id}/evidence-rule`, w.ops, { version: await versionOf(w, s.id), rule: rule({ min: 3 }) }))).toBe("evidence_locked")
  }, 90_000)
})

describe("inherited rules (D23)", () => {
  test("a template or project rule whose named reviewer can no longer write falls back to manager review; a template without a rule still beats the project default; an invalid inherited rule is 422", async () => {
    const w = await world()
    const named = rule({ review: "named", reviewer: w.staff2.userId })
    const tpl = await w.json(await w.req("POST", "/v1/task-templates", w.ops, { name: "Named", title: "Named", evidenceRule: named }))
    const proj = await w.json(await w.req("POST", "/v1/projects", w.ops, { name: "P", defaultEvidenceRule: named }))
    const plain = await w.json(await w.req("POST", "/v1/task-templates", w.ops, { name: "Plain", title: "Plain" }))
    await w.q(`update roles set access = access || '{"tasks":"read"}'::jsonb where key = 'employee'`) // staff2 is now read-only
    const viaTpl = await w.mk(w.ops, { templateId: tpl.id })
    expect(viaTpl.evidenceRule).toMatchObject({ mode: "required", review: "manager" })
    expect(viaTpl.evidenceRule.reviewer).toBeUndefined()
    const viaProj = await w.mk(w.ops, { projectId: proj.id })
    expect(viaProj.evidenceRule).toMatchObject({ mode: "required", review: "manager" })
    // the explicit template (no rule) wins over the project default
    expect((await w.mk(w.ops, { templateId: plain.id, projectId: proj.id })).evidenceRule.mode).toBe("none")
    // an inherited rule that is itself invalid now fails the POST
    await w.q(`update task_templates set evidence_rule = '{"mode":"required","types":[],"min":1,"instruction":"","review":"manager"}'::jsonb where id = $1`, [tpl.id])
    expect(await code(await w.req("POST", "/v1/tasks", w.ops, w.base({ templateId: tpl.id })))).toBe("invalid_evidence_rule")
  }, 60_000)
})

describe("support grants", () => {
  test("a support-grant session gets 403 support_read_only on verify, reject and batch (nothing changes) and can read the gallery", async () => {
    const w = await world()
    const t = await submitted(w)
    const staff = await makeStaff(w.deps, "support")
    const g = await call(w.app, "POST", `/v1/platform/tenants/${w.tenant.id}/support-grants`, { cookie: staff.cookie, body: { reason: "Ticket 4411: report totals look wrong", hours: 2 } })
    expect(g.status, await g.clone().text()).toBe(201)
    const v = await versionOf(w, t.id)
    const as = (m: string, path: string, body?: unknown) => call(w.app, m, path, { cookie: staff.cookie, tenant: "acme", body })
    for (const [path, body] of [[`/v1/tasks/${t.id}/verify`, { version: v }], [`/v1/tasks/${t.id}/reject`, { version: v, reason: "no" }], ["/v1/evidence/verify-batch", { items: [{ taskId: t.id, version: v }] }]] as const) {
      const r = await as("POST", path, body)
      expect(r.status, path).toBe(403)
      expect(await code(r), path).toBe("support_read_only")
    }
    expect(await versionOf(w, t.id)).toBe(v)
    expect(await statusOf(w, t.id)).toBe("submitted")
    expect(await auditCount(w)).toBe(0)
    const gal = await as("GET", "/v1/evidence")
    expect(gal.status).toBe(200)
    expect(((await w.json(gal)).items as Json[]).map((i) => i.taskId)).toEqual([t.id])
  }, 60_000)
})

describe("verification independence (D8)", () => {
  test("nobody verifies evidence they uploaded or on a task they are assigned to; keys cannot verify", async () => {
    const w = await world()
    await w.manages(w.manager, w.staff)
    const key = await makeApiKey(w.deps, w.tenant.id, w.owner.userId, ["tasks:write", "tasks:read"])
    // (1) a manager who is a CO-ASSIGNEE
    const t1 = await submitted(w, { others: [w.ops.userId] })
    const v1 = await versionOf(w, t1.id)
    const r1 = await verify(w, w.ops, t1.id)
    expect(r1.status).toBe(403)
    expect(await code(r1)).toBe("self_verification")
    expect(await code(await reject(w, w.ops, t1.id))).toBe("self_verification") // rejection follows the same rule
    // (2) the primary assignee themself
    expect(await code(await verify(w, w.staff, t1.id))).toBe("self_verification")
    // (3) an API key, whatever its scopes (even the creator's own tasks:write)
    const rk = await verify(w, key, t1.id)
    expect(rk.status).toBe(403)
    expect(await code(rk)).toBe("human_required")
    expect(await code(await reject(w, key, t1.id))).toBe("human_required")
    // nothing changed
    expect(await versionOf(w, t1.id)).toBe(v1)
    expect(await statusOf(w, t1.id)).toBe("submitted")
    expect((await evRows(w, t1.id)).every((e) => e.review === "pending")).toBe(true)
    expect(await auditCount(w)).toBe(0)
    // an independent manager (none of the above) may
    expect((await verify(w, w.owner, t1.id)).status).toBe(200)

    // (4) the UPLOADER: a manager attached the item for the assignee; they cannot verify it, another manager can
    const t2 = await w.mk(w.ops, { evidenceRule: rule() })
    await note(w, w.manager, t2.id, "Manager's own note") // team manager attaches (manage) as evidence
    expect((await complete(w, w.staff, t2.id)).status).toBe(200)
    const v2 = await versionOf(w, t2.id)
    expect(await code(await verify(w, w.manager, t2.id))).toBe("self_verification")
    expect(await code(await reject(w, w.manager, t2.id))).toBe("self_verification")
    expect(await versionOf(w, t2.id)).toBe(v2)
    expect((await verify(w, w.ops, t2.id)).status).toBe(200)

    // (5) the creator who is ALSO the assignee (creator mode): no verification of their own task, a manager still can
    const t3 = await w.json(await w.req("POST", "/v1/tasks", w.staff, w.base({ evidenceRule: rule({ review: "creator" }) })))
    await note(w, w.staff, t3.id)
    expect((await complete(w, w.staff, t3.id)).status).toBe(200)
    expect(await code(await verify(w, w.staff, t3.id))).toBe("self_verification")
    expect((await verify(w, w.ops, t3.id)).status).toBe(200)

    // (6) a person who sees the task but is not a reviewer (a staff creator who is not an assignee, manager review): not_a_reviewer
    const t4 = await submitted(w)
    await w.q("update tasks set creator_id = $1 where id = $2", [w.staff2.userId, t4.id])
    const r4 = await verify(w, w.staff2, t4.id)
    expect(r4.status).toBe(403)
    expect(await code(r4)).toBe("not_a_reviewer")
    expect(await code(await reject(w, w.staff2, t4.id))).toBe("not_a_reviewer")
    // (7) an outsider cannot see the task at all (no oracle)
    const t5 = await submitted(w)
    expect(await code(await verify(w, w.staff2, t5.id))).toBe("task_not_found")
  }, 120_000)

  test("review modes: auto accepts on complete; creator mode lets the creator verify; named mode lets the named reviewer (who can now see the task) and managers; a departed named reviewer falls back to managers", async () => {
    const w = await world()
    // auto: items are accepted on Complete, the task closes, nobody reviews
    const a = await w.mk(w.ops, { evidenceRule: rule({ review: "auto" }) })
    await note(w, w.staff, a.id)
    const done = await w.json(await complete(w, w.staff, a.id))
    expect(done.status).toBe("completed")
    expect(done.evidenceState).toBe("verified")
    expect((await evRows(w, a.id))[0]).toMatchObject({ review: "accepted", reviewed_by: "system:auto" })
    // creator mode: the manager creator (not assignee) verifies; an outsider cannot even see the task
    const c = await submitted(w, { evidenceRule: rule({ review: "creator" }) })
    expect(await code(await verify(w, w.staff2, c.id))).toBe("task_not_found")
    expect((await verify(w, w.ops, c.id)).status).toBe(200) // creator = ops
    // named mode: the named staff2 verifies; staff2 can see the task through the rule
    const n = await w.mk(w.ops, { evidenceRule: rule({ review: "named", reviewer: w.staff2.userId }) })
    await note(w, w.staff, n.id)
    await complete(w, w.staff, n.id)
    const vn = await verify(w, w.staff2, n.id)
    expect(vn.status, await vn.clone().text()).toBe(200)
    expect((await evRows(w, n.id))[0].reviewed_by).toBe(w.staff2.userId)
    // the named reviewer leaves (membership suspended): the task is not stuck, a manager verifies
    const m2 = await w.mk(w.ops, { evidenceRule: rule({ review: "named", reviewer: w.staff2.userId }) })
    await note(w, w.staff, m2.id)
    await complete(w, w.staff, m2.id)
    await w.q("update memberships set status = 'suspended' where user_id = $1", [w.staff2.userId])
    expect((await verify(w, w.ops, m2.id)).status).toBe(200)
  }, 90_000)
})

describe("scan gate (D10)", () => {
  test("pending scan blocks complete with 409 evidence_not_ready; infected file auto-rejects its item with reviewer system:scanner; only clean files count", async () => {
    const w = await world()
    const t = await w.mk(w.ops, { evidenceRule: rule({ types: ["pdf"], min: 1 }) })
    const pending = await evFile(w, w.staff, t.id, { scan: false })
    const item = await w.json(await addEv(w, w.staff, t.id, { kind: "pdf", fileId: pending }))
    expect(item.fileStatus).toBe("pending")
    const r = await complete(w, w.staff, t.id)
    expect(r.status).toBe(409)
    expect(await code(r)).toBe("evidence_not_ready")
    expect(await statusOf(w, t.id)).toBe("not_started")
    expect((await w.json(await w.req("GET", `/v1/tasks/${t.id}`, w.staff))).evidenceState).toBe("missing") // not counted until clean
    await drain(w)
    expect((await complete(w, w.staff, t.id)).status).toBe(200)

    // infected: the subscriber rejects the item (before any Complete)
    const t2 = await w.mk(w.ops, { evidenceRule: rule({ types: ["pdf"], min: 1 }) })
    const bad = await evFile(w, w.staff, t2.id, { content: EICAR })
    expect((await w.q("select status from files where id = $1", [bad]))[0].status).toBe("infected")
    expect(await code(await addEv(w, w.staff, t2.id, { kind: "pdf", fileId: bad }))).toBe("file_infected") // already known infected: refused
    const bad2 = await evFile(w, w.staff, t2.id, { content: EICAR, scan: false })
    await addEv(w, w.staff, t2.id, { kind: "pdf", fileId: bad2 })
    await drain(w)
    await relay(w)
    const rows = await evRows(w, t2.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ review: "rejected", reviewed_by: "system:scanner", reason: "Failed malware scan" })
    expect(await code(await complete(w, w.staff, t2.id))).toBe("evidence_required")
    // the download of an infected item's file is gone (410), on both routes
    expect((await w.req("GET", `/v1/tasks/${t2.id}/evidence/${rows[0].id}/download`, w.ops)).status).toBe(410)
    expect((await w.req("GET", `/v1/tasks/${t2.id}/files/${bad2}/download`, w.ops)).status).toBe(410)
    // an infected file found at Complete time (event not yet relayed) never counts: with nothing else it is 422 (the subscriber rejects it once relayed)
    const t3 = await w.mk(w.ops, { evidenceRule: rule({ types: ["pdf", "note"], min: 1 }) })
    const bad3 = await evFile(w, w.staff, t3.id, { content: EICAR, scan: false })
    await addEv(w, w.staff, t3.id, { kind: "pdf", fileId: bad3 })
    await drain(w)
    expect(await code(await complete(w, w.staff, t3.id))).toBe("evidence_required")
    await relay(w)
    expect((await evRows(w, t3.id))[0]).toMatchObject({ review: "rejected", reviewed_by: "system:scanner" })
    // ... and when the task does close on another item, the infected one is rejected in the same transaction, before any relay
    const t4 = await w.mk(w.ops, { evidenceRule: rule({ types: ["pdf", "note"], min: 1 }) })
    const bad4 = await evFile(w, w.staff, t4.id, { content: EICAR, scan: false })
    await addEv(w, w.staff, t4.id, { kind: "pdf", fileId: bad4 })
    await note(w, w.staff, t4.id)
    await drain(w)
    expect((await w.json(await complete(w, w.staff, t4.id))).status).toBe("submitted")
    const r4 = await evRows(w, t4.id)
    expect(r4.map((e) => e.review).sort()).toEqual(["pending", "rejected"])
    expect(r4.find((e) => e.review === "rejected")).toMatchObject({ reviewed_by: "system:scanner", reason: "Failed malware scan" })
    expect((await verify(w, w.ops, t4.id)).status).toBe(200)
  }, 120_000)

  test("evidence downloads follow task access and the scan gate; the generic file route cannot be used to skirt it", async () => {
    const w = await world()
    const t = await w.mk(w.ops, { evidenceRule: rule() })
    const f = await evFile(w, w.staff, t.id, { scan: false })
    const item = await w.json(await addEv(w, w.staff, t.id, { kind: "pdf", fileId: f }))
    expect((await w.req("GET", `/v1/tasks/${t.id}/evidence/${item.id}/download`, w.staff)).status).toBe(409) // pending
    expect((await w.req("GET", `/v1/tasks/${t.id}/files/${f}/download`, w.staff)).status).toBe(409)
    await drain(w)
    const ok = await w.req("GET", `/v1/tasks/${t.id}/evidence/${item.id}/download`, w.ops)
    expect(ok.status).toBe(302)
    expect(ok.headers.get("location")).toContain("X-Amz")
    // out of scope: 404 task_not_found, never the file
    expect(await code(await w.req("GET", `/v1/tasks/${t.id}/evidence/${item.id}/download`, w.staff2))).toBe("task_not_found")
    expect(await code(await w.req("GET", `/v1/tasks/${t.id}/files/${f}/download`, w.staff2))).toBe("task_not_found")
    // a note has no file
    const n = await note(w, w.staff, t.id)
    expect(await code(await w.req("GET", `/v1/tasks/${t.id}/evidence/${n.id}/download`, w.ops))).toBe("evidence_not_found")
    expect(await code(await w.req("GET", `/v1/tasks/${t.id}/evidence/${NIL}/download`, w.ops))).toBe("evidence_not_found")
    // /v1/files cannot read a task file
    expect(await code(await w.req("GET", `/v1/files/${f}/download`, w.owner))).toBe("file_not_found")
  }, 90_000)
})

describe("shift report hand-off", () => {
  test("a report that says Done uses the REAL items: pending scan or no proof leaves the task open ('evidence still needed'); proof closes it like Complete (submitted, items locked)", async () => {
    const w = await world()
    const t = await w.mk(w.ops, { evidenceRule: rule({ types: ["pdf", "note"], min: 1 }) })
    const ctx: TaskCtx = { tenantId: w.tenant.id, tz: "Europe/Dublin", me: w.staff.userId, actorId: w.staff.userId, role: { home: "staff", access: { tasks: "write" } } as never, scope: { kind: "own", personId: w.staff.userId }, reports: [], drive: true, now: w.clock.now() }
    const done = (id: string) => ({ id, ref: t.ref, itemStatus: "done", minutes: 0, note: "", at: "2026-11-16T10:00:00", source: "report" }) as never
    await withTenant(w.deps.db, w.tenant.id, (tx) => applyTaskUpdate(tx, ctx, done("r1")))
    expect(await statusOf(w, t.id)).toBe("not_started")
    const pending = await evFile(w, w.staff, t.id, { scan: false })
    await addEv(w, w.staff, t.id, { kind: "pdf", fileId: pending })
    await withTenant(w.deps.db, w.tenant.id, (tx) => applyTaskUpdate(tx, ctx, done("r2"))) // pending scan: no error, still open
    expect(await statusOf(w, t.id)).toBe("not_started")
    await drain(w)
    await withTenant(w.deps.db, w.tenant.id, (tx) => applyTaskUpdate(tx, ctx, done("r3")))
    expect(await statusOf(w, t.id)).toBe("submitted")
    expect((await evRows(w, t.id))[0].locked_at).not.toBeNull()
  }, 60_000)
})

describe("lock, rounds and delete", () => {
  test("submitted items are locked: delete → 409 evidence_locked; resubmission after reject is round 2 and round-1 items stay as earlier versions; only the uploader deletes an unlocked item", async () => {
    const w = await world()
    const t = await w.mk(w.ops, { evidenceRule: rule() })
    const n1 = await note(w, w.staff, t.id, "first")
    const del = (as: Who, id: string) => w.req("DELETE", `/v1/tasks/${t.id}/evidence/${id}`, as)
    expect(await code(await del(w.ops, n1.id))).toBe("forbidden") // a manager is not the uploader
    const spare = await note(w, w.staff, t.id, "spare")
    expect((await del(w.staff, spare.id)).status).toBe(204)
    expect(await code(await del(w.staff, spare.id))).toBe("evidence_not_found")
    await complete(w, w.staff, t.id)
    const locked = await del(w.staff, n1.id)
    expect(locked.status).toBe(409)
    expect(await code(locked)).toBe("evidence_locked")
    expect((await evRows(w, t.id))[0].locked_at).not.toBeNull()
    await reject(w, w.ops, t.id)
    const rows = await evRows(w, t.id)
    expect(rows[0]).toMatchObject({ review: "rejected", round: 1 })
    const n2 = await note(w, w.staff, t.id, "second try")
    expect(n2.round).toBe(2)
    expect(await code(await del(w.staff, n1.id))).toBe("evidence_locked") // an earlier version is read-only for good
    expect((await complete(w, w.staff, t.id)).status).toBe(200)
    expect((await verify(w, w.ops, t.id)).status).toBe(200)
    const final = await evRows(w, t.id)
    expect(final.map((e) => [e.round, e.review])).toEqual([[1, "rejected"], [2, "accepted"]])
    // a delete of a file item expires its file
    const t2 = await w.mk(w.ops, { evidenceRule: rule() })
    const it = await pdf(w, w.staff, t2.id)
    const fileId = (await w.q("select file_id from task_evidence where id = $1", [it.id]))[0].file_id
    expect((await w.req("DELETE", `/v1/tasks/${t2.id}/evidence/${it.id}`, w.staff)).status).toBe(204)
    expect((await w.q("select status from files where id = $1", [fileId]))[0].status).toBe("deleted")
  }, 120_000)

  test("partial verify keeps the task awaiting; reject carries untouched pending items into the new round", async () => {
    const w = await world()
    const t = await w.mk(w.ops, { evidenceRule: rule({ min: 2 }) })
    const a = await note(w, w.staff, t.id, "a")
    const b = await note(w, w.staff, t.id, "b")
    await complete(w, w.staff, t.id)
    const part = await w.json(await verify(w, w.ops, t.id, { evidenceIds: [a.id] }))
    expect(part.status).toBe("submitted")
    expect(part.evidenceState).toBe("awaiting")
    // a verify naming an already reviewed item is refused
    expect(await code(await verify(w, w.ops, t.id, { evidenceIds: [a.id] }))).toBe("invalid_transition")
    const rej = await w.json(await reject(w, w.ops, t.id, { evidenceIds: [b.id] }))
    expect(rej.status).toBe("changes_requested")
    expect(rej.round).toBe(2)
    expect(rej.evidence.find((e: Json) => e.id === a.id).review).toBe("accepted")
    // verify of a task that is not submitted
    const late = await verify(w, w.ops, t.id)
    expect(late.status).toBe(409)
    expect(await code(late)).toBe("invalid_transition")
  }, 90_000)
})

describe("drive links (D22)", () => {
  test("AC-M1-06: drive evidence attach off the company PC → 403 device_policy; on the allowed device → 201; withheld on every response without access", async () => {
    const w = await world()
    const t = await w.mk(w.ops, { evidenceRule: rule() })
    const url = "https://drive.google.com/file/d/abc123/view"
    expect((await w.req("PUT", "/v1/device-policies/drive", w.owner, { allow: "none" })).status).toBe(200)
    const denied = await addEv(w, w.staff, t.id, { kind: "drive", url })
    expect(denied.status).toBe(403)
    expect(await code(denied)).toBe("device_policy")
    expect((await w.req("PUT", "/v1/device-policies/drive", w.owner, { allow: "any" })).status).toBe(200)
    const ok = await addEv(w, w.staff, t.id, { kind: "drive", url })
    expect(ok.status, await ok.clone().text()).toBe(201)
    expect((await w.json(ok)).url).toBe(url)
    const n = await note(w, w.staff, t.id, `see ${url} for details`)
    expect(n.name).toContain("drive.google.com")
    // off the PC: the link is withheld everywhere evidence is shown, but stored intact
    expect((await w.req("PUT", "/v1/device-policies/drive", w.owner, { allow: "none" })).status).toBe(200)
    const detail = await w.json(await w.req("GET", `/v1/tasks/${t.id}`, w.staff))
    expect(JSON.stringify(detail)).not.toContain("drive.google.com")
    const drv = detail.evidence.find((e: Json) => e.kind === "drive")
    expect(drv).toMatchObject({ name: "Google Drive link" })
    expect(drv.url).toBeUndefined()
    expect(JSON.stringify(await w.json(await w.req("GET", "/v1/tasks", w.staff)))).not.toContain("drive.google.com")
    expect(JSON.stringify(await w.json(await w.req("GET", "/v1/evidence?state=awaiting", w.ops)))).not.toContain("drive.google.com")
    expect(await code(await w.req("GET", `/v1/tasks/${t.id}/evidence/${drv.id}/download`, w.staff))).toBe("evidence_not_found")
    expect((await w.q("select url from task_evidence where kind = 'drive'"))[0].url).toBe(url)
    // an API key has no device: Drive is withheld for it too
    const key = await makeApiKey(w.deps, w.tenant.id, w.owner.userId, ["tasks:read"])
    const viaKey = await call(w.app, "GET", `/v1/tasks/${t.id}`, { headers: { authorization: `Bearer ${key.key}` } })
    expect(JSON.stringify(await viaKey.json())).not.toContain("drive.google.com")
    // with access again the download of a Drive item redirects to the link
    expect((await w.req("PUT", "/v1/device-policies/drive", w.owner, { allow: "any" })).status).toBe(200)
    const red = await w.req("GET", `/v1/tasks/${t.id}/evidence/${drv.id}/download`, w.staff)
    expect(red.status).toBe(302)
    expect(red.headers.get("location")).toBe(url)
  }, 90_000)
})

describe("races", () => {
  test("concurrent verify and reject on the same submission: one wins, the other 409; two reviewers verifying at once: one verification, one audit", async () => {
    const w = await world()
    const t = await submitted(w)
    const v = await versionOf(w, t.id)
    const [a, b] = await Promise.all([
      w.req("POST", `/v1/tasks/${t.id}/verify`, w.ops, { version: v }),
      w.req("POST", `/v1/tasks/${t.id}/reject`, w.owner, { version: v, reason: "No" }),
    ])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    const loser = a.status === 409 ? a : b
    expect(["version_conflict", "invalid_transition"]).toContain(await code(loser))
    expect(await auditCount(w)).toBe(1)
    expect(["completed", "changes_requested"]).toContain(await statusOf(w, t.id))

    const t2 = await submitted(w)
    const v2 = await versionOf(w, t2.id)
    const [c, d] = await Promise.all([
      w.req("POST", `/v1/tasks/${t2.id}/verify`, w.ops, { version: v2 }),
      w.req("POST", `/v1/tasks/${t2.id}/verify`, w.owner, { version: v2 }),
    ])
    expect([c.status, d.status].sort()).toEqual([200, 409])
    expect((await w.q("select count(*)::int n from audit_events where action = 'task.evidence_verified' and entity_id = $1", [t2.id]))[0].n).toBe(1)
    expect((await w.q("select count(*)::int n from domain_events where type = 'task.evidence_verified' and payload->>'taskId' = $1", [t2.id]))[0].n).toBe(1)
    expect((await evRows(w, t2.id)).filter((e) => e.review === "accepted")).toHaveLength(1)
  }, 90_000)

  test("verify-batch never deadlocks with a single verify / reject or another batch (ruling E10): no 500, no 40P01, one audit row and one event per decided item", async () => {
    const w = await world()
    const N = 6
    for (let round = 0; round < 4; round++) {
      const ts: Json[] = []
      for (let i = 0; i < N; i++) ts.push(await submitted(w))
      const vs = await Promise.all(ts.map((t) => versionOf(w, t.id)))
      const items = (order: number[]) => ({ items: order.map((i) => ({ taskId: ts[i].id, version: vs[i] })) })
      const fwd = ts.map((_, i) => i)
      const calls = [
        w.req("POST", "/v1/evidence/verify-batch", w.ops, items(fwd)),
        w.req("POST", "/v1/evidence/verify-batch", w.owner, items([...fwd].reverse())), // overlapping, opposite order
        // a single verify or reject of EVERY batched task, racing the batches
        ...ts.map((t, i) => (i % 2 ? w.req("POST", `/v1/tasks/${t.id}/verify`, w.owner, { version: vs[i] }) : w.req("POST", `/v1/tasks/${t.id}/reject`, w.ops, { version: vs[i], reason: "No" }))),
      ]
      const res = await Promise.all(calls)
      for (const r of res) expect(r.status, await r.clone().text()).toBeLessThan(500)
      for (const r of res.slice(0, 2)) expect(r.status).toBe(200)
      // each task was decided exactly once: its audit row, its event and its status agree
      for (const t of ts) {
        const st = await statusOf(w, t.id)
        expect(["completed", "changes_requested"]).toContain(st)
        const au = await w.q<{ action: string }>("select action from audit_events where entity_id = $1 and action in ('task.evidence_verified','task.evidence_rejected')", [t.id])
        expect(au).toHaveLength(1)
        expect(au[0].action).toBe(st === "completed" ? "task.evidence_verified" : "task.evidence_rejected")
        const ev = await w.q("select 1 from domain_events where payload->>'taskId' = $1 and type in ('task.evidence_verified','task.evidence_rejected')", [t.id])
        expect(ev).toHaveLength(1)
      }
    }
  }, 300_000)

  test("the assignee adding evidence while a reviewer decides: the item never slips in unreviewed (409 evidence_locked once submitted)", async () => {
    const w = await world()
    const t = await submitted(w)
    const v = await versionOf(w, t.id)
    const [add, ver] = await Promise.all([addEv(w, w.staff, t.id, { kind: "note", text: "late extra" }), w.req("POST", `/v1/tasks/${t.id}/verify`, w.ops, { version: v })])
    expect(ver.status).toBe(200)
    expect(add.status).toBe(409)
    expect(await code(add)).toBe("evidence_locked")
    expect((await evRows(w, t.id)).filter((e) => e.review === "pending")).toHaveLength(0)
  }, 60_000)
})

describe("batch, gallery, isolation", () => {
  test("verify-batch verifies the allowed items and reports self_verification for the rest, without rolling back the others", async () => {
    const w = await world()
    const ok1 = await submitted(w)
    const mine = await submitted(w, { others: [w.ops.userId] })
    const stale = await submitted(w)
    const ok2 = await submitted(w)
    const r = await w.req("POST", "/v1/evidence/verify-batch", w.ops, {
      items: [
        { taskId: ok1.id, version: await versionOf(w, ok1.id) },
        { taskId: mine.id, version: await versionOf(w, mine.id) },
        { taskId: stale.id, version: 1 },
        { taskId: NIL, version: 1 },
        { taskId: ok2.id, version: await versionOf(w, ok2.id) },
      ],
    })
    expect(r.status, await r.clone().text()).toBe(200)
    const out = (await w.json(r)).items as Json[]
    expect(out.map((i) => [i.status, i.code])).toEqual([["verified", undefined], ["failed", "self_verification"], ["failed", "version_conflict"], ["failed", "task_not_found"], ["verified", undefined]])
    expect(await statusOf(w, ok1.id)).toBe("completed")
    expect(await statusOf(w, ok2.id)).toBe("completed")
    expect(await statusOf(w, mine.id)).toBe("submitted")
    expect((await w.q("select count(*)::int n from audit_events where action = 'task.evidence_verified'"))[0].n).toBe(2)
    // a key cannot batch-verify; more than 50 items is a 400
    const key = await makeApiKey(w.deps, w.tenant.id, w.owner.userId, ["tasks:write"])
    const viaKey = await call(w.app, "POST", "/v1/evidence/verify-batch", { headers: { authorization: `Bearer ${key.key}` }, body: { items: [{ taskId: stale.id, version: 1 }] } })
    expect(await code(viaKey)).toBe("human_required")
    const many = Array.from({ length: 51 }, () => ({ taskId: stale.id, version: 1 }))
    expect((await w.req("POST", "/v1/evidence/verify-batch", w.ops, { items: many })).status).toBe(400)
  }, 120_000)

  test("gallery lists awaiting items of the manager's scope for a tenant-local day only; staff see only their own scope; verified and rejected states", async () => {
    const w = await world({ timezone: "Pacific/Auckland" }) // UTC+13: the clock (09:00Z) is 22:00 on the 16th locally
    await w.manages(w.manager, w.staff)
    const t1 = await submitted(w)
    w.clock.advance({ hours: 3 }) // 12:00Z = 01:00 on the 17th locally
    const t2 = await submitted(w, { primary: w.staff2.userId }) // not the manager's report
    const ids = (r: Json) => (r.items as Json[]).map((i) => i.taskId)
    const get = async (path: string, as: Who) => w.json(await w.req("GET", path, as))
    expect(ids(await get("/v1/evidence?date=2026-11-16", w.ops))).toEqual([t1.id])
    expect(ids(await get("/v1/evidence?date=2026-11-17", w.ops))).toEqual([t2.id])
    expect((await get("/v1/evidence", w.ops)).items).toHaveLength(2)
    // team-scope manager: only their report's task; staff: only their own scope
    expect(ids(await get("/v1/evidence", w.manager))).toEqual([t1.id])
    expect(ids(await get("/v1/evidence", w.staff))).toEqual([t1.id])
    expect(ids(await get("/v1/evidence", w.staff2))).toEqual([t2.id])
    expect((await get(`/v1/evidence?teamId=${NIL}`, w.ops)).items).toEqual([])
    await verify(w, w.owner, t1.id)
    expect(ids(await get("/v1/evidence?state=verified", w.ops))).toEqual([t1.id])
    expect(ids(await get("/v1/evidence", w.ops))).toEqual([t2.id])
    await reject(w, w.owner, t2.id)
    expect(ids(await get("/v1/evidence?state=rejected", w.ops))).toEqual([t2.id])
    expect((await get("/v1/evidence?state=verified&limit=1", w.ops)).nextCursor).toBeNull()
    expect((await w.req("GET", "/v1/evidence?cursor=%25%25", w.ops)).status).toBe(400)
    // an archived task leaves the gallery
    expect((await w.req("POST", `/v1/tasks/${t1.id}/archive`, w.ops, { version: await versionOf(w, t1.id) })).status).toBe(200)
    expect(ids(await get("/v1/evidence?state=verified", w.ops))).toEqual([])
  }, 120_000)

  test("evidence ids: A's task with another task's evidenceId → 404 evidence_not_found; B's file id in the body → 404 file_not_found; B cannot reach A's items; list filter by evidence state", async () => {
    const w = await world()
    const t = await w.mk(w.ops, { evidenceRule: rule() })
    const other = await w.mk(w.ops, { evidenceRule: rule() })
    const mine = await note(w, w.staff, t.id)
    const theirs = await note(w, w.staff, other.id)
    expect(await code(await w.req("DELETE", `/v1/tasks/${t.id}/evidence/${theirs.id}`, w.staff))).toBe("evidence_not_found")
    expect(await code(await w.req("GET", `/v1/tasks/${t.id}/evidence/${theirs.id}/download`, w.ops))).toBe("evidence_not_found")
    await complete(w, w.staff, t.id)
    expect(await code(await verify(w, w.ops, t.id, { evidenceIds: [theirs.id] }))).toBe("evidence_not_found")
    expect(await code(await reject(w, w.ops, t.id, { evidenceIds: [theirs.id] }))).toBe("evidence_not_found")
    expect((await evRows(w, t.id))[0].review).toBe("pending")
    // another tenant: its file id is just as unknown, and A's task id is a 404 for B's owner
    const bravo = await makeTenant(w.deps, { slug: "bravo" })
    const ob = await makeMember(w.deps, bravo.id, "owner")
    const oc = (await signIn(w.app, ob.email, ob.password)).cookie
    const bt = await w.json(await call(w.app, "POST", "/v1/tasks", { cookie: oc, tenant: "bravo", body: { ...w.base({ primary: ob.userId }), evidenceRule: rule() } }))
    const bf = await w.json(await call(w.app, "POST", `/v1/tasks/${bt.id}/uploads`, { cookie: oc, tenant: "bravo", body: { purpose: "evidence", name: "b.pdf", mime: "application/pdf", sizeBytes: 5 } }))
    expect(await code(await addEv(w, w.staff, other.id, { kind: "pdf", fileId: bf.fileId }))).toBe("file_not_found")
    expect(await code(await call(w.app, "DELETE", `/v1/tasks/${t.id}/evidence/${mine.id}`, { cookie: oc, tenant: "bravo" }))).toBe("task_not_found")
    expect(await code(await call(w.app, "POST", `/v1/tasks/${t.id}/verify`, { cookie: oc, tenant: "bravo", body: { version: 1 } }))).toBe("task_not_found")
    // list filter by evidence state
    const lf = async (s: string) => ((await w.json(await w.req("GET", `/v1/tasks?evidence=${s}`, w.ops))).items as Json[]).map((i) => i.id)
    expect(await lf("awaiting")).toContain(t.id)
    const empty = await w.mk(w.ops, { evidenceRule: rule() })
    expect(await lf("missing")).toContain(empty.id)
    expect(await lf("missing")).not.toContain(other.id)
    await verify(w, w.owner, t.id)
    expect(await lf("verified")).toEqual([t.id])
    expect(await lf("awaiting")).not.toContain(t.id)
  }, 120_000)
})

describe("audit and events", () => {
  test("verify and reject are audited in the same tx with ids only; events task.evidence_verified/rejected carry ids only; the reason is a comment, not in the audit", async () => {
    const w = await world()
    const t = await submitted(w)
    const secret = "Mary O'Neill 12 Main St"
    await w.q("update task_evidence set text = $1 where task_id = $2", [secret, t.id])
    const items = await evRows(w, t.id)
    expect((await verify(w, w.ops, t.id)).status).toBe(200)
    const t2 = await submitted(w)
    const items2 = await evRows(w, t2.id)
    expect((await reject(w, w.owner, t2.id, { reason: `Please redo ${secret}` })).status).toBe(200)
    await relay(w)
    const audit = await w.q<{ action: string; entity: string; entity_id: string; actor_id: string; before: Json; after: Json }>("select action, entity, entity_id, actor_id, before, after from audit_events where action like 'task.evidence_%' order by seq")
    expect(audit.map((a) => [a.action, a.entity, a.entity_id, a.actor_id])).toEqual([
      ["task.evidence_verified", "task", t.id, w.ops.userId],
      ["task.evidence_rejected", "task", t2.id, w.owner.userId],
    ])
    expect(audit[0].after).toMatchObject({ ref: t.ref, status: "completed", evidenceIds: [items[0].id] })
    expect(audit[1].after).toMatchObject({ ref: t2.ref, status: "changes_requested", evidenceIds: [items2[0].id] })
    expect(JSON.stringify(audit)).not.toMatch(/Mary|Main St|secret-name|Please redo/)
    const events = await w.q<{ type: string; payload: Json }>("select type, payload from domain_events where type in ('task.evidence_verified','task.evidence_rejected') order by type desc")
    expect(events).toEqual([
      { type: "task.evidence_verified", payload: { taskId: t.id, evidenceIds: [items[0].id] } },
      { type: "task.evidence_rejected", payload: { taskId: t2.id, evidenceIds: [items2[0].id], round: 1 } },
    ])
    // the assignee is told, the actor is not
    const notes = await w.q<{ user_id: string; title: string }>("select user_id, title from notifications where kind = 'task' and title in ('Evidence verified','Evidence rejected')")
    expect(notes.map((n) => [n.user_id, n.title]).sort()).toEqual([[w.staff.userId, "Evidence rejected"], [w.staff.userId, "Evidence verified"]])
    // the history lines carry no reason text
    const hist = await w.json(await w.req("GET", `/v1/tasks/${t2.id}/history`, w.ops))
    expect(JSON.stringify(hist)).not.toContain("Please redo")
  }, 90_000)

  test("DSR: export lists the subject's evidence metadata only; erase nulls created_by and reviewed_by and keeps the items", async () => {
    const w = await world()
    const t = await submitted(w)
    await verify(w, w.ops, t.id)
    const exp = await withTenant(w.deps.db, w.tenant.id, (tx) => tasksDsrHandler.export(tx, w.tenant.id, w.staff.userId))
    expect(exp.evidence).toHaveLength(1)
    expect(Object.keys((exp.evidence as Json[])[0]).sort()).toEqual(["at", "id", "kind", "review", "taskId"])
    const expOps = await withTenant(w.deps.db, w.tenant.id, (tx) => tasksDsrHandler.export(tx, w.tenant.id, w.ops.userId))
    expect((expOps.evidence as Json[]).length).toBe(1) // reviewed by ops
    await withTenant(w.deps.db, w.tenant.id, (tx) => tasksDsrHandler.erase(tx, w.tenant.id, w.staff.userId, w.clock.now()))
    await withTenant(w.deps.db, w.tenant.id, (tx) => tasksDsrHandler.erase(tx, w.tenant.id, w.ops.userId, w.clock.now()))
    const rows = await evRows(w, t.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ created_by: null, reviewed_by: null, review: "accepted" })
  }, 60_000)
})

describe("purge, grants, query plans", () => {
  test("purging a task with evidence and files works as app_user (cascade) and queues the files for deletion", async () => {
    const w = await world()
    const t = await w.mk(w.ops, { evidenceRule: rule() })
    const it = await pdf(w, w.staff, t.id)
    await note(w, w.staff, t.id)
    const fileId = (await w.q("select file_id from task_evidence where id = $1", [it.id]))[0].file_id as string
    expect((await w.q("select 1 from task_files where file_id = $1", [fileId])).length).toBe(1) // registered, so the purge sees it
    expect((await w.req("POST", `/v1/tasks/${t.id}/archive`, w.ops, { version: await versionOf(w, t.id) })).status).toBe(200)
    w.queue.jobs.length = 0
    const r = await w.req("DELETE", `/v1/tasks/${t.id}`, w.owner)
    expect(r.status, await r.clone().text()).toBe(204)
    expect((await w.q("select count(*)::int n from task_evidence where task_id = $1", [t.id]))[0].n).toBe(0)
    expect((await w.q("select status from files where id = $1", [fileId]))[0].status).toBe("deleted")
    expect(w.queue.jobs.some((j) => j.name === "file.delete-object" && (j.data as Json).fileId === fileId)).toBe(true)
  }, 90_000)

  test("grants are minimal: no UPDATE on identity, kind, file, text, url or capture columns; RLS is forced and blocks other tenants", async () => {
    const tbl = async (t: string) => (await ownerQuery(`select privilege_type from information_schema.role_table_grants where grantee = 'app_user' and table_name = $1 order by 1`, [t])).map((r) => r.privilege_type)
    const col = async (t: string) => (await ownerQuery(`select column_name from information_schema.column_privileges where grantee = 'app_user' and table_name = $1 and privilege_type = 'UPDATE' order by 1`, [t])).map((r) => r.column_name)
    expect(await tbl("task_evidence")).toEqual(["DELETE", "INSERT", "SELECT"])
    expect(await col("task_evidence")).toEqual(["created_by", "locked_at", "reason", "review", "reviewed_at", "reviewed_by", "round"])
    const rls = await ownerQuery(`select relrowsecurity, relforcerowsecurity from pg_class where relname = 'task_evidence'`)
    expect(rls[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true })
    const w = await world()
    const t = await w.mk(w.ops, { evidenceRule: rule() })
    await note(w, w.staff, t.id)
    const other = await makeTenant(w.deps, { slug: "bravo" })
    const res = await withTenant(w.deps.db, other.id, (tx) => tx.execute(sql`delete from task_evidence where task_id = ${t.id}`))
    expect((res as { rowCount?: number }).rowCount ?? 0).toBe(0)
    const err = await withTenant(w.deps.db, other.id, (tx) => tx.execute(sql`insert into task_evidence (tenant_id, task_id, round, kind, text, review, created_by, created_at) values (${w.tenant.id}, ${t.id}, 1, 'note', 'x', 'pending', 'x', now())`)).catch((e) => e)
    expect(String((err as { cause?: { message?: string } }).cause?.message ?? err)).toMatch(/row-level security/)
  }, 60_000)

  test("DB checks: a file kind needs a file, a note needs text, a drive item needs a url, text is at most 2000 characters", async () => {
    const w = await world()
    const t = await w.mk(w.ops, { evidenceRule: rule() })
    const ins = (kind: string, text: string | null, url: string | null) =>
      w.q(`insert into task_evidence (tenant_id, task_id, round, kind, text, url, review, created_by, created_at) values ($1, $2, 1, $3, $4, $5, 'pending', 'x', now())`, [w.tenant.id, t.id, kind, text, url])
    await expect(ins("pdf", "x", null)).rejects.toThrow(/check/)
    await expect(ins("note", null, "x")).rejects.toThrow(/check/)
    await expect(ins("drive", "x", null)).rejects.toThrow(/check/)
    await expect(ins("note", "x".repeat(2001), null)).rejects.toThrow(/check/)
    await ins("note", "ok", null)
  }, 60_000)

  test("gallery query uses task_evidence_gallery_idx (EXPLAIN at 10k items) and the endpoints stay fast", async () => {
    const w = await world()
    await w.mk(w.owner)
    // a realistic spread: 2000 live tasks, 10 000 items over them (a lone task would let the planner pick the per-task index instead)
    await w.q(
      `insert into tasks (tenant_id, ref_no, title, evidence_rule, status, start_at, due_at, created_at, updated_at, creator_id)
       select $1::uuid, 2000 + g, 'Seed ' || g, $2::jsonb, 'submitted', now(), now() + (g || ' minutes')::interval, now(), now(), $3 from generate_series(1, 2000) g`,
      [w.tenant.id, JSON.stringify(rule()), w.owner.userId],
    )
    await w.q(
      `insert into task_evidence (tenant_id, task_id, round, kind, text, review, created_by, created_at)
       select $1::uuid, (select id from tasks where tenant_id = $1 and ref_no = 2001 + (g % 2000)), 1, 'note', 'n' || g, (array['pending','accepted','rejected'])[1 + g % 3], $2, now() - (g || ' minutes')::interval from generate_series(1, 10000) g`,
      [w.tenant.id, w.owner.userId],
    )
    await ownerQuery("vacuum analyze tasks")
    await ownerQuery("vacuum analyze task_evidence")
    const ctx: TaskCtx = { tenantId: w.tenant.id, tz: "Europe/Dublin", me: w.owner.userId, actorId: w.owner.userId, role: null as never, scope: { kind: "all" }, reports: [], drive: true, now: w.clock.now() }
    const plan = await withTenant(w.deps.db, w.tenant.id, async (tx) => galleryQuery(tx, ctx, { state: "rejected" }, null, 26).toSQL())
    const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_OWNER_URL })
    await c.connect()
    try {
      await c.query("begin")
      await c.query("select set_config('app.tenant_id', $1, true)", [w.tenant.id])
      const rows = (await c.query(`explain ${plan.sql}`, plan.params as unknown[])).rows.map((r) => r["QUERY PLAN"] as string).join("\n")
      await c.query("rollback")
      expect(rows).toContain("task_evidence_gallery_idx")
      expect(rows).not.toMatch(/Seq Scan on task_evidence/)
    } finally {
      await c.end()
    }
    const t0 = Date.now()
    expect((await w.req("GET", "/v1/evidence?state=rejected", w.owner)).status).toBe(200)
    expect((await w.req("GET", "/v1/tasks?evidence=verified", w.owner)).status).toBe(200)
    expect(Date.now() - t0).toBeLessThan(5000)
  }, 120_000)
})
