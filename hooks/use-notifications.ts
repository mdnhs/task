"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { toast } from "sonner"

import { apiBrowser } from "@/lib/api/browser"
import { loadNotifications, markAllGuarded, markGuarded, startPolling, type BellItem, type MarkResult } from "@/lib/notifications"

type State = { items: BellItem[]; unread: number; loaded: boolean }

/**
 * The bell's data (B6 T6.4): the API's own notifications, refreshed every 60 s while the tab is visible and after every change the user makes here.
 * Marking read is optimistic; a failed call puts the previous list back and shows a toast with the mapped copy (never silent). `timezone` is the tenant's: it turns the API's instants into the tenant's wall time.
 */
export function useNotifications(timezone: string) {
  const [state, setState] = useState<State>({ items: [], unread: 0, loaded: false })
  const alive = useRef(true)
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

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

  const failed = (r: MarkResult, before: State) => {
    if (r.ok) return
    if (alive.current) setState(before) // the optimistic change did not happen on the server: show the truth we had
    toast.error(r.text, r.ref ? { description: `Ref ${r.ref}` } : undefined)
  }

  const read = useCallback(
    (id: string) => {
      const before = stateRef.current
      setState((s) => ({ ...s, items: s.items.map((n) => (n.id === id ? { ...n, read: true } : n)), unread: Math.max(0, s.unread - (s.items.find((n) => n.id === id && !n.read) ? 1 : 0)) }))
      void markGuarded(apiBrowser, id, timezone).then((r) => (failed(r, before), reload().catch(() => undefined)))
    },
    [timezone, reload],
  )

  const readAll = useCallback(() => {
    const before = stateRef.current
    setState((s) => ({ ...s, items: s.items.map((n) => ({ ...n, read: true })), unread: 0 }))
    void markAllGuarded(apiBrowser).then((r) => (failed(r, before), reload().catch(() => undefined)))
  }, [reload])

  return { ...state, read, readAll }
}
