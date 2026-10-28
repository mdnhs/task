import { useEffect } from "react"

import { createStore } from "@/lib/store"
import { taskInbox, type IncomingTask } from "@/lib/task-inbox"
import { materialiseRecurring } from "./recurrence"
import type { Person, Task, TaskTemplate } from "./types"

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
    evidenceRequired: false,
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

/** tasksStore.useStore plus the inbox merge; every tasks screen uses this. */
export function useTasksStore(seed: Task[], scopeKey: string, people: Person[], clock?: { today: string; refFloor?: number }) {
  const state = tasksStore.useStore(seed, scopeKey)
  useEffect(() => {
    const tenant = scopeKey.split(":")[0] ?? ""
    tasksStore.set((prev) => mergeIncoming(prev, taskInbox.list(tenant), people, scopeKey))
    // Recurring series: add the instances that are due by the org's today (idempotent).
    if (clock) tasksStore.set((prev) => materialiseRecurring(prev, clock.today, clock.refFloor))
    taskInbox.noteRefs(tenant, (tasksStore.get() ?? []).map((t) => t.ref))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, scopeKey, clock?.today, clock?.refFloor])
  return state
}
