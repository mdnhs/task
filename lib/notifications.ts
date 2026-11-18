// The shell bell, as the API tells it (B6 T6.4): GET /v1/notifications, mark one, mark all, and a 60 s poll that runs only while the tab is visible.
// There is NO client outbox: task, report, billing and member notices are written by the API (in the same transaction as the change, redacted by the API),
// so the bell only lists them. Pure: the API client, the document and the zone are arguments.
import type { ApiClient } from "./api/client"
import { userMessage } from "./api/problem"
import { wallInTz } from "./tz"

export type NotificationKind = "invite" | "member" | "file" | "security" | "dsr" | "billing" | "system" | "task" | "report"
const KINDS: readonly NotificationKind[] = ["invite", "member", "file", "security", "dsr", "billing", "system", "task", "report"]

/** One bell row. `at` is the tenant's wall time ("YYYY-MM-DDTHH:mm:ss"), like every other date the UI formats. The body text is not carried: the bell shows the title only. */
export type BellItem = { id: string; type: NotificationKind; title: string; at: string; read: boolean; href: string }

type Dto = { id: string; kind: string; title: string; body?: string; link: string | null; createdAt: string; readAt: string | null }

/** Where a notice with no (or an unusable) link goes: the page of its kind. */
const KIND_HOME: Record<NotificationKind, string> = {
  invite: "/settings/users", member: "/settings/users", file: "/files", security: "/account/security", dsr: "/settings/privacy",
  billing: "/settings/billing", system: "/", task: "/tasks", report: "/daily-reports",
}

/** Only an in-app absolute path is followed: never a scheme, a host, a protocol-relative URL or a backslash. */
const isAppPath = (l: string) => /^\/(?![/\\])[^\s\\]*$/.test(l)

/** The API's report notices link to `/reports` and `/reports/<id>`; the web's pages live under `/daily-reports` (the URL kept so old links work). Only the exact first segment is renamed. */
const webPath = (l: string) => l.replace(/^\/reports(?=$|[/?#])/, "/daily-reports")

export function toNotification(dto: Dto, timezone: string): BellItem {
  const type = (KINDS as readonly string[]).includes(dto.kind) ? (dto.kind as NotificationKind) : "system"
  return {
    id: dto.id, type, title: dto.title, at: wallInTz(dto.createdAt, timezone), read: dto.readAt !== null,
    href: dto.link && isAppPath(dto.link) ? webPath(dto.link) : KIND_HOME[type],
  }
}

export async function loadNotifications(api: Pick<ApiClient, "get">, timezone: string): Promise<{ items: BellItem[]; unread: number }> {
  const res = await api.get("/v1/notifications", { query: { limit: 50 } })
  return { items: res.items.map((n) => toNotification(n, timezone)), unread: res.unread }
}

export async function markRead(api: Pick<ApiClient, "post">, id: string, timezone: string): Promise<BellItem> {
  return toNotification(await api.post("/v1/notifications/{id}/read", { path: { id } }), timezone)
}

/** Returns how many were marked. */
export async function markAllRead(api: Pick<ApiClient, "post">): Promise<number> {
  return (await api.post("/v1/notifications/read-all")).updated
}

export const POLL_MS = 60_000
type VisibilityDoc = { visibilityState: string; addEventListener(t: "visibilitychange", l: () => void): void; removeEventListener(t: "visibilitychange", l: () => void): void }

/**
 * Calls `load` now and every 60 s, but only while the tab is visible: a hidden tab makes no calls, and becoming visible refreshes at once and resumes the beat.
 * A failed load is swallowed (the next beat tries again) and two loads never overlap. Returns the stop function.
 */
export function startPolling(o: { load: () => Promise<unknown>; doc: VisibilityDoc; intervalMs?: number }): () => void {
  const every = o.intervalMs ?? POLL_MS
  let timer: ReturnType<typeof setInterval> | null = null
  let busy = false
  const visible = () => o.doc.visibilityState === "visible"
  const tick = () => {
    if (!visible() || busy) return
    busy = true
    let run: Promise<unknown>
    try {
      run = Promise.resolve(o.load()) // called synchronously: the first load starts the moment the bell mounts
    } catch (e) {
      run = Promise.reject(e)
    }
    void run
      .catch(() => undefined)
      .finally(() => {
        busy = false
      })
  }
  const arm = () => {
    if (visible()) {
      tick()
      timer ??= setInterval(tick, every)
    } else if (timer) {
      clearInterval(timer)
      timer = null
    }
  }
  o.doc.addEventListener("visibilitychange", arm)
  arm()
  return () => {
    o.doc.removeEventListener("visibilitychange", arm)
    if (timer) clearInterval(timer)
    timer = null
  }
}

/** What a guarded mark reports: success, or the mapped copy (never the server's text) and the request ref, for a toast. */
export type MarkResult = { ok: true } | { ok: false; text: string; ref: string | null }

/** Marks one notice read; a failure never throws (the caller reverts its optimistic state and toasts the returned copy). */
export async function markGuarded(api: Pick<ApiClient, "post">, id: string, timezone: string): Promise<MarkResult> {
  try {
    await markRead(api, id, timezone)
    return { ok: true }
  } catch (e) {
    return { ok: false, ...userMessage(e) }
  }
}

export async function markAllGuarded(api: Pick<ApiClient, "post">): Promise<MarkResult> {
  try {
    await markAllRead(api)
    return { ok: true }
  } catch (e) {
    return { ok: false, ...userMessage(e) }
  }
}
