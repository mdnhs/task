"use client"

import { useEffect } from "react"

import { createStore } from "@/lib/store"
import { clockAt, dueReminders, preview, type NotifyContext } from "@/lib/notify"

// The shell notification list as a store (it was component state), so generated reminders and read state survive navigation.
export type FeedItem = { id: string; type: string; title: string; at: string; read: boolean; href: string }
export const notifyFeed = createStore<FeedItem[]>()

/** Mock clock override ("HH:MM" on the org's today) so the schedule can be tried before the deadline. null = the org clock. */
export const notifyClock = createStore<string | null>()

/**
 * Seeds the shell list and, against the org's mock clock, adds the reminders and overdue alerts that are due for this user.
 * Idempotent: each item has a stable id per day, so re-running never duplicates. Respects hide-sensitive in the text.
 */
export function useNotifyFeed<T extends FeedItem>(items: T[], scope: string, ctx?: NotifyContext) {
  const [list, setList] = notifyFeed.useStore(items, scope)
  const [clock] = notifyClock.useStore(null)

  useEffect(() => {
    if (!ctx) return
    const now = clock ? clockAt(ctx.today, clock) : ctx.today
    const due = dueReminders(ctx.schedule, now, { pending: ctx.pending, deadline: ctx.deadline, managers: [{ id: "me", name: "me" }], submitters: [{ id: "me", name: "me" }] })
      .filter((d) => d.channels.includes("inapp") && (d.kind === "reminder" ? ctx.canSubmit : ctx.isManager))
    if (due.length === 0) return
    setList((prev) => {
      const have = new Set(prev.map((n) => n.id))
      const fresh = due
        .filter((d) => !have.has(d.id))
        .map((d) => ({ id: d.id, type: "reminder", title: preview(d.message, ctx.hideSensitive).title, at: `${d.atIso}:00`, read: false, href: d.kind === "reminder" ? "/daily-reports" : "/manager-attention" }))
      return fresh.length === 0 ? prev : [...fresh, ...prev].sort((a, b) => b.at.localeCompare(a.at))
    })
  }, [ctx, clock, setList])

  return [list as FeedItem[], setList] as const
}
