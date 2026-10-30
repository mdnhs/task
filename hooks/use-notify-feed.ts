"use client"

import { useEffect } from "react"

import { createStore } from "@/lib/store"
import { clockAt, dueReminders, preview, type NotifyContext } from "@/lib/notify"
import { noticeFeedItems, taskNotices } from "@/lib/task-notices"

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
    // Missing shift reports (FR-M1-30), already filtered for this viewer on the server; only those due by the mock clock.
    const alerts = (ctx.alerts ?? []).filter((a) => a.at.slice(0, 16) <= now.slice(0, 16))
    if (due.length === 0 && alerts.length === 0) return
    setList((prev) => {
      const have = new Set(prev.map((n) => n.id))
      const fresh = [
        ...due.map((d) => ({ id: d.id, type: "reminder", title: preview(d.message, ctx.hideSensitive).title, at: `${d.atIso}:00`, read: false, href: d.kind === "reminder" ? "/daily-reports" : "/manager-attention" })),
        ...alerts.map((a) => ({ id: a.id, type: "deadline", title: a.title, at: a.at, read: false, href: a.href })),
      ].filter((d) => !have.has(d.id))
      return fresh.length === 0 ? prev : [...fresh, ...prev].sort((a, b) => b.at.localeCompare(a.at))
    })
  }, [ctx, clock, setList])

  // Task change notices for this person (FR-M1-12): added now and whenever the tasks feature pushes a new one. Idempotent.
  const tenantId = ctx?.me?.tenantId
  const personId = ctx?.me?.personId
  const hide = ctx?.hideSensitive ?? false
  useEffect(() => {
    if (!tenantId || !personId) return
    const pull = () =>
      setList((prev) => {
        const fresh = noticeFeedItems(taskNotices.forPerson(tenantId, personId), new Set(prev.map((n) => n.id)), hide)
        return fresh.length === 0 ? prev : [...fresh, ...prev].sort((a, b) => b.at.localeCompare(a.at))
      })
    pull()
    return taskNotices.subscribe(pull)
  }, [tenantId, personId, hide, setList])

  return [list as FeedItem[], setList] as const
}
