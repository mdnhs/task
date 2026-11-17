// Runs one write for the UI (B6 ruling I10): ONE request per action key at a time, and the server is the truth.
// The UI changes optimistically (React's useOptimistic, or a local state the caller owns). Whatever the answer, the page then re-reads the server record
// (`refresh`, the router's refresh), so a refused write leaves no lie on screen: `rollback` undoes any local state that outlives the refresh, and the mapped
// copy plus a "Ref <requestId>" is shown. A 402 additionally lights the billing banner: the browser client announces it (lib/api/blocked.ts) for every write.
import { classifyApiError, userMessage, type ErrorKind } from "./problem"

export type ActionDeps = {
  notify: (m: { text: string; ref: string | null }) => void
  refresh: () => void
}
export type ActionResult<T> = { ok: true; value: T } | { ok: false; kind: ErrorKind | "in_flight" }

export function makeActionRunner(deps: ActionDeps) {
  const inFlight = new Set<string>()
  return async function run<T>(key: string, request: () => Promise<T>, opts: { rollback?: () => void } = {}): Promise<ActionResult<T>> {
    if (inFlight.has(key)) return { ok: false, kind: "in_flight" } // a double click sends nothing
    inFlight.add(key)
    try {
      const value = await request()
      deps.refresh()
      return { ok: true, value }
    } catch (e) {
      opts.rollback?.()
      deps.notify(userMessage(e))
      deps.refresh()
      return { ok: false, kind: classifyApiError(e).kind }
    } finally {
      inFlight.delete(key)
    }
  }
}
