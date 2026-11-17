import { can } from "./permissions"
import type { Role } from "./types"

// Who a task belongs to and which tasks still count (FR-M1-01 "assignee(s)", FR-M1-13 archive). Pure and server-safe.
// The one rule for every reader of tasks/tasks.json outside the tasks feature (search, shift reports, the Today card) and
// for the tasks feature itself (features/tasks/planning.ts re-exports these), so all screens agree on "my tasks".

export type AssignedTask = { assignee: string; assignees?: string[] }

/** Primary assignee first, then the others, no duplicates. */
export const assigneesOf = (t: AssignedTask): string[] => [t.assignee, ...(t.assignees ?? []).filter((a) => a !== t.assignee)]

/** The person is the primary or one of the further assignees. */
export const isAssignee = (t: AssignedTask, personId: string): boolean => t.assignee === personId || !!t.assignees?.includes(personId)

/** Tasks that are not archived (archived ones only show in the archive view until restored or purged). */
export const activeTasks = <T extends { archivedAt?: string }>(list: readonly T[]): T[] => list.filter((t) => !t.archivedAt)

/**
 * Which tasks a role may see (FR-M1-10, ruling D5): staff-home → own (assignee, co-assignee, creator or named reviewer); a manager-home
 * role with `reportScope: "team"` (the API resolves it from the role template, following `cloned_from`) → team (own, plus tasks with an
 * assignee who reports to me); any other manager-home role → all. null = no tasks:read.
 */
export type TaskScope = { kind: "all" } | { kind: "team"; managerId: string } | { kind: "own"; personId: string }
export function taskScope(role: Role & { reportScope?: "team" }, meId: string): TaskScope | null {
  if (!can(role, "tasks")) return null
  if (role.home === "staff") return { kind: "own", personId: meId }
  if (role.reportScope === "team") return { kind: "team", managerId: meId }
  return { kind: "all" }
}
