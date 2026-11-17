import { addDays } from "./shifts"

// Pure planning rules (SRS CR-04): finish-to-start dependencies and the knock-on preview (FR-M1-02, FR-M1-14), the 30-day
// archive (FR-M1-13), project and milestone progress (FR-M1-04). Wall-clock strings (YYYY-MM-DDTHH:mm[:ss]) are read as UTC
// numbers, so there is no DST maths here. The rules are keyed by `ref`: the front end passes display refs, the API passes task ids.

/** What the rules read of a task. The front-end `Task` and the API's id-keyed rows both satisfy it. */
export type PlanTask = { ref: string; title: string; start: string; due: string; status: string; archivedAt?: string; dependsOn?: readonly string[] }
export type PlanNode = { ref: string; dependsOn?: readonly string[] }

const DAY_MIN = 1440
const mins = (iso: string) => {
  const [d, t = "00:00"] = iso.split("T")
  const [y, m, dd] = d.split("-").map(Number)
  const [h, mi] = t.split(":").map(Number)
  return Math.round(Date.UTC(y, m - 1, dd, h || 0, mi || 0) / 60000)
}
const shiftIso = (iso: string, days: number) => `${addDays(iso.slice(0, 10), days)}${iso.slice(10)}`
const DONE = new Set(["completed", "cancelled"])

// ---------- dependencies (finish-to-start) ----------

export const dependantsOf = <T extends PlanTask>(tasks: readonly T[], ref: string): T[] => tasks.filter((t) => !t.archivedAt && t.dependsOn?.includes(ref))

/** Dependencies of `t` that are not finished yet: the task should not start before they are done. */
export const waitingOn = <T extends PlanTask>(tasks: readonly T[], t: T): T[] =>
  (t.dependsOn ?? []).map((r) => tasks.find((x) => x.ref === r)).filter((x): x is T => !!x && !DONE.has(x.status))

/** True when `ref` depending on `on` would close a loop (or point at itself). */
export function wouldCycle(tasks: readonly PlanNode[], ref: string, on: string): boolean {
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
 * push carries on down the chain. Tasks are only ever pushed later, never pulled earlier. Archived, completed and cancelled
 * dependants are never pushed. More than KNOCK_ON_LIMIT tasks walked throws KnockOnTooLarge. The moved task itself is not listed.
 */
/** The most tasks one knock-on may walk. Past it the push is refused (RangeError) instead of being cut short without telling anyone. */
export const KNOCK_ON_LIMIT = 500
export class KnockOnTooLarge extends RangeError {
  constructor() {
    super("knock_on_too_large")
  }
}

export function knockOn(tasks: readonly PlanTask[], ref: string, to: { start: string; due: string }): DateMove[] {
  const byRef = new Map(tasks.map((t) => [t.ref, t]))
  const dates = new Map<string, { start: string; due: string }>([[ref, to]])
  const moves = new Map<string, DateMove>()
  const queue = [ref]
  let walked = 0
  while (queue.length) {
    if (walked++ >= KNOCK_ON_LIMIT) throw new KnockOnTooLarge()
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

// ---------- projects and milestones (FR-M1-04) ----------

export type Progress = { done: number; total: number; pct: number }
/** Progress from counts: `total` excludes cancelled tasks (the aggregate query counts the same way). */
export const progressOf = (done: number, total: number): Progress => ({ done, total, pct: total ? Math.round((done / total) * 100) : 0 })
export const progress = (list: readonly { status: string }[]): Progress => {
  const live = list.filter((t) => t.status !== "cancelled")
  return progressOf(live.filter((t) => t.status === "completed").length, live.length)
}

export type MilestoneState = "done" | "late" | "open"
/** "done" once every counted task is completed, "late" when the date has passed (`today` is the tenant's calendar day), else "open". */
export const milestoneStateOf = (due: string, pr: Progress, today: string): MilestoneState =>
  pr.total > 0 && pr.done === pr.total ? "done" : due < today.slice(0, 10) ? "late" : "open"
export function milestoneState(m: { due: string }, tasks: readonly { status: string }[], today: string): { state: MilestoneState } & Progress {
  const pr = progress(tasks)
  return { state: milestoneStateOf(m.due, pr, today), ...pr }
}
