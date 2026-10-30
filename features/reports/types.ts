// The end-of-shift report model lives in lib/shift-report.ts (shared with notifications and search); re-exported here.
import type { Person } from "@/lib/types"
import type { ReportFilters, ShiftReport, TemplateSection } from "@/lib/shift-report"

export type {
  ItemStatus, ReportItem, ReportState, ReportFilters, ShiftReport, StoredStatus, TemplateSection, TemplateData, UnplannedRow, ReportAttachment, ReportScope,
} from "@/lib/shift-report"
export { ITEM_STATUS, ITEM_STATUS_ORDER, REPORT_STATE, REPORT_STATE_ORDER } from "@/lib/shift-report"

/** What the /daily-reports routes send to the client, already cut to the viewer's scope. */
export type ReportsSeed = {
  reports: ShiftReport[]
  /** Team → template sections (only the teams in `reports`). */
  templates: Record<string, TemplateSection[]>
  /** Only the people the viewer may see (report owners, plus the viewer). */
  people: Person[]
  teams: string[]
  scope: "all" | "team" | "own"
  /** The signed-in member (mock), "" for manager roles without a person. */
  meId: string
  /** Store scope: tenant + role, so a role switch reseeds. */
  scopeKey: string
  range: { from: string; to: string }
  dueAfterMinutes: number
}

export type ReportsPageFilters = ReportFilters

/** Inbox page size (shared by the inbox and its skeleton). */
export const REPORT_PAGE_SIZE = 10
