"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { apiBrowser } from "@/lib/api/browser"
import { loadNotifications, markAllRead, markRead, startPolling, type BellItem } from "@/lib/notifications"

type State = { items: BellItem[]; unread: number; loaded: boolean }

/**
 * The bell's data (B6 T6.4): the API's own notifications, refreshed every 60 s while the tab is visible and after every change the user makes here.
 * Marking read is optimistic and reverts to the server's list if the call fails. `timezone` is the tenant's: it turns the API's instants into the tenant's wall time.
 */
export function useNotifications(timezone: string) {
  const [state, setState] = useState<State>({ items: [], unread: 0, loaded: false })
  const alive = useRef(true)

  const reload = useCallback(async () => {
    const r = await loadNotifications(apiBrowser, timezone)
    if (alive.current) setState({ items: r.items, unread: r.unread, loaded: true })
  }, [timezone])

  useEffect(() => {
    alive.current = true
    const stop = startPolling({ load: reload, doc: document })
    return () => {
      alive.current = false
      stop()
    }
  }, [reload])

  const read = useCallback(
    (id: string) => {
      setState((s) => ({ ...s, items: s.items.map((n) => (n.id === id ? { ...n, read: true } : n)), unread: Math.max(0, s.unread - (s.items.find((n) => n.id === id && !n.read) ? 1 : 0)) }))
      void markRead(apiBrowser, id, timezone).catch(() => undefined).then(() => reload().catch(() => undefined))
    },
    [timezone, reload],
  )

  const readAll = useCallback(() => {
    setState((s) => ({ ...s, items: s.items.map((n) => ({ ...n, read: true })), unread: 0 }))
    void markAllRead(apiBrowser).catch(() => undefined).then(() => reload().catch(() => undefined))
  }, [reload])

  return { ...state, read, readAll }
}
