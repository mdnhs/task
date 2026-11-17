import { readFileSync } from "node:fs"
import { join } from "node:path"
import { sql } from "drizzle-orm"
import pg from "pg"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { ownerQuery, ownerTenantQuery } from "../../../test/db"
import { makeApiKey, makeMember, makeStaff, makeTenant, signIn } from "../../../test/factories"
import { call, resetDb, testApp, testEnv } from "../../../test/harness"
import { resetSubscribers } from "../../core/events"
import { runJob } from "../../core/queue/queue"
import { withTenant } from "../../db/tenant-tx"
import { registerFiles } from "../files"
import { registerNotifications } from "../notifications"
import { registerSearchIndexers } from "../search"
import { playsQuery, registerTasks, tasksDsrHandler, type TaskCtx } from "."

// T4.7: voice instructions on tasks (ruling D21). Rulings D4, D9, D10, D13, D19, D21, D22.

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Who = { userId: string; email: string; password: string; cookie: string }
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
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

async function world(over: { env?: Partial<typeof testEnv> } = {}) {
  const t = testApp(over.env ? { env: { ...testEnv, ...over.env } } : {})
  const tenant = await makeTenant(t.deps, { slug: "acme", sessionIdleHours: 2160 })
  await ownerQuery("update tenants set timezone = 'Europe/Dublin' where id = $1", [tenant.id])
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
  const base = (o: Json = {}) => ({ title: "Check fire exits", description: "Walk every floor.", priority: 2, start: "2026-11-16T08:00:00", due: "2026-11-16T09:00:00", primary: staff.userId, ...o })
  const mk = async (as: Who, o: Json = {}) => {
    const r = await req("POST", "/v1/tasks", as, base(o))
    expect(r.status, await r.clone().text()).toBe(201)
    return json(r)
  }
  const q = <R = Json>(sqlText: string, params: unknown[] = []) => ownerTenantQuery(tenant.id, sqlText, params) as Promise<R[]>
  return { ...t, tenant, who, owner, manager, ops, staff, staff2, req, json, base, mk, q }
}
type W = Awaited<ReturnType<typeof world>>
const code = async (r: Response) => ((await r.clone().json()) as Json).code as string
const versionOf = async (w: W, id: string) => (await w.q("select version from tasks where id = $1", [id]))[0].version as number
const drain = async (w: W) => {
  for (let i = 0; i < 6 && w.queue.jobs.length > 0; i++) for (const j of w.queue.jobs.splice(0)) await runJob(j.name, j.data, w.deps)
}
const status = async (w: W, fileId: string) => (await w.q("select status from files where id = $1", [fileId]))[0].status as string
const objectOf = async (w: W, fileId: string) => w.deps.storage.head(((await w.q("select key from files where id = $1", [fileId]))[0] as { key: string }).key)

/** Intent → browser-style PUT → complete → scan. Returns the file id (scanned unless `scan` is false). */
async function voiceFile(w: W, as: Who, taskId: string, o: { mime?: string; content?: string; scan?: boolean } = {}) {
  const buf = Buffer.from(o.content ?? "voice bytes")
  const r = await w.req("POST", `/v1/tasks/${taskId}/uploads`, as, { purpose: "voice", name: "secret-voice-name.webm", mime: o.mime ?? "audio/webm;codecs=opus", sizeBytes: buf.length })
  expect(r.status, await r.clone().text()).toBe(201)
  const j = await w.json(r)
  const { "Content-Length": _len, ...headers } = j.upload.headers as Record<string, string>
  expect((await fetch(j.upload.url, { method: "PUT", headers, body: buf })).status).toBe(200)
  expect((await w.req("POST", `/v1/tasks/${taskId}/uploads/${j.fileId}/complete`, as)).status).toBe(200)
  if (o.scan !== false) await drain(w)
  return j.fileId as string
}
const put = async (w: W, as: Who, taskId: string, fileId: string, o: Json = {}) => w.req("PUT", `/v1/tasks/${taskId}/voice-note`, as, { version: await versionOf(w, taskId), fileId, durationSec: 30, ...o })
const del = async (w: W, as: Who, taskId: string, o: Json = {}) => w.req("DELETE", `/v1/tasks/${taskId}/voice-note`, as, { version: await versionOf(w, taskId), ...o })
const play = (w: W, as: Who, taskId: string) => w.req("GET", `/v1/tasks/${taskId}/voice-note`, as)
const plays = (w: W, taskId: string) => w.q("select user_id, task_id, file_id, at from task_voice_access where task_id = $1 order by at, id", [taskId])
/** A task with a clean voice note set by `as` (the manager, ops by default). */
async function withVoice(w: W, o: { as?: Who; task?: Json } = {}) {
  const as = o.as ?? w.ops
  const t = await w.mk(as, o.task)
  const fileId = await voiceFile(w, as, t.id)
  const r = await put(w, as, t.id, fileId)
  expect(r.status, await r.clone().text()).toBe(200)
  return { t, fileId, dto: await w.json(r) }
}
/** A daily series carrying a voice note, plus its first instance (created by the recurrence job, which copies the series' file). */
async function series(w: W) {
  const { t, fileId } = await withVoice(w)
  expect((await w.req("PUT", `/v1/tasks/${t.id}/repeat`, w.ops, { version: await versionOf(w, t.id), rule: { freq: "daily" } })).status).toBe(200)
  w.clock.advance({ days: 1 })
  await runJob("tasks.recurrence", {}, w.deps)
  const inst = (await w.q<{ id: string; voice_file_id: string }>("select id, voice_file_id from tasks where series_id = $1", [t.id]))[0]
  expect(inst.voice_file_id).toBe(fileId)
  return { s: t, inst, fileId }
}

describe("set, limits and the task DTO", () => {
  test("declared durationSec 121 → 422 voice_too_long (and 0 is a 400); size over TASK_VOICE_MAX_BYTES → 422 file_too_large; audio/webm;codecs=opus is stored as audio/webm", async () => {
    const w = await world({ env: { TASK_VOICE_MAX_BYTES: 3000 } })
    const t = await w.mk(w.ops)
    const big = await w.req("POST", `/v1/tasks/${t.id}/uploads`, w.ops, { purpose: "voice", name: "v.webm", mime: "audio/webm", sizeBytes: 3001 })
    expect(await code(big)).toBe("file_too_large")
    const f = await voiceFile(w, w.ops, t.id) // content type sent with codecs → stored bare
    expect((await w.q("select mime from files where id = $1", [f]))[0].mime).toBe("audio/webm")
    const long = await put(w, w.ops, t.id, f, { durationSec: 121 })
    expect(long.status).toBe(422)
    expect(await code(long)).toBe("voice_too_long")
    expect((await put(w, w.ops, t.id, f, { durationSec: 0 })).status).toBe(400)
    expect((await w.q("select voice_file_id from tasks where id = $1", [t.id]))[0].voice_file_id).toBeNull()
    const ok = await put(w, w.ops, t.id, f, { durationSec: 120 })
    expect(ok.status, await ok.clone().text()).toBe(200)
    const dto = await w.json(ok)
    expect(dto.voiceNote).toEqual({ durationSec: 120, mime: "audio/webm", recordedBy: w.ops.userId, recordedAt: w.clock.now().toISOString() })
    expect(dto.version).toBe(2) // a voice change is a task-field change: it bumps the version (D4)
    expect(JSON.stringify(dto)).not.toContain(f) // the file id never reaches the task DTO
    // the DTO of the detail and the list carry it for everyone who sees the task
    const asStaff = await w.json(await w.req("GET", `/v1/tasks/${t.id}`, w.staff))
    expect(asStaff.voiceNote).toMatchObject({ durationSec: 120, mime: "audio/webm" })
    const list = await w.json(await w.req("GET", "/v1/tasks", w.staff))
    expect((list.items as Json[]).find((i) => i.id === t.id)!.voiceNote).toMatchObject({ durationSec: 120 })
  }, 60_000)

  test("a stale version is 409 version_conflict; an archived task is 409 task_archived; a file that is not a clean voice file of THIS task is refused", async () => {
    const w = await world()
    const t = await w.mk(w.ops)
    const f = await voiceFile(w, w.ops, t.id)
    expect(await code(await put(w, w.ops, t.id, f, { version: 7 }))).toBe("version_conflict")
    // another task's voice file, and a made-up id: 404 file_not_found, the same answer
    const other = await w.mk(w.ops)
    const otherFile = await voiceFile(w, w.ops, other.id)
    expect(await code(await put(w, w.ops, t.id, otherFile))).toBe("file_not_found")
    expect(await code(await put(w, w.ops, t.id, NIL))).toBe("file_not_found")
    // an attachment of this very task is no voice file
    const buf = Buffer.from("pdf")
    const att = await w.json(await w.req("POST", `/v1/tasks/${t.id}/uploads`, w.ops, { purpose: "attachment", name: "a.pdf", mime: "application/pdf", sizeBytes: buf.length }))
    expect(await code(await put(w, w.ops, t.id, att.fileId))).toBe("file_not_found")
    expect((await put(w, w.ops, t.id, f)).status).toBe(200)
    expect((await w.req("POST", `/v1/tasks/${t.id}/archive`, w.ops, { version: await versionOf(w, t.id) })).status).toBe(200)
    expect(await code(await del(w, w.ops, t.id))).toBe("task_archived")
  }, 60_000)

  test("scan gate: a voice file that is still scanning is 409 file_not_ready, an infected one 410 file_infected; neither can be attached", async () => {
    const w = await world()
    const t = await w.mk(w.ops)
    const pending = await voiceFile(w, w.ops, t.id, { scan: false })
    const r = await put(w, w.ops, t.id, pending)
    expect(r.status).toBe(409)
    expect(await code(r)).toBe("file_not_ready")
    await drain(w)
    expect((await put(w, w.ops, t.id, pending)).status).toBe(200)
    const bad = await voiceFile(w, w.ops, t.id, { content: EICAR })
    expect(await status(w, bad)).toBe("infected")
    const inf = await put(w, w.ops, t.id, bad)
    expect(inf.status).toBe(410)
    expect(await code(inf)).toBe("file_infected")
    // playing: a note whose file is not clean is never served (and nothing is logged)
    await w.q("update files set status = 'pending' where id = $1", [pending])
    expect(await code(await play(w, w.staff, t.id))).toBe("file_not_ready")
    await w.q("update files set status = 'infected', signature = 'Test.Signature' where id = $1", [pending])
    expect(await code(await play(w, w.staff, t.id))).toBe("file_infected")
    expect(await plays(w, t.id)).toHaveLength(0)
  }, 60_000)

  test("only the creator or a manager sets or clears it; an assignee who is neither gets 403 forbidden but can play; out of scope is 404", async () => {
    const w = await world()
    const t = await w.mk(w.ops) // creator ops, assignee staff
    const fOps = await voiceFile(w, w.ops, t.id)
    // the assignee cannot even upload a voice file (T4.2), nor set or delete
    expect((await w.req("POST", `/v1/tasks/${t.id}/uploads`, w.staff, { purpose: "voice", name: "v.webm", mime: "audio/webm", sizeBytes: 5 })).status).toBe(403)
    expect(await code(await put(w, w.staff, t.id, fOps))).toBe("forbidden")
    expect((await put(w, w.ops, t.id, fOps)).status).toBe(200)
    expect(await code(await del(w, w.staff, t.id))).toBe("forbidden")
    expect((await play(w, w.staff, t.id)).status).toBe(302)
    // out of scope: 404 task_not_found on every verb
    for (const r of [await play(w, w.staff2, t.id), await put(w, w.staff2, t.id, fOps), await del(w, w.staff2, t.id)]) {
      expect(r.status).toBe(404)
      expect(await code(r)).toBe("task_not_found")
    }
    // a staff CREATOR of a task for themselves may set and clear their own
    const mine = await w.mk(w.staff, { primary: w.staff.userId })
    const fMine = await voiceFile(w, w.staff, mine.id)
    expect((await put(w, w.staff, mine.id, fMine)).status).toBe(200)
    expect((await del(w, w.staff, mine.id)).status).toBe(200)
    // a team-scope manager acts on a task of a direct report; a plain team manager with no relation gets 404
    const other = await w.mk(w.owner)
    await w.q("update tasks set creator_id = $2 where id = $1", [other.id, w.owner.userId])
    expect(await code(await del(w, w.manager, other.id))).toBe("task_not_found")
  }, 90_000)
})

describe("playing and the access log", () => {
  test("anyone who can see the task plays it: 302 to a 60 s presigned GET, no-store, one log row per play with the user and the clock time; no note → 404 voice_note_not_found", async () => {
    const w = await world()
    const t = await w.mk(w.ops)
    expect(await code(await play(w, w.staff, t.id))).toBe("voice_note_not_found")
    const f = await voiceFile(w, w.ops, t.id)
    expect((await put(w, w.ops, t.id, f)).status).toBe(200)
    const r = await play(w, w.staff, t.id)
    expect(r.status).toBe(302)
    expect(r.headers.get("cache-control")).toBe("no-store")
    const url = r.headers.get("location")!
    expect(url).toMatch(/X-Amz-Expires=60\b/)
    expect(url).not.toContain("secret-voice-name") // no file name in the URL
    expect(await (await fetch(url)).text()).toBe("voice bytes")
    expect(await plays(w, t.id)).toHaveLength(1)
    w.clock.advance({ minutes: 5 })
    expect((await play(w, w.ops, t.id)).status).toBe(302) // the creator's own play is logged too
    const rows = await plays(w, t.id)
    expect(rows.map((x) => x.user_id)).toEqual([w.staff.userId, w.ops.userId])
    expect(rows.every((x) => x.file_id === f && x.task_id === t.id)).toBe(true)
    expect((rows[1].at as Date).toISOString()).toBe(w.clock.now().toISOString())
    // a play that fails (task out of scope) leaves no row
    expect((await play(w, w.staff2, t.id)).status).toBe(404)
    expect(await plays(w, t.id)).toHaveLength(2)
  }, 60_000)

  test("the generic task file download cannot serve a voice file (404 file_not_found, no log row); the voice route is the only way", async () => {
    const w = await world()
    const { t, fileId } = await withVoice(w)
    for (const as of [w.ops, w.staff]) {
      const r = await w.req("GET", `/v1/tasks/${t.id}/files/${fileId}/download`, as)
      expect(r.status).toBe(404)
      expect(await code(r)).toBe("file_not_found")
    }
    expect(await plays(w, t.id)).toHaveLength(0)
    expect((await w.req("GET", `/v1/files/${fileId}/download`, w.ops)).status).toBe(404) // and the B2 file routes never saw task files
    // the voice file is not usable as an evidence or comment attachment either
    const c = await w.req("POST", `/v1/tasks/${t.id}/comments`, w.ops, { body: "x", attachmentFileIds: [fileId] })
    expect(c.status).toBe(422)
  }, 60_000)

  test("the play log is readable by managers of the task only (404 out of scope, 403 for an assignee); keyset paging; erased players show as Former member", async () => {
    const w = await world()
    const { t } = await withVoice(w)
    for (let i = 0; i < 3; i++) {
      w.clock.advance({ minutes: 1 })
      expect((await play(w, i === 2 ? w.ops : w.staff, t.id)).status).toBe(302)
    }
    expect(await code(await w.req("GET", `/v1/tasks/${t.id}/voice-note/plays`, w.staff))).toBe("forbidden")
    expect(await code(await w.req("GET", `/v1/tasks/${t.id}/voice-note/plays`, w.staff2))).toBe("task_not_found")
    const p1 = await w.json(await w.req("GET", `/v1/tasks/${t.id}/voice-note/plays?limit=2`, w.ops))
    expect(p1.items).toHaveLength(2)
    expect(p1.items[0]).toMatchObject({ userId: w.ops.userId }) // newest first
    expect(p1.nextCursor).toBeTruthy()
    const p2 = await w.json(await w.req("GET", `/v1/tasks/${t.id}/voice-note/plays?limit=2&cursor=${p1.nextCursor}`, w.ops))
    expect(p2.items).toHaveLength(1)
    expect(p2.nextCursor).toBeNull()
    expect((await w.req("GET", `/v1/tasks/${t.id}/voice-note/plays?cursor=zzz`, w.ops)).status).toBe(400)
    // nothing about plays reaches the task DTO or its history
    const dto = JSON.stringify(await w.json(await w.req("GET", `/v1/tasks/${t.id}`, w.ops)))
    expect(dto).not.toMatch(/plays|voice_access|playedBy/i)
    // a manager outside the task's scope (team manager, no relation) is 404, not 403
    expect(await code(await w.req("GET", `/v1/tasks/${t.id}/voice-note/plays`, w.manager))).toBe("task_not_found")
  }, 60_000)

  test("an API key acts with its creator's scope; the play is logged as apikey:<id>; a key cannot play a task its creator cannot see", async () => {
    const w = await world()
    const { t } = await withVoice(w)
    const key = await makeApiKey(w.deps, w.tenant.id, w.staff.userId, ["tasks:read"])
    const r = await call(w.app, "GET", `/v1/tasks/${t.id}/voice-note`, { headers: { authorization: `Bearer ${key.key}` } })
    expect(r.status, await r.clone().text()).toBe(302)
    expect((await plays(w, t.id)).map((x) => x.user_id)).toEqual([`apikey:${key.id}`])
    const other = await makeApiKey(w.deps, w.tenant.id, w.staff2.userId, ["tasks:read"])
    const no = await call(w.app, "GET", `/v1/tasks/${t.id}/voice-note`, { headers: { authorization: `Bearer ${other.key}` } })
    expect(await code(no)).toBe("task_not_found")
    // a write key minted by the creator sets and clears; the history actor is the key, recordedBy the creator (whose note it is)
    const wk = await makeApiKey(w.deps, w.tenant.id, w.ops.userId, ["tasks:write", "tasks:read"])
    const f2 = await voiceFile(w, w.ops, t.id)
    w.clock.advance({ minutes: 1 }) // history lines are ordered by instant: the key's line is the newest
    const set = await call(w.app, "PUT", `/v1/tasks/${t.id}/voice-note`, { headers: { authorization: `Bearer ${wk.key}` }, body: { version: await versionOf(w, t.id), fileId: f2, durationSec: 9 } })
    expect(set.status, await set.clone().text()).toBe(200)
    expect((await w.json(set)).voiceNote.recordedBy).toBe(w.ops.userId)
    const [h] = await w.q("select actor_id from task_history where task_id = $1 and kind = 'voice' order by at desc, id desc limit 1", [t.id])
    expect(h.actor_id).toBe(`apikey:${wk.id}`)
  }, 60_000)

  test("ruling E11: a support grant cannot play a voice note (403 support_forbidden_route, audited, no log row) nor read the plays; other task reads still work; API keys are not deny-listed (deliberate)", async () => {
    const w = await world()
    const { t } = await withVoice(w)
    const staff = await makeStaff(w.deps, "support")
    const g = await call(w.app, "POST", `/v1/platform/tenants/${w.tenant.id}/support-grants`, { cookie: staff.cookie, body: { reason: "Ticket 4411: report totals look wrong", hours: 2 } })
    expect(g.status, await g.clone().text()).toBe(201)
    const as = (path: string) => call(w.app, "GET", path, { cookie: staff.cookie, tenant: "acme" })
    const r = await as(`/v1/tasks/${t.id}/voice-note`)
    expect(r.status).toBe(403)
    expect(await code(r)).toBe("support_forbidden_route")
    expect(r.headers.get("location")).toBeNull()
    expect(await plays(w, t.id)).toHaveLength(0)
    const denied = await w.q("select after from audit_events where action = 'support.route_denied'")
    expect(denied.map((d) => (d.after as Json).path)).toEqual([`/v1/tasks/${t.id}/voice-note`])
    // the plays list is not audio, and a support role cannot manage (read-only role): 403 forbidden, not a URL
    const pl = await as(`/v1/tasks/${t.id}/voice-note/plays`)
    expect(pl.status).toBe(403)
    // the other task reads work under the grant, and show metadata only
    const detail = await as(`/v1/tasks/${t.id}`)
    expect(detail.status).toBe(200)
    expect((await w.json(detail)).voiceNote).toMatchObject({ durationSec: 30 })
    expect((await as("/v1/tasks")).status).toBe(200)
    expect(await plays(w, t.id)).toHaveLength(0)
  }, 60_000)

  test("device policy: a voice note is audio, not a Drive link, so playing is the same on every device", async () => {
    const w = await world()
    const { t } = await withVoice(w)
    await w.q("insert into device_policies (tenant_id, feature, allow) values ($1, 'drive', 'none') on conflict (tenant_id, feature) do update set allow = 'none'", [w.tenant.id])
    expect((await play(w, w.staff, t.id)).status).toBe(302)
  }, 60_000)

  test("M1 gates every voice route (403 module_not_entitled), playing needs no M4, and nothing is deleted", async () => {
    const w = await world()
    const { t } = await withVoice(w)
    expect((await play(w, w.staff, t.id)).status).toBe(302) // the tenant has M1 only (no M4 needed)
    await w.q("insert into module_overrides (tenant_id, module, mode, reason, set_by, set_at) values ($1, 'M1', 'revoke', 'test', 'p', now())", [w.tenant.id])
    w.clock.advance({ minutes: 1 })
    for (const r of [await play(w, w.staff, t.id), await put(w, w.ops, t.id, NIL), await del(w, w.ops, t.id), await w.req("GET", `/v1/tasks/${t.id}/voice-note/plays`, w.ops)]) {
      expect(r.status).toBe(403)
      expect(await code(r)).toBe("module_not_entitled")
    }
    expect((await w.q("select voice_file_id from tasks where id = $1", [t.id]))[0].voice_file_id).not.toBeNull()
  }, 60_000)
})

describe("replace, clear and the last reference", () => {
  test("replace deletes the old file after commit; history says added/replaced/removed with no file name; each change bumps the version", async () => {
    const w = await world()
    const { t, fileId: f1 } = await withVoice(w)
    expect(await versionOf(w, t.id)).toBe(2)
    const f2 = await voiceFile(w, w.ops, t.id, { content: "second" })
    w.queue.jobs.length = 0
    const r = await put(w, w.ops, t.id, f2, { durationSec: 12 })
    expect(r.status).toBe(200)
    expect(await status(w, f1)).toBe("deleted")
    expect(await status(w, f2)).toBe("clean")
    expect(w.queue.jobs.filter((j) => j.name === "file.delete-object" && (j.data as Json).fileId === f1)).toHaveLength(1)
    await drain(w)
    expect(await objectOf(w, f1)).toBeNull()
    expect(await objectOf(w, f2)).not.toBeNull()
    expect(await versionOf(w, t.id)).toBe(3)
    // re-setting the SAME file only changes the duration; it never deletes it
    expect((await put(w, w.ops, t.id, f2, { durationSec: 13 })).status).toBe(200)
    expect(await status(w, f2)).toBe("clean")
    expect(((await w.q("select voice_meta from tasks where id = $1", [t.id]))[0].voice_meta as Json).durationSec).toBe(13)
    const c = await del(w, w.ops, t.id)
    expect(c.status).toBe(200)
    expect((await w.json(c)).voiceNote).toBeNull()
    expect(await status(w, f2)).toBe("deleted")
    expect(await code(await del(w, w.ops, t.id))).toBe("voice_note_not_found")
    const texts = (await w.q("select text, changes from task_history where task_id = $1 and kind = 'voice' order by at, id, text", [t.id])).map((h) => h.text as string)
    expect(texts.sort()).toEqual(["Voice note added", "Voice note removed", "Voice note replaced", "Voice note replaced"].sort())
    expect(JSON.stringify(await w.q("select text, changes from task_history where task_id = $1", [t.id]))).not.toContain("secret-voice-name")
    const timeline = (await w.json(await w.req("GET", `/v1/tasks/${t.id}`, w.ops))).timeline as Json[]
    expect(timeline.filter((x) => x.kind === "voice").length).toBe(4)
  }, 90_000)

  test("a recurring instance shares the series' file: replacing the series' note keeps the old file for the instance; the last clear deletes it", async () => {
    const w = await world()
    const { s, inst, fileId } = await series(w)
    const f2 = await voiceFile(w, w.ops, s.id, { content: "series v2" })
    expect((await put(w, w.ops, s.id, f2)).status).toBe(200)
    expect(await status(w, fileId)).toBe("clean") // the instance still plays it
    expect((await play(w, w.staff, inst.id)).status).toBe(302)
    // an instance created after the replace gets the NEW file (consistency)
    w.clock.advance({ days: 1 })
    await runJob("tasks.recurrence", {}, w.deps)
    const later = (await w.q<{ voice_file_id: string }>("select voice_file_id from tasks where series_id = $1 and id <> $2 order by occurrence_date desc limit 1", [s.id, inst.id]))[0]
    expect(later.voice_file_id).toBe(f2)
    // clearing the instance's note drops the last reference to the old file
    expect((await del(w, w.ops, inst.id)).status).toBe(200)
    expect(await status(w, fileId)).toBe("deleted")
    expect(await status(w, f2)).toBe("clean") // the series and the newer instance still use it
  }, 90_000)

  test("clearing the series and its instance at the same moment deletes the shared file exactly once (the purge lock makes the reference check atomic)", async () => {
    const w = await world()
    const { s, inst, fileId } = await series(w)
    w.queue.jobs.length = 0
    const [a, b] = await Promise.all([del(w, w.ops, s.id), del(w, w.ops, inst.id)])
    expect([a.status, b.status]).toEqual([200, 200])
    expect(await status(w, fileId)).toBe("deleted") // never orphaned: one of the two saw the other already gone
    expect(w.queue.jobs.filter((j) => j.name === "file.delete-object" && (j.data as Json).fileId === fileId)).toHaveLength(1)
    expect((await w.q("select count(*)::int n from tasks where voice_file_id is not null"))[0].n).toBe(0)
  }, 90_000)

  test("a recurrence run racing a replace on the series: the instance ends up with a note that exists (no dangling id)", async () => {
    const w = await world()
    const { t } = await withVoice(w)
    expect((await w.req("PUT", `/v1/tasks/${t.id}/repeat`, w.ops, { version: await versionOf(w, t.id), rule: { freq: "daily" } })).status).toBe(200)
    const f2 = await voiceFile(w, w.ops, t.id, { content: "v2" })
    const f1 = (await w.q("select voice_file_id from tasks where id = $1", [t.id]))[0].voice_file_id as string
    w.clock.advance({ days: 1 })
    const [r] = await Promise.all([put(w, w.ops, t.id, f2), runJob("tasks.recurrence", {}, w.deps)])
    expect(r.status).toBe(200)
    const inst = (await w.q<{ voice_file_id: string }>("select voice_file_id from tasks where series_id = $1", [t.id]))[0]
    expect([f1, f2]).toContain(inst.voice_file_id)
    expect(await status(w, inst.voice_file_id)).toBe("clean") // whichever it copied, the file is still alive
    expect(await status(w, f2)).toBe("clean")
  }, 90_000)
})

describe("purge, DSR, grants and privacy", () => {
  test("purging a task cascades its play log (as app_user); a shared voice file is kept for the instance; the log goes with the task", async () => {
    const w = await world()
    const { s, inst, fileId } = await series(w)
    expect((await play(w, w.staff, s.id)).status).toBe(302)
    expect((await play(w, w.staff, inst.id)).status).toBe(302)
    expect((await w.req("POST", `/v1/tasks/${s.id}/archive`, w.ops, { version: await versionOf(w, s.id) })).status).toBe(200)
    expect((await w.req("DELETE", `/v1/tasks/${s.id}`, w.owner)).status).toBe(204)
    expect(await plays(w, s.id)).toHaveLength(0)
    expect(await plays(w, inst.id)).toHaveLength(1)
    expect(await status(w, fileId)).toBe("clean")
    // the instance clears its note: the last reference goes (the voice route works after the re-home)
    expect((await del(w, w.ops, inst.id)).status).toBe(200)
    expect(await status(w, fileId)).toBe("deleted")
  }, 90_000)

  test("purging an instance whose series already moved to another file deletes the old file (no orphan)", async () => {
    const w = await world()
    const { s, inst, fileId } = await series(w)
    const f2 = await voiceFile(w, w.ops, s.id, { content: "v2" })
    expect((await put(w, w.ops, s.id, f2)).status).toBe(200)
    expect(await status(w, fileId)).toBe("clean")
    expect((await w.req("POST", `/v1/tasks/${inst.id}/archive`, w.ops, { version: await versionOf(w, inst.id) })).status).toBe(200)
    expect((await w.req("DELETE", `/v1/tasks/${inst.id}`, w.owner)).status).toBe(204)
    expect(await status(w, fileId)).toBe("deleted") // the instance was its last holder
    expect(await status(w, f2)).toBe("clean")
  }, 90_000)

  test("DSR: export lists the voice notes the person recorded (metadata only) and their plays; erase clears the note on every task sharing the file, queues its deletion and nulls the play log user", async () => {
    const w = await world()
    const { s, inst, fileId } = await series(w)
    expect((await play(w, w.ops, inst.id)).status).toBe(302)
    w.clock.advance({ minutes: 1 })
    expect((await play(w, w.staff, inst.id)).status).toBe(302)
    const exp = (await withTenant(w.deps.db, w.tenant.id, (tx) => tasksDsrHandler.export(tx, w.tenant.id, w.ops.userId))) as Json
    expect(exp.voiceNotes).toEqual([
      { taskId: s.id, ref: expect.stringMatching(/^TSK-/), durationSec: 30, mime: "audio/webm", recordedAt: expect.any(String) },
      { taskId: inst.id, ref: expect.stringMatching(/^TSK-/), durationSec: 30, mime: "audio/webm", recordedAt: expect.any(String) },
    ].sort((a, b) => a.taskId.localeCompare(b.taskId)))
    expect(JSON.stringify(exp)).not.toContain(fileId)
    expect(exp.voicePlays).toHaveLength(1)
    w.queue.jobs.length = 0
    await withTenant(w.deps.db, w.tenant.id, (tx) => tasksDsrHandler.erase(tx, w.tenant.id, w.ops.userId, w.clock.now(), (name, data) => void w.queue.jobs.push({ name, data })))
    expect((await w.q("select count(*)::int n from tasks where voice_file_id is not null"))[0].n).toBe(0)
    expect(await status(w, fileId)).toBe("deleted")
    expect(w.queue.jobs.filter((j) => j.name === "file.delete-object" && (j.data as Json).fileId === fileId)).toHaveLength(1)
    expect((await plays(w, inst.id)).map((x) => x.user_id)).toEqual([null, w.staff.userId]) // erased player: null, the other stays
    // idempotent
    await withTenant(w.deps.db, w.tenant.id, (tx) => tasksDsrHandler.erase(tx, w.tenant.id, w.ops.userId, w.clock.now(), (name, data) => void w.queue.jobs.push({ name, data })))
    expect(await code(await play(w, w.staff, inst.id))).toBe("voice_note_not_found")
  }, 90_000)

  test("privacy: no job other than file.scan and file.delete-object is ever enqueued for a voice file, and the voice module has no path to any AI or transcription client", async () => {
    const w = await world()
    const { t, fileId } = await withVoice(w)
    await play(w, w.staff, t.id)
    const f2 = await voiceFile(w, w.ops, t.id, { content: "again" })
    await put(w, w.ops, t.id, f2)
    await del(w, w.ops, t.id)
    const seen = new Set<string>()
    const all = [...w.queue.jobs]
    for (const j of all) if ([fileId, f2].includes((j.data as Json).fileId)) seen.add(j.name)
    await drain(w)
    expect([...seen].every((n) => n === "file.scan" || n === "file.delete-object")).toBe(true)
    expect(seen.size).toBeGreaterThan(0)
    // static guard: the two voice sources import nothing but db, core http helpers, the files module and the task helpers
    const dir = join(__dirname)
    for (const f of ["voice.ts", "voice-routes.ts", "voice-refs.ts"]) {
      const src = readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "") // code only: the comments explain the rule
      const imports = [...src.matchAll(/from "([^"]+)"/g)].map((m) => m[1])
      for (const spec of imports) expect(spec, `${f} imports ${spec}`).not.toMatch(/\b(ai|llm|openai|anthropic|transcri\w*|speech|whisper|search|webhooks?-out|integrations)\b/i)
      expect(src, f).not.toMatch(/transcri|openai|anthropic|whisper|speech-to-text|\bfetch\(/i)
    }
  }, 90_000)

  test("grants are minimal: the play log is INSERT and SELECT only plus UPDATE(user_id); RLS is forced and blocks other tenants; the DB refuses rewriting a play", async () => {
    const tbl = async (t: string) => (await ownerQuery(`select privilege_type from information_schema.role_table_grants where grantee = 'app_user' and table_name = $1 order by 1`, [t])).map((r) => r.privilege_type)
    const col = async (t: string) => (await ownerQuery(`select column_name from information_schema.column_privileges where grantee = 'app_user' and table_name = $1 and privilege_type = 'UPDATE' order by 1`, [t])).map((r) => r.column_name)
    expect(await tbl("task_voice_access")).toEqual(["INSERT", "SELECT"])
    expect(await col("task_voice_access")).toEqual(["user_id"])
    const rls = await ownerQuery(`select relrowsecurity, relforcerowsecurity from pg_class where relname = 'task_voice_access'`)
    expect(rls[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true })
    const w = await world()
    const { t } = await withVoice(w)
    await play(w, w.staff, t.id)
    const other = await makeTenant(w.deps, { slug: "bravo" })
    for (const stmt of [sql`delete from task_voice_access`, sql`update task_voice_access set at = now()`, sql`update task_voice_access set task_id = gen_random_uuid()`]) {
      const err = await withTenant(w.deps.db, w.tenant.id, (tx) => tx.execute(stmt)).catch((e) => e)
      expect(String((err as { cause?: { message?: string } }).cause?.message ?? err), String(stmt)).toMatch(/permission denied/)
    }
    const err = await withTenant(w.deps.db, other.id, (tx) => tx.execute(sql`insert into task_voice_access (tenant_id, task_id, file_id, user_id, at) values (${w.tenant.id}, ${t.id}, ${NIL}, 'x', now())`)).catch((e) => e)
    expect(String((err as { cause?: { message?: string } }).cause?.message ?? err)).toMatch(/row-level security/)
    expect((await plays(w, t.id)).length).toBe(1)
  }, 60_000)

  test("the play-log list uses task_voice_access_task_idx (EXPLAIN at 10k rows)", async () => {
    const w = await world()
    const { t } = await withVoice(w)
    await w.q(
      `insert into task_voice_access (tenant_id, task_id, file_id, user_id, at)
       select $1::uuid, $2::uuid, $3::uuid, $4, now() - (g || ' minutes')::interval from generate_series(1, 10000) g`,
      [w.tenant.id, t.id, NIL, w.staff.userId],
    )
    await ownerQuery("vacuum analyze task_voice_access")
    const ctx: TaskCtx = { tenantId: w.tenant.id, tz: "Europe/Dublin", me: w.owner.userId, actorId: w.owner.userId, role: null as never, scope: { kind: "all" }, reports: [], drive: true, now: w.clock.now() }
    const plan = await withTenant(w.deps.db, w.tenant.id, async (tx) => playsQuery(tx, ctx, t.id, null, 26).toSQL())
    const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_OWNER_URL })
    await c.connect()
    try {
      await c.query("begin")
      await c.query("select set_config('app.tenant_id', $1, true)", [w.tenant.id])
      const rows = (await c.query(`explain ${plan.sql}`, plan.params as unknown[])).rows.map((r) => r["QUERY PLAN"] as string).join("\n")
      await c.query("rollback")
      expect(rows).toContain("task_voice_access_task_idx")
      expect(rows).not.toMatch(/Seq Scan on task_voice_access/)
      expect(rows).not.toMatch(/Sort/)
    } finally {
      await c.end()
    }
  }, 120_000)
})
