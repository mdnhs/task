import { addDays } from "./recurrence"
import { activeTasks } from "@/lib/task-scope"
import type { Milestone, Project, Task } from "./types"

// Pure planning rules (SRS CR-04): finish-to-start dependencies and the knock-on preview (FR-M1-02, FR-M1-14), the 30-day
// archive (FR-M1-13), projects and milestones (FR-M1-04). Wall-clock strings are read as UTC numbers, so no DST maths.

const DAY_MIN = 1440
const mins = (iso: string) => {
  const [d, t = "00:00"] = iso.split("T")
  const [y, m, dd] = d.split("-").map(Number)
  const [h, mi] = t.split(":").map(Number)
  return Math.round(Date.UTC(y, m - 1, dd, h || 0, mi || 0) / 60000)
}
const shiftIso = (iso: string, days: number) => `${addDays(iso.slice(0, 10), days)}${iso.slice(10)}`
const DONE = new Set(["completed", "cancelled"])

/** Every assignee (primary first) and "is this person one of them": one rule with search, shift reports and the Today card (lib/task-scope.ts). */
export { assigneesOf, isAssignee as isAssigned } from "@/lib/task-scope"

// ---------- dependencies (finish-to-start) ----------

export const dependantsOf = (tasks: readonly Task[], ref: string) => tasks.filter((t) => !t.archivedAt && t.dependsOn?.includes(ref))

/** Dependencies of `t` that are not finished yet: the task should not start before they are done. */
export const waitingOn = (tasks: readonly Task[], t: Task) =>
  (t.dependsOn ?? []).map((r) => tasks.find((x) => x.ref === r)).filter((x): x is Task => !!x && !DONE.has(x.status))

/** True when `ref` depending on `on` would close a loop (or point at itself). */
export function wouldCycle(tasks: readonly Task[], ref: string, on: string): boolean {
  if (ref === on) return true
  const byRef = new Map(tasks.map((t) => [t.ref, t]))
  const seen = new Set<string>()
  const stack = [on]
  while (stack.length) {
    const cur = stack.pop()!
    if (cur === ref) return true
    if (seen.has(cur)) continue
    seen.add(cur)
    stack.push(...(byRef.get(cur)?.dependsOn ?? []))
  }
  return false
}

export type DateMove = { ref: string; title: string; from: { start: string; due: string }; to: { start: string; due: string } }

/**
 * FR-M1-14 (simple version): moving `ref` to new dates pushes every open dependant that would now start before its
 * dependency is due. A pushed task moves by whole days (start and due together, so its length and times stay), and the
 * push carries on down the chain. Tasks are only ever pushed later, never pulled earlier. The moved task itself is not listed.
 */
export function knockOn(tasks: readonly Task[], ref: string, to: { start: string; due: string }): DateMove[] {
  const byRef = new Map(tasks.map((t) => [t.ref, t]))
  const dates = new Map<string, { start: string; due: string }>([[ref, to]])
  const moves = new Map<string, DateMove>()
  const queue = [ref]
  let guard = 0
  while (queue.length && guard++ < 500) {
    const cur = queue.shift()!
    const due = dates.get(cur)!.due
    for (const d of dependantsOf(tasks, cur)) {
      if (DONE.has(d.status) || d.ref === ref) continue
      const now = dates.get(d.ref) ?? { start: d.start, due: d.due }
      const gap = mins(due) - mins(now.start)
      if (gap <= 0) continue
      const days = Math.ceil(gap / DAY_MIN)
      const next = { start: shiftIso(now.start, days), due: shiftIso(now.due, days) }
      dates.set(d.ref, next)
      const orig = byRef.get(d.ref)!
      moves.set(d.ref, { ref: d.ref, title: orig.title, from: { start: orig.start, due: orig.due }, to: next })
      queue.push(d.ref)
    }
  }
  return [...moves.values()]
}

// ---------- archive (FR-M1-13) ----------

export const ARCHIVE_DAYS = 30

/** Whole days left to restore an archived task (0 = expires today or already gone). */
export function archiveDaysLeft(archivedAt: string, today: string): number {
  const left = ARCHIVE_DAYS - Math.floor((mins(today) - mins(archivedAt)) / DAY_MIN)
  return Math.max(0, left)
}
export const isArchiveExpired = (archivedAt: string, today: string) => mins(today) - mins(archivedAt) >= ARCHIVE_DAYS * DAY_MIN
/** Tasks on the board, list and calendar: not archived. */
export const liveTasks = (list: readonly Task[]): Task[] => activeTasks(list)
/** The archive view: archived and still restorable. Expired ones are treated as gone (a backend would purge them). */
export const archivedTasks = (list: readonly Task[], today: string) =>
  list.filter((t) => t.archivedAt && !isArchiveExpired(t.archivedAt, today)).sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""))

// ---------- projects and milestones (FR-M1-04) ----------

export type Progress = { done: number; total: number; pct: number }
const progress = (list: Task[]): Progress => {
  const live = list.filter((t) => t.status !== "cancelled")
  const done = live.filter((t) => t.status === "completed").length
  return { done, total: live.length, pct: live.length ? Math.round((done / live.length) * 100) : 0 }
}
export const projectProgress = (p: Project, tasks: readonly Task[]) => progress(liveTasks(tasks).filter((t) => t.projectId === p.id))

export type MilestoneState = "done" | "late" | "open"
export function milestoneState(m: Milestone, tasks: readonly Task[], today: string): { state: MilestoneState } & Progress {
  const pr = progress(liveTasks(tasks).filter((t) => t.milestoneId === m.id))
  const state: MilestoneState = pr.total > 0 && pr.done === pr.total ? "done" : m.due < today.slice(0, 10) ? "late" : "open"
  return { state, ...pr }
}

/** Checklist progress "2/4", or null without a checklist. */
export const checklistProgress = (t: Pick<Task, "checklist">) => (t.checklist?.length ? { done: t.checklist.filter((c) => c.done).length, total: t.checklist.length } : null)
