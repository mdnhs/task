// Browser stores that hold something a person typed or chose while working in ONE company. They are cleared when the person switches company or signs out, so the next
// company (or the next person on a shared computer) never sees them: the recent searches (search terms can be task titles, names, references).
// The Today card's choices are not here: they are keyed by company and user (lib/today-prefs.ts) and stay. Every access is guarded (storage can be blocked).
const COMPANY_SCOPED_PREFIXES = ["od-search-recents"] // features/search/recents.ts RECENTS_KEY (test/client-stores.test.ts pins the two together)

type StorageLike = Pick<Storage, "length" | "key" | "removeItem">

export function clearCompanyScopedStores(s: StorageLike | null = storage()): void {
  try {
    if (!s) return
    const doomed: string[] = []
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i)
      if (k && COMPANY_SCOPED_PREFIXES.some((p) => k === p || k.startsWith(`${p}:`))) doomed.push(k)
    }
    for (const k of doomed) s.removeItem(k)
  } catch {
    // storage unavailable: nothing to clear
  }
}

function storage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}
