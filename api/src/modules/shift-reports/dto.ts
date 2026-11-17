import { z } from "@hono/zod-openapi"

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
