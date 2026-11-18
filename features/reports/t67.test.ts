import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, test, vi } from "vitest"
import { fakeApi, problem } from "@/test/support/fake-api"
import { ApiError, userMessage } from "@/lib/api/problem"
import { FILE, ME, PID, RID, TASK, TZ, inboxDto, reportDto, templateDto } from "@/test/support/report-dto"
import { fieldErrorsOf, toInboxRow, toReport, toReportBody, toTemplateBody, toTemplateData, toVersions } from "./adapters"
import { makeAutosaver, makeReportsClient, makeSubmitter, reportFilePath } from "./client"
import { EXPORT_COPY, exportPath, makeExportClient } from "./export"
import { draftPhaseAt, reportStateAt, secondsUntilAt } from "./time"
import * as shim from "./export-rows"
import * as domain from "@opsdesk/domain/report-export"

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

describe("toReport maps a real report", () => {
  test("items, state, version, instants, wall times from the instants and extra answers", () => {
    const r = toReport(reportDto({ extra: { "handover.keys": "Yes" }, summary: "Quiet", version: 4 }), TZ)
    expect(r).toMatchObject({
      id: `${ME}:${PID}:2026-10-24`, reportId: RID, personId: ME, version: 4, state: "draft", status: "draft", shiftName: "Night", team: "Security", date: "2026-10-24",
      start: "2026-10-24T22:00", end: "2026-10-25T06:00", due: "2026-10-25T07:00", dueAt: "2026-10-25T07:00:00.000Z", extra: { "handover.keys": "Yes" }, summary: "Quiet",
    })
    expect(r.items[0]).toMatchObject({ taskId: TASK, taskRef: "TSK-1001", title: "Check fire exits", status: "not_started", due: "2026-10-25T03:00", dueAt: "2026-10-25T03:00:00.000Z" })
    expect(JSON.stringify(r)).not.toContain("undefined")
    for (const v of Object.values(r)) expect(v).not.toBeUndefined()
  })
  test("the wall times come from the stored INSTANTS in the tenant zone, not from the API's wall strings", () => {
    // a wrong wall string must not be shown: the instant wins (24 Oct night: 21:00Z is 22:00 IST, 06:00Z is 06:00 GMT)
    const r = toReport(reportDto({ start: "2026-10-24T21:00", end: "2026-10-25T05:00", due: "2026-10-25T06:00" }), TZ)
    expect([r.start, r.end, r.due]).toEqual(["2026-10-24T22:00", "2026-10-25T06:00", "2026-10-25T07:00"])
  })
  test("the repeated hour: a due time of 01:30 GMT (the SECOND 01:30) is shown as 01:30 and counts down against the instants", () => {
    const r = toReport(reportDto({ due: "2026-10-25T01:30", dueAt: "2026-10-25T01:30:00.000Z", endAt: "2026-10-25T00:30:00.000Z" }), TZ)
    expect(r.due).toBe("2026-10-25T01:30")
    // 00:45Z is still BEFORE the second 01:30; resolving the wall string 01:30 to its FIRST instant (00:30Z) would say 0 seconds
    expect(secondsUntilAt(r.dueAt, "2026-10-25T00:45:00.000Z")).toBe(45 * 60)
    expect(reportStateAt(r, "2026-10-25T00:45:00.000Z")).toBe("draft")
    expect(reportStateAt(r, "2026-10-25T01:31:00.000Z")).toBe("missing")
  })
  test("the 27 Mar 2027 night (gap): 22:00 GMT to 06:00 BST is seven real hours and the 07:00 BST due time is 06:00Z", () => {
    const r = toReport(reportDto({ date: "2027-03-27", start: "x", end: "x", due: "x", startAt: "2027-03-27T22:00:00.000Z", endAt: "2027-03-28T05:00:00.000Z", dueAt: "2027-03-28T06:00:00.000Z" }), TZ)
    expect([r.start, r.end, r.due]).toEqual(["2027-03-27T22:00", "2027-03-28T06:00", "2027-03-28T07:00"])
    expect(secondsUntilAt(r.dueAt, "2027-03-28T05:00:00.000Z")).toBe(3600)
  })
  test("a Pacific/Auckland tenant shows its own wall times", () => {
    const r = toReport(reportDto(), "Pacific/Auckland")
    expect(r.start).toBe("2026-10-25T10:00") // 21:00Z is 10:00 NZDT the next morning
    expect(r.due).toBe("2026-10-25T20:00")
  })
  test("submitted and reviewed times, comments and attachments map to tenant wall time and display sizes", () => {
    const r = toReport(
      reportDto({
        status: "returned", state: "returned", submittedAt: "2026-10-25T06:20:00.000Z", reviewedAt: "2026-10-25T08:00:00.000Z", reviewedBy: "Mia Doyle",
        comments: [{ at: "2026-10-25T08:00:00.000Z", by: "Mia Doyle", text: "Add the lift fault" }],
        attachments: [{ id: FILE, name: "lift.jpg", kind: "image", size: 482113, status: "pending" }],
      }),
      TZ,
    )
    expect(r.submittedAt).toBe("2026-10-25T06:20")
    expect(r.reviewedAt).toBe("2026-10-25T08:00")
    expect(r.comments).toEqual([{ at: "2026-10-25T08:00", by: "Mia Doyle", text: "Add the lift fault" }])
    expect(r.attachments[0]).toMatchObject({ id: FILE, name: "lift.jpg", kind: "image", status: "pending", size: "471 KB" })
  })
  test("an unknown or missing required key throws, and so does an unknown status", () => {
    for (const k of ["id", "key", "version", "items", "dueAt", "startAt", "status", "state", "attachments", "extra", "comments", "unplanned"]) {
      const d = reportDto() as Record<string, unknown>
      delete d[k]
      expect(() => toReport(d, TZ), k).toThrow()
    }
    expect(() => toReport(reportDto({ surprise: 1 }), TZ)).toThrow()
    expect(() => toReport(reportDto({ status: "weird" }), TZ)).toThrow()
    expect(() => toReport(reportDto({ items: [{ ...reportDto().items[0], status: "weird" }] }), TZ)).toThrow()
  })
  test("an erased member keeps the report: personId is empty, never undefined", () => {
    const r = toReport(reportDto({ userId: null, key: `former:${PID}:2026-10-24` }), TZ)
    expect(r.personId).toBe("")
    expect(r.userId).toBeNull()
  })
})

describe("the inbox row", () => {
  test("a stored row and a virtual row (id null, with a key) both map", () => {
    const stored = toInboxRow(inboxDto(), TZ)
    expect(stored).toMatchObject({ reportId: RID, key: `${ME}:${PID}:2026-10-24`, person: "Ann Byrne", state: "submitted", itemCount: 4, doneCount: 3, teamId: expect.any(String), submittedAt: "2026-10-25T06:20" })
    const virtual = toInboxRow(inboxDto({ id: null, status: "draft", state: "missing", version: 0, submissions: 0, itemCount: 0, doneCount: 0, submittedAt: null }), TZ)
    expect(virtual.reportId).toBeNull()
    expect(virtual.key).toBe(`${ME}:${PID}:2026-10-24`)
    expect(virtual.submittedAt).toBeUndefined()
    for (const v of Object.values(virtual)) expect(v).not.toBeUndefined()
  })
  test("a missing required field throws", () => {
    const d = inboxDto() as Record<string, unknown>
    delete d.dueAt
    expect(() => toInboxRow(d, TZ)).toThrow()
  })
})

describe("report state and countdown use the instants (never wall strings)", () => {
  const r = toReport(reportDto(), TZ)
  test("draft until dueAt, missing after; a submission is late only when the FIRST submission came after dueAt", () => {
    expect(reportStateAt(r, "2026-10-25T06:59:00.000Z")).toBe("draft")
    expect(reportStateAt(r, "2026-10-25T07:01:00.000Z")).toBe("missing")
    const sub = toReport(reportDto({ status: "submitted", state: "submitted", submittedAt: "2026-10-25T07:05:00.000Z" }), TZ)
    expect(reportStateAt(sub, "2026-10-25T09:00:00.000Z")).toBe("late")
    const early = toReport(reportDto({ status: "submitted", state: "submitted", submittedAt: "2026-10-25T06:50:00.000Z" }), TZ)
    expect(reportStateAt(early, "2026-10-25T09:00:00.000Z")).toBe("submitted")
    expect(reportStateAt(toReport(reportDto({ status: "accepted", state: "accepted" }), TZ), "2026-10-26T00:00:00.000Z")).toBe("accepted")
  })
  test("in shift versus open: the nine real hours of the 24 Oct night", () => {
    expect(draftPhaseAt(r, "2026-10-25T05:59:00.000Z")).toBe("in_shift")
    expect(draftPhaseAt(r, "2026-10-25T06:00:00.000Z")).toBe("open")
    // 05:30 wall time would be "in shift" for a wall-string maths that thinks the night is eight hours long ending 06:00 IST (05:00Z)
  })
  test("the countdown is never negative", () => {
    expect(secondsUntilAt(r.dueAt, "2026-10-25T07:00:30.000Z")).toBe(0)
  })
})

describe("toReportBody", () => {
  test("version, items by task id, summary, blockers, unplanned, extra and the attachment ids", () => {
    const r = toReport(
      reportDto({ version: 3, summary: "Ok", blockers: "None", unplanned: [{ id: "u1", text: "Helped", minutes: 20 }], extra: { "handover.keys": "Yes" }, attachments: [{ id: FILE, name: "a.jpg", kind: "image", size: 10, status: "clean" }] }),
      TZ,
    )
    r.items[0] = { ...r.items[0]!, status: "done", minutes: 30, note: "Locked" }
    expect(toReportBody(r)).toEqual({
      version: 3,
      items: [{ taskId: TASK, status: "done", minutes: 30, note: "Locked" }],
      summary: "Ok", blockers: "None", unplanned: [{ id: "u1", text: "Helped", minutes: 20 }], extra: { "handover.keys": "Yes" }, attachmentFileIds: [FILE],
    })
  })
  test("a row whose task was purged (no taskId) is not sent, an infected attachment is not sent, and no row note is echoed anywhere else", () => {
    const r = toReport(
      reportDto({
        items: [{ ...reportDto().items[0], taskId: null }, { ...reportDto().items[0], position: 1, ref: "TSK-1002" }],
        attachments: [{ id: FILE, name: "x", kind: "file", size: 1, status: "infected" }],
      }),
      TZ,
    )
    const b = toReportBody(r)
    expect(b.items).toHaveLength(1)
    expect(b.attachmentFileIds).toEqual([])
  })
  test("a body with no version throws before any request", () => {
    const r = toReport(reportDto(), TZ)
    expect(() => toReportBody({ ...r, version: 0 })).toThrow(/version/)
  })
})

describe("the draft autosave (debounced 800 ms, with the version)", () => {
  function timers() {
    const q: { at: number; fn: () => void; id: number }[] = []
    let now = 0
    let n = 0
    return {
      setTimer: (fn: () => void, ms: number) => (q.push({ at: now + ms, fn, id: ++n }), n),
      clearTimer: (id: unknown) => void q.splice(0, q.length, ...q.filter((x) => x.id !== id)),
      advance: async (ms: number) => {
        now += ms
        for (const t of q.filter((x) => x.at <= now).sort((a, b) => a.at - b.at)) {
          q.splice(q.indexOf(t), 1)
          t.fn()
        }
        await Promise.resolve()
        await Promise.resolve()
      },
    }
  }
  test("a burst of edits makes ONE save, 800 ms after the last one, with the version, then adopts the returned version", async () => {
    const t = timers()
    const saved: { version: number; summary: string }[] = []
    const onSaved = vi.fn()
    const a = makeAutosaver({ delay: 800, setTimer: t.setTimer, clearTimer: t.clearTimer, version: 1, save: async (form: { summary: string }, version) => { saved.push({ version, summary: form.summary }); return { version: version + 1 } }, onSaved, onConflict: vi.fn(), onError: vi.fn() })
    a.schedule({ summary: "a" })
    await t.advance(500)
    a.schedule({ summary: "ab" })
    await t.advance(799)
    expect(saved).toEqual([])
    await t.advance(1)
    expect(saved).toEqual([{ version: 1, summary: "ab" }])
    expect(onSaved).toHaveBeenCalledWith({ version: 2 })
    a.schedule({ summary: "abc" })
    await t.advance(800)
    expect(saved[1]).toEqual({ version: 2, summary: "abc" })
  })
  test("an edit made while a save is in flight is saved after it, with the NEW version (never two saves with one version)", async () => {
    const t = timers()
    const versions: number[] = []
    let release: () => void = () => {}
    const a = makeAutosaver({
      delay: 800, setTimer: t.setTimer, clearTimer: t.clearTimer, version: 1,
      save: (_f: { n: number }, v) => new Promise<{ version: number }>((res) => { versions.push(v); release = () => res({ version: v + 1 }) }),
      onSaved: vi.fn(), onConflict: vi.fn(), onError: vi.fn(),
    })
    a.schedule({ n: 1 })
    await t.advance(800)
    a.schedule({ n: 2 })
    await t.advance(800) // the first save has not answered yet
    expect(versions).toEqual([1])
    release()
    await t.advance(0)
    await t.advance(0)
    expect(versions).toEqual([1, 2])
  })
  test("409 version_conflict stops the saving and reloads the report (two tabs)", async () => {
    const t = timers()
    const onConflict = vi.fn()
    const a = makeAutosaver({ delay: 800, setTimer: t.setTimer, clearTimer: t.clearTimer, version: 1, save: async () => { throw new ApiError(409, "version_conflict", "r1") }, onSaved: vi.fn(), onConflict, onError: vi.fn() })
    a.schedule({ n: 1 })
    await t.advance(800)
    await t.advance(0)
    expect(onConflict).toHaveBeenCalledTimes(1)
  })
  test("flush saves at once and waits for the save in flight, cancel drops a pending save", async () => {
    const t = timers()
    const saves: number[] = []
    const a = makeAutosaver({ delay: 800, setTimer: t.setTimer, clearTimer: t.clearTimer, version: 5, save: async (_f: { n: number }, v) => (saves.push(v), { version: v + 1 }), onSaved: vi.fn(), onConflict: vi.fn(), onError: vi.fn() })
    a.schedule({ n: 1 })
    await a.flush()
    expect(saves).toEqual([5])
    expect(a.version()).toBe(6)
    a.schedule({ n: 2 })
    a.cancel()
    await t.advance(2000)
    expect(saves).toEqual([5])
  })
})

describe("submit: one request id per attempt, reused on retry (F7)", () => {
  const ok = reportDto({ status: "submitted", state: "submitted", version: 2, submissions: 1, submittedAt: "2026-10-25T06:20:00.000Z" })
  test("the body is { version, requestId } and nothing else", async () => {
    const api = fakeApi({ [`POST /v1/shift-reports/{id}/submit`]: ok })
    const c = makeReportsClient(api.client, TZ)
    const s = makeSubmitter(c, () => "11111111-1111-4111-8111-111111111111")
    await s.submit(toReport(reportDto({ version: 1 }), TZ))
    expect(api.calls[0]).toMatchObject({ method: "post", path: "/v1/shift-reports/{id}/submit", body: { version: 1, requestId: "11111111-1111-4111-8111-111111111111" } })
    expect(Object.keys(api.calls[0]!.body as object).sort()).toEqual(["requestId", "version"])
  })
  test("a network failure then a retry sends the SAME requestId and the same version; success starts a new attempt next time", async () => {
    let n = 0
    const calls: { requestId: string; version: number }[] = []
    const api = {
      get: async () => ({}), put: async () => ({}), patch: async () => ({}), delete: async () => ({}),
      post: async (_p: string, o: { body: { requestId: string; version: number } }) => {
        calls.push(o.body)
        if (++n === 1) throw new TypeError("fetch failed")
        return ok
      },
    }
    const ids = ["a1111111-1111-4111-8111-111111111111", "b2222222-2222-4222-8222-222222222222"]
    const s = makeSubmitter(makeReportsClient(api as never, TZ), () => ids.shift()!)
    const r = toReport(reportDto({ version: 1 }), TZ)
    await expect(s.submit(r)).rejects.toBeInstanceOf(TypeError)
    await s.submit(r)
    expect(calls.map((c) => c.requestId)).toEqual([ids0(), ids0()])
    expect(calls.map((c) => c.version)).toEqual([1, 1])
    function ids0() {
      return "a1111111-1111-4111-8111-111111111111"
    }
    await s.submit(r) // a NEW attempt after the success
    expect(calls[2]!.requestId).toBe("b2222222-2222-4222-8222-222222222222")
  })
  test("a double tap sends ONE request (the second call gets the first call's promise)", async () => {
    let release: (v: unknown) => void = () => {}
    const posts: unknown[] = []
    const api = { get: async () => ({}), put: async () => ({}), patch: async () => ({}), delete: async () => ({}), post: (_p: string, o: unknown) => new Promise((res) => (posts.push(o), (release = res))) }
    const s = makeSubmitter(makeReportsClient(api as never, TZ), () => "c3333333-3333-4333-8333-333333333333")
    const r = toReport(reportDto({ version: 1 }), TZ)
    const a = s.submit(r)
    const b = s.submit(r)
    expect(posts).toHaveLength(1)
    release(ok)
    await Promise.all([a, b])
    expect(posts).toHaveLength(1)
  })
  test("a refusal that is final (409 version_conflict, 422 report_invalid) drops the attempt: the next submit gets a new id", async () => {
    const answers: unknown[] = [new ApiError(409, "version_conflict", "r"), ok]
    const bodies: { requestId: string }[] = []
    const api = { get: async () => ({}), put: async () => ({}), patch: async () => ({}), delete: async () => ({}), post: async (_p: string, o: { body: { requestId: string } }) => { bodies.push(o.body); const a = answers.shift(); if (a instanceof Error) throw a; return a } }
    const ids = ["d4444444-4444-4444-8444-444444444444", "e5555555-5555-4555-8555-555555555555"]
    const s = makeSubmitter(makeReportsClient(api as never, TZ), () => ids.shift()!)
    await expect(s.submit(toReport(reportDto({ version: 1 }), TZ))).rejects.toMatchObject({ code: "version_conflict" })
    await s.submit(toReport(reportDto({ version: 2 }), TZ))
    expect(bodies.map((b) => b.requestId)).toEqual(["d4444444-4444-4444-8444-444444444444", "e5555555-5555-4555-8555-555555555555"])
  })
  test("422 report_invalid maps errors[] to field errors the editor shows (summary, item:TSK-1001:note)", async () => {
    const api = fakeApi({})
    const e = new ApiError(422, "report_invalid", "r1", { errors: [{ key: "summary", message: "Write a short summary of the shift" }, { key: "item:TSK-1001:note", message: "Say what is blocking it" }] })
    expect(fieldErrorsOf(e)).toEqual({ summary: "Write a short summary of the shift", "item:TSK-1001:note": "Say what is blocking it" })
    expect(fieldErrorsOf(new ApiError(409, "report_locked", "r"))).toEqual({})
    expect(api.calls).toEqual([])
  })
  test("copy: report_locked, version_conflict, evidence_not_ready, self_review, reporting_off, shift_not_found", () => {
    const t = (code: string, status = 409) => userMessage(new ApiError(status, code, "r1")).text
    expect(t("report_locked")).toMatch(/locked|submitted/i)
    expect(t("version_conflict")).toBeTruthy()
    expect(t("self_review", 403)).toBe("You cannot review your own report.")
    expect(t("reporting_off", 422)).toMatch(/off/i)
    expect(t("report_not_submitted")).toBeTruthy()
    expect(t("report_invalid", 422)).toMatch(/required|highlighted|missing/i)
    expect(t("shift_not_found", 404)).toBeTruthy()
    expect(t("comment_required", 422)).toMatch(/comment/i)
  })
})

describe("the reports client", () => {
  test("open: POST /v1/shift-reports/open { patternId, date } and map the answer (a created or an existing report)", async () => {
    const api = fakeApi({ "POST /v1/shift-reports/open": reportDto() })
    const r = await makeReportsClient(api.client, TZ).open(PID, "2026-10-24")
    expect(api.calls[0]).toMatchObject({ body: { patternId: PID, date: "2026-10-24" } })
    expect(r.reportId).toBe(RID)
  })
  test("saveDraft: PUT …/draft with the version, id in the path; returns the mapped report", async () => {
    const api = fakeApi({ "PUT /v1/shift-reports/{id}/draft": reportDto({ version: 2 }) })
    const c = makeReportsClient(api.client, TZ)
    const r = toReport(reportDto({ version: 1 }), TZ)
    const saved = await c.saveDraft(r)
    expect(api.calls[0]).toMatchObject({ method: "put", path: "/v1/shift-reports/{id}/draft", body: { version: 1 } })
    expect(saved.version).toBe(2)
  })
  test("a write for a report that was never opened (no uuid) throws before any request", async () => {
    const api = fakeApi({})
    const c = makeReportsClient(api.client, TZ)
    const r = { ...toReport(reportDto(), TZ), reportId: null }
    await expect(c.saveDraft(r)).rejects.toThrow(/open/)
    expect(api.calls).toEqual([])
  })
  test("accept and return send the version and a comment; the owner gets 403 self_review (copy: You cannot review your own report)", async () => {
    const api = fakeApi({ "POST /v1/shift-reports/{id}/accept": reportDto({ status: "accepted", state: "accepted", version: 3 }), "POST /v1/shift-reports/{id}/return": problem(403, "self_review") })
    const c = makeReportsClient(api.client, TZ)
    const r = toReport(reportDto({ version: 2, status: "submitted", state: "submitted" }), TZ)
    await c.accept(r, "Thanks")
    expect(api.calls[0]).toMatchObject({ body: { version: 2, comment: "Thanks" } })
    const err = await c.returnIt(r, "Add the lift fault").catch((e) => e)
    expect(userMessage(err).text).toBe("You cannot review your own report.")
    expect(api.calls[1]).toMatchObject({ body: { version: 2, comment: "Add the lift fault" } })
  })
  test("versions map to wall time", async () => {
    const api = fakeApi({ "GET /v1/shift-reports/{id}/versions": { items: [{ v: 1, at: "2026-10-25T06:20:00.000Z", by: "Ann", note: "Submitted", snapshot: { summary: "", blockers: "", unplanned: [], extra: {}, attachmentFileIds: [], items: [] } }] } })
    const v = toVersions(await api.client.get("/v1/shift-reports/{id}/versions", { path: { id: RID } }), TZ)
    expect(v).toEqual([{ v: 1, at: "2026-10-25T06:20", by: "Ann", note: "Submitted" }])
  })
  test("an attachment: intent, PUT with the signed headers, complete, then clean; infected is refused", async () => {
    const put = vi.fn(async () => new Response(null, { status: 200 }))
    const states = ["pending", "clean"]
    const api = fakeApi({
      "POST /v1/shift-reports/{id}/uploads": { fileId: FILE, upload: { method: "PUT", url: "https://s3/x", headers: { "Content-Type": "image/jpeg" } } },
      "POST /v1/shift-reports/{id}/uploads/{fileId}/complete": () => ({ id: FILE, name: "a.jpg", mime: "image/jpeg", sizeBytes: 3, status: states.shift() }),
    })
    const c = makeReportsClient(api.client, TZ, put as never, async () => {})
    const r = toReport(reportDto(), TZ)
    const att = await c.upload(r, { name: "a.jpg", type: "image/jpeg", size: 3, arrayBuffer: async () => new ArrayBuffer(3) })
    expect(att).toMatchObject({ id: FILE, name: "a.jpg", kind: "image", status: "clean" })
    expect(put).toHaveBeenCalledWith("https://s3/x", expect.objectContaining({ method: "PUT", headers: { "Content-Type": "image/jpeg" } }))
    const bad = fakeApi({
      "POST /v1/shift-reports/{id}/uploads": { fileId: FILE, upload: { method: "PUT", url: "https://s3/x", headers: {} } },
      "POST /v1/shift-reports/{id}/uploads/{fileId}/complete": { id: FILE, name: "a", mime: "x", sizeBytes: 3, status: "infected" },
    })
    await expect(makeReportsClient(bad.client, TZ, put as never, async () => {}).upload(r, { name: "a", type: "x", size: 3, arrayBuffer: async () => new ArrayBuffer(3) })).rejects.toMatchObject({ reason: "infected" })
  })
  test("a report file opens through a same-origin path with a fresh nonce each time", () => {
    const a = reportFilePath(RID, FILE, "n1")
    const b = reportFilePath(RID, FILE, "n2")
    expect(a).toBe(`/v1/shift-reports/${RID}/files/${FILE}/download?o=n1`)
    expect(a).not.toBe(b)
  })
})

describe("the template", () => {
  test("maps the departments array and builds the PUT body from it; sizes over 64 KB are refused before the request", async () => {
    const data = toTemplateData(templateDto())
    expect(data.departments[0]!.dept).toBe("Security")
    expect(toTemplateBody(data)).toEqual({ departments: templateDto().departments })
    const big = { departments: [{ dept: "Security", sections: [{ id: "x", title: "x".repeat(70_000), enabled: true, fields: [] }] }] }
    expect(() => toTemplateBody(big)).toThrow(/template_too_large/)
    const api = fakeApi({ "PUT /v1/shift-reports/template": templateDto() })
    const out = await makeReportsClient(api.client, TZ).saveTemplate(data)
    expect(out.departments[0]!.dept).toBe("Security")
    expect(api.calls[0]!.body).toEqual({ departments: templateDto().departments })
  })
  test("422 invalid_template shows field errors; 409 template_dept_exists and template_too_large have copy", () => {
    const e = new ApiError(422, "invalid_template", "r", { errors: [{ key: "departments.0.dept", message: "Each department appears once" }] })
    expect(fieldErrorsOf(e)).toEqual({ "departments.0.dept": "Each department appears once" })
    expect(userMessage(new ApiError(409, "template_dept_exists", "r")).text).toMatch(/department/i)
    expect(userMessage(new ApiError(422, "template_too_large", "r")).text).toMatch(/too large|64/i)
    expect(userMessage(new ApiError(422, "invalid_template", "r")).text).toBeTruthy()
  })
})

describe("exports: request, poll (1 s then 2 s, bounded), open with a fresh nonce", () => {
  const waits: number[] = []
  const status = (s: string, extra: Record<string, unknown> = {}) => ({ id: "4d1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8", status: s, format: "xlsx", rowCount: null, expiresAt: null, errorCode: null, ...extra })
  test("queued then running then done: polls at 1 s then 2 s and stops", async () => {
    waits.length = 0
    const answers = [status("queued"), status("running"), status("done", { rowCount: 3, expiresAt: "2026-11-01T00:00:00.000Z" })]
    const api = fakeApi({ "POST /v1/report-exports": { id: "4d1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8" }, "GET /v1/report-exports/{id}": () => answers.shift() })
    const seen: string[] = []
    const out = await makeExportClient(api.client, { wait: async (ms) => void waits.push(ms), hidden: () => false }).run({ format: "xlsx", from: "2026-10-19", to: "2026-10-25" }, { onStatus: (s) => seen.push(s.status) })
    expect(out).toMatchObject({ kind: "done", id: "4d1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8" })
    expect(waits).toEqual([1000, 2000])
    expect(seen).toEqual(["queued", "running", "done"])
  })
  test("it stops when the tab is hidden and when the user leaves (abort); it is bounded", async () => {
    const api = fakeApi({ "POST /v1/report-exports": { id: "4d1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8" }, "GET /v1/report-exports/{id}": status("running") })
    let hidden = false
    const c = makeExportClient(api.client, { wait: async () => void (hidden = true), hidden: () => hidden, maxPolls: 50 })
    expect(await c.run({ format: "csv" })).toMatchObject({ kind: "paused" })
    const ac = new AbortController()
    const c2 = makeExportClient(api.client, { wait: async () => ac.abort(), hidden: () => false, maxPolls: 50 })
    expect(await c2.run({ format: "csv" }, { signal: ac.signal })).toMatchObject({ kind: "paused" })
    const c3 = makeExportClient(api.client, { wait: async () => {}, hidden: () => false, maxPolls: 4 })
    expect(await c3.run({ format: "csv" })).toMatchObject({ kind: "timeout" })
    // 3 runs: 1 POST each + at most maxPolls GETs for the bounded one
    expect(api.calls.filter((x) => x.method === "get").length).toBeLessThanOrEqual(1 + 1 + 4)
  })
  test("failed shows the code copy; expired shows 'Expired, export again'; range_too_long and export_too_large show their copy", async () => {
    const failed = fakeApi({ "POST /v1/report-exports": { id: "4d1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8" }, "GET /v1/report-exports/{id}": status("failed", { errorCode: "export_failed" }) })
    const f = await makeExportClient(failed.client, { wait: async () => {}, hidden: () => false }).run({ format: "pdf" })
    expect(f).toMatchObject({ kind: "failed", code: "export_failed" })
    expect(EXPORT_COPY.failed("export_failed")).toMatch(/could not|failed/i)
    expect(EXPORT_COPY.failed("forbidden")).toMatch(/access/i)
    expect(EXPORT_COPY.expired).toBe("Expired, export again.")
    const expired = fakeApi({ "POST /v1/report-exports": { id: "4d1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8" }, "GET /v1/report-exports/{id}": status("expired") })
    expect(await makeExportClient(expired.client, { wait: async () => {}, hidden: () => false }).run({ format: "pdf" })).toMatchObject({ kind: "expired" })
    expect(userMessage(new ApiError(422, "range_too_long", "r")).text).toMatch(/92|range|shorter/i)
    expect(userMessage(new ApiError(422, "export_too_large", "r")).text).toMatch(/too many|too large|narrow/i)
    expect(userMessage(new ApiError(422, "pdf_too_large", "r")).text).toMatch(/Excel|CSV/)
    expect(userMessage(new ApiError(409, "export_limit", "r")).text).toMatch(/wait|already|running/i)
  })
  test("the download path carries a fresh nonce and the id; the URL is never stored", () => {
    const id = "4d1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8"
    expect(exportPath(id, "n1")).toBe(`/v1/report-exports/${id}/download?o=n1`)
    expect(exportPath(id, "n1")).not.toBe(exportPath(id, "n2"))
    for (const f of walk("features/reports").filter((p) => /\.(ts|tsx)$/.test(p) && !/\.test\./.test(p))) {
      const src = read(f)
      expect(src, f).not.toMatch(/(localStorage|sessionStorage|indexedDB)/)
    }
  })
})

describe("export-rows parity: the one builder is the domain's", () => {
  test("every export of features/reports/export-rows IS the domain builder's (same function, same output on a shared fixture)", () => {
    const names = Object.keys(domain)
    expect(names.length).toBeGreaterThan(10)
    for (const n of names) expect(Object.prototype.hasOwnProperty.call(shim, n), n).toBe(true)
    for (const n of names) expect((shim as Record<string, unknown>)[n], n).toBe((domain as Record<string, unknown>)[n])
    const r: domain.ExportReport = {
      date: "2026-10-24", shiftName: "Night", team: "Security", person: "Ann Byrne", state: "late", start: "2026-10-24T22:00", end: "2026-10-25T06:00", due: "2026-10-25T07:00", submittedAt: "2026-10-25T07:05",
      hasReport: true, summary: "=1+1", blockers: "", unplanned: [{ text: "@cmd", minutes: 5 }], extra: [["Keys", "+yes"]], items: [{ ref: "TSK-1", title: "-x", status: "done", minutes: 30, note: "a,b" }],
    }
    expect(shim.inboxRowCells(r)).toEqual(domain.inboxRowCells(r))
    expect(shim.reportDocTables(r)).toEqual(domain.reportDocTables(r))
    expect(shim.tableToCsv({ head: ["a"], rows: [[r.summary]] })).toBe(domain.tableToCsv({ head: ["a"], rows: [[r.summary]] }))
    expect(shim.tableToCsv({ head: ["a"], rows: [[r.summary]] })).toContain(`"'=1+1"`) // formula-safe through the domain builder only
  })
  test("the old FE row builders (buildReportDoc, buildRangeDoc, toCsv) are gone and nothing builds export files in the browser", () => {
    const src = read("features/reports/export-rows.ts")
    expect(src).not.toMatch(/buildReportDoc|buildRangeDoc|csvSafe/)
    expect(src).toContain("@opsdesk/domain/report-export")
    const files = walk("features/reports").filter((p) => /\.(ts|tsx)$/.test(p) && !/\.test\./.test(p))
    for (const f of files) expect(read(f), f).not.toMatch(/jspdf|exceljs|URL\.createObjectURL/)
    expect(files).not.toContain("features/reports/store.ts")
  })
})
