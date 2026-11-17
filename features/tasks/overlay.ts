// The optimistic overlay as pure functions (B6 ruling I10): the server's list plus the tasks the UI predicted. Predictions live only until fresh server data arrives
// (a new `base` array) or the write fails (`clear`): the server record always wins. The hook (use-task-writes.ts) holds one of these in React state.
import type { Task } from "./types"

export type Overlay = { base: readonly Task[]; byId: ReadonlyMap<string, Task> }
const NONE: ReadonlyMap<string, Task> = new Map()

export const emptyOverlay = (base: readonly Task[]): Overlay => ({ base, byId: NONE })

/** The list as the screen shows it: predictions only while they belong to THIS server list (fresh server data replaces every one of them). */
export function viewOf(server: readonly Task[], ov: Overlay): Task[] {
  if (ov.base !== server || ov.byId.size === 0) return server as Task[]
  return server.map((t) => (t.id && ov.byId.get(t.id)) || t)
}

export const predictInto = (ov: Overlay, server: readonly Task[], id: string, next: Task): Overlay => ({ base: server, byId: new Map(ov.base === server ? ov.byId : NONE).set(id, next) })

export function clearFrom(ov: Overlay, id: string): Overlay {
  if (!ov.byId.has(id)) return ov
  const m = new Map(ov.byId)
  m.delete(id)
  return { ...ov, byId: m }
}
