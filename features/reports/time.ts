// Report timing from INSTANTS (B6 T6.7, ruling I12). `nowAt` is the clock as a UTC instant (Org.nowAt); `dueAt`, `endAt` and `submittedAtIso` are the stored instants. Nothing here reads a wall
// string or the browser's zone, so the repeated hour of a DST fall-back and the gap of a spring-forward cannot move a deadline by an hour.
import type { ReportState } from "@opsdesk/domain/shift-report"
import type { InboxRow, ShiftReport } from "./types"

const ms = (iso: string): number => {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) throw new Error(`reports: not an instant: ${iso}`)
  return t
}

type Timed = Pick<ShiftReport | InboxRow, "status" | "dueAt" | "submittedAtIso">

/** The state shown at `nowAt`: accepted and returned as stored; submitted is "late" when the FIRST submission came after the due instant; a draft is "missing" once the due instant has passed. */
export function reportStateAt(r: Timed, nowAt: string): ReportState {
  if (r.status === "accepted" || r.status === "returned") return r.status
  if (r.status === "submitted") return r.submittedAtIso && ms(r.submittedAtIso) > ms(r.dueAt) ? "late" : "submitted"
  return ms(nowAt) > ms(r.dueAt) ? "missing" : "draft"
}

/** First submission came after the due instant. */
export const isLateAt = (r: Pick<ShiftReport | InboxRow, "dueAt" | "submittedAtIso">): boolean => !!r.submittedAtIso && ms(r.submittedAtIso) > ms(r.dueAt)

/** The API's real minutes late (`minutesLate`, from instants) in a few characters: "35 min late", "1 h 35 min late", "2 d 3 h late"; 0 (on time, or not due yet) is "". */
export function lateText(minutes: number): string {
  if (!(minutes > 0)) return ""
  const m = Math.round(minutes)
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  const min = m % 60
  const parts = d > 0 ? [`${d} d`, ...(h ? [`${h} h`] : [])] : h > 0 ? [`${h} h`, ...(min ? [`${min} min`] : [])] : [`${min} min`]
  return `${parts.join(" ")} late`
}

/** "in_shift" until the shift's end instant, "open" after it. */
export const draftPhaseAt = (r: Pick<ShiftReport | InboxRow, "endAt">, nowAt: string): "in_shift" | "open" => (ms(nowAt) < ms(r.endAt) ? "in_shift" : "open")

/** Whole seconds from `nowAt` to `dueAt`, never below 0. */
export const secondsUntilAt = (dueAt: string | null, nowAt: string): number => (dueAt === null ? 0 : Math.max(0, Math.round((ms(dueAt) - ms(nowAt)) / 1000)))

/** A shift that has started by `nowAt`. */
export const startedAt = (r: Pick<ShiftReport | InboxRow, "startAt">, nowAt: string): boolean => ms(r.startAt) <= ms(nowAt)

type Row = Pick<InboxRow, "status" | "dueAt" | "submittedAtIso" | "endAt" | "startAt">

/** The rows that need the member now: returned, missing, or ended and not yet submitted. Most urgent first (returned, missing, draft), newest shift first. */
export function needsActionAt<T extends Row>(rows: T[], nowAt: string): T[] {
  const rank: Partial<Record<ReportState, number>> = { returned: 0, missing: 1, draft: 2 }
  return rows
    .map((r) => ({ r, s: reportStateAt(r, nowAt) }))
    .filter(({ r, s }) => s === "returned" || s === "missing" || (s === "draft" && draftPhaseAt(r, nowAt) === "open"))
    .sort((a, b) => rank[a.s]! - rank[b.s]! || ms(b.r.startAt) - ms(a.r.startAt))
    .map(({ r }) => r)
}

/** The member's "current or last" report: the running shift's, else the latest one that has started. */
export function currentRowAt<T extends Row>(rows: T[], nowAt: string): T | undefined {
  const mine = rows.filter((r) => startedAt(r, nowAt)).sort((a, b) => ms(b.startAt) - ms(a.startAt))
  return mine.find((r) => draftPhaseAt(r, nowAt) === "in_shift") ?? mine[0]
}
