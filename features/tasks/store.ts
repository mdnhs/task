import { useEffect } from "react"

import { createStore } from "@/lib/store"
import { taskStatusFor } from "@/lib/shift-report"
import { NO_EVIDENCE } from "@/lib/task-evidence"
import { taskInbox, type IncomingTask, type TaskUpdate } from "@/lib/task-inbox"
import { materialiseRecurring } from "./recurrence"
import type { Person, Task, TaskStatus, TaskTemplate } from "./types"

export const tasksStore = createStore<Task[]>()
/** Task templates (FR-TASK-10), in memory like the tasks. */
export const templatesStore = createStore<TaskTemplate[]>()

/** An inbox task as a tasks-store task. Names map to Person ids when the directory knows them. */
export function fromIncoming(t: IncomingTask, people: Person[]): Task {
  const id = (name: string) => people.find((p) => p.name === name)?.id ?? name
  return {
    ref: t.ref,
    title: t.title,
    description: t.description,
    dept: t.dept,
    assignee: id(t.assignee),
    creator: id(t.creator),
    priority: 2,
    start: t.at,
    due: `${t.due}T17:00:00`,
    status: "not_started",
    evidenceRule: { ...NO_EVIDENCE },
    tags: [t.source],
    notes: [],
    evidence: [],
    timeline: [{ at: t.at, by: t.creator, text: `Created from ${t.source} by ${t.creator}` }],
  }
}

/**
 * Adds inbox tasks the store doesn't hold yet. `scopeKey` is getTaskSeed's `${tenant}:${"all" | Person.id}`:
 * only that tenant's tasks are taken, and a staff scope only takes tasks assigned to that person.
 */
export function mergeIncoming(list: Task[], incoming: readonly IncomingTask[], people: Person[], scopeKey: string): Task[] {
  const [tenant, only] = scopeKey.split(":")
  const have = new Set(list.map((t) => t.ref))
  const add = incoming
    .filter((t) => t.tenantId === tenant && !have.has(t.ref))
    .map((t) => fromIncoming(t, people))
    .filter((t) => !only || only === "all" || t.assignee === only)
  return add.length ? [...add.reverse(), ...list] : list
}

const STATUS_TEXT: Record<string, string> = {
  not_started: "Not Started", in_progress: "In Progress", blocked: "Blocked", submitted: "Submitted for Review",
  changes_requested: "Changes Requested", completed: "Completed", cancelled: "Cancelled",
}

/**
 * Applies task changes made outside /tasks (end-of-shift reports FR-M1-26, the Today card FR-M1-74): status via taskStatusFor
 * (never backwards; Done goes to review when evidence is Required and not auto-accepted), a time entry when time was logged,
 * and a timeline line. A snooze only adds the timeline line. Each update id is applied once (it is kept on the timeline line
 * and the time entry), so re-running is a no-op.
 */
export function applyTaskUpdates(list: Task[], updates: readonly TaskUpdate[], scopeKey: string): Task[] {
  const tenant = scopeKey.split(":")[0]
  const mine = updates.filter((u) => u.tenantId === tenant)
  if (mine.length === 0) return list
  let changed = false
  const next = list.map((t) => {
    const todo = mine.filter((u) => u.ref === t.ref && !t.timeEntries?.some((e) => e.id === u.id) && !t.timeline.some((e) => e.updateId === u.id))
    if (todo.length === 0) return t
    changed = true
    return todo.reduce<Task>((acc, u) => {
      if (u.snooze) return { ...acc, timeline: [...acc.timeline, { at: `${u.at.slice(0, 16)}:00`, by: u.by, text: `Snoozed for today from the ${u.source}`, updateId: u.id }] }
      const status = taskStatusFor(u.itemStatus, acc.status, acc.evidenceRule.mode === "required" && acc.evidenceRule.review !== "auto") as TaskStatus
      const moved = status !== acc.status
      const text = [
        moved ? `Status set to ${STATUS_TEXT[status] ?? status}` : "Reported",
        u.minutes > 0 ? `${u.minutes} min logged` : "",
      ].filter(Boolean).join(", ")
      return {
        ...acc,
        status,
        ...(moved && status === "completed" ? { completedAt: `${u.at.slice(0, 16)}:00` } : {}),
        ...(moved && status === "submitted" ? { submittedAt: `${u.at.slice(0, 16)}:00` } : {}),
        timeEntries: u.minutes > 0 ? [...(acc.timeEntries ?? []), { id: u.id, at: u.at, by: u.by, minutes: u.minutes, note: u.note, source: u.source }] : acc.timeEntries,
        timeline: [...acc.timeline, { at: `${u.at.slice(0, 16)}:00`, by: u.by, text: `${text} from the ${u.source}${u.note ? `: ${u.note}` : ""}`, updateId: u.id }],
      }
    }, t)
  })
  return changed ? next : list
}

/** tasksStore.useStore plus the inbox merge; every tasks screen uses this. */
export function useTasksStore(seed: Task[], scopeKey: string, people: Person[], clock?: { today: string; refFloor?: number }) {
  const state = tasksStore.useStore(seed, scopeKey)
  useEffect(() => {
    const tenant = scopeKey.split(":")[0] ?? ""
    tasksStore.set((prev) => mergeIncoming(prev, taskInbox.list(tenant), people, scopeKey))
    // End-of-shift reports submitted in this session (FR-M1-26).
    tasksStore.set((prev) => applyTaskUpdates(prev, taskInbox.updates(tenant), scopeKey))
    // Recurring series: add the instances that are due by the org's today (idempotent).
    if (clock) tasksStore.set((prev) => materialiseRecurring(prev, clock.today, clock.refFloor))
    taskInbox.noteRefs(tenant, (tasksStore.get() ?? []).map((t) => t.ref))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, scopeKey, clock?.today, clock?.refFloor])
  return state
}
