import { and, eq, isNull, lt, or } from "drizzle-orm"
import { memberships } from "../../db/schema"
import { withTenant } from "../../db/tenant-tx"
import type { Deps } from "../../deps"

/** A member's last-active stamp moves at most once per this long (FR: Settings -> Users "last active"). */
export const LAST_ACTIVE_GAP_MS = 5 * 60_000

const inflight = new Set<Promise<void>>()

/** Resolves when every stamp started so far has settled. Tests only (the request path never waits for a stamp). */
export async function flushLastActive(): Promise<void> {
  while (inflight.size > 0) await Promise.all([...inflight])
}

/**
 * Stamps `memberships.last_active_at` for a member who just made an authenticated tenant request. The caller read `seen` (the current value) with the
 * membership it already loaded, so a request inside the gap costs NOTHING extra. Otherwise ONE conditional UPDATE runs in the background: it is never awaited
 * by the request, an error is swallowed (counted in `last_active_stamp_total{result="failed"}`, never a failed request) and the `where` repeats the gap check
 * so two instances racing, or a slow earlier stamp, cannot move the value backwards or twice inside the window. Time comes from deps.clock only.
 */
export function touchLastActive(deps: Deps, tenantId: string, userId: string, seen: Date | null): void {
  const now = deps.clock.now()
  if (seen && now.getTime() - seen.getTime() < LAST_ACTIVE_GAP_MS) return
  const before = new Date(now.getTime() - LAST_ACTIVE_GAP_MS)
  const p: Promise<void> = withTenant(deps.db, tenantId, (tx) =>
    tx
      .update(memberships)
      .set({ lastActiveAt: now })
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId), or(isNull(memberships.lastActiveAt), lt(memberships.lastActiveAt, before)))),
  )
    .then(() => deps.metrics.counter("last_active_stamp_total", { result: "ok" }).inc())
    .catch((err: unknown) => {
      deps.metrics.counter("last_active_stamp_total", { result: "failed" }).inc()
      deps.logger.warn({ tenantId, errCode: (err as { code?: string } | null)?.code ?? "error" }, "last-active stamp failed")
    })
    .finally(() => void inflight.delete(p))
  inflight.add(p)
}
