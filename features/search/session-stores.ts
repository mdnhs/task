import { registerClientStoreReset } from "@/lib/client-stores"

import { readRecents, recentsKey, writeRecents } from "./recents"
import type { SearchConfig, SearchItem } from "./types"

// In-memory search state that lives for the whole browser tab: the recents (one store per index `scope`, so tenant and platform queries never mix)
// and the lazily loaded index. Both belong to one company and one person, so `resetSearchState` drops them on sign-out and company switch
// (lib/client-stores.ts calls it through registerClientStoreReset).
export type RecentsStore = { subscribe: (fn: () => void) => () => void; get: () => string[]; set: (next: string[]) => void; reset: () => void }
const recentsStores = new Map<string, RecentsStore>()
export function recentsFor(scope: string): RecentsStore {
  let st = recentsStores.get(scope)
  if (st) return st
  const key = recentsKey(scope)
  const listeners = new Set<() => void>()
  let cache: string[] | null = null
  st = {
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    get() {
      if (cache === null) cache = readRecents(undefined, key)
      return cache
    },
    set(next) {
      cache = next
      writeRecents(next, undefined, key)
      listeners.forEach((fn) => fn())
    },
    reset() {
      cache = null
      listeners.forEach((fn) => fn())
    },
  }
  recentsStores.set(scope, st)
  return st
}

// The index is loaded lazily on the first open (server action, role-filtered on the server). One cache per index (`scope`).
export type SearchData = { items: SearchItem[]; config: SearchConfig }
export type SearchLoader = () => Promise<SearchData>
const dataCache = new Map<string, Promise<SearchData>>()
export const loadSearch = (scope: string, load: SearchLoader) => {
  let p = dataCache.get(scope)
  if (!p) {
    const mine: Promise<SearchData> = load().catch((e: unknown) => {
      if (dataCache.get(scope) === mine) dataCache.delete(scope)
      throw e
    })
    p = mine
    dataCache.set(scope, p)
  }
  return p
}

const resetListeners = new Set<() => void>()
export function onSearchReset(fn: () => void): () => void {
  resetListeners.add(fn)
  return () => resetListeners.delete(fn)
}

export function resetSearchState(): void {
  dataCache.clear()
  recentsStores.forEach((st) => st.reset())
  resetListeners.forEach((fn) => fn())
}

registerClientStoreReset(resetSearchState)
