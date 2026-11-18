// Browser stores that hold something a person typed or chose while working in ONE company. clearClientStores(reason) is the ONE hook, called when the person
// switches company ("tenant_switch"), signs out ("sign_out"), lands on the sign-in page after a dead session ("expired") or a call finds the session gone
// because another device revoked it ("revoked"), so the next company (or the next person on a shared computer) never sees them: the recent searches (search
// terms can be task titles, names, references), the registered in-memory stores and, when the person is gone, the Today cookie mirror.
// The Today card's localStorage choices stay (keyed by company and user, lib/today-prefs.ts); its cookie mirror is keyed too, so a company switch keeps it
// and only a sign-out, expiry or revoke removes it. Every access is guarded (storage and cookies can be blocked).
import { TODAY_COOKIE_PREFIX } from "./today"

export type ClearReason = "sign_out" | "expired" | "revoked" | "tenant_switch"
const COMPANY_SCOPED_PREFIXES = ["od-search-recents"] // features/search/recents.ts RECENTS_KEY (test/client-stores.test.ts pins the two together)

// In-memory stores (module-level caches) register a reset here, so one call clears them together with the browser storage. Features never import each other: they import this.
const resets = new Set<() => void>()
export function registerClientStoreReset(fn: () => void): void {
  resets.add(fn)
}

type StorageLike = Pick<Storage, "length" | "key" | "removeItem">
type CookieJar = { cookie: string }
export type ClearTargets = { storage?: StorageLike | null; cookies?: CookieJar | null }

export function clearClientStores(reason: ClearReason, t: ClearTargets = {}): void {
  const s = t.storage === undefined ? storage() : t.storage
  try {
    if (s) {
      const doomed: string[] = []
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i)
        if (k && COMPANY_SCOPED_PREFIXES.some((p) => k === p || k.startsWith(`${p}:`))) doomed.push(k)
      }
      for (const k of doomed) s.removeItem(k)
    }
  } catch {
    // storage unavailable: nothing to clear
  }
  if (reason !== "tenant_switch") clearTodayMirror(t.cookies === undefined ? jar() : t.cookies)
  // After the storage is empty: subscribers re-read it when their store resets.
  for (const fn of resets) {
    try {
      fn()
    } catch {
      // a failing reset must not stop the others
    }
  }
}

/** The same, kept for callers that only switch company. */
export const clearCompanyScopedStores = (s?: StorageLike | null): void => clearClientStores("tenant_switch", { storage: s })

// A dead session is seen by every call that was in flight; the stores are cleared once for all of them (until the page is loaded again).
let clearedOnce = false
export function clearClientStoresOnce(reason: ClearReason, t: ClearTargets = {}): void {
  if (clearedOnce) return
  clearedOnce = true
  clearClientStores(reason, t)
}
/** Tests only: lets the next clearClientStoresOnce run. */
export function rearmClientStoresOnce(): void {
  clearedOnce = false
}

function clearTodayMirror(c: CookieJar | null): void {
  try {
    if (!c) return
    for (const part of c.cookie.split(";")) {
      const name = part.split("=")[0]!.trim()
      if (name.startsWith(TODAY_COOKIE_PREFIX)) c.cookie = `${name}=; path=/; max-age=0; samesite=lax`
    }
  } catch {
    // cookies unavailable: the server falls back to the default card
  }
}

function jar(): CookieJar | null {
  try {
    return typeof document === "undefined" ? null : document
  } catch {
    return null
  }
}

function storage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}
