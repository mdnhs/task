import type { Status } from "@/lib/types"

export type ReportStatus = "draft" | "submitted" | "returned" | "resubmitted" | "reviewed" | "overdue"
export type FieldState = "no_issues" | "action_required" | "na" | "details"

// Labels are exactly SRS §4.2 / FR-REP-05.
export const REPORT_STATUS: Record<ReportStatus, Status> = {
  draft: { tone: "mute", label: "Draft" },
  submitted: { tone: "info", label: "Submitted" },
  returned: { tone: "warn", label: "Returned for Correction" },
  resubmitted: { tone: "info", label: "Resubmitted" },
  reviewed: { tone: "ok", label: "Reviewed" },
  overdue: { tone: "bad", label: "Overdue" },
}
export const REPORT_STATUS_ORDER: ReportStatus[] = ["draft", "submitted", "returned", "resubmitted", "reviewed", "overdue"]

export const FIELD_STATE: Record<FieldState, string> = {
  no_issues: "No issues",
  action_required: "Action required",
  na: "Not applicable",
  details: "Details provided",
}

export type TemplateField = { id: string; label: string; required: boolean; entry: "text" | "count" | "structured"; columns?: string[] }
export type TemplateSection = { id: string; n: number; title: string; restricted?: boolean; fields: TemplateField[] }
export type ReportEntry = { id: string; text: string; cells?: Record<string, string> }
export type ReportField = { state?: FieldState; entries: ReportEntry[] }
export type ReportVersion = { v: number; at: string; by: string; note: string }
export type Report = {
  id: string
  date: string
  dept: string
  owner: string // Person.id (lib/people)
  status: ReportStatus
  createdAt: string
  updatedAt: string
  submittedAt?: string // the original submission time; resubmitting never changes it (FR-REP-10), versions[] carry each later time
  reviewedAt?: string
  reviewedBy?: string
  nil: boolean
  fields: Record<string /* sectionId.fieldId */, ReportField>
  comments: { at: string; by: string; text: string; section?: string }[]
  versions: ReportVersion[]
}

export type ReportsFilters = { from: string; to: string; owner: string; status: string }
