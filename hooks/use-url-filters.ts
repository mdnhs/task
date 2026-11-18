"use client"

import { useCallback, useRef, useState, useTransition } from "react"
import { usePathname, useRouter } from "next/navigation"

/**
 * Filters that live in the URL, so the SERVER answers every filter (cursor pagination and scope are the API's, not the page's). The control updates at once; the URL follows
 * (the search box 300 ms later, so typing is not one request per key). `pending` is true while the new page is being fetched.
 */
export function useUrlFilters<F extends Record<string, string>>(initial: F, defaults: F) {
  const router = useRouter()
  const pathname = usePathname()
  const [f, setF] = useState<F>(initial)
  const latest = useRef<F>(initial)
  const [pending, start] = useTransition()
  const timer = useRef<number | undefined>(undefined)
  const go = useCallback(
    (next: F) => {
      const q = new URLSearchParams()
      for (const k of Object.keys(next)) if (next[k] !== defaults[k] && next[k] !== "") q.set(k, next[k]!)
      const qs = q.toString()
      start(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }))
    },
    [defaults, pathname, router],
  )
  const set = useCallback(
    <K extends keyof F>(k: K, v: F[K]) => {
      const next = { ...latest.current, [k]: v }
      latest.current = next
      setF(next)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => go(next), k === "q" ? 300 : 0)
    },
    [go],
  )
  const reset = useCallback(() => {
    latest.current = defaults
    setF(defaults)
    go(defaults)
  }, [defaults, go])
  return { filters: f, set, reset, pending }
}
