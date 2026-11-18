// Shift reports as the UI holds them (B6 T6.7). The API's report DTO is mapped once (adapters.ts) into these types; the pure rules (statuses, template, validation) stay in
// @opsdesk/domain/shift-report. Ids: `id` is the stable shift key (`userId:patternId:date`, what the DTO calls `key`), `reportId` the report's uuid (null until the report is opened).
// Times: `start`, `end`, `due` and the other walls are the tenant's, derived from the INSTANTS (`startAt`, `endAt`, `dueAt`, `submittedAtIso`); every comparison reads the instants.
import type { Person } from "@/lib/types"
import type { ItemStatus, ReportComment, ReportFilters, ReportState, StoredStatus, TemplateSection, UnplannedRow } from "@opsdesk/domain/shift-report"

export type {
  ItemStatus, ReportState, ReportFilters, StoredStatus, TemplateSection, TemplateData, UnplannedRow, ReportScope,
} from "@opsdesk/domain/shift-report"
export { ITEM_STATUS, ITEM_STATUS_ORDER, REPORT_STATE, REPORT_STATE_ORDER } from "@opsdesk/domain/shift-report"

export type ReportOutcome = "applied" | "needs_evidence" | "submitted_for_review" | "skipped_archived" | "skipped_unavailable"

/** One task row. `taskRef` is for display and links; `taskId` (null once the task was purged) is what a draft save sends. */
export type ReportItem = {
  taskRef: string
  taskId: string | null
  title: string
  /** Tenant wall time of the task's due date, from `dueAt`. */
  due: string
  dueAt: string
  status: ItemStatus
  minutes: number
  note: string
  taskStatus: string | null
  evidenceState: string | null
  outcome?: ReportOutcome
}

/** An attachment (the report upload intent and the malware scan gate): `pending` is still being scanned, `infected` can never be opened or attached. */
export type ReportAttachment = { id: string; name: string; kind: "image" | "file"; size: string; bytes: number; status: "pending" | "clean" | "infected" }

export type ReportVersionRow = { v: number; at: string; by: string; note: string }

export type ShiftReport = {
  /** The shift key `userId:patternId:date`. */
  id: string
  reportId: string | null
  userId: string | null
  /** The member's user id, "" for an erased member. */
  personId: string
  patternId: string
  shiftName: string
  team: string
  /** Shift start date (the shift belongs to it). */
  date: string
  start: string
  end: string
  due: string
  startAt: string
  endAt: string
  dueAt: string
  status: StoredStatus
  /** The state when the API answered; components read reportStateAt(r, nowAt) so the page's clock decides draft versus missing. */
  state: ReportState
  version: number
  submissions: number
  items: ReportItem[]
  summary: string
  blockers: string
  unplanned: UnplannedRow[]
  attachments: ReportAttachment[]
  /** Answers to template sections other than the built-in ones, keyed "sectionId.fieldId". */
  extra: Record<string, string>
  /** Tenant wall time of the FIRST submission (undefined before it) and the instant it came from. */
  submittedAt?: string
  submittedAtIso?: string
  reviewedAt?: string
  reviewedBy?: string
  comments: ReportComment[]
}

/** One inbox row: a stored report or a virtual one (a shift that started and has no report yet: `reportId` null). No report text. */
export type InboxRow = {
  id: string
  reportId: string | null
  key: string
  userId: string
  person: string
  patternId: string
  teamId: string
  shiftName: string
  team: string
  date: string
  start: string
  end: string
  due: string
  startAt: string
  endAt: string
  dueAt: string
  status: StoredStatus
  state: ReportState
  version: number
  submissions: number
  itemCount: number
  doneCount: number
  /** Real minutes the first submission came after the due time (or now minus due while unsubmitted); 0 when on time. */
  minutesLate: number
  /** Real minutes from the end of the shift to the first submission (or to now). */
  minutesOpen: number
  submittedAt?: string
  submittedAtIso?: string
  reviewedAt?: string
  reviewedBy?: string
}

/** What /daily-reports loads for the caller: the API's first page for the URL filters (scope is the API's, nothing is widened here) and what the screen needs around it. */
export type ReportsData = {
  rows: InboxRow[]
  /** A member's own unfiltered window (for the prompts and "My shift report"); absent for managers. */
  mine?: InboxRow[]
  nextCursor: string | null
  /** "own" = a member (staff home), otherwise the inbox; the wording only, the API decides who is in it. */
  scope: "all" | "team" | "own"
  meId: string
  people: Person[]
  /** Teams (id and name): the filter shows the name, the API takes the id. */
  teams: { id: string; name: string }[]
  /** The default window the API uses (the last 7 tenant days) shown when no date filter is set. */
  range: { from: string; to: string }
  dueAfterMinutes: number
}

export type ReportsPageFilters = ReportFilters

/** Inbox page size (the API's `limit`, shared by the inbox and its skeleton). */
export const REPORT_PAGE_SIZE = 10

export type TemplateSections = TemplateSection[]
