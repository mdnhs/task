// The browser side of shift reports (B6 T6.7): every write is ONE call to the API through the BFF, with the API's shapes. Errors are ApiErrors: the caller shows userMessage(e).
// Rules kept here so no component can break them:
//  - a draft save and a submit send the report's CURRENT `version` (D4); a report that was never opened (no uuid) throws before any request;
//  - a submit is { version, requestId } and nothing else. The requestId is made ONCE per attempt and REUSED on a retry (F7), so a retry after a network error can never double-submit;
//    a double tap shares the one request in flight;
//  - the autosave is debounced (800 ms) and carries the version it last saw: an edit made during a save waits for its answer and goes out with the NEW version;
//  - an attachment is intent -> direct PUT of the bytes -> complete -> wait until the malware scan says clean; an infected file is refused, never attached.
import type { ApiClient } from "@/lib/api/client"
import { ApiError, classifyApiError } from "@/lib/api/problem"
import { fetchTemplate, putTemplate, type TemplateWithEtag } from "@/lib/report-template"
import type { TemplateData } from "@opsdesk/domain/shift-report"
import { sizeText, toReport, toReportBody, toTemplateData, toVersions } from "./adapters"
import type { ReportAttachment, ReportVersionRow, ShiftReport } from "./types"

const needId = (r: Pick<ShiftReport, "reportId">): string => r.reportId ?? bad("open the report first (a shift with no report yet has no id)")
const bad = (what: string): never => {
  throw new Error(`reports: ${what}`)
}

/** A file the server refused after scanning (infected), or that never became clean in time. The message is ours, never the server's text. */
export class ReportFileRefused extends Error {
  readonly reason: "infected" | "slow" | "upload"
  constructor(reason: "infected" | "slow" | "upload") {
    super(`reports: file ${reason}`)
    this.name = "ReportFileRefused"
    this.reason = reason
  }
}

export type UploadFile = { name: string; type: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }
export type Waiter = (ms: number) => Promise<void>
const sleep: Waiter = (ms) => new Promise((r) => setTimeout(r, ms))

/** The path that opens ONE report attachment: our own origin, a fresh `nonce` every call, no credential in it. Built at the moment of a click; never stored. */
export const reportFilePath = (reportId: string, fileId: string, nonce: string): string => `/v1/shift-reports/${encodeURIComponent(reportId)}/files/${encodeURIComponent(fileId)}/download?o=${encodeURIComponent(nonce)}`

export function makeReportsClient(api: ApiClient, tz: string, put: typeof fetch = (...a) => fetch(...a), wait: Waiter = sleep) {
  return {
    /** A shift's report is created on first open (idempotent on member, pattern and date). 404 shift_not_found, 422 reporting_off. */
    async open(patternId: string, date: string): Promise<ShiftReport> {
      return toReport(await api.post("/v1/shift-reports/open", { body: { patternId, date } }), tz)
    },
    async get(reportId: string): Promise<ShiftReport> {
      return toReport(await api.get("/v1/shift-reports/{id}", { path: { id: reportId } }), tz)
    },
    async saveDraft(r: ShiftReport): Promise<ShiftReport> {
      return toReport(await api.put("/v1/shift-reports/{id}/draft", { path: { id: needId(r) }, body: toReportBody(r) }), tz)
    },
    async submit(r: ShiftReport, requestId: string): Promise<ShiftReport> {
      if (!Number.isInteger(r.version) || r.version < 1) bad("a submit needs the report version")
      return toReport(await api.post("/v1/shift-reports/{id}/submit", { path: { id: needId(r) }, body: { version: r.version, requestId } }), tz)
    },
    async accept(r: ShiftReport, comment?: string): Promise<ShiftReport> {
      return toReport(await api.post("/v1/shift-reports/{id}/accept", { path: { id: needId(r) }, body: { version: r.version, ...(comment?.trim() ? { comment: comment.trim() } : {}) } }), tz)
    },
    /** A return needs a comment (422 comment_required otherwise). */
    async returnIt(r: ShiftReport, comment: string): Promise<ShiftReport> {
      return toReport(await api.post("/v1/shift-reports/{id}/return", { path: { id: needId(r) }, body: { version: r.version, comment: comment.trim() } }), tz)
    },
    async versions(r: Pick<ShiftReport, "reportId">): Promise<ReportVersionRow[]> {
      return toVersions(await api.get("/v1/shift-reports/{id}/versions", { path: { id: needId(r) } }), tz)
    },
    /** Intent, PUT with exactly the headers the API signed, complete, then wait for `clean`. `complete` is idempotent, so it doubles as the status poll. */
    async upload(r: Pick<ShiftReport, "reportId">, file: UploadFile, onScanning?: () => void): Promise<ReportAttachment> {
      const id = needId(r)
      const intent = await api.post("/v1/shift-reports/{id}/uploads", { path: { id }, body: { name: file.name, mime: file.type, sizeBytes: file.size } })
      const res = await put(intent.upload.url, { method: "PUT", headers: intent.upload.headers, body: await file.arrayBuffer() })
      if (!res.ok) throw new ReportFileRefused("upload")
      onScanning?.()
      for (let i = 0; i < 40; i++) {
        const f = await api.post("/v1/shift-reports/{id}/uploads/{fileId}/complete", { path: { id, fileId: intent.fileId } })
        if (f.status === "clean") return { id: f.id, name: f.name, kind: f.mime.startsWith("image/") ? "image" : "file", size: sizeText(f.sizeBytes), bytes: f.sizeBytes, status: "clean" }
        if (f.status === "infected" || f.status === "deleted") throw new ReportFileRefused("infected")
        await wait(1000)
      }
      throw new ReportFileRefused("slow")
    },
    async template(): Promise<TemplateData> {
      return toTemplateData(await api.get("/v1/shift-reports/template"))
    },
    async templateWithEtag(): Promise<TemplateWithEtag> {
      return fetchTemplate(api)
    },
    /** `etag` is the tag the template was read with (If-Match); the answer holds the new one. */
    async saveTemplate(data: TemplateData, etag: string | null): Promise<TemplateWithEtag> {
      return putTemplate(api, data, etag)
    },
  }
}

export type ReportsClient = ReturnType<typeof makeReportsClient>

/** A final answer: the same request id can never succeed, so the next try is a new attempt. Network failures, 5xx and a busy `409 retry` are NOT final: the retry carries the same id. */
const isFinal = (e: unknown): boolean => {
  const k = classifyApiError(e)
  return e instanceof ApiError && e.status >= 400 && e.status < 500 && k.kind !== "retry" && e.status !== 429 && e.status !== 408
}

/**
 * Submit with an idempotent request id (F7). One attempt = one id: it is kept across a network error, a 5xx and a busy retry (the server returns the stored result for a request id it
 * already finished, writing nothing), and dropped after a success or a final refusal. A second call while one is in flight gets the same promise: a double tap sends ONE request.
 */
export function makeSubmitter(client: Pick<ReportsClient, "submit">, newId: () => string = () => crypto.randomUUID()) {
  let attempt: { reportId: string; version: number; requestId: string } | null = null
  let inflight: Promise<ShiftReport> | null = null
  return {
    submit(r: ShiftReport): Promise<ShiftReport> {
      if (inflight) return inflight
      const reportId = needId(r)
      if (!attempt || attempt.reportId !== reportId || attempt.version !== r.version) attempt = { reportId, version: r.version, requestId: newId() }
      const a = attempt
      const p = client.submit(r, a.requestId).then(
        (v) => {
          attempt = null
          return v
        },
        (e) => {
          if (isFinal(e)) attempt = null
          throw e
        },
      )
      inflight = p.finally(() => {
        inflight = null
      })
      return inflight
    },
    /** The id of the attempt in progress (for tests and logs), or null. */
    requestId: (): string | null => attempt?.requestId ?? null,
  }
}

export type AutosaverOptions<F, S extends { version: number }> = {
  /** Milliseconds after the last edit (800). */
  delay: number
  /** The report version the editor loaded. */
  version: number
  save(form: F, version: number): Promise<S>
  onSaved(saved: S): void
  /** 409 version_conflict: another tab or a manager changed the report. Saving stops until `resume`. */
  onConflict(): void
  onError(e: unknown): void
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (id: unknown) => void
}

/** Debounced draft autosave (800 ms) that always sends the version it last saw and adopts the one the server answers with. */
export function makeAutosaver<F, S extends { version: number }>(o: AutosaverOptions<F, S>) {
  const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = o.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>))
  let version = o.version
  let pending: { form: F } | null = null
  let timer: unknown = null
  let saving: Promise<void> | null = null
  let stopped = false

  function run(): Promise<void> {
    if (saving || !pending || stopped) return saving ?? Promise.resolve()
    const { form } = pending
    pending = null
    saving = (async () => {
      try {
        const saved = await o.save(form, version)
        version = saved.version
        o.onSaved(saved)
      } catch (e) {
        if (e instanceof ApiError && e.code === "version_conflict") {
          // the user's text is NOT dropped: it stays pending (a newer edit wins) until they choose Keep mine or Reload theirs
          stopped = true
          if (!pending) pending = { form }
          o.onConflict()
        } else {
          o.onError(e)
        }
      } finally {
        saving = null
        // an edit that arrived during the save goes out now, with the version the answer brought
        if (pending && timer === null && !stopped) void run()
      }
    })()
    return saving
  }

  return {
    schedule(form: F): void {
      pending = { form }
      if (stopped) return
      if (timer !== null) clearTimer(timer)
      timer = setTimer(() => {
        timer = null
        void run()
      }, o.delay)
    },
    /** Save what is pending now and wait for any save in flight (before a submit or leaving the page). */
    async flush(): Promise<void> {
      if (timer !== null) {
        clearTimer(timer)
        timer = null
      }
      while ((pending && !stopped) || saving) {
        if (saving) await saving
        else await run()
      }
    },
    cancel(): void {
      if (timer !== null) clearTimer(timer)
      timer = null
      pending = null
    },
    /** Keep mine: continue on the server's NEW version; the pending local text is saved at once. */
    keep(v: number): void {
      version = v
      stopped = false
      if (pending) void run()
    },
    /** Saving is paused by a conflict, waiting for the user's choice. */
    isStopped: (): boolean => stopped,
    /** After the report was reloaded (Reload theirs): start again from the server's version, local text dropped. */
    resume(v: number): void {
      version = v
      stopped = false
      pending = null
    },
    version: (): number => version,
    dirty: (): boolean => pending !== null || saving !== null,
  }
}
