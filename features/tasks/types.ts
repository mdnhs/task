import type { Status } from "@/lib/types"

export type TaskStatus = "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled"

// Labels are exactly FR-TASK-02.
export const STATUS: Record<TaskStatus, Status> = {
  not_started: { tone: "mute", label: "Not Started" },
  in_progress: { tone: "warn", label: "In Progress" },
  blocked: { tone: "bad", label: "Blocked" },
  submitted: { tone: "info", label: "Submitted for Review" },
  changes_requested: { tone: "warn", label: "Changes Requested" },
  completed: { tone: "ok", label: "Completed" },
  cancelled: { tone: "mute", label: "Cancelled" },
}

export const STATUS_ORDER: TaskStatus[] = ["not_started", "in_progress", "blocked", "submitted", "changes_requested", "completed", "cancelled"]

import type { Person } from "@/lib/types"

export type { Person }
export type Evidence = {
  id: string
  kind: "image" | "file" | "link" | "note"
  name: string
  by: string
  at: string
  review: "pending" | "accepted" | "rejected" | "info_requested"
  reason?: string
}
/** FR-TASK-10 repeat rule. `days` are weekdays 0 (Sun) to 6 (Sat); `until` is an optional YYYY-MM-DD end date. */
export type RepeatRule = {
  freq: "daily" | "weekdays" | "weekly" | "monthly"
  days?: number[]
  dayOfMonth?: number
  until?: string
}
/** A reusable task blueprint (FR-TASK-10). `dueOffset` is days after the start date; `dueTime` is HH:mm. */
export type TaskTemplate = {
  id: string
  name: string
  title: string
  description: string
  dept: string
  assignee?: string // Person.id
  priority: 1 | 2 | 3
  tags: string[]
  evidenceRequired: boolean
  dueOffset: number
  dueTime: string
}
export type TimelineEvent = { at: string; by: string; text: string }
export type Task = {
  ref: string
  title: string
  description: string
  dept: string
  assignee: string // Person.id
  creator: string
  priority: 1 | 2 | 3
  start: string
  due: string
  status: TaskStatus
  evidenceRequired: boolean
  client?: string
  tags: string[]
  /** Recurring series task: the rule that creates later instances. */
  repeat?: RepeatRule
  /** Instance of a series: the ref of the recurring task that created it. */
  seriesId?: string
  submittedAt?: string
  completedAt?: string
  notes: TimelineEvent[]
  evidence: Evidence[]
  timeline: TimelineEvent[]
  overdue?: { reason: string; nextAction: string; owner: string; revisedDue: string }
}

export type TasksFilters = { status: string; due: string; priority: string; assignee: string; q: string; repeat: string }
