import { addDays, nextOccurrences } from "@opsdesk/domain/task-recurrence"
import type { Task, TimelineEvent } from "./types"

// FR-TASK-10: recurring tasks. The pure date rules live in @opsdesk/domain/task-recurrence (shared with the API); this file keeps the
// feature's import paths and the mock-store materialiser.
export { addDays, daysInMonth, describeRepeat, nextOccurrences, repeatError, weekdayOf } from "@opsdesk/domain/task-recurrence"

const DAY = 86_400_000
const ymd = (iso: string) => iso.slice(0, 10)
const num = (date: string) => {
  const [y, m, d] = date.split("-").map((n) => parseInt(n, 10))
  return Math.round(Date.UTC(y, m - 1, d) / DAY)
}

const nextNumber = (tasks: Task[], floor: number) => tasks.reduce((m, t) => Math.max(m, parseInt(t.ref.replace(/\D/g, ""), 10) || 0), floor)

/**
 * Creates the due instances of every recurring task (the "series", whose ref is the series id) up to the org's today.
 * Idempotent: an instance is keyed by series id + due date, so running it again adds nothing and returns the same array.
 * An instance copies the series task's fields, is Not Started with no evidence, and keeps the series' time of day.
 */
export function materialiseRecurring(tasks: Task[], today: string, refFloor = 0): Task[] {
  const to = ymd(today)
  const have = new Set(tasks.filter((t) => t.seriesId).map((t) => `${t.seriesId}|${ymd(t.due)}`))
  let n = nextNumber(tasks, refFloor)
  const added: Task[] = []
  for (const s of tasks) {
    if (!s.repeat || s.seriesId) continue
    const lead = Math.max(0, num(ymd(s.due)) - num(ymd(s.start)))
    for (const date of nextOccurrences(s.repeat, s.due, to)) {
      if (have.has(`${s.ref}|${date}`)) continue
      have.add(`${s.ref}|${date}`)
      const at = `${date}T00:00:00`
      const first: TimelineEvent = { at, by: "System", text: `Created from recurring task ${s.ref}` }
      const { repeat: _r, submittedAt: _s, completedAt: _c, overdue: _o, ...rest } = s
      void _r; void _s; void _c; void _o
      added.push({
        ...rest,
        ref: `TSK-${++n}`,
        seriesId: s.ref,
        start: `${addDays(date, -lead)}T${s.start.slice(11, 19) || "09:00:00"}`,
        due: `${date}T${s.due.slice(11, 19) || "17:00:00"}`,
        status: "not_started",
        notes: [],
        evidence: [],
        timeline: [first],
      })
    }
  }
  return added.length ? [...added.reverse(), ...tasks] : tasks
}
