// The browser side of Today (B6 T6.7). "Mark done" and "Snooze" are ONE call each: `POST /v1/today/updates { taskId, action, dayKey }` where dayKey is the working day the card was built for
// (`workingDay.key`, H6: the server compares it with ITS working day and answers 422 invalid_day_key when it is stale). One request per task and action at a time (a double tap shares it).
// An "evidence still needed" answer means the task stayed open: the card shows the proof prompt and the next "done" completes it (the id was not used up).
import type { ApiClient } from "@/lib/api/client"
import { ApiError } from "@/lib/api/problem"

export type TodayOutcome =
  | { kind: "done" }
  | { kind: "snoozed" }
  | { kind: "needs_evidence" }
  | { kind: "duplicate" }
  | { kind: "archived" }
  /** 422 invalid_day_key: the card's day is not the server's working day any more; refetch Today. */
  | { kind: "stale_day" }

export function makeTodayClient(api: ApiClient) {
  const inflight = new Map<string, Promise<TodayOutcome>>()
  return {
    /** The raw Today DTO for a mode (the order and the written summary depend on it). */
    load(mode: "all" | "high-and-overdue") {
      return api.get("/v1/today", { query: { mode } })
    },
    update(taskId: string, action: "done" | "snooze", dayKey: string): Promise<TodayOutcome> {
      const key = `${taskId}:${action}`
      const existing = inflight.get(key)
      if (existing) return existing
      const p = (async (): Promise<TodayOutcome> => {
        try {
          const r = await api.post("/v1/today/updates", { body: { taskId, action, dayKey } })
          if (r.result === "duplicate") return { kind: "duplicate" }
          if (r.result === "skipped_archived") return { kind: "archived" }
          if (action === "snooze") return { kind: "snoozed" }
          return r.evidenceStillNeeded ? { kind: "needs_evidence" } : { kind: "done" }
        } catch (e) {
          if (e instanceof ApiError && e.status === 422 && e.code === "invalid_day_key") return { kind: "stale_day" }
          throw e
        } finally {
          inflight.delete(key)
        }
      })()
      inflight.set(key, p)
      return p
    },
  }
}

export type TodayClient = ReturnType<typeof makeTodayClient>
