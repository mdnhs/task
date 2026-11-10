import { blocking, checkShifts, type RuleContext, type RuleViolation } from "@/lib/roster-rules"
import { canSeeLocation, type RosterAccess } from "@/lib/roster-access"
import type { HistoryEntry, RosterShift, RosterWeek, ShiftTemplate } from "@/lib/rosters"
import { isHm, weekStart } from "@/lib/shifts"
import type { WorkforceMember } from "@/lib/workforce"
import { BlockedError, ineligible } from "./exchange"
import type { ChangeRequest } from "./types"

// Publish, lock and change requests (FR-RS-23/24/31/35/36/37, D6, D7). Pure: the rules for who may do what, and the audit lines.
// There is no unpublish (D7): after publishing, a supervisor's only route is a change request.

let seq = 0
/** Makes history ids unique even within one second. */
const uid = () => (++seq).toString(36)
const clean = (s: string | null | undefined) => (s ?? "").trim()

/** The fields of `s` named by `patch`, so history shows only what changed. */
const pick = (s: RosterShift, patch: Partial<RosterShift>): Partial<RosterShift> =>
  Object.fromEntries(Object.keys(patch).map((k) => [k, s[k as keyof RosterShift]]))

/** The shift fields a change may carry. `weekId` only travels with an office edit that moves a shift into another week (never in a request). */
const PATCH_KEYS = ["date", "start", "end", "unpaidBreakMin", "personId", "templateId", "role"] as const
const ISO = /^\d{4}-\d{2}-\d{2}$/

/** Only whitelisted keys with well-formed values get through; anything else (a location, a week, an id, the confirmation) throws. */
function cleanPatch(patch: Partial<RosterShift>, allowWeek = false, own?: RosterShift, weeks: RosterWeek[] = []): Partial<RosterShift> {
  const allowed = new Set<string>([...PATCH_KEYS, ...(allowWeek ? ["weekId"] : [])])
  const bad = Object.keys(patch).find((k) => !allowed.has(k))
  if (bad) throw new Error(`This change cannot include ${bad}`)
  const p = patch as Record<string, unknown>
  const fail = (k: string) => { throw new Error(`This change has an invalid ${k}`) }
  if ("date" in p && !(typeof p.date === "string" && ISO.test(p.date))) fail("date")
  for (const k of ["start", "end"]) if (k in p && !(typeof p[k] === "string" && isHm(p[k] as string))) fail(k)
  if ("unpaidBreakMin" in p && !(Number.isInteger(p.unpaidBreakMin) && (p.unpaidBreakMin as number) >= 0 && (p.unpaidBreakMin as number) <= 480)) fail("break")
  if ("personId" in p && p.personId !== null && typeof p.personId !== "string") fail("person")
  for (const k of ["templateId", "role", "weekId"]) if (k in p && typeof p[k] !== "string") fail(k)
  // A week id is only accepted when it is the shift's own, or an existing week of the same location (a move across weeks).
  if (patch.weekId !== undefined && own && patch.weekId !== own.weekId && !weeks.some((w) => w.id === patch.weekId && w.locationId === own.locationId)) fail("week")
  return patch
}

/** What a change to a published shift is checked against: the people, the templates and the rule context over the shifts in view. */
export type PatchCheck = { members: WorkforceMember[]; templates: ShiftTemplate[]; ctx: RuleContext; /** Existing weeks, so a move may name another week of the same location. */ weeks?: RosterWeek[] }

/**
 * Eligibility, then the blocking rules, for the shift as it would become. Eligibility is checked when the person, template or day changes (someone
 * already on the shift keeps it while only the times move) and always refuses. Only violations the change adds count: an old warning never blocks.
 * A blocking rule throws BlockedError unless `override` is a reason from a role that may edit published weeks.
 */
function checkChange(s: RosterShift, next: RosterShift, a: RosterAccess, override: string | null, check: PatchCheck): void {
  if (next.personId && (next.personId !== s.personId || next.templateId !== s.templateId || next.date !== s.date)) {
    const m = check.members.find((x) => x.id === next.personId)
    const t = check.templates.find((x) => x.id === next.templateId)
    if (!m || !t) throw new Error("Could not verify this person for the shift")
    const why = ineligible(m, t, next.date)
    if (why) throw new Error(why)
  }
  if (!next.personId) return
  const key = (v: RuleViolation) => `${v.rule}|${v.message}`
  const withShift = (x: RosterShift): RuleContext => ({ ...check.ctx, shifts: [...check.ctx.shifts.filter((y) => y.id !== s.id), x] })
  const before = new Set(s.personId ? checkShifts([s], withShift(s)).map(key) : [])
  const added = blocking(checkShifts([next], withShift(next)).filter((v) => v.shiftId === s.id && !before.has(key(v))))
  if (!added.length) return
  const why = [...new Set(added.map((v) => v.message))].join("; ")
  if (!a.editPublished) throw new BlockedError(`A blocking rule is broken: ${why}`)
  if (!clean(override)) throw new BlockedError(`A reason is needed to go over a blocking rule: ${why}`)
}

/**
 * Publishing a draft. A blocking violation needs a role that may edit published weeks (office) and a reason; warnings never block.
 * A supervisor with a blocking violation cannot publish at all.
 */
export function publishWeek(week: RosterWeek, a: RosterAccess, violations: RuleViolation[], overrideReason: string | null, by: string, at: string): { week: RosterWeek; entry: HistoryEntry } {
  if (!a.editDraft && !a.editPublished) throw new Error("This role cannot publish a roster")
  if (!canSeeLocation(a, week.locationId)) throw new Error("No access to this location")
  if (week.status === "published") throw new Error("This week is already published")
  const blocked = blocking(violations).length > 0
  const reason = clean(overrideReason)
  if (blocked && !a.editPublished) throw new Error("A blocking rule is broken: only an office role can publish over it")
  if (blocked && !reason) throw new Error("A reason is needed to publish over a blocking rule")
  return {
    week: { ...week, status: "published", publishedAt: at, publishedBy: by },
    entry: { id: `h-${at}-${week.id}-publish-${uid()}`, weekId: week.id, locationId: week.locationId, shiftId: null, at, by, action: "publish", before: { status: week.status }, after: { status: "published" }, reason: blocked ? reason : null },
  }
}

/** FR-RS-35: an office edit to a published shift, with a reason. The person must confirm again (confirmedAt cleared). */
export function editPublished(s: RosterShift, patch: Partial<RosterShift>, a: RosterAccess, reason: string, by: string, at: string, check?: PatchCheck): { shift: RosterShift; entry: HistoryEntry } {
  if (!a.editPublished) throw new Error("Only an office role can edit a published roster")
  if (!canSeeLocation(a, s.locationId)) throw new Error("No access to this location")
  const why = clean(reason)
  if (!why) throw new Error("A reason is needed to edit a published roster")
  cleanPatch(patch, true, s, check?.weeks)
  // The reason of an office edit is also what lets it go over a blocking rule.
  if (check) checkChange(s, { ...s, ...patch }, a, why, check)
  return {
    shift: { ...s, ...patch, confirmedAt: null },
    entry: { id: `h-${at}-${s.id}-edit-${uid()}`, weekId: s.weekId, locationId: s.locationId, shiftId: s.id, at, by, action: "edit-published", before: pick(s, patch), after: patch, reason: why },
  }
}

/** FR-RS-36: a supervisor asks for a change to a published shift. `ids` supplies the new id. */
export function requestChange(s: RosterShift, patch: Partial<RosterShift>, why: string, by: string, at: string, ids: string[]): ChangeRequest {
  if (!Object.keys(patch).length) throw new Error("Nothing to change")
  cleanPatch(patch)
  if (!clean(why)) throw new Error("Say why the change is needed")
  return { id: ids[0], weekId: s.weekId, shiftId: s.id, by, at, patch, why: clean(why), status: "open", decidedBy: null, decidedAt: null, note: null }
}

/** FR-RS-37: an office role approves or rejects. Approving applies the patch and clears confirmedAt; rejecting leaves the shift as it is. */
export function decideRequest(r: ChangeRequest, s: RosterShift, a: RosterAccess, approve: boolean, note: string | null, by: string, at: string, override?: string | null, check?: PatchCheck): { request: ChangeRequest; shift: RosterShift; entry: HistoryEntry | null } {
  if (!a.approve) throw new Error("Only an office role can decide a change request")
  if (!canSeeLocation(a, s.locationId)) throw new Error("No access to this location")
  if (r.shiftId !== s.id || r.weekId !== s.weekId) throw new Error("This request is for a different shift")
  if (r.status !== "open") throw new Error("This request is already decided")
  const request: ChangeRequest = { ...r, status: approve ? "approved" : "rejected", decidedBy: by, decidedAt: at, note: clean(note) || null }
  if (!approve) return { request, shift: s, entry: null }
  const patch = cleanPatch(r.patch)
  if (patch.date && weekStart(patch.date) !== weekStart(s.date)) throw new Error("A change request cannot move a shift to another week")
  const next: RosterShift = { ...s, ...patch, confirmedAt: null }
  if (check) checkChange(s, next, a, override ?? null, check)
  const over = clean(override)
  return {
    request,
    shift: next,
    entry: { id: `h-${at}-${s.id}-request-${uid()}`, weekId: s.weekId, locationId: s.locationId, shiftId: s.id, at, by, action: "change-approved", before: pick(s, patch), after: patch, reason: over ? `${r.why} (approved over a rule: ${over})` : r.why },
  }
}
