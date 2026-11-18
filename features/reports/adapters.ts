// Pure mappers between the shift-report API's DTOs and the UI's types (B6 T6.7). A missing, extra or mistyped field THROWS (Review Focus 4): the API's own ReportSchema is strict,
// and so is this reader. Times (I12, F2, F3): the tenant wall times are DERIVED from the stored INSTANTS in the tenant's zone (`wallInTz`), never taken from the DTO's wall strings
// and never recomputed from a wall string, so the DST fold (25 Oct 2026) and gap (28 Mar 2027) read right. `tz` is the tenant's IANA zone from /v1/me/tenant.
import { ApiError } from "@/lib/api/problem"
import { reader, type Rec } from "@/lib/api/read"
import { wallInTz } from "@/lib/tz"
import { ITEM_STATUS_ORDER, REPORT_STATE_ORDER, type ItemStatus, type ReportState, type StoredStatus } from "@opsdesk/domain/shift-report"
import type { InboxRow, ReportAttachment, ReportItem, ReportVersionRow, ShiftReport } from "./types"

const R = reader("report")
const STORED: readonly StoredStatus[] = ["draft", "submitted", "accepted", "returned"]
const OUTCOMES = ["applied", "needs_evidence", "submitted_for_review", "skipped_archived", "skipped_unavailable"] as const
const ATT_STATUS = ["pending", "clean", "infected"] as const

/** An instant as the tenant's wall time, "YYYY-MM-DDTHH:mm". */
export const wall = (instant: string, tz: string): string => wallInTz(instant, tz).slice(0, 16)

/** "471 KB", "1.2 MB": a display size for an attachment. */
export const sizeText = (n: number): string => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

const REPORT_KEYS = [
  "id", "key", "userId", "patternId", "shiftName", "team", "date", "start", "end", "due", "startAt", "endAt", "dueAt", "status", "state", "version", "submissions", "items", "summary", "blockers",
  "unplanned", "extra", "attachments", "submittedAt", "reviewedAt", "reviewedBy", "comments",
] as const
const ITEM_KEYS = ["position", "taskId", "ref", "title", "due", "dueAt", "status", "minutes", "note", "taskStatus", "evidenceState"] as const

function toItem(v: unknown, tz: string): ReportItem {
  const r = R.rec(v, "report item")
  R.exact(r, ITEM_KEYS, ["outcome"])
  const dueAt = R.str(r, "dueAt")
  return {
    taskRef: R.str(r, "ref"),
    taskId: R.strOrNull(r, "taskId"),
    title: R.str(r, "title"),
    due: wall(dueAt, tz),
    dueAt,
    status: R.oneOf(r, "status", ITEM_STATUS_ORDER),
    minutes: R.int(r, "minutes"),
    note: R.str(r, "note"),
    taskStatus: R.strOrNull(r, "taskStatus"),
    evidenceState: R.strOrNull(r, "evidenceState"),
    ...(r.outcome === undefined ? {} : { outcome: R.oneOf(r, "outcome", OUTCOMES) }),
  }
}

function toAttachment(v: unknown): ReportAttachment {
  const r = R.rec(v, "attachment")
  R.exact(r, ["id", "name", "kind", "size", "status"])
  const bytes = R.num(r, "size")
  return { id: R.str(r, "id"), name: R.str(r, "name"), kind: R.oneOf(r, "kind", ["image", "file"] as const), size: sizeText(bytes), bytes, status: R.oneOf(r, "status", ATT_STATUS) }
}

/** `GET /v1/shift-reports/{id}` (and open, draft, submit, accept, return) as the UI's report. Strict. */
export function toReport(dto: unknown, tz: string): ShiftReport {
  const r = R.rec(dto, "report")
  R.exact(r, REPORT_KEYS)
  const startAt = R.str(r, "startAt")
  const endAt = R.str(r, "endAt")
  const dueAt = R.str(r, "dueAt")
  const submittedAtIso = R.strOrNull(r, "submittedAt")
  const reviewedAtIso = R.strOrNull(r, "reviewedAt")
  const reviewedBy = R.strOrNull(r, "reviewedBy")
  R.str(r, "start")
  R.str(r, "end")
  R.str(r, "due") // present and a string (the API's own wall strings are not shown: the instants are)
  const userId = R.strOrNull(r, "userId")
  const extra = R.rec(r.extra, "extra")
  for (const [k, v] of Object.entries(extra)) if (typeof v !== "string") R.rec(null, `extra.${k}`)
  return {
    id: R.str(r, "key"),
    reportId: R.str(r, "id"),
    userId,
    personId: userId ?? "",
    patternId: R.str(r, "patternId"),
    shiftName: R.str(r, "shiftName"),
    team: R.str(r, "team"),
    date: R.str(r, "date"),
    start: wall(startAt, tz),
    end: wall(endAt, tz),
    due: wall(dueAt, tz),
    startAt,
    endAt,
    dueAt,
    status: R.oneOf(r, "status", STORED),
    state: R.oneOf(r, "state", REPORT_STATE_ORDER),
    version: R.int(r, "version"),
    submissions: R.int(r, "submissions"),
    items: R.arr(r, "items").map((i) => toItem(i, tz)),
    summary: R.str(r, "summary"),
    blockers: R.str(r, "blockers"),
    unplanned: R.arr(r, "unplanned").map((u) => {
      const x = R.rec(u, "unplanned row")
      R.exact(x, ["id", "text", "minutes"])
      return { id: R.str(x, "id"), text: R.str(x, "text"), minutes: R.int(x, "minutes") }
    }),
    attachments: R.arr(r, "attachments").map(toAttachment),
    extra: extra as Record<string, string>,
    ...(submittedAtIso ? { submittedAt: wall(submittedAtIso, tz), submittedAtIso } : {}),
    ...(reviewedAtIso ? { reviewedAt: wall(reviewedAtIso, tz) } : {}),
    ...(reviewedBy ? { reviewedBy } : {}),
    comments: R.arr(r, "comments").map((c) => {
      const x = R.rec(c, "comment")
      R.exact(x, ["at", "by", "text"])
      return { at: wall(R.str(x, "at"), tz), by: R.str(x, "by"), text: R.str(x, "text") }
    }),
  }
}

const INBOX_KEYS = [
  "id", "key", "userId", "person", "patternId", "teamId", "shiftName", "team", "date", "start", "end", "due", "startAt", "endAt", "dueAt", "status", "state", "version", "submissions", "itemCount",
  "doneCount", "submittedAt", "reviewedAt", "reviewedBy",
] as const

/** One row of `GET /v1/shift-reports`. A virtual row has `id: null` and a `key` (open it with POST /v1/shift-reports/open before reading or writing). */
export function toInboxRow(dto: unknown, tz: string): InboxRow {
  const r = R.rec(dto, "inbox row")
  R.exact(r, INBOX_KEYS)
  const startAt = R.str(r, "startAt")
  const endAt = R.str(r, "endAt")
  const dueAt = R.str(r, "dueAt")
  const submittedAtIso = R.strOrNull(r, "submittedAt")
  const reviewedAtIso = R.strOrNull(r, "reviewedAt")
  const reviewedBy = R.strOrNull(r, "reviewedBy")
  R.str(r, "start")
  R.str(r, "end")
  R.str(r, "due")
  const key = R.str(r, "key")
  return {
    id: key,
    reportId: R.strOrNull(r, "id"),
    key,
    userId: R.str(r, "userId"),
    person: R.str(r, "person"),
    patternId: R.str(r, "patternId"),
    teamId: R.str(r, "teamId"),
    shiftName: R.str(r, "shiftName"),
    team: R.str(r, "team"),
    date: R.str(r, "date"),
    start: wall(startAt, tz),
    end: wall(endAt, tz),
    due: wall(dueAt, tz),
    startAt,
    endAt,
    dueAt,
    status: R.oneOf(r, "status", STORED),
    state: R.oneOf(r, "state", REPORT_STATE_ORDER),
    version: R.int(r, "version"),
    submissions: R.int(r, "submissions"),
    itemCount: R.int(r, "itemCount"),
    doneCount: R.int(r, "doneCount"),
    ...(submittedAtIso ? { submittedAt: wall(submittedAtIso, tz), submittedAtIso } : {}),
    ...(reviewedAtIso ? { reviewedAt: wall(reviewedAtIso, tz) } : {}),
    ...(reviewedBy ? { reviewedBy } : {}),
  }
}

/** `GET /v1/shift-reports/{id}/versions`: the history lines (the frozen snapshot is not shown). */
export function toVersions(dto: unknown, tz: string): ReportVersionRow[] {
  const r = R.rec(dto, "versions")
  return R.arr(r, "items").map((v) => {
    const x = R.rec(v, "version")
    return { v: R.int(x, "v"), at: wall(R.str(x, "at"), tz), by: R.str(x, "by"), note: R.str(x, "note") }
  })
}

/** The body of `PUT …/draft`: the report's CURRENT version and what the member typed. Throws without a version (a write never guesses one). Only rows whose task still exists are sent; an infected file is never attached. */
export function toReportBody(r: ShiftReport) {
  if (!Number.isInteger(r.version) || r.version < 1) throw new Error("reports: a draft save needs the report version")
  return {
    version: r.version,
    items: r.items.flatMap((i) => (i.taskId ? [{ taskId: i.taskId, status: i.status as ItemStatus, minutes: i.minutes, note: i.note }] : [])),
    summary: r.summary,
    blockers: r.blockers,
    unplanned: r.unplanned.map((u) => ({ id: u.id, text: u.text, minutes: u.minutes })),
    extra: r.extra,
    attachmentFileIds: r.attachments.filter((a) => a.status !== "infected").map((a) => a.id),
  }
}

/** A report as the domain's validateReport wants it (the same required-field rules the API applies on submit). */
export function forValidation(r: ShiftReport) {
  return {
    ...r,
    createdAt: "",
    updatedAt: "",
    versions: [],
    items: r.items.map((i) => ({ taskRef: i.taskRef, title: i.title, due: i.due, status: i.status, minutes: i.minutes, note: i.note })),
  }
}

/** `errors[{ key, message }]` of a 422 (`report_invalid`, `invalid_template`) as key to message; empty for any other problem. */
export function fieldErrorsOf(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError) || e.status !== 422) return {}
  const list = e.extra.errors
  if (!Array.isArray(list)) return {}
  const out: Record<string, string> = {}
  for (const x of list) {
    if (x && typeof x === "object" && typeof (x as Rec).key === "string" && typeof (x as Rec).message === "string") out[(x as Rec).key as string] = (x as Rec).message as string
  }
  return out
}

// ---- template (FR-M1-25): shared with Settings -> Report template (lib/report-template.ts) ----
export { TEMPLATE_MAX_BYTES, toTemplateBody, toTemplateData } from "@/lib/report-template"

export type { ReportState }
