"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { apiBrowser } from "@/lib/api/browser"
import { userMessage } from "@/lib/api/problem"
import { startPolling } from "@/lib/notifications"
import { loadPlatformBell, markPlatformBellSeen, type PlatformBellItem } from "@/lib/platform-bell"

type State = { items: PlatformBellItem[]; unread: number; loaded: boolean }

/**
 * The console bell's data (B8 Task 24): the API's derived feed, polled every 60 s while the tab is visible. "Mark seen" is optimistic (badge to 0 at once); a refused call puts the
 * previous state back with the mapped copy (never silent), then the feed is read again. A poll already in flight when "Mark seen" is clicked is ignored (it would restore the old count). Mounted only for active platform staff (the console layout decides).
 */
export function usePlatformBell() {
  const [state, setState] = useState<State>({ items: [], unread: 0, loaded: false })
  const alive = useRef(true)
  // Bumped by "Mark seen": a read that started before it (a poll still on the wire) answers with the old unread count and is dropped; only reads started after it apply.
  const gen = useRef(0)
  const reload = useCallback(async () => {
    const mine = gen.current
    const r = await loadPlatformBell(apiBrowser)
    if (alive.current && mine === gen.current) setState({ ...r, loaded: true })
  }, [])
  useEffect(() => {
    alive.current = true
    const stop = startPolling({ load: reload, doc: document })
    return () => {
      alive.current = false
      stop()
    }
  }, [reload])
  const seen = useCallback(() => {
    let before: State | null = null
    gen.current++
    setState((s) => ((before = s), { ...s, unread: 0, items: s.items.map((i) => ({ ...i, read: true })) }))
    void markPlatformBellSeen(apiBrowser)
      .catch((e: unknown) => {
        if (alive.current && before) setState(before)
        toast.error(userMessage(e).text)
      })
      .finally(() => void reload().catch(() => undefined))
  }, [reload])
  return { ...state, seen }
}
