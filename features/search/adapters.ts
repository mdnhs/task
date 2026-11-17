// Search on the real API (B6 T6.5, ruling I19). Data hits come from GET /v1/search?q= (scoped by the API to what the caller may read) and are mapped to the
// same SearchItem the dialog already renders: one `href` per entity, no facets (the API has none yet, B11), so a facet filter drops them. Nav pages, quick actions and
// popular terms stay local. Pure: timers and the API client are arguments.
import type { ApiClient } from "@/lib/api/client"
import type { SearchItem, SearchType } from "./types"

type Hit = { entity: string; entityId: string; title: string; module: string }

const TASK_REF = /^(TSK-\d+)\b/

/** Entity -> where the hit opens. An entity this app has no page for is dropped (never a dead link). */
function hrefAndType(h: Hit): { type: SearchType; href: string; ref: string } | null {
  switch (h.entity) {
    case "task": {
      const ref = TASK_REF.exec(h.title)?.[1]
      return ref ? { type: "task", href: `/tasks/${encodeURIComponent(ref)}`, ref } : { type: "task", href: "/tasks", ref: "" }
    }
    case "report": return { type: "report", href: `/daily-reports/${encodeURIComponent(h.entityId)}`, ref: "" }
    case "member": return { type: "member", href: "/settings/users", ref: "" }
    case "file": return { type: "file", href: "/files", ref: "" }
    default: return null
  }
}

export function hitsToItems(hits: readonly Hit[]): SearchItem[] {
  const out: SearchItem[] = []
  for (const h of hits) {
    const m = hrefAndType(h)
    if (m) out.push({ id: `api:${h.entity}:${h.entityId}`, type: m.type, title: h.title, ref: m.ref, href: m.href, dept: "", owner: "", status: "", date: "" })
  }
  return out
}

export const SEARCH_DEBOUNCE_MS = 150
export const SEARCH_MIN_CHARS = 2
export const SEARCH_LIMIT = 20

type Timer = unknown

/**
 * One searcher per dialog. `search(q)` waits 150 ms; a newer call before that cancels the wait, and a newer call while a request is in flight aborts it. It resolves the items,
 * `[]` for a query under 2 characters or a failed request, or `null` when it was superseded (the caller ignores that answer).
 */
export function makeSearcher(o: {
  api: Pick<ApiClient, "get">
  setTimer?: (fn: () => void, ms: number) => Timer
  clearTimer?: (t: Timer) => void
}) {
  const setTimer = o.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const clearTimer = o.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>))
  let timer: Timer | null = null
  let ctl: AbortController | null = null
  let cancelPending: (() => void) | null = null

  function supersede() {
    if (timer !== null) clearTimer(timer)
    timer = null
    ctl?.abort()
    ctl = null
    cancelPending?.()
    cancelPending = null
  }

  return {
    search(raw: string): Promise<SearchItem[] | null> {
      supersede()
      const q = raw.trim()
      if (q.length < SEARCH_MIN_CHARS) return Promise.resolve([])
      return new Promise((resolve) => {
        cancelPending = () => resolve(null)
        timer = setTimer(() => {
          timer = null
          cancelPending = null
          const mine = new AbortController()
          ctl = mine
          o.api.get("/v1/search", { query: { q, limit: String(SEARCH_LIMIT) }, signal: mine.signal }).then(
            (r) => resolve(mine.signal.aborted ? null : hitsToItems((r as { hits: Hit[] }).hits)),
            () => resolve(mine.signal.aborted ? null : []),
          )
        }, SEARCH_DEBOUNCE_MS)
      })
    },
    cancel: supersede,
  }
}

/** Mock-backed kinds (payroll, orders, staff, recruitment, client files...) are in the index only on a demo deployment (I16). */
export const mockSearchEnabled = (env: Record<string, string | undefined>): boolean => env.ENABLE_MOCK_MODULES === "1"
