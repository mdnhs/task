// Time rules for tasks (I12): the wall strings (`due`, `start`) are for DISPLAY; a comparison with the clock reads the instants. 25 Oct 2026 01:30 Dublin happens twice;
// the wall string cannot say which, `dueAt` can. The completed/submitted moments only have a wall string in the DTO, so a finished task keeps the wall comparison.
import { isLate } from "./lifecycle"
import type { Task } from "./types"

/** Late (FR-TASK-08): an open task is late when its due INSTANT is past `nowAt`; a task already submitted or completed is judged at that moment. */
export function isLateAt(t: Pick<Task, "status" | "due" | "dueAt" | "submittedAt" | "completedAt">, today: string, nowAt?: string): boolean {
  if (t.status === "cancelled") return false
  if (t.submittedAt || t.completedAt || !t.dueAt || !nowAt) return isLate(t as Task, today)
  return Date.parse(t.dueAt) < Date.parse(nowAt)
}
