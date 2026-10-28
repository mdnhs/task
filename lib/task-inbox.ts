// Hand-off for tasks created outside /tasks (WhatsApp, FR-WA-02). Features can't import each other, so the creating
// feature pushes here and the tasks store merges these in when a tasks screen mounts (features/tasks/store.ts).
// Module state like lib/store.ts: survives client navigation, resets on reload.
export type IncomingTask = {
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
const seen = new Set<string>()

export const taskInbox = {
  push(t: IncomingTask) {
    items.push(t)
    seen.add(t.ref)
  },
  list: (): readonly IncomingTask[] => items,
  /** The tasks store reports the refs it holds, so refs minted elsewhere never collide with them. */
  noteRefs(refs: string[]) {
    refs.forEach((r) => seen.add(r))
  },
  knownRefs: (): string[] => [...seen],
  /** Tests only. */
  reset() {
    items.length = 0
    seen.clear()
  },
}
