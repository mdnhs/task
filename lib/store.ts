import { useSyncExternalStore } from "react"

// Per-feature in-memory store. Survives client navigation (module state), resets on reload.
// Mock-data features seed it from their fetched JSON and mutate it locally.
export function createStore<T>() {
  let value: T | undefined
  let seeded = false
  let scopeKey: string | undefined
  const listeners = new Set<() => void>()

  const get = () => value
  const subscribe = (fn: () => void) => {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }
  /**
   * Sets the value only if nothing is stored yet. With a `scope` (what the seed was built for: tenant, role...), a seed
   * under a different scope replaces the stored value silently. It may run during render, so it does not notify listeners.
   */
  const seed = (v: T, scope?: string) => {
    if (!seeded) {
      value = v
      seeded = true
      scopeKey = scope
    } else if (scope !== undefined && scope !== scopeKey) {
      value = v
      scopeKey = scope
    }
  }
  const set = (update: (prev: T) => T) => {
    if (!seeded) {
      if (process.env.NODE_ENV !== "production") console.warn("store.set called before the store was seeded")
      return
    }
    value = update(value as T)
    listeners.forEach((fn) => fn())
  }
  const reset = () => {
    value = undefined
    seeded = false
    scopeKey = undefined
    listeners.forEach((fn) => fn())
  }

  function useStore(initial: T, scope?: string): readonly [T, (update: (prev: T) => T) => void] {
    // Never write on the server: module state there is shared between requests.
    if (typeof window !== "undefined") seed(initial, scope)
    const current = useSyncExternalStore(subscribe, get, () => initial)
    return [seeded ? (current as T) : initial, set] as const
  }

  return { useStore, get, seed, set, subscribe, reset }
}
