// Hand-off for tasks created or changed outside /tasks (WhatsApp FR-WA-02, end-of-shift report FR-M1-26). Features can't import each other, so the creating
// feature pushes here and the tasks store merges these in when a tasks screen mounts (features/tasks/store.ts).
// Module state like lib/store.ts: survives client navigation, resets on reload.
export type IncomingTask = {
  /** Tenant the task belongs to; only that tenant's tasks screens merge it (FR-SAAS-02). */
  tenantId: string
  ref: string
  title: string
  description: string
  dept: string
  /** Display name; the tasks feature maps it to a Person.id. */
  assignee: string
  /** YYYY-MM-DD */
  due: string
  /** Display name of who created it. */
  creator: string
  /** YYYY-MM-DDTHH:mm:ss, tenant time. */
  at: string
  /** Where it came from, for the timeline, e.g. "WhatsApp". */
  source: string
}

/**
 * A change to an existing task made outside /tasks: the end-of-shift report (FR-M1-26) sets the status and logs time; the
 * Today card (FR-M1-74) marks a task done or snoozes it for the day (`snooze`: timeline line only, status unchanged).
 * `itemStatus` is the report row status; the tasks store maps it with taskStatusFor() (lib/shift-report.ts). `id` is unique
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

const items: IncomingTask[] = []
const updates: TaskUpdate[] = []
/** Known refs per tenant id: each tenant has its own ref sequence. */
const seen = new Map<string, Set<string>>()

function seenFor(tenantId: string): Set<string> {
  let set = seen.get(tenantId)
  if (!set) seen.set(tenantId, (set = new Set()))
  return set
}

export const taskInbox = {
  push(t: IncomingTask) {
    items.push(t)
    seenFor(t.tenantId).add(t.ref)
  },
  /** Only the given tenant's tasks. */
  list: (tenantId: string): IncomingTask[] => items.filter((t) => t.tenantId === tenantId),
  /** The tasks store reports the refs it holds, so refs minted elsewhere never collide with them. */
  noteRefs(tenantId: string, refs: string[]) {
    const set = seenFor(tenantId)
    refs.forEach((r) => set.add(r))
  },
  knownRefs: (tenantId: string): string[] => [...(seen.get(tenantId) ?? [])],
  /** Queues task changes (same id twice is ignored). */
  pushUpdates(list: TaskUpdate[]) {
    for (const u of list) if (!updates.some((x) => x.id === u.id)) updates.push(u)
  },
  /** Only the given tenant's updates, oldest first. */
  updates: (tenantId: string): TaskUpdate[] => updates.filter((u) => u.tenantId === tenantId),
  /** Tests only. */
  reset() {
    items.length = 0
    updates.length = 0
    seen.clear()
  },
}
