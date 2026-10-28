export const RECENTS_KEY = "od-search-recents"
export const RECENTS_MAX = 6

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">

/** Newest first, case-insensitive de-dupe, capped. Blank queries are ignored. */
export function pushRecent(list: string[], q: string, max = RECENTS_MAX): string[] {
  const v = q.trim().slice(0, 100)
  if (!v) return list
  return [v, ...list.filter((x) => x.toLowerCase() !== v.toLowerCase())].slice(0, max)
}

export function removeRecent(list: string[], q: string): string[] {
  return list.filter((x) => x !== q)
}

function storage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}

/** Every access is guarded: private windows, blocked site data and previews can throw or return junk. */
export function readRecents(s: StorageLike | null = storage()): string[] {
  try {
    const raw = s?.getItem(RECENTS_KEY)
    const v: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, RECENTS_MAX) : []
  } catch {
    return []
  }
}

export function writeRecents(list: string[], s: StorageLike | null = storage()): void {
  try {
    if (list.length === 0) s?.removeItem(RECENTS_KEY)
    else s?.setItem(RECENTS_KEY, JSON.stringify(list))
  } catch {
    // Storage unavailable: recents just live in memory for this session.
  }
}
