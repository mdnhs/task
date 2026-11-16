// Plain data shapes the domain rules take from the app. They live here so the package never imports app code;
// lib/appearance.ts, lib/task-inbox.ts and lib/workforce.ts re-export them.

export type Corners = "sharp" | "soft" | "round"
export type TextSize = "small" | "default" | "large"
export type Spacing = "compact" | "comfortable" | "spacious"
export type Appearance = { corners: Corners; text: TextSize; spacing: Spacing }

export type Qualification = { type: string; expires: string | null }
export type WorkforceMember = { id: string; name: string; role: string; dept: string; homeLocationId: string | null; qualifications: Qualification[]; leftOn: string | null }

/**
 * A task change from a submitted shift report or the Today card. `itemStatus` is the report row status; `id` is unique
 * per report version and task, so the store applies each update once.
 */
export type TaskUpdate = {
  id: string
  tenantId: string
  ref: string
  itemStatus: "done" | "in_progress" | "blocked" | "not_started"
  minutes: number
  note: string
  /** YYYY-MM-DDTHH:mm, tenant time. */
  at: string
  /** Display name of who submitted. */
  by: string
  /** Where it came from, for the timeline, e.g. "shift report Day patrol, 2026-10-19". */
  source: string
  /** Snoozed for the day: no status change and no time entry, just the timeline line. */
  snooze?: boolean
}
