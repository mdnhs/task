import type { Status } from "@/lib/types"

export type IssueType = "missed_hours" | "overtime" | "deduction" | "bank_details" | "other"
export type IssueStatus = "open" | "info_needed" | "correction_required" | "resolved"

export type PayrollIssue = {
  /** PAY-… reference. */
  ref: string
  staff: string
  dept: string
  type: IssueType
  description: string
  owner: string
  /** Target date, ISO. */
  target: string
  status: IssueStatus
  createdAt: string
  /** Required when status is resolved (FR-PAY). */
  resolution?: string
  history: { at: string; by: string; action: string; note?: string }[]
}

export type PayrollDirectory = { staff: { name: string; dept: string }[]; owners: string[] }

export const PAYROLL_PAGE_SIZE = 10

export const TYPE: Record<IssueType, string> = {
  missed_hours: "Missed hours",
  overtime: "Overtime",
  deduction: "Deduction",
  bank_details: "Bank details",
  other: "Other",
}
export const TYPE_ORDER = Object.keys(TYPE) as IssueType[]

export const STATUS: Record<IssueStatus, Status> = {
  open: { tone: "warn", label: "Open" },
  info_needed: { tone: "info", label: "Info needed" },
  correction_required: { tone: "bad", label: "Correction required" },
  resolved: { tone: "ok", label: "Resolved" },
}
export const STATUS_ORDER = Object.keys(STATUS) as IssueStatus[]

/** Next free PAY-… number, above every existing ref. */
export function nextRef(issues: PayrollIssue[]): string {
  const max = issues.reduce((m, i) => Math.max(m, parseInt(i.ref.replace(/\D/g, ""), 10) || 0), 1000)
  return `PAY-${max + 1}`
}
