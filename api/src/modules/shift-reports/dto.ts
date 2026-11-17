import { z } from "@hono/zod-openapi"
import { EXPORT_FORMATS } from "@opsdesk/domain/report-export"

const RID = "9b1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8"
const TID = "6f1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8"
const FID = "3a1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8"
const PID = "7c1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8"

const isDate = (v: string) => {
  const d = new Date(`${v}T00:00:00Z`)
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}
const date = z.string().refine(isDate, "a real YYYY-MM-DD date")

export const ITEM_STATUSES = ["done", "in_progress", "blocked", "not_started"] as const

// ---------- limits (the brief; every one is also a CHECK or a code rule) ----------
export const LIMITS = { summary: 4000, blockers: 2000, unplannedRows: 20, unplannedText: 300, minutes: 1440, attachments: 5, extraAnswers: 50, extraText: 2000, note: 1000, items: 200 } as const

const minutes = z.number().int().min(0).max(LIMITS.minutes)
const UnplannedRow = z.strictObject({ id: z.string().min(1).max(64), text: z.string().max(LIMITS.unplannedText), minutes })
const ItemInput = z.strictObject({ taskId: z.uuid(), status: z.enum(ITEM_STATUSES), minutes, note: z.string().max(LIMITS.note) })
const EXTRA_KEY = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/

export const IdParam = z.object({ id: z.uuid().openapi({ param: { name: "id", in: "path" }, example: RID }) })
export const FileParams = z.object({
  id: z.uuid().openapi({ param: { name: "id", in: "path" }, example: RID }),
  fileId: z.uuid().openapi({ param: { name: "fileId", in: "path" }, example: FID }),
})

export const OpenBody = z
  .strictObject({ patternId: z.uuid(), date })
  .openapi({ example: { patternId: PID, date: "2026-10-24" } })

export const DraftBody = z
  .strictObject({
    version: z.number().int().min(1),
    items: z.array(ItemInput).max(LIMITS.items).refine((a) => new Set(a.map((i) => i.taskId)).size === a.length, "one row per task"),
    summary: z.string().max(LIMITS.summary),
    blockers: z.string().max(LIMITS.blockers),
    unplanned: z.array(UnplannedRow).max(LIMITS.unplannedRows),
    extra: z
      .record(z.string().regex(EXTRA_KEY), z.string().max(LIMITS.extraText))
      .refine((r) => Object.keys(r).length <= LIMITS.extraAnswers, "at most 50 answers"),
    attachmentFileIds: z.array(z.uuid()).max(LIMITS.attachments).refine((a) => new Set(a).size === a.length, "no duplicates").optional(),
  })
  .openapi({
    example: {
      version: 1,
      items: [{ taskId: TID, status: "done", minutes: 30, note: "Locked up at 05:40" }],
      summary: "Quiet night, one lift fault.", blockers: "", unplanned: [{ id: "u1", text: "Helped the neighbouring site", minutes: 20 }],
      extra: { "handover.next-shift": "Lift engineer booked for 9am" }, attachmentFileIds: [FID],
    },
  })

export const SubmitBody = z.strictObject({ version: z.number().int().min(1), requestId: z.uuid() }).openapi({ example: { version: 2, requestId: "0d9f2b7e-3c41-4b7e-9c41-2a5b7e90d3f8" } })

export const UploadBody = z
  .strictObject({
    name: z.string().min(1).max(255).regex(/^[^\u0000-\u001f\u007f]+$/, "no control characters"),
    mime: z.string().min(1).max(255),
    sizeBytes: z.number().int().min(1),
  })
  .openapi({ example: { name: "site-photo.jpg", mime: "image/jpeg", sizeBytes: 482113 } })

export const UploadIntent = z
  .object({ fileId: z.string(), upload: z.object({ method: z.literal("PUT"), url: z.string(), headers: z.record(z.string(), z.string()) }) })
  .openapi({ example: { fileId: FID, upload: { method: "PUT", url: "https://<account_id>.r2.cloudflarestorage.com/<bucket>/u/<tenant>/<fileId>?X-Amz-...", headers: { "Content-Type": "image/jpeg", "Content-Length": "482113" } } } })

export const ReportFileSchema = z
  .object({
    id: z.string(), name: z.string(), mime: z.string(), sizeBytes: z.number(), status: z.enum(["pending", "clean", "infected", "deleted"]), signature: z.string().nullable(),
    sha256: z.string().nullable(), ownerUserId: z.string().nullable(), createdAt: z.string(), scannedAt: z.string().nullable(),
  })
  .openapi({ example: { id: FID, name: "site-photo.jpg", mime: "image/jpeg", sizeBytes: 482113, status: "pending", signature: null, sha256: null, ownerUserId: "usr_8Kq2mZ4tW1", createdAt: "2026-10-25T06:10:00.000Z", scannedAt: null } })

// ---------- output ----------
export type ReportItemDto = {
  position: number; taskId: string | null; ref: string; title: string; due: string; dueAt: string; status: (typeof ITEM_STATUSES)[number]; minutes: number; note: string
  /** The task's own status now (null once the task was purged). */
  taskStatus: string | null
  /** FR-M1-48, read-only: verified | awaiting | rejected | missing | attached | null. */
  evidenceState: string | null
  /** What the last submit did with this row (absent before the first submit). */
  outcome?: "applied" | "needs_evidence" | "submitted_for_review" | "skipped_archived" | "skipped_unavailable"
}
export type ReportAttachmentDto = { id: string; name: string; kind: "image" | "file"; size: number; status: "pending" | "clean" | "infected" }
export type ReportDto = {
  id: string; key: string; userId: string | null; patternId: string; shiftName: string; team: string; date: string
  start: string; end: string; due: string; startAt: string; endAt: string; dueAt: string
  status: "draft" | "submitted" | "accepted" | "returned"; state: "draft" | "submitted" | "late" | "missing" | "accepted" | "returned"; version: number; submissions: number
  items: ReportItemDto[]; summary: string; blockers: string; unplanned: { id: string; text: string; minutes: number }[]; extra: Record<string, string>
  attachments: ReportAttachmentDto[]; submittedAt: string | null; reviewedAt: string | null; reviewedBy: string | null; comments: { at: string; by: string; text: string }[]
}
export type VersionDto = { v: number; at: string; by: string; note: string; snapshot: unknown }

const Any = z.any()
export const ReportSchema = z
  .object({ id: z.uuid() })
  .catchall(Any)
  .openapi({
    example: {
      id: RID, key: `usr_8Kq2mZ4tW1:${PID}:2026-10-24`, userId: "usr_8Kq2mZ4tW1", patternId: PID, shiftName: "Night", team: "Security", date: "2026-10-24",
      start: "2026-10-24T22:00", end: "2026-10-25T06:00", due: "2026-10-25T07:00", startAt: "2026-10-24T21:00:00.000Z", endAt: "2026-10-25T06:00:00.000Z", dueAt: "2026-10-25T07:00:00.000Z",
      status: "draft", state: "draft", version: 1, submissions: 0,
      items: [{ position: 0, taskId: TID, ref: "TSK-1001", title: "Check fire exits", due: "2026-10-25T03:00", dueAt: "2026-10-25T03:00:00.000Z", status: "not_started", minutes: 0, note: "", taskStatus: "not_started", evidenceState: null }],
      summary: "", blockers: "", unplanned: [], extra: {}, attachments: [], submittedAt: null, reviewedAt: null, reviewedBy: null, comments: [],
    },
  })
export const CurrentOut = z
  .object({ item: z.object({ key: z.string(), shiftName: z.string(), shiftDate: z.string(), startAt: z.string(), endAt: z.string(), dueAt: z.string(), state: z.string(), reportId: z.string().nullable() }).nullable() })
  .openapi({ example: { item: { key: `usr_8Kq2mZ4tW1:${PID}:2026-10-24`, shiftName: "Night", shiftDate: "2026-10-24", startAt: "2026-10-24T21:00:00.000Z", endAt: "2026-10-25T06:00:00.000Z", dueAt: "2026-10-25T07:00:00.000Z", state: "draft", reportId: null } } })
export const VersionsOut = z
  .object({ items: z.array(z.object({ v: z.number(), at: z.string(), by: z.string(), note: z.string(), snapshot: z.any() })) })
  .openapi({ example: { items: [{ v: 1, at: "2026-10-25T06:20:00.000Z", by: "Alex Byrne", note: "Submitted", snapshot: { summary: "Quiet night.", items: [] } }] } })

// ---------- T5.3: review, inbox, template ----------
export const COMMENT_MAX = 2000
/** `comment` is checked by the service (422 comment_required for a return), never by zod (which would answer 400 for an absent one). */
export const AcceptBody = z
  .strictObject({ version: z.number().int().min(1), comment: z.string().max(COMMENT_MAX).optional() })
  .openapi({ example: { version: 2, comment: "Thanks, all good" } })
export const ReturnBody = z
  .strictObject({ version: z.number().int().min(1), comment: z.string().max(COMMENT_MAX).optional() })
  .openapi({ example: { version: 2, comment: "Please add the lift fault and the time spent on it" } })

export const INBOX_STATUSES = ["all", "draft", "submitted", "late", "missing", "accepted", "returned"] as const
export type InboxStatus = (typeof INBOX_STATUSES)[number]
export const INBOX_MAX_DAYS = 31
export const INBOX_DEFAULT_DAYS = 7

export const InboxQuery = z.object({
  from: date.optional().openapi({ example: "2026-10-18" }),
  to: date.optional().openapi({ example: "2026-10-24" }),
  team: z.uuid().optional().openapi({ example: "5e1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8" }),
  person: z.string().min(1).max(100).optional().openapi({ example: "usr_8Kq2mZ4tW1" }),
  status: z.enum(INBOX_STATUSES).default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(400).optional(),
})

export type InboxItemDto = {
  id: string | null; key: string; userId: string; person: string; patternId: string; teamId: string; shiftName: string; team: string; date: string
  start: string; end: string; due: string; startAt: string; endAt: string; dueAt: string
  status: "draft" | "submitted" | "accepted" | "returned"; state: "draft" | "submitted" | "late" | "missing" | "accepted" | "returned"; version: number; submissions: number
  itemCount: number; doneCount: number; submittedAt: string | null; reviewedAt: string | null; reviewedBy: string | null
}
const InboxItem = z.object({
  id: z.string().nullable(), key: z.string(), userId: z.string(), person: z.string(), patternId: z.string(), teamId: z.string(), shiftName: z.string(), team: z.string(), date: z.string(),
  start: z.string(), end: z.string(), due: z.string(), startAt: z.string(), endAt: z.string(), dueAt: z.string(),
  status: z.enum(["draft", "submitted", "accepted", "returned"]), state: z.enum(["draft", "submitted", "late", "missing", "accepted", "returned"]), version: z.number(), submissions: z.number(),
  itemCount: z.number(), doneCount: z.number(), submittedAt: z.string().nullable(), reviewedAt: z.string().nullable(), reviewedBy: z.string().nullable(),
})
export const InboxOut = z
  .object({ items: z.array(InboxItem), nextCursor: z.string().nullable() })
  .openapi({
    example: {
      items: [
        { id: RID, key: `usr_8Kq2mZ4tW1:${PID}:2026-10-24`, userId: "usr_8Kq2mZ4tW1", person: "Alex Byrne", patternId: PID, teamId: "5e1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8", shiftName: "Night", team: "Security", date: "2026-10-24", start: "2026-10-24T22:00", end: "2026-10-25T06:00", due: "2026-10-25T07:00", startAt: "2026-10-24T21:00:00.000Z", endAt: "2026-10-25T06:00:00.000Z", dueAt: "2026-10-25T07:00:00.000Z", status: "submitted", state: "submitted", version: 2, submissions: 1, itemCount: 4, doneCount: 3, submittedAt: "2026-10-25T06:20:00.000Z", reviewedAt: null, reviewedBy: null },
        { id: null, key: `usr_3Zt9pQ7rLm:${PID}:2026-10-24`, userId: "usr_3Zt9pQ7rLm", person: "Sam Doyle", patternId: PID, teamId: "5e1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8", shiftName: "Night", team: "Security", date: "2026-10-24", start: "2026-10-24T22:00", end: "2026-10-25T06:00", due: "2026-10-25T07:00", startAt: "2026-10-24T21:00:00.000Z", endAt: "2026-10-25T06:00:00.000Z", dueAt: "2026-10-25T07:00:00.000Z", status: "draft", state: "missing", version: 0, submissions: 0, itemCount: 0, doneCount: 0, submittedAt: null, reviewedAt: null, reviewedBy: null },
      ],
      nextCursor: null,
    },
  })

// ---------- template (FR-M1-25): TemplateData of @opsdesk/domain/shift-report, validated ----------
export const TEMPLATE_LIMITS = { departments: 50, sections: 12, fields: 12, dept: 100, title: 100, label: 200 } as const
const TEMPLATE_ID = /^[a-z0-9_]{1,40}$/
const TemplateField = z.strictObject({ id: z.string().regex(TEMPLATE_ID, "[a-z0-9_]{1,40}"), label: z.string().min(1).max(TEMPLATE_LIMITS.label), required: z.boolean() })
const TemplateSection = z.strictObject({
  id: z.string().regex(TEMPLATE_ID, "[a-z0-9_]{1,40}"), title: z.string().min(1).max(TEMPLATE_LIMITS.title), enabled: z.boolean(), fields: z.array(TemplateField).max(TEMPLATE_LIMITS.fields),
})
const TemplateDepartment = z.strictObject({ dept: z.string().trim().min(1).max(TEMPLATE_LIMITS.dept), sections: z.array(TemplateSection).max(TEMPLATE_LIMITS.sections) })
const TEMPLATE_EXAMPLE = {
  departments: [
    {
      dept: "Security",
      sections: [
        { id: "tasks", title: "Tasks in the shift", enabled: true, fields: [{ id: "time", label: "Time spent on done and in-progress tasks", required: true }, { id: "note", label: "Note on blocked tasks", required: true }] },
        { id: "summary", title: "Summary", enabled: true, fields: [{ id: "summary", label: "Shift summary", required: true }] },
        { id: "handover", title: "Handover", enabled: true, fields: [{ id: "keys", label: "Keys returned", required: false }] },
      ],
    },
  ],
}
export const TemplateBody = z.strictObject({ departments: z.array(TemplateDepartment).min(1).max(TEMPLATE_LIMITS.departments) }).openapi({ example: TEMPLATE_EXAMPLE })
export const TemplateOut = z
  .object({ custom: z.boolean(), departments: z.array(z.object({ dept: z.string(), sections: z.array(z.object({ id: z.string(), title: z.string(), enabled: z.boolean(), fields: z.array(z.object({ id: z.string(), label: z.string(), required: z.boolean() })) })) })) })
  .openapi({ example: { custom: true, ...TEMPLATE_EXAMPLE } })

// ---------- exports (T5.5) ----------
const XID = "4d1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8"
export const ExportIdParam = z.object({ id: z.uuid().openapi({ param: { name: "id", in: "path" }, example: XID }) })
export const ExportBody = z
  .strictObject({
    format: z.enum(EXPORT_FORMATS),
    reportId: z.uuid().optional(),
    from: date.optional(),
    to: date.optional(),
    team: z.uuid().optional(),
    person: z.string().min(1).max(100).optional(),
    status: z.enum(INBOX_STATUSES).optional(),
  })
  .refine((b) => !b.reportId || (b.from === undefined && b.to === undefined && b.team === undefined && b.person === undefined && b.status === undefined), "a single report takes no range or filters")
  .openapi({ example: { format: "xlsx", from: "2026-10-19", to: "2026-10-25", team: "5e1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8", status: "all" } })
export const ExportCreated = z.object({ id: z.uuid() }).openapi({ example: { id: XID } })
export const ExportOut = z
  .object({ id: z.uuid(), status: z.enum(["queued", "running", "done", "failed"]), format: z.enum(EXPORT_FORMATS), rowCount: z.number().int().nullable(), expiresAt: z.string().nullable(), errorCode: z.string().nullable() })
  .openapi({ example: { id: XID, status: "done", format: "xlsx", rowCount: 42, expiresAt: "2026-11-02T12:34:00.000Z", errorCode: null } })
export type ExportDto = z.infer<typeof ExportOut>
