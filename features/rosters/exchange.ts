import type { RosterShift, RosterWeek, ShiftTemplate } from "@/lib/rosters"
import type { WorkforceMember } from "@/lib/workforce"
import { eligible } from "./editing"
import { isUpcoming } from "./self-service"
import type { ApiExchange, Claim, ExchangeStatus, SwapRequest, WeekAccess } from "./types"

export type { Claim, SwapRequest }

// Open shifts and swaps. Two halves. (1) Task 21: what the roster page OFFERS on the API's exchanges (the approver matrix R8-11 below); the API decides every one of them again and answers
// 403/404/409/422, so a button shown by mistake is a toast, never a change. (2) The mock claim and swap REQUEST rules My roster still runs on until Task 22 moves it to the API (FR-RS-38, 42, 43).

/**
 * R8-11 as buttons. Who DECIDES a claim or swap: an office role always; a supervisor on a draft week, and on a published week only when the location delegates swap approval; staff never.
 * Who RECOMMENDS: a supervisor on a published week who cannot decide (office is asked; the exchange moves requested to recommended once). Who CLAIMS an open shift: anyone, on a published week,
 * before it starts: the API checks that the person is located at the site and eligible. A decided or cancelled exchange offers nothing; an expired one (the shift has started) can still be rejected,
 * not approved. Nobody approves their own: the API's 403 self_decision, not hidden here (the page does not know who is party to what).
 */
export function exchangeActions(p: { level: WeekAccess["level"]; weekStatus: "draft" | "published"; delegated: boolean; status: ExchangeStatus; expired: boolean }) {
  const open = p.status === "requested" || p.status === "recommended"
  const decide = open && (p.level === "office" || (p.level === "supervisor" && (p.weekStatus === "draft" || p.delegated)))
  return {
    approve: decide && !p.expired,
    reject: decide,
    recommend: open && p.status === "requested" && p.level === "supervisor" && p.weekStatus === "published" && !decide,
  }
}

/** An open shift can be claimed: published week, still open, and not started (the shift's own wall time is compared by the API; this only hides what is certainly past, by date). */
export const canClaim = (weekStatus: "draft" | "published", personId: string | null, date: string, today: string): boolean => weekStatus === "published" && personId === null && date >= today.slice(0, 10)

/** Open exchanges of one shift, claims and swaps apart. */
export const openExchanges = (list: ApiExchange[], shiftId: string, kind: ApiExchange["kind"]): ApiExchange[] => list.filter((x) => x.shiftId === shiftId && x.kind === kind && (x.status === "requested" || x.status === "recommended"))

let seq = 0
const uid = () => (++seq).toString(36)


/** Why a person can't work this template on this date, or null when they can (left, or a required licence missing or expired). */
export function ineligible(m: WorkforceMember, t: ShiftTemplate, date: string): string | null {
  if (eligible([m], t, date).length > 0) return null
  if (m.leftOn !== null && date >= m.leftOn) return `${m.name} left on ${m.leftOn}`
  const missing = t.requires.find((r) => !m.qualifications.some((q) => q.type === r && (q.expires === null || q.expires >= date)))
  return `${m.name} does not hold a valid ${missing ?? "required"} licence for ${date}`
}

/** Only a published week, and only a shift still to come (`at` is the tenant wall clock, `tz` the tenant zone), can be claimed or swapped. */
export type Timing = { week?: RosterWeek; tz?: string }
function timely(s: RosterShift, at: string, opts: Timing | undefined): void {
  if (opts?.week && (opts.week.id !== s.weekId || opts.week.status !== "published")) throw new Error("Only published rosters can be changed this way")
  if (opts?.tz && !isUpcoming(s, at, opts.tz)) throw new Error("This shift has already passed")
}

/** FR-RS-38: a member offers to take an open shift. Refused for a shift someone holds, a shift in the past, an unpublished week, or when they are not eligible. `at` is the claim time. */
export function claimShift(s: RosterShift, m: WorkforceMember, t: ShiftTemplate, at: string, opts?: Timing): Claim {
  if (s.personId !== null) throw new Error("This shift is not open")
  if (t.id !== s.templateId) throw new Error("Wrong shift template")
  timely(s, at, opts)
  const why = ineligible(m, t, s.date)
  if (why) throw new Error(why)
  return { id: `cl-${s.id}-${m.id}-${uid()}`, shiftId: s.id, personId: m.id, at, status: "open", decidedBy: null, decidedAt: null }
}

/**
 * FR-RS-42: ask to hand a shift to someone (`toShift` null) or trade it for theirs. Only the shift's holder asks, the target must be able to work
 * it.
 */
export function requestSwap(s: RosterShift, requester: string, target: WorkforceMember, t: ShiftTemplate, toShift: RosterShift | null, at: string, id: string, opts?: Timing): SwapRequest {
  if (s.personId !== requester) throw new Error("You can only swap your own shift")
  if (target.id === requester) throw new Error("Pick someone else")
  if (t.id !== s.templateId) throw new Error("Wrong shift template")
  timely(s, at, opts)
  const why = ineligible(target, t, s.date)
  if (why) throw new Error(why)
  if (toShift && toShift.personId !== target.id) throw new Error("That shift is not theirs")
  return { id, shiftId: s.id, toShiftId: toShift?.id ?? null, fromPersonId: requester, toPersonId: target.id, at, status: "open", decidedBy: null, decidedAt: null }
}
