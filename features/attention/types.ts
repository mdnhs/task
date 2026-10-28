import type { Status } from "@/lib/types"

export type Urgency = "low" | "medium" | "high" | "critical"
export type AttentionStatus = "open" | "decided" | "in_progress" | "resolved"
export type Outcome = "approved" | "rejected" | "deferred"

export type AttentionItem = {
  id: string
  title: string
  summary: string
  impact: string
  urgency: Urgency
  /** The decision being asked of the manager. */
  decision: string
  owner: string
  due: string
  dept: string
  status: AttentionStatus
  source: "report" | "task" | "client" | "staff" | "roster" | "stock"
  history: { at: string; by: string; action: string; note?: string }[]
  decisionRecord?: { by: string; at: string; outcome: Outcome; note: string }
}

export type OutstandingItem = {
  id: string
  title: string
  reason: string
  owner: string
  priority: 1 | 2 | 3
  nextAction: string
  target: string
  /** ISO date the item was first carried forward. */
  carriedFrom: string
  status: "open" | "closed"
  resolution?: string
}

export const URGENCY: Record<Urgency, Status> = {
  critical: { tone: "bad", label: "Critical" },
  high: { tone: "warn", label: "High" },
  medium: { tone: "info", label: "Medium" },
  low: { tone: "mute", label: "Low" },
}
export const URGENCY_RANK: Record<Urgency, number> = { critical: 0, high: 1, medium: 2, low: 3 }

export const ATTENTION_STATUS: Record<AttentionStatus, Status> = {
  open: { tone: "warn", label: "Awaiting decision" },
  decided: { tone: "ok", label: "Decided" },
  in_progress: { tone: "info", label: "In progress" },
  resolved: { tone: "ok", label: "Resolved" },
}

export const OUTCOME: Record<Outcome, string> = { approved: "Approved", rejected: "Rejected", deferred: "Deferred" }
export const SOURCE: Record<AttentionItem["source"], string> = {
  report: "Daily report",
  task: "Task",
  client: "Client",
  staff: "Staff",
  roster: "Roster",
  stock: "Orders & stock",
}
export const PRIORITY: Record<OutstandingItem["priority"], Status> = {
  1: { tone: "bad", label: "Priority 1" },
  2: { tone: "warn", label: "Priority 2" },
  3: { tone: "mute", label: "Priority 3" },
}
