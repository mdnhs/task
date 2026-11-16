// In-app notices to a member when a manager changes their task or timeline (FR-M1-12, AC-M1-04).
// The tasks feature pushes here; the shell bell (hooks/use-notify-feed.ts) subscribes and adds the signed-in person's
// notices to its feed once each (noticeFeedItems). Module state like lib/task-inbox.ts: survives client navigation, resets on reload.

export type TaskNotice = {
  id: string
  tenantId: string
  /** Person.id of the member being told. */
  to: string
  title: string
  href: string
  /** Tenant wall clock, YYYY-MM-DDTHH:mm:ss. */
  at: string
}

const notices: TaskNotice[] = []
const listeners = new Set<() => void>()

/** The notice text for a change, e.g. "Lilianna Novak rescheduled TSK-1023: Due 28 Oct → 30 Oct". */
export function noticeTitle(by: string, ref: string, what: string, changes: { field: string; from: string; to: string }[] = []): string {
  const detail = changes.map((c) => `${c.field} ${c.from} → ${c.to}`).join("; ")
  return `${by} ${what} ${ref}${detail ? `: ${detail}` : ""}`
}

export const taskNotices = {
  /** Same id twice is ignored. */
  push(n: TaskNotice) {
    if (notices.some((x) => x.id === n.id)) return
    notices.push(n)
    listeners.forEach((l) => l())
  },
  /** Called after every new notice; returns the unsubscribe. */
  subscribe(l: () => void): () => void {
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  },
  forPerson: (tenantId: string, personId: string): TaskNotice[] => notices.filter((n) => n.tenantId === tenantId && n.to === personId),
  /** Tests only. */
  reset() {
    notices.length = 0
  },
}

/** Generic wording when the tenant hides sensitive details in previews (FR-NOT-04). */
export const GENERIC_NOTICE = "A manager changed one of your tasks"

export type NoticeFeedItem = { id: string; type: "manager-action"; title: string; at: string; read: false; href: string }

/**
 * The person's notices as bell feed items, skipping ids the feed already has (so adding them is idempotent). Feed ids are
 * prefixed "task-notice:" so they never clash with seeded or reminder ids.
 */
export function noticeFeedItems(list: TaskNotice[], have: Set<string>, hideSensitive: boolean): NoticeFeedItem[] {
  return list
    .map((n) => ({ id: `task-notice:${n.id}`, type: "manager-action" as const, title: hideSensitive ? GENERIC_NOTICE : n.title, at: n.at, read: false as const, href: n.href }))
    .filter((n) => !have.has(n.id))
}
