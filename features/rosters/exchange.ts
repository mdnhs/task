import { canSeeLocation, type RosterAccess } from "@/lib/roster-access"
import { blocking, checkShifts, type RuleContext, type RuleViolation } from "@/lib/roster-rules"
import type { HistoryEntry, Location, RosterShift, RosterWeek, ShiftTemplate } from "@/lib/rosters"
import type { WorkforceMember } from "@/lib/workforce"
import { eligible } from "./editing"
import { isUpcoming } from "./self-service"
import type { Claim, SwapRequest } from "./types"

export type { Claim, SwapRequest }

// Open shifts and swaps (FR-RS-38, 42, 43, D6). Pure: who decides, who may claim, and the rule check before anything is assigned.

let seq = 0
const uid = () => (++seq).toString(36)
const clean = (s: string | null | undefined) => (s ?? "").trim()

/**
 * D6: who decides a claim or swap. Office roles always (within their locations). A supervisor of the location decides on a draft week, and on a
 * published week only when the location delegates swap approval; otherwise a higher-level user does. Staff and read-only roles never.
 * A supervisor's access has `editDraft` (rosterAccess sets `approve` for office roles only), so either flag counts.
 */
export function approverFor(week: RosterWeek, location: Location, a: RosterAccess): boolean {
  if (week.locationId !== location.id || !canSeeLocation(a, location.id)) return false
  if (a.editPublished) return true
  if (!(a.approve || a.editDraft)) return false
  return week.status === "draft" || location.swapApprovalDelegated
}

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

/** A blocking rule stands in the way: an office role may approve anyway with a reason. */
export class BlockedError extends Error {}

const MSG = (v: RuleViolation[]) => [...new Set(v.map((x) => x.message))].join("; ")

/** A rule check of the new assignments. Blocking violations refuse, unless the caller is office and gives a reason. Warnings come back. */
function gate(found: RuleViolation[], a: RosterAccess, overrideReason: string | null | undefined): { violations: RuleViolation[]; reason: string | null } {
  const stop = blocking(found)
  const reason = clean(overrideReason)
  if (stop.length === 0) return { violations: found, reason: null }
  if (!a.editPublished) throw new BlockedError(`A blocking rule is broken: ${MSG(stop)}`)
  if (!reason) throw new BlockedError(`A reason is needed to approve over a blocking rule: ${MSG(stop)}`)
  return { violations: found, reason }
}

function guard(week: RosterWeek, location: Location, a: RosterAccess, s: RosterShift): void {
  if (!approverFor(week, location, a)) throw new Error("This role cannot approve here")
  if (s.weekId !== week.id || s.locationId !== location.id) throw new Error("Shift is not in this week")
}

/** The same finding from the browser's check and the server's counts once. */
const merge = (local: RuleViolation[], remote: RuleViolation[]): RuleViolation[] => {
  const seen = new Set(local.map((v) => `${v.rule}|${v.shiftId}|${v.message}`))
  return [...local, ...remote.filter((v) => !seen.has(`${v.rule}|${v.shiftId}|${v.message}`))]
}

const withShifts = (ctx: RuleContext, changed: RosterShift[]): RuleContext => ({ ...ctx, shifts: [...ctx.shifts.filter((x) => !changed.some((c) => c.id === x.id)), ...changed] })
const entryOf = (action: string, week: RosterWeek, s: RosterShift, by: string, at: string, before: unknown, after: unknown, reason: string | null): HistoryEntry =>
  ({ id: `h-${at}-${s.id}-${action}-${uid()}`, weekId: week.id, locationId: s.locationId, shiftId: s.id, at, by, action, before, after, reason })

/**
 * FR-RS-38: approve a claim. The claimant goes on the shift (confirmation cleared) after the rule check over the shift with them on it and
 * their other shifts. `found` carries violations from beyond this browser's shifts (a clash at a site the caller can't see).
 */
export function approveClaim(
  c: Claim, s: RosterShift, a: RosterAccess, week: RosterWeek, location: Location, ctx: RuleContext, by: string, at: string,
  overrideReason?: string | null, found: RuleViolation[] = [],
): { shift: RosterShift; claim: Claim; violations: RuleViolation[]; entry: HistoryEntry } {
  guard(week, location, a, s)
  if (c.status !== "open") throw new Error("Claim already decided")
  if (c.shiftId !== s.id) throw new Error("Claim is for another shift")
  if (s.personId !== null) throw new Error("This shift is no longer open")
  const m = ctx.members.find((x) => x.id === c.personId)
  const t = ctx.templates.find((x) => x.id === s.templateId)
  if (!m || !t) throw new Error("Cannot verify this person for the shift")
  const why = ineligible(m, t, s.date)
  if (why) throw new Error(why)
  const shift: RosterShift = { ...s, personId: c.personId, confirmedAt: null }
  const violations = merge(checkShifts([shift], withShifts(ctx, [shift])), found.filter((v) => v.shiftId === s.id))
  const { reason } = gate(violations, a, overrideReason)
  return {
    shift,
    claim: { ...c, status: "approved", decidedBy: by, decidedAt: at },
    violations,
    entry: entryOf("claim.approved", week, s, by, at, { personId: null }, { personId: c.personId }, reason),
  }
}

/** Reject a claim that is still waiting; the same people who may approve may reject. */
export function rejectClaim(c: Claim, s: RosterShift, a: RosterAccess, week: RosterWeek, location: Location, by: string, at: string): Claim {
  guard(week, location, a, s)
  if (c.status !== "open") throw new Error("Claim already decided")
  return { ...c, status: "rejected", decidedBy: by, decidedAt: at }
}

/**
 * FR-RS-42: ask to hand a shift to someone (`toShift` null) or trade it for theirs. Only the shift's holder asks, the target must be able to work
 * it. The trade's other side is checked at approval, where the full rules run.
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

/** FR-RS-43: approve a swap. Both resulting assignments are checked; a blocking rule broken for either person refuses it (office can override with a reason). */
export function approveSwap(
  r: SwapRequest, s: RosterShift, toShift: RosterShift | null, a: RosterAccess, week: RosterWeek, location: Location, ctx: RuleContext, by: string, at: string,
  overrideReason?: string | null, found: RuleViolation[] = [],
): { shift: RosterShift; other: RosterShift | null; request: SwapRequest; violations: RuleViolation[]; entry: HistoryEntry } {
  guard(week, location, a, s)
  if (r.status !== "open") throw new Error("Swap already decided")
  if (r.shiftId !== s.id || s.personId !== r.fromPersonId) throw new Error("The shift has changed since the request")
  if ((r.toShiftId ?? null) !== (toShift?.id ?? null)) throw new Error("The other shift is missing")
  if (toShift && (toShift.personId !== r.toPersonId || toShift.locationId !== s.locationId)) throw new Error("The other shift has changed since the request")
  const templates = new Map(ctx.templates.map((x) => [x.id, x]))
  const check = (m: WorkforceMember | undefined, x: RosterShift) => {
    const t = templates.get(x.templateId)
    if (!m || !t) throw new Error("Cannot verify this person for the shift")
    const why = ineligible(m, t, x.date)
    if (why) throw new Error(why)
  }
  check(ctx.members.find((x) => x.id === r.toPersonId), s)
  if (toShift) check(ctx.members.find((x) => x.id === r.fromPersonId), toShift)
  const shift: RosterShift = { ...s, personId: r.toPersonId, confirmedAt: null }
  const other: RosterShift | null = toShift ? { ...toShift, personId: r.fromPersonId, confirmedAt: null } : null
  const changed = other ? [shift, other] : [shift]
  const ids = new Set(changed.map((x) => x.id))
  const violations = merge(checkShifts(changed, withShifts(ctx, changed)), found.filter((v) => ids.has(v.shiftId)))
  const { reason } = gate(violations, a, overrideReason)
  return {
    shift,
    other,
    request: { ...r, status: "approved", decidedBy: by, decidedAt: at },
    violations,
    entry: entryOf("swap.approved", week, s, by, at, { personId: r.fromPersonId, toShiftId: r.toShiftId }, { personId: r.toPersonId, toShiftPerson: other ? r.fromPersonId : null }, reason),
  }
}

export function rejectSwap(r: SwapRequest, s: RosterShift, a: RosterAccess, week: RosterWeek, location: Location, by: string, at: string): SwapRequest {
  guard(week, location, a, s)
  if (r.status !== "open") throw new Error("Swap already decided")
  return { ...r, status: "rejected", decidedBy: by, decidedAt: at }
}
