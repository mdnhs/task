import type { Status } from "./types"

// Evidence rules for tasks (SRS CR-05, FR-M1-40..48). Pure and server-safe: no React, no I/O.
// Lives in lib so other modules (the end-of-shift report hand-off, a later progress view) can read a task's rule
// without importing the tasks feature.

/** FR-M1-41 allowed types. "drive" is a Google Drive link, usable on the company PC only (CR-02). */
export type EvidenceType = "photo" | "image" | "pdf" | "office" | "video" | "checklist" | "signature" | "note" | "drive"
export const EVIDENCE_TYPES: EvidenceType[] = ["photo", "image", "pdf", "office", "video", "checklist", "signature", "note", "drive"]
export const EVIDENCE_TYPE_LABEL: Record<EvidenceType, string> = {
  photo: "Photo",
  image: "Image file",
  pdf: "PDF",
  office: "Office document",
  video: "Short video",
  checklist: "Checklist",
  signature: "Signature",
  note: "Note",
  drive: "Drive link",
}

/** FR-M1-40. */
export type EvidenceMode = "none" | "optional" | "required"
/** FR-M1-44: auto-accept on upload, or review by the creator, the team manager or a named person. */
export type ReviewMode = "auto" | "creator" | "manager" | "named"
export type EvidenceRule = {
  mode: EvidenceMode
  types: EvidenceType[]
  /** Minimum number of valid (not rejected) items. Only enforced for Required. */
  min: number
  /** What to capture, e.g. "Photo of the cleaned area, wide angle". */
  instruction: string
  review: ReviewMode
  /** Person.id of the named reviewer (review === "named"). */
  reviewer?: string
}
export type EvidenceReview = "pending" | "accepted" | "rejected" | "info_requested"

export const MODE_LABEL: Record<EvidenceMode, string> = { none: "Not needed", optional: "Optional", required: "Required" }
export const REVIEW_LABEL: Record<ReviewMode, string> = { auto: "Auto-accept on upload", creator: "The creator", manager: "The manager", named: "A named reviewer" }

/** Q6 assumption: photos and files; location stays off. */
export const DEFAULT_TYPES: EvidenceType[] = ["photo", "image", "pdf", "office", "note"]
export const NO_EVIDENCE: EvidenceRule = { mode: "none", types: [], min: 0, instruction: "", review: "manager" }
export const MAX_MIN = 20
/** Size limits per upload (FR-M1-46: configurable later; mock constants for now). */
export const MAX_FILE_BYTES = 25 * 1024 * 1024
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024

/** The old yes/no flag (SRS v1.2 FR-TASK-05) as a rule: required = at least one photo or file, checked by the manager. */
export function legacyRule(required: boolean): EvidenceRule {
  return required ? { mode: "required", types: [...DEFAULT_TYPES], min: 1, instruction: "", review: "manager" } : { ...NO_EVIDENCE }
}

/** A rule as the form edits it; "none" always drops types, minimum and reviewer. */
export function normaliseRule(r: EvidenceRule): EvidenceRule {
  if (r.mode === "none") return { ...NO_EVIDENCE, review: r.review === "auto" ? "manager" : r.review }
  const types = EVIDENCE_TYPES.filter((t) => r.types.includes(t))
  const min = r.mode === "required" ? Math.max(1, Math.min(MAX_MIN, Math.round(r.min) || 1)) : 0
  return { mode: r.mode, types, min, instruction: r.instruction.trim(), review: r.review, ...(r.review === "named" && r.reviewer ? { reviewer: r.reviewer } : {}) }
}

/** First problem with a rule the creator entered, or null. */
export function ruleError(r: EvidenceRule): string | null {
  if (r.mode === "none") return null
  if (r.types.length === 0) return "Choose at least one evidence type"
  if (r.mode === "required" && (!Number.isFinite(r.min) || r.min < 1)) return "The minimum must be at least 1"
  if (r.min > MAX_MIN) return `The minimum can be at most ${MAX_MIN}`
  if (r.instruction.trim().length > 200) return "Keep the instruction under 200 characters"
  if (r.review === "named" && !r.reviewer) return "Choose the reviewer"
  return null
}

type Item = { kind: string; review: EvidenceReview }
/** Rejected items stay as earlier versions (FR-M1-47) but no longer count. */
export const isValidItem = (e: Item) => e.review !== "rejected"
export const validCount = (items: readonly Item[]) => items.filter(isValidItem).length

/** How many more items a Required task needs before it can be completed (FR-M1-43). */
export function missingEvidence(r: EvidenceRule, items: readonly Item[]): number {
  return r.mode === "required" ? Math.max(0, r.min - validCount(items)) : 0
}
export const needsReview = (r: EvidenceRule) => r.mode !== "none" && r.review !== "auto"

/**
 * What pressing Complete does (FR-M1-43/44, AC-M1-08): "Not needed" closes with one tap; Required below the minimum is
 * "blocked" (the upload step opens); items waiting for a reviewer send the task to "submitted" (Awaiting verification).
 */
export function completeTarget(r: EvidenceRule, items: readonly Item[]): "completed" | "submitted" | "blocked" {
  if (r.mode === "none") return "completed"
  if (missingEvidence(r, items) > 0) return "blocked"
  const waiting = items.some((e) => isValidItem(e) && e.review !== "accepted")
  return waiting && needsReview(r) ? "submitted" : "completed"
}

const OFFICE = /\.(docx?|xlsx?|pptx?|odt|ods|odp|rtf|csv)$/i
/** The evidence type of an uploaded file. `capture` = taken with the camera button (a photo, not a gallery image). */
export function fileType(name: string, mime: string, capture = false): EvidenceType | null {
  if (mime.startsWith("image/")) return capture ? "photo" : "image"
  if (mime.startsWith("video/")) return "video"
  if (mime === "application/pdf" || /\.pdf$/i.test(name)) return "pdf"
  if (OFFICE.test(name) || /officedocument|msword|ms-excel|ms-powerpoint|opendocument/.test(mime)) return "office"
  if (/\.(jpe?g|png|gif|webp|heic)$/i.test(name)) return capture ? "photo" : "image"
  if (/\.(mp4|mov|webm|m4v)$/i.test(name)) return "video"
  return null
}

/** Why a file can't be attached under this rule, or null. A photo also satisfies "image file" and the other way round. */
export function uploadError(r: EvidenceRule, type: EvidenceType | null, size: number): string | null {
  if (!type) return "This file type isn't accepted"
  if (!isTypeAllowed(r, type)) return `${EVIDENCE_TYPE_LABEL[type]} isn't allowed for this task`
  if (type === "video" && size > MAX_VIDEO_BYTES) return "Videos must be under 100 MB"
  if (type !== "video" && size > MAX_FILE_BYTES) return "Files must be under 25 MB"
  return null
}
export function isTypeAllowed(r: EvidenceRule, type: EvidenceType): boolean {
  if (r.mode === "none") return true
  if (r.types.includes(type)) return true
  return (type === "photo" && r.types.includes("image")) || (type === "image" && r.types.includes("photo"))
}

/** FR-M1-48 status shown in the task, the list and the board. */
export type EvidenceState = "verified" | "awaiting" | "rejected" | "missing" | "attached"
export const EVIDENCE_STATE: Record<EvidenceState, Status> = {
  verified: { tone: "ok", label: "Verified" },
  awaiting: { tone: "info", label: "Awaiting verification" },
  rejected: { tone: "bad", label: "Evidence rejected" },
  missing: { tone: "warn", label: "Evidence needed" },
  attached: { tone: "mute", label: "Evidence attached" },
}

export function evidenceState(r: EvidenceRule, items: readonly Item[], status: string): EvidenceState | null {
  if (r.mode === "none" && items.length === 0) return null
  if (status === "cancelled") return null
  const valid = items.filter(isValidItem)
  if (status === "submitted") return "awaiting"
  if (status === "changes_requested" && items.some((e) => e.review === "rejected")) return "rejected"
  if (missingEvidence(r, items) > 0) return status === "completed" ? null : "missing"
  if (valid.length > 0 && valid.every((e) => e.review === "accepted")) return "verified"
  return valid.length > 0 ? "attached" : null
}

/** "Required · at least 2 · Photo, PDF" */
export function describeRule(r: EvidenceRule): string {
  if (r.mode === "none") return MODE_LABEL.none
  const types = r.types.map((t) => EVIDENCE_TYPE_LABEL[t]).join(", ")
  return [MODE_LABEL[r.mode], r.mode === "required" ? `at least ${r.min}` : "", types].filter(Boolean).join(" · ")
}

/** Who checks the evidence, in words. `names` maps Person.id to a display name. */
export function reviewerText(r: EvidenceRule, creatorName: string, names: (id: string) => string | undefined): string {
  if (r.review === "auto") return "Accepted automatically on upload"
  if (r.review === "creator") return `Checked by ${creatorName} (creator)`
  if (r.review === "named") return `Checked by ${(r.reviewer && names(r.reviewer)) || "the named reviewer"}`
  return "Checked by the manager"
}

/**
 * May this viewer verify or reject? Managers may always (they own their team's work, FR-M1-10). Otherwise only the
 * creator (creator mode) or the named reviewer, and never the assignee on their own task.
 */
export function canVerify(r: EvidenceRule, viewer: { id: string; manager: boolean }, task: { creator: string; assignee: string }): boolean {
  if (r.mode === "none") return false
  if (viewer.manager) return true
  if (viewer.id === task.assignee) return false
  return (r.review === "creator" && viewer.id === task.creator) || (r.review === "named" && viewer.id === r.reviewer)
}
