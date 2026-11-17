import { randomUUID } from "node:crypto"
import { expect } from "vitest"
import { ownerTenantQuery, ownerQuery } from "../../../test/db"
import { fakeClock } from "../../../test/fakes"
import { makeMember, makeTenant, signIn } from "../../../test/factories"
import { call, testApp } from "../../../test/harness"
import { relayOnce } from "../../core/events"
import { runJob } from "../../core/queue/queue"

// Shared test world for the shift-report suites (T5.2 reports.test.ts, T5.3 review.test.ts). Not a test file.

export type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
export type Who = { userId: string; email: string; password: string; cookie: string }
export const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
export const DRIVE = "https://drive.google.com/file/d/abc123/view"
export const DAY = "2026-10-24" // the Dublin night that lasts 9 h: 21:00Z -> 06:00Z, due 07:00Z
export const IN_START = "2026-10-24T20:00:00.000Z"
export const IN_DUE = "2026-10-25T02:00:00.000Z"
export const REQUIRED = { mode: "required", types: ["pdf", "note", "image"], min: 1, instruction: "", review: "manager" }


export async function world(over: { now?: string; reporting?: boolean; slug?: string } = {}) {
  const slug = over.slug ?? "acme"
  const t = testApp(over.now ? { clock: fakeClock(new Date(over.now)) } : {})
  const tenant = await makeTenant(t.deps, { slug, sessionIdleHours: 2160 })
  await ownerQuery("update tenants set timezone = 'Europe/Dublin' where id = $1", [tenant.id])
  const who = async (role: string): Promise<Who> => {
    const m = await makeMember(t.deps, tenant.id, role)
    return { userId: m.userId, email: m.email, password: m.password, cookie: (await signIn(t.app, m.email, m.password)).cookie }
  }
  const owner = await who("owner")
  const manager = await who("manager") // manager-home, report scope "team"
  const ops = await who("ops") // manager-home, all
  const staff = await who("employee")
  const staff2 = await who("employee")
  const staff3 = await who("employee")
  const req = (method: string, path: string, as: { cookie: string } | null, body?: unknown) => call(t.app, method, path, { cookie: as?.cookie, tenant: slug, body })
  const json = async (r: Response) => (await r.json()) as Json
  const q = <R = Json>(sqlText: string, params: unknown[] = []) => ownerTenantQuery(tenant.id, sqlText, params) as Promise<R[]>
  const team = (await json(await req("POST", "/v1/teams", owner, { name: "Night team", kind: "team" }))).id as string
  const pr = await req("POST", "/v1/shifts/patterns", ops, { name: "Night", teamId: team, start: "22:00", end: "06:00", days: [0, 1, 2, 3, 4, 5, 6] })
  expect(pr.status, await pr.clone().text()).toBe(201)
  const pattern = (await json(pr)).id as string
  for (const u of [staff, staff2, staff3, owner]) expect((await req("POST", "/v1/shifts/assignments", ops, { userId: u.userId, patternId: pattern, from: "2026-10-01" })).status).toBe(201)
  if (over.reporting !== false) expect((await req("PUT", `/v1/shifts/reporting/teams/${team}`, ops, { on: true })).status).toBe(200)
  const manages = async (mgr: Who, person: Who) => expect((await req("PUT", `/v1/members/${person.userId}/manager`, owner, { managerId: mgr.userId })).status).toBe(200)
  /** A task assigned to `primary`, placed inside the 24 Oct night by default (start 20:00Z, due 02:00Z). */
  const task = async (primary: Who, o: Json = {}) => {
    const { start = IN_START, due = IN_DUE, status, completedAt, ...rest } = o
    const r = await req("POST", "/v1/tasks", ops, { title: "Check fire exits", description: "Walk every floor.", priority: 2, start: "2026-11-20T09:00:00", due: "2026-11-20T17:00:00", primary: primary.userId, ...rest })
    expect(r.status, await r.clone().text()).toBe(201)
    const tk = await json(r)
    await q("update tasks set start_at = $2, due_at = $3 where id = $1", [tk.id, start, due])
    if (status) await q("update tasks set status = $2, completed_at = $3 where id = $1", [tk.id, status, completedAt ?? null])
    return tk
  }
  const open = (as: Who, date = DAY, patternId = pattern) => req("POST", "/v1/shift-reports/open", as, { patternId, date })
  const opened = async (as: Who, date = DAY) => {
    const r = await open(as, date)
    expect([200, 201], await r.clone().text()).toContain(r.status)
    return json(r)
  }
  const get = async (as: Who, id: string) => json(await req("GET", `/v1/shift-reports/${id}`, as))
  const draftBody = (rep: Json, o: Json = {}) => ({
    version: rep.version, summary: "Quiet night.", blockers: "", unplanned: [], extra: {}, attachmentFileIds: [],
    items: rep.items.filter((i: Json) => i.taskId).map((i: Json) => ({ taskId: i.taskId, status: i.status, minutes: i.minutes, note: i.note })), ...o,
  })
  const put = (as: Who, rep: Json, o: Json = {}) => req("PUT", `/v1/shift-reports/${rep.id}/draft`, as, draftBody(rep, o))
  const saved = async (as: Who, rep: Json, o: Json = {}) => {
    const r = await put(as, rep, o)
    expect(r.status, await r.clone().text()).toBe(200)
    return json(r)
  }
  const submit = (as: Who, rep: Json, requestId = randomUUID()) => req("POST", `/v1/shift-reports/${rep.id}/submit`, as, { version: rep.version, requestId })
  /** Marks every row done with 30 min and a summary, then submits. */
  const filled = async (as: Who, rep: Json, o: Json = {}) => {
    const items = rep.items.filter((i: Json) => i.taskId).map((i: Json) => ({ taskId: i.taskId, status: "done", minutes: 30, note: "" }))
    return saved(as, rep, { items, ...o })
  }
  const taskRow = async (id: string) => (await q("select status, version from tasks where id = $1", [id]))[0]
  const hist = (id: string) => q("select kind, text, update_id from task_history where task_id = $1 and kind = 'report' order by at, id", [id])
  const relay = async () => {
    for (let i = 0; i < 5 && (await relayOnce(t.deps)) > 0; i++);
  }
  const drain = async () => {
    for (let i = 0; i < 6 && t.queue.jobs.length > 0; i++) for (const j of t.queue.jobs.splice(0)) await runJob(j.name, j.data, t.deps)
  }
  return { ...t, tenant, who, owner, manager, ops, staff, staff2, staff3, req, json, q, team, pattern, manages, task, open, opened, get, draftBody, put, saved, submit, filled, taskRow, hist, relay, drain }
}
export type W = Awaited<ReturnType<typeof world>>
export const code = async (r: Response) => ((await r.clone().json()) as Json).code as string

/** Intent -> browser-style PUT -> complete (-> scan job). Returns the file id. */
export async function upload(w: W, as: Who, reportId: string, o: { name?: string; mime?: string; content?: string; scan?: boolean } = {}) {
  const buf = Buffer.from(o.content ?? "hello pdf")
  const r = await w.req("POST", `/v1/shift-reports/${reportId}/uploads`, as, { name: o.name ?? "site-photo.pdf", mime: o.mime ?? "application/pdf", sizeBytes: buf.length })
  expect(r.status, await r.clone().text()).toBe(201)
  const j = await w.json(r)
  const { "Content-Length": _len, ...headers } = j.upload.headers as Record<string, string>
  expect((await fetch(j.upload.url, { method: "PUT", headers, body: buf })).status).toBe(200)
  expect((await w.req("POST", `/v1/shift-reports/${reportId}/uploads/${j.fileId}/complete`, as)).status).toBe(200)
  if (o.scan !== false) await w.drain()
  return j.fileId as string
}
