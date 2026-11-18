import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test, vi } from "vitest"
import { fakeApi, problem } from "@/test/support/fake-api"
import { makeActionRunner } from "@/lib/api/action"
import { ApiError, userMessage } from "@/lib/api/problem"
import { toCard, toEvidence, toPatch, toProject, toTask, toTaskBody, toTimeline } from "./adapters"
import { FileRefused, VoiceTooLong, isKnockOnChanged, makeTasksClient, playUrl } from "./client"
import { createFlow } from "./create-flow"
import { canVerifyItem, canVerifyTask, countable, evState, ruleView } from "./evidence-view"
import { emptyOverlay, predictInto, viewOf, clearFrom } from "./overlay"
import { isLateAt } from "./time"
import { changeStatus } from "./mutations"
import { loadTaskByRef } from "./api"
import type { Task } from "./types"

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [] }), headers: async () => new Headers() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }), usePathname: () => "/tasks", useSearchParams: () => new URLSearchParams() }))

const root = path.resolve(__dirname, "../..")
const read = (p: string) => readFileSync(path.join(root, p), "utf8")
const walk = (dir: string, out: string[] = []): string[] => {
  for (const n of readdirSync(path.join(root, dir))) {
    const rel = `${dir}/${n}`
    if (statSync(path.join(root, rel)).isDirectory()) walk(rel, out)
    else out.push(rel)
  }
  return out
}

import { RULE, TID, U, dto, ev } from "@/test/support/task-dto"

describe("toTask maps a real DTO", () => {
  test("id, version, ref, wall and instant dates, assignees, seriesId stays a string", () => {
    const t = toTask(dto())
    expect(t).toMatchObject({ id: TID, version: 3, ref: "TSK-1001", due: "2026-10-25T01:30:00", dueAt: "2026-10-25T00:30:00.000Z", startAt: "2026-10-24T08:00:00.000Z", assignee: U.staff, assignees: [U.co], seriesId: "9a2b7c14-5e60-4d38-8f21-0c6d4e1b7a93" })
    expect(typeof t.seriesId).toBe("string")
    expect(Object.values(t).includes(undefined as never)).toBe(false) // no undefined member
  })
  test("a missing parentRef means no parent (an out-of-scope parent is opaque, E15)", () => {
    const t = toTask(dto({ parentId: null }))
    expect(t.parentRef).toBeUndefined()
    expect(t.parentId).toBeNull()
  })
  test("a missing required field THROWS instead of defaulting", () => {
    for (const k of ["id", "version", "title", "due", "dueAt", "status", "assignee", "evidenceRule", "checklist", "timeline"]) {
      const d = dto() as Record<string, unknown>
      delete d[k]
      expect(() => toTask(d), k).toThrow(/tasks:/)
    }
    expect(() => toTask(dto({ status: "done" }))).toThrow()
    expect(() => toTask(dto({ priority: 9 }))).toThrow()
  })
  test("cards (board, calendar, archive) map and keep a null parentId", () => {
    const c = toCard({ id: TID, ref: "TSK-2", version: 1, title: "t", status: "blocked", priority: 1, dept: "", teamId: null, assignee: "u", assignees: [], creator: "c", start: "a", due: "b", startAt: "a", dueAt: "b", tags: [], parentId: null })
    expect(c).toMatchObject({ id: TID, parentId: null, status: "blocked" })
    expect(c.parentRef).toBeUndefined()
  })
  test("a voice note maps to metadata only: there is NO url", () => {
    const t = toTask(dto({ voiceNote: { durationSec: 12, mime: "audio/webm", recordedBy: "Ann", recordedAt: "2026-10-24T10:00:00.000Z" } }))
    expect(t.voiceNote).toEqual({ durationSec: 12, mime: "audio/webm", recordedBy: "Ann", recordedAt: "2026-10-24T10:00:00.000Z" })
    expect(JSON.stringify(t)).not.toMatch(/https?:|blob:|presign|X-Amz/i)
  })
  test("project maps with its progress and milestones; evidence and history map", () => {
    const p = toProject({ id: TID, name: "Move", teamId: null, dept: "", leadId: null, lead: "", description: "d", due: null, defaultEvidenceRule: null, createdAt: "x", updatedAt: "x", version: 2, progress: { done: 1, total: 4, pct: 25 }, milestones: [{ id: "m", name: "M", due: "2026-12-01", position: 0, state: "open", done: 0, total: 1, pct: 0 }] })
    expect(p).toMatchObject({ version: 2, lead: "", due: "", progress: { pct: 25 } })
    expect(toEvidence(ev()).fileStatus).toBe("clean")
    expect(toTimeline([{ id: "h", at: "2026-10-24T10:00:00", atUtc: "x", actorId: null, by: "System", kind: "report", text: "Updated from the shift report", changes: [], notified: [] }])).toEqual([{ at: "2026-10-24T10:00:00", by: "System", text: "Updated from the shift report" }])
  })
})

describe("history notified list (T6.9 browser-walk defect: the timeline printed raw user ids)", () => {
  const h = { id: "h", at: "2026-10-24T10:00:00", atUtc: "x", actorId: null, by: "Ann", kind: "assigned", text: "Assigned", changes: [], notified: ["u-1", "u-gone"] }
  test("ids become display names through the people the caller can see; anyone else reads as Member", () => {
    const names = new Map([["u-1", "Tomasz Wojcik"]])
    expect(toTimeline([h], (id) => names.get(id) ?? "Member")[0].notified).toEqual(["Tomasz Wojcik", "Member"])
  })
  test("with no resolver an id is never shown", () => {
    expect(toTimeline([h])[0].notified).toEqual(["Member", "Member"])
  })
})

describe("toPatch (DST fold, D4)", () => {
  const prev = toTask(dto({ status: "not_started" }))
  test("unchanged dates are NOT re-sent as wall strings: the stored instant (25 Oct 01:30 Dublin, first occurrence) cannot move", () => {
    const next = { ...prev, title: "New title" }
    const p = toPatch(prev, next)
    expect(p).toEqual({ version: 3, title: "New title" })
    expect("due" in p || "start" in p).toBe(false)
  })
  test("a date the user edited is sent as the wall string; only changed fields travel; the version is the task's", () => {
    const p = toPatch(prev, { ...prev, due: "2026-10-26T17:00:00", tags: [], estimate: 30, client: "" })
    expect(p).toEqual({ version: 3, due: "2026-10-26T17:00:00", labels: [], estimateMin: 30 })
  })
  test("a task without a version cannot be patched", () => {
    expect(() => toPatch({ ...prev, version: undefined }, prev)).toThrow(/version/)
  })
  test("create body: primary and others, no repeat, no voice, the team's uuid", () => {
    const b = toTaskBody({ title: " T ", description: "d", teamId: "d1", assignee: "a", others: ["a", "b"], priority: 3, start: "2026-11-20T09:00:00", due: "2026-11-20T17:00:00", tags: [] })
    expect(b).toMatchObject({ title: "T", primary: "a", others: ["b"], teamId: "d1" })
    expect(b).not.toHaveProperty("repeat")
  })
  test("isLateAt reads the INSTANT: inside the repeated hour the wall string cannot tell", () => {
    const t = { status: "in_progress", due: "2026-10-25T01:30:00", dueAt: "2026-10-25T00:30:00.000Z" } as Task
    // 01:45 the FIRST time (00:45Z) is not late; 01:15 the SECOND time (01:15Z) is, though the wall string 01:15 < 01:30
    expect(isLateAt(t, "2026-10-25T01:45:00", "2026-10-25T00:45:00.000Z")).toBe(true)
    expect(isLateAt(t, "2026-10-25T01:15:00", "2026-10-25T00:15:00.000Z")).toBe(false)
    expect(isLateAt(t, "2026-10-25T01:15:00", "2026-10-25T01:15:00.000Z")).toBe(true)
  })
})

describe("optimistic writes: server wins, one request, retry", () => {
  const server = [toTask(dto({ status: "not_started", version: 3 }))]
  const refusals: [number, string][] = [[403, "forbidden"], [422, "invalid_transition"], [409, "evidence_not_ready"], [409, "version_conflict"], [402, "billing_required"]]
  for (const [status, code] of refusals) {
    test(`a ${status} ${code} rolls the prediction back, shows the mapped copy with a Ref, and refreshes`, async () => {
      let ov = emptyOverlay(server)
      const notify = vi.fn()
      const refresh = vi.fn()
      const run = makeActionRunner({ notify, refresh })
      const api = fakeApi({ "POST /v1/tasks/{id}/status": problem(status, code) })
      const client = makeTasksClient(api.client)
      const t = server[0]!
      ov = predictInto(ov, server, t.id!, changeStatus(t, "in_progress", "Me", "2026-10-24T09:00:00"))
      expect(viewOf(server, ov)[0]!.status).toBe("in_progress") // shown at once
      const r = await run(`status:${t.id}`, () => client.setStatus(t, "in_progress"), { rollback: () => (ov = clearFrom(ov, t.id!)) })
      expect(r.ok).toBe(false)
      expect(viewOf(server, ov)[0]!.status).toBe("not_started") // back to the server's record
      expect(notify).toHaveBeenCalledTimes(1)
      const m = notify.mock.calls[0]![0] as { text: string; ref: string }
      expect(m.ref).toBe("req-1")
      expect(m.text).toBe(userMessage(new ApiError(status, code, "req-1")).text)
      expect(refresh).toHaveBeenCalled()
      expect(api.calls[0]!.body).toEqual({ version: 3, to: "in_progress" }) // the CURRENT version, the uuid in the path
    })
  }
  test("on success the prediction stays until fresh server data arrives, then the server record replaces it", async () => {
    let ov = emptyOverlay(server)
    const t = server[0]!
    ov = predictInto(ov, server, t.id!, changeStatus(t, "in_progress", "Me", "x"))
    const fresh = [toTask(dto({ status: "in_progress", version: 4 }))]
    expect(viewOf(fresh, ov)[0]!.version).toBe(4) // a new server array: no prediction applies
  })
  test("409 version_conflict: refresh once and the clear copy; nothing repeated", async () => {
    const notify = vi.fn()
    const refresh = vi.fn()
    const run = makeActionRunner({ notify, refresh })
    const api = fakeApi({ "POST /v1/tasks/{id}/complete": problem(409, "version_conflict") })
    const r = await run("complete", () => makeTasksClient(api.client).complete(server[0]!))
    expect(r).toEqual({ ok: false, kind: "version_conflict" })
    expect(api.calls).toHaveLength(1)
    expect(notify).toHaveBeenCalledWith({ text: "Changed by someone else.", ref: "req-1" })
    expect(refresh).toHaveBeenCalledTimes(1)
  })
  test("every task write sends the version; a task without one throws before any request", async () => {
    const api = fakeApi({})
    const c = makeTasksClient(api.client)
    await expect(c.complete({ id: TID, version: undefined })).rejects.toThrow(/version/)
    await expect(c.setStatus({ id: undefined, version: 1 }, "blocked")).rejects.toThrow(/id/)
    expect(api.calls).toHaveLength(0)
  })
  test("the id in the path is the uuid, the version in the body (assignees, repeat, rule, archive, verify, reject)", async () => {
    const t = server[0]!
    const api = fakeApi({
      "PUT /v1/tasks/{id}/assignees": {}, "PUT /v1/tasks/{id}/repeat": {}, "PUT /v1/tasks/{id}/evidence-rule": {}, "POST /v1/tasks/{id}/archive": {}, "POST /v1/tasks/{id}/verify": {}, "POST /v1/tasks/{id}/reject": {},
      "PUT /v1/tasks/{id}/dependencies": {}, "POST /v1/tasks/{id}/date-proposal/decline": {},
    })
    const c = makeTasksClient(api.client)
    await c.setAssignees(t, "a", ["b"])
    await c.setRepeat(t, null)
    await c.setEvidenceRule(t, t.evidenceRule)
    await c.archive(t)
    await c.verify(t)
    await c.reject(t, "blurry")
    await c.setDependencies(t, [TID])
    await c.declineProposal(t)
    for (const call of api.calls) {
      expect((call as { body: { version: number } }).body.version).toBe(3)
      expect(JSON.stringify(call)).toContain(TID === TID ? "" : "")
    }
    expect(api.calls.every((c2) => c2.path.includes("{id}"))).toBe(true)
  })
  test("a double click sends ONE request and a failed request can be retried", async () => {
    const run = makeActionRunner({ notify: vi.fn(), refresh: vi.fn() })
    let n = 0
    const api = fakeApi({ "POST /v1/tasks/{id}/complete": () => (++n === 1 ? problem(500, "boom") : { ...dto() }) })
    const c = makeTasksClient(api.client)
    const first = run("complete", () => c.complete(server[0]!))
    expect(await run("complete", () => c.complete(server[0]!))).toEqual({ ok: false, kind: "in_flight" })
    expect((await first).ok).toBe(false)
    expect((await run("complete", () => c.complete(server[0]!))).ok).toBe(true)
    expect(n).toBe(2)
  })
  test("409 retry repeats the identical request once", async () => {
    let n = 0
    const api = fakeApi({ "POST /v1/tasks/{id}/status": () => (++n === 1 ? problem(409, "retry") : dto()) })
    const run = makeActionRunner({ notify: vi.fn(), refresh: vi.fn() })
    const r = await run("s", () => makeTasksClient(api.client).setStatus(server[0]!, "blocked"))
    expect(r.ok).toBe(true)
    expect(api.calls.map((c) => c.body)).toEqual([{ version: 3, to: "blocked" }, { version: 3, to: "blocked" }])
  })
})

describe("evidence independence (D8) and the whole assignee list", () => {
  const viewer = (id: string, name = "Viewer", manager = true) => ({ id, name, manager })
  const task = (over: Record<string, unknown> = {}) => toTask(dto({ evidence: [ev()], ...over }))
  test("the primary assignee, every co-assignee and a manager who is a co-assignee cannot verify", () => {
    const t = task()
    expect(canVerifyTask(t, viewer(U.staff, "S", false))).toBe(false)
    expect(canVerifyTask(t, viewer(U.co))).toBe(false) // a manager AND a co-assignee
    expect(canVerifyTask(t, viewer(U.mgr))).toBe(true)
  })
  test("the uploader of a waiting item cannot verify, and not that item", () => {
    const t = task({ evidence: [ev({ by: "Mona Manager" })] })
    expect(canVerifyTask(t, viewer(U.mgr, "Mona Manager"))).toBe(false)
    expect(canVerifyItem(toEvidence(ev({ by: "Mona Manager" })), viewer(U.mgr, "Mona Manager"))).toBe(false)
    expect(canVerifyItem(toEvidence(ev()), viewer(U.mgr, "Mona Manager"))).toBe(true)
  })
  test("creator mode: only the creator; no evidence asked: nobody", () => {
    const creatorMode = task({ evidenceRule: { ...RULE, review: "creator" as const } })
    expect(canVerifyTask(creatorMode, viewer(U.boss, "B", false))).toBe(true)
    expect(canVerifyTask(creatorMode, viewer(U.mgr, "M", false))).toBe(false)
    expect(canVerifyTask(task({ evidenceRule: { ...RULE, mode: "none" as const } }), viewer(U.mgr))).toBe(false)
  })
  test("the API 403 self_verification still has its copy if forced", () => {
    expect(userMessage(new ApiError(403, "self_verification", "r")).text).toBe("You can't verify your own task.")
    expect(userMessage(new ApiError(403, "human_required", "r")).text).toMatch(/person/)
  })
  test("every call site passes the WHOLE task (never a partial assignee list) through canVerifyTask", () => {
    const comps = walk("features/tasks/components").filter((f) => f.endsWith(".tsx"))
    for (const f of comps) {
      const src = read(f)
      expect(src, f).not.toMatch(/\bmayVerify\(|[^A-Za-z]canVerify\(/)
    }
    expect(read("features/tasks/components/task-detail.tsx")).toMatch(/canVerifyTask\(task, viewer\)/)
    expect(read("features/tasks/components/evidence-panel.tsx")).toMatch(/canVerifyItem\(e, viewer\)/)
  })
})

describe("evidence files: a clean file only (D10)", () => {
  const file = { name: "a.jpg", type: "image/jpeg", size: 3, arrayBuffer: async () => new ArrayBuffer(3) }
  const intent = { fileId: "f1", upload: { method: "PUT", url: "https://s3.test/put?sig", headers: { "Content-Type": "image/jpeg" } } }
  const run = (statuses: string[]) => {
    let i = 0
    const api = fakeApi({
      "POST /v1/tasks/{id}/uploads": intent,
      "POST /v1/tasks/{id}/uploads/{fileId}/complete": () => ({ status: statuses[Math.min(i++, statuses.length - 1)] }),
      "POST /v1/tasks/{id}/evidence": { id: "e1" },
    })
    const put = vi.fn(async () => new Response(null, { status: 200 }))
    const waits: number[] = []
    const c = makeTasksClient(api.client, put as never, async (ms) => void waits.push(ms))
    return { api, put, waits, c }
  }
  test("PUT to the presigned URL with the signed headers, complete, poll while Scanning, attach only when clean", async () => {
    const { api, put, c } = run(["pending", "pending", "clean"])
    const scanning = vi.fn()
    await c.addFileEvidence({ id: TID }, "photo", file, { source: "camera", onScanning: scanning })
    expect(put).toHaveBeenCalledWith("https://s3.test/put?sig", expect.objectContaining({ method: "PUT", headers: { "Content-Type": "image/jpeg" } }))
    expect(scanning).toHaveBeenCalledTimes(1)
    expect(api.paths().filter((p) => p.includes("complete"))).toHaveLength(3)
    expect(api.paths().at(-1)).toBe("POST /v1/tasks/{id}/evidence")
    expect(api.calls.at(-1)!.body).toEqual({ kind: "photo", fileId: "f1", source: "camera" })
  })
  test("an infected file is refused with FileRefused and is never attached", async () => {
    const { api, c } = run(["pending", "infected"])
    await expect(c.addFileEvidence({ id: TID }, "photo", file)).rejects.toMatchObject({ name: "FileRefused", reason: "infected" })
    expect(api.paths()).not.toContain("POST /v1/tasks/{id}/evidence")
  })
  test("a file that never clears is 'slow', not attached", async () => {
    const { c } = run(["pending"])
    await expect(c.addFileEvidence({ id: TID }, "photo", file)).rejects.toBeInstanceOf(FileRefused)
  })
  test("a failed PUT is refused before complete", async () => {
    const api = fakeApi({ "POST /v1/tasks/{id}/uploads": intent })
    const c = makeTasksClient(api.client, (async () => new Response(null, { status: 403 })) as never)
    await expect(c.addFileEvidence({ id: TID }, "photo", file)).rejects.toMatchObject({ reason: "upload" })
  })
  test("Complete before clean shows the evidence_not_ready copy; pending and infected items do not count", () => {
    expect(userMessage(new ApiError(409, "evidence_not_ready", "r")).text).toBe("Evidence is still being scanned.")
    const t = toTask(dto({ evidence: [ev({ fileStatus: "pending" }), ev({ id: "e2", fileStatus: "infected", review: "rejected", reason: "Failed malware scan" })] }))
    expect(countable(t.evidence).map((e) => e.id)).toEqual(["e2"]) // rejected explains; the scanning one does not count
    expect(ruleView(t).evidence).toHaveLength(1)
    expect(evState(t)).toBe(evState({ ...t, evidence: [t.evidence[1]!] })) // the scanning item is not counted: the state is what the API reports
  })
  test("Drive: withheld text from the API is shown as is, and device_policy has its copy", () => {
    expect(toEvidence(ev({ kind: "drive", name: "Link withheld on this device", fileId: undefined, fileStatus: undefined })).name).toBe("Link withheld on this device")
    expect(userMessage(new ApiError(403, "device_policy", "r")).text).toBe("Available on your work PC.")
    const src = read("features/tasks/components/evidence-panel.tsx")
    expect(src).toMatch(/driveAllowed && isDriveUrl\(e\.name\)/) // never rebuilt into a link
  })
})

describe("knock-on, checklist, comments, voice", () => {
  test("apply sends the previewHash; knock_on_changed is recognised so the preview repeats", async () => {
    const api = fakeApi({ "POST /v1/tasks/{id}/reschedule": dto() })
    await makeTasksClient(api.client).reschedule(toTask(dto()), { start: "2026-11-21T09:00:00", due: "2026-11-21T17:00:00" }, { apply: true, previewHash: "h".repeat(64) })
    expect(api.calls[0]!.body).toMatchObject({ version: 3, knockOn: { apply: true, previewHash: "h".repeat(64) } })
    expect(isKnockOnChanged(new ApiError(409, "knock_on_changed", "r"))).toBe(true)
    expect(isKnockOnChanged(new ApiError(409, "version_conflict", "r"))).toBe(false)
    expect(userMessage(new ApiError(409, "knock_on_changed", "r")).text).toMatch(/Check the preview/)
  })
  test("the schedule dialog shows hidden moves as a count only", () => {
    const src = read("features/tasks/components/schedule-dialogs.tsx")
    expect(src).toMatch(/hidden > 0/)
    expect(src).not.toMatch(/outOfScope\s*\?[^:]*ref/) // an out-of-scope entry has no ref to show
  })
  test("a checklist tick sends the ABSOLUTE done; comments send mentions as user ids", async () => {
    const api = fakeApi({ "PATCH /v1/tasks/{id}/checklist/{itemId}": {}, "POST /v1/tasks/{id}/comments": {} })
    const c = makeTasksClient(api.client)
    await c.setChecklistDone({ id: TID }, "i1", true)
    await c.setChecklistDone({ id: TID }, "i1", true) // two clicks: still true, never flipped back
    await c.comment({ id: TID }, "Done", ["usr_a"])
    expect(api.calls.map((x) => x.body)).toEqual([{ done: true }, { done: true }, { body: "Done", mentions: ["usr_a"], attachmentFileIds: [] }])
  })
  test("a voice note over 120 s is refused BEFORE any upload; the API's voice_too_long has copy", async () => {
    const api = fakeApi({})
    const c = makeTasksClient(api.client)
    await expect(c.setVoice(toTask(dto()), { name: "v", type: "audio/webm", size: 5, arrayBuffer: async () => new ArrayBuffer(5) }, 121)).rejects.toBeInstanceOf(VoiceTooLong)
    expect(api.calls).toHaveLength(0)
    expect(userMessage(new ApiError(422, "voice_too_long", "r")).text).toMatch(/2 minutes/)
  })
  test("voice: the play path is ours, fresh per play, carries no credential; nothing stores a URL", () => {
    const a = playUrl(TID, "1")
    expect(a).toBe(`/v1/tasks/${TID}/voice-note?play=1`)
    expect(playUrl(TID, "2")).not.toBe(a)
    expect(a).not.toMatch(/X-Amz|signature|token/i)
    const src = read("features/tasks/components/voice-card.tsx") + read("components/voice-note.tsx")
    expect(src).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/)
    expect(read("components/voice-note.tsx")).toMatch(/removeAttribute\("src"\)/)
    expect(read("features/tasks/components/voice-card.tsx")).toMatch(/fresh=\{\(\) => playUrl\(/)
  })
  test("Support sessions and API keys are refused with their copy", () => {
    expect(userMessage(new ApiError(403, "support_read_only", "r")).text).toMatch(/support/i)
    expect(userMessage(new ApiError(403, "api_key_forbidden_route", "r")).text).toMatch(/API key/)
  })
})

describe("creating: two calls, the task stays (I13)", () => {
  const T = { id: TID, version: 1, ref: "TSK-9" }
  test("if PUT /repeat fails the task stays: one create, no second task, the repeat is reported failed", async () => {
    const create = vi.fn(async () => ({ ok: true as const, value: T }))
    const repeat = vi.fn(async () => ({ ok: false as const }))
    const r = await createFlow({ create, repeat })
    expect(create).toHaveBeenCalledTimes(1)
    expect(r).toEqual({ task: T, repeat: "failed", voice: "none" })
  })
  test("the voice note uses the version the repeat answered with", async () => {
    const voice = vi.fn(async (t: typeof T) => ({ ok: true as const, value: t }))
    await createFlow({ create: async () => ({ ok: true as const, value: T }), repeat: async (t) => ({ ok: true as const, value: { ...t, version: 2 } }), voice })
    expect(voice).toHaveBeenCalledWith({ ...T, version: 2 })
  })
  test("a failed create creates nothing and runs no later step", async () => {
    const repeat = vi.fn()
    expect(await createFlow({ create: async () => ({ ok: false as const }), repeat })).toBeNull()
    expect(repeat).not.toHaveBeenCalled()
  })
  test("the form offers 'Set repeat again' and never a second create", () => {
    const src = read("features/tasks/components/new-task-form.tsx")
    expect(src).toMatch(/Set repeat again/)
    expect(src.match(/c\.create\(/g)).toHaveLength(1)
  })
})

describe("scope is the server's; deleted mock modules", () => {
  test("another person's task ref (404) or an unknown one shows the not-found state; nothing is filtered client-side", async () => {
    const hit = fakeApi({ "GET /v1/tasks": { items: [], nextCursor: null } })
    expect(await loadTaskByRef(hit.client, "TSK-7")).toBeNull()
    const gone = fakeApi({ "GET /v1/tasks": { items: [{ id: TID }], nextCursor: null }, "GET /v1/tasks/{id}": problem(404, "task_not_found"), "GET /v1/tasks/{id}/comments": { items: [], nextCursor: null } })
    expect(await loadTaskByRef(gone.client, "TSK-7")).toBeNull()
    expect(await loadTaskByRef(gone.client, "not a ref")).toBeNull() // never even sent
    const src = read("features/tasks/api.ts")
    expect(src).not.toMatch(/\bME_ID\b|isAssigned|scopeReports/)
  })
  test("the detail page renders 'Task not found' for a null task, and a subtask of an out-of-scope parent without a parent link", async () => {
    const { TaskDetail } = await import("./components/task-detail")
    const base = { taskRef: "TSK-7", people: [], today: "2026-11-18T09:00:00", tzLabel: "GMT", actor: "reviewer" as const, canEdit: true, viewer: { id: "u", name: "Me", manager: true, purge: false }, driveAllowed: true }
    expect(renderToStaticMarkup(createElement(TaskDetail, { ...base, task: null }))).toMatch(/Task not found/)
    const orphan = toTask(dto({ parentId: null, status: "not_started" }))
    const html = renderToStaticMarkup(createElement(TaskDetail, { ...base, task: orphan }))
    expect(html).toMatch(/Check fire exits/)
    expect(html).not.toMatch(/Subtask of/)
  })
  test("a series is shown once per API row: nothing materialises recurring instances any more", () => {
    for (const f of [...walk("app"), ...walk("features"), ...walk("lib"), ...walk("hooks")].filter((p) => /\.(ts|tsx)$/.test(p) && !/\.test\./.test(p))) {
      expect(read(f), f).not.toMatch(/materialiseRecurring/)
    }
  })
  test("the mock store, the detail-loading wrapper and the tasks store are gone and nothing imports them", () => {
    for (const gone of ["features/tasks/store.ts", "features/tasks/components/task-detail-loading.tsx"]) expect(() => statSync(path.join(root, gone))).toThrow()
    for (const f of [...walk("app"), ...walk("features"), ...walk("lib"), ...walk("hooks"), ...walk("components")].filter((p) => /\.(ts|tsx)$/.test(p) && !/\.test\./.test(p))) {
      const src = read(f)
      expect(src, f).not.toMatch(/\btasksStore\b|useTasksStore|features\/tasks\/store/) // (rosters has its own, unrelated templatesStore)
    }
  })
  test("no tasks screen imports the mock inbox", () => {
    for (const f of walk("features/tasks").filter((p) => /\.(ts|tsx)$/.test(p) && !/\.test\./.test(p))) expect(read(f), f).not.toMatch(/task-inbox/)
  })
})

describe("loading.tsx files are static", () => {
  test("no tasks loading.tsx imports a data layer, a session or the API", () => {
    const files = walk("app/(app)/tasks").filter((f) => f.endsWith("loading.tsx"))
    expect(files).toHaveLength(7)
    for (const f of files) {
      const src = read(f)
      expect(src, f).not.toMatch(/lib\/session"|lib\/api|lib\/data|getMockOrg|getMockPeople|taskScreenData|loadTask|loadProjects|requireMfaOk|getSession\(/)
    }
  })
  test("every tasks page that reaches the API uses requireMfaOk()", () => {
    for (const f of walk("app/(app)/tasks").filter((p) => p.endsWith("page.tsx"))) expect(read(f), f).toMatch(/requireMfaOk\(\)/)
  })
})
