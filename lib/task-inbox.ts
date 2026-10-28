// Hand-off for tasks created outside /tasks (WhatsApp, FR-WA-02). Features can't import each other, so the creating
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

const items: IncomingTask[] = []
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
  /** Tests only. */
  reset() {
    items.length = 0
    seen.clear()
  },
}
