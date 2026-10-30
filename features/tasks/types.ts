import type { Status } from "@/lib/types"
import type { EvidenceReview, EvidenceRule, EvidenceType } from "@/lib/task-evidence"
import type { VoiceNote } from "@/lib/task-voice"

export type { EvidenceRule, EvidenceType }

export type TaskStatus = "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled"

// Labels are FR-TASK-02, except "submitted", which FR-M1-44 calls "Awaiting verification".
export const STATUS: Record<TaskStatus, Status> = {
  not_started: { tone: "mute", label: "Not Started" },
  in_progress: { tone: "warn", label: "In Progress" },
  blocked: { tone: "bad", label: "Blocked" },
  submitted: { tone: "info", label: "Awaiting verification" },
  changes_requested: { tone: "warn", label: "Changes Requested" },
  completed: { tone: "ok", label: "Completed" },
  cancelled: { tone: "mute", label: "Cancelled" },
}

export const STATUS_ORDER: TaskStatus[] = ["not_started", "in_progress", "blocked", "submitted", "changes_requested", "completed", "cancelled"]

import type { Person } from "@/lib/types"

export type { Person }
export type Evidence = {
  id: string
  kind: EvidenceType
  /** File name, note text, link URL or a label ("Signature by …", "Checklist 5/5"). */
  name: string
  by: string
  at: string
  review: EvidenceReview
  reason?: string
  /** Submission round (FR-M1-47): 1 for the first submission, +1 after each rejection. */
  round?: number
  /** Read-only once the task is submitted or completed (FR-M1-47). */
  locked?: boolean
  /** Camera capture vs gallery/file upload (FR-M1-46; location stays off, Q6). */
  source?: "camera" | "upload"
  /** Local preview URL for images in this session (mock; real storage is platform storage, FR-M1-47). */
  url?: string
  size?: number
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
  /** Evidence defaults (FR-M1-42); tasks made from the template and its recurring instances inherit them. */
  evidenceRule: EvidenceRule
  dueOffset: number
  dueTime: string
}
/** One field change in the history (FR-M1-12): old and new value, already formatted for display. */
export type FieldChange = { field: string; from: string; to: string }
export type TimelineEvent = { at: string; by: string; text: string; changes?: FieldChange[]; /** Members told in-app about this change (FR-M1-12). */ notified?: string[]; /** The lib/task-inbox update that wrote this line, so it is applied once. */ updateId?: string }
export type ChecklistItem = { id: string; text: string; done: boolean }
/** A member's proposed new dates (Q8: only managers change timelines; members propose). */
export type DateProposal = { start: string; due: string; reason: string; by: string; at: string }
export type Milestone = { id: string; name: string; due: string }
/** FR-M1-04 project: tasks may belong to one; milestones have their own dates. */
export type Project = { id: string; name: string; dept: string; lead: string; description: string; due: string; milestones: Milestone[] }
export type Task = {
  ref: string
  title: string
  description: string
  dept: string
  /** Primary assignee (Person.id). Shift reports, the dashboard and the staff scope key on this one. */
  assignee: string
  /** Further assignees (FR-M1-01 "assignee(s)"), Person ids, never including `assignee`. */
  assignees?: string[]
  creator: string
  priority: 1 | 2 | 3
  start: string
  due: string
  status: TaskStatus
  /** CR-05 evidence rule (replaces the old evidenceRequired flag). */
  evidenceRule: EvidenceRule
  client?: string
  /** Labels (FR-M1-01). */
  tags: string[]
  /** Estimate in minutes. */
  estimate?: number
  projectId?: string
  milestoneId?: string
  /** Subtask of this task ref (FR-M1-02). */
  parentRef?: string
  checklist?: ChecklistItem[]
  /** Finish-to-start dependencies: refs that must finish before this task starts (FR-M1-02, FR-M1-14). */
  dependsOn?: string[]
  /** Removed = archived (FR-M1-13); restorable for 30 days from this moment. */
  archivedAt?: string
  archivedBy?: string
  proposal?: DateProposal
  /** Current evidence submission round (FR-M1-47); 1 when absent. */
  round?: number
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
  /** Time logged against the task, e.g. from end-of-shift reports (FR-M1-26). `id` = the update that added it. */
  timeEntries?: TimeEntry[]
  /**
   * Spoken instructions recorded at creation (change request 30 Oct 2026, lib/task-voice.ts). Mock: `url` is a `blob:` object
   * URL held in the client tasksStore only, so it is gone on reload like every mock edit. Templates never copy it.
   */
  voiceNote?: VoiceNote
}
export type TimeEntry = { id: string; at: string; by: string; minutes: number; note: string; source: string }

export type TasksFilters = { status: string; due: string; priority: string; assignee: string; q: string; repeat: string; project: string }
