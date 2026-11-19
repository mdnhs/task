// The platform console's bell (B8 T17 API, T24 web): GET /v1/platform/notifications is a DERIVED feed (data requests staff can act on: running or failed; past-due or unpaid
// subscriptions; trials ending within 7 days; the caller's own support grants about to expire), newest first, with `unread` = items newer than the caller's last "seen".
// POST /v1/platform/notifications/seen stamps "seen" in one statement on the server clock (never backwards) and answers unread 0. There is no per-item read state: the newest
// `unread` items are the unread ones. Ids, tenant names and dates only. Pure mapping plus the two calls; the hook and the panel live in hooks/ and features/shell.
import type { ApiClient } from "@/lib/api/client"

export type PlatformBellKind = "data_request" | "failed_payment" | "trial_ending" | "grant_expiring"
export type PlatformBellItem = { id: string; type: "dsr" | "payment" | "trial" | "access"; title: string; href: string; /** UTC wall clock (the console has no tenant zone). */ at: string; read: boolean }

const TYPE: Record<PlatformBellKind, PlatformBellItem["type"]> = { data_request: "dsr", failed_payment: "payment", trial_ending: "trial", grant_expiring: "access" }
const TITLE: Record<PlatformBellKind, string> = { data_request: "Data request waiting", failed_payment: "Payment failed", trial_ending: "Trial ending", grant_expiring: "Your support access ends soon" }

type Dto = { items: { kind: PlatformBellKind; tenantId: string; tenantName: string; refId: string | null; at: string; until: string | null }[]; unread: number }

/** The feed as the bell lists it: the newest `unread` items are unread (the API counts items after your last "seen"). */
export function toPlatformBell(dto: Dto): { items: PlatformBellItem[]; unread: number } {
  const unread = Math.max(0, Math.min(dto.unread, dto.items.length))
  const items = dto.items.map((i, n) => ({
    id: `${i.kind}:${i.tenantId}:${i.refId ?? ""}:${i.at}`,
    type: TYPE[i.kind],
    title: `${TITLE[i.kind]} · ${i.tenantName}`,
    href: i.kind === "data_request" ? "/platform/data-requests" : i.kind === "grant_expiring" ? "/platform/support" : `/platform/tenants/${encodeURIComponent(i.tenantId)}`,
    at: i.at.slice(0, 19),
    read: n >= unread,
  }))
  return { items, unread }
}

type Client = Pick<ApiClient, "get" | "post">
export const loadPlatformBell = async (api: Client) => toPlatformBell((await api.get("/v1/platform/notifications")) as Dto)
/** "Mark seen": the server stamps its own clock; the answer's unread (0) replaces the badge. */
export const markPlatformBellSeen = async (api: Client): Promise<number> => (await api.post("/v1/platform/notifications/seen")).unread
