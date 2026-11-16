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
