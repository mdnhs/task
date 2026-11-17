import { z } from "@hono/zod-openapi"
import { EVIDENCE_KINDS } from "../../db/schema"
import { EvidenceRuleSchema, Version } from "../tasks/dto"

const TID = "6f1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8"
const EID = "9a2b7c14-5e60-4d38-8f21-0c6d4e1b7a93"
const UTC_EX = "2026-11-20T10:00:00.000Z"
const Ids = z.array(z.uuid()).min(1).max(100)

export const EvidenceParams = z.object({
  id: z.uuid().openapi({ param: { name: "id", in: "path" }, example: TID }),
  evidenceId: z.uuid().openapi({ param: { name: "evidenceId", in: "path" }, example: EID }),
})

/** Strict on purpose: there is no `location` field (Q6), and an unknown field is a 400, never silently dropped. */
export const EvidenceBody = z
  .object({
    kind: z.enum(EVIDENCE_KINDS),
    fileId: z.uuid().optional().openapi({ description: "A `task_evidence` upload of THIS task, made by the caller (POST /v1/tasks/{id}/uploads, purpose evidence)" }),
    text: z.string().trim().min(1).max(2000).optional().openapi({ description: "kind note. (kind checklist ignores it: the server writes `Checklist n/m` from the task's checklist)" }),
    url: z.string().trim().min(1).max(2000).optional().openapi({ description: "kind drive: a Google Drive or Docs link; needs the Drive device policy (403 device_policy)" }),
    source: z.enum(["camera", "upload"]).optional(),
    capturedAt: z.iso.datetime().optional().openapi({ description: "The client's claim, checked against the server clock: not more than 5 minutes ahead, not older than 30 days (422 invalid_captured_at)" }),
  })
  .strict()
  .openapi({ example: { kind: "photo", fileId: TID, source: "camera", capturedAt: UTC_EX } })

export const EvidenceItem = z
  .object({
    id: z.string(), kind: z.string(), name: z.string(), by: z.string(), at: z.string(), review: z.enum(["pending", "accepted", "rejected"]), reason: z.string().optional(),
    round: z.number().int(), locked: z.boolean(), source: z.string().optional(), capturedAt: z.string().optional(), url: z.string().optional(), size: z.number().optional(),
    fileId: z.string().optional(), fileStatus: z.enum(["pending", "clean", "infected", "deleted"]).optional(), reviewedBy: z.string().optional(), reviewedAt: z.string().optional(),
  })
  .openapi({ example: { id: EID, kind: "photo", name: "floor.jpg", by: "Ann Byrne", at: "2026-11-20T10:00:00", review: "pending", round: 1, locked: false, source: "camera", capturedAt: UTC_EX, fileId: TID, fileStatus: "clean" } })

export const RuleBody = z.object({ version: Version, rule: EvidenceRuleSchema }).openapi({ example: { version: 1, rule: { mode: "required", types: ["photo", "note"], min: 1, instruction: "Photo of the cleaned area", review: "manager" } } })

export const VerifyBody = z
  .object({ version: Version, evidenceIds: Ids.optional().openapi({ description: "Default: every pending item of the current round" }) })
  .openapi({ example: { version: 3 } })
export const RejectBody = z
  .object({ version: Version, reason: z.string().trim().min(1).max(500), evidenceIds: Ids.optional().openapi({ description: "Default: every pending item of the current round" }) })
  .openapi({ example: { version: 3, reason: "The photo is blurry; retake it from the doorway" } })

export const BatchBody = z
  .object({ items: z.array(z.object({ taskId: z.uuid(), version: Version, evidenceIds: Ids.optional() })).min(1).max(50) })
  .openapi({ example: { items: [{ taskId: TID, version: 3 }] } })
export const BatchResult = z
  .object({ items: z.array(z.object({ taskId: z.string(), status: z.enum(["verified", "failed"]), code: z.string().optional() })) })
  .openapi({ example: { items: [{ taskId: TID, status: "verified" }, { taskId: EID, status: "failed", code: "self_verification" }] } })

export const GalleryQuery = z.object({
  state: z.enum(["awaiting", "verified", "rejected"]).default("awaiting"),
  teamId: z.uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().openapi({ description: "A tenant-local calendar day (YYYY-MM-DD): the day the item was added" }),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(300).optional(),
})
export type GalleryFilter = Pick<z.infer<typeof GalleryQuery>, "state" | "teamId" | "date">
export const GalleryItem = EvidenceItem.extend({ taskId: z.string(), taskRef: z.string(), taskTitle: z.string(), taskStatus: z.string() }).openapi({
  example: { id: EID, kind: "photo", name: "floor.jpg", by: "Ann Byrne", at: "2026-11-20T10:00:00", review: "pending", round: 1, locked: true, taskId: TID, taskRef: "TSK-1001", taskTitle: "Check fire exits", taskStatus: "submitted" },
})
export const GalleryList = z.object({ items: z.array(GalleryItem), nextCursor: z.string().nullable() }).openapi({ example: { items: [], nextCursor: null } })
