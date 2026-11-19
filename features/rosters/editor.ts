// The editing controller of the week view (B8 Task 20): framework-free, so the rules of an edit are tested without a DOM. One `runEdit` per user action:
//   1. the edit shows AT ONCE (optimistic copy of the payload, `onOptimistic`);
//   2. the API gets the shift's `version` (a stale one is 409);
//   3. an answer is kept (the API's copy and its warnings) and the week is read again (the API is the truth, I10);
//   4. a refusal is mapped to ONE thing the screen does (./errors.ts): the local edit is dropped in every case; a conflict shows the SERVER's copy and the toast "Changed by someone else.";
//      a locked week (403 roster_locked) turns read-only with NO toast; a missing reason or a blocked rule asks the user (`ask`); anything else is a toast.
import type { RuleViolation } from "@/lib/roster-rules"
import { addBody, patchBody, removeShiftLocal, replaceShift, setShiftLocal, shiftsAddedLocal, withoutLocal, type AddForm, type ShiftEdit } from "./editing"
import { mapRosterError, type RosterError, type RosterToast, type RosterWriteResult } from "./errors"
import type { RosterPayload, ShiftType, WeekShift } from "./types"

export type EditorState = { payload: RosterPayload; /** What the API last said about the shifts (warnings of a write, the blocks of a refusal); shown with the person and shifts named. */ violations: RuleViolation[] }
type Gate = { reason?: string; overrideRuleIds?: string[] }

export type Edit =
  | { kind: "patch"; shiftId: string; edit: ShiftEdit; gate?: Gate }
  /** `localKey` names the temporary cards of this add, so they keep the same ids on every render while it waits. */
  | { kind: "add"; weekId: string; type: ShiftType; form: AddForm; gate?: Gate; localKey?: string }
  | { kind: "remove"; shiftId: string; reason?: string }

type PatchBody = NonNullable<ReturnType<typeof patchBody>>
type AddBody = ReturnType<typeof addBody>
export type EditorApi = {
  patchShift(id: string, body: PatchBody): Promise<RosterWriteResult<{ shift: WeekShift; violations: RuleViolation[] }>>
  addShifts(weekId: string, body: AddBody): Promise<RosterWriteResult<{ shifts: WeekShift[]; violations: RuleViolation[] }>>
  deleteShift(id: string, o: { version: number; reason?: string }): Promise<RosterWriteResult<null>>
  /** The week as the API has it now, for the range on screen. */
  reload(): Promise<RosterWriteResult<RosterPayload>>
}

export type Ask = { kind: "reason" } | { kind: "override"; violations: RuleViolation[]; needsOffice: boolean }
/** `sent`: a request really went out and was accepted. A missing shift (gone or never there) is NOT ok; an edit that changes nothing is ok but not `sent`, so no success toast follows either. */
export type EditResult = { ok: boolean; sent: boolean; state: EditorState; toast: RosterToast | null; ask: Ask | null }

/** The week read-only (published and not yours to change): what a 403 roster_locked means, whatever the reload says. */
export function lockWeek(p: RosterPayload, weekId: string): RosterPayload {
  return { ...p, weeks: p.weeks.map((w) => (w.id === weekId ? { ...w, access: { ...w.access, canEdit: false, locked: true, lockReason: "roster_locked" } } : w)) }
}

function weekOf(p: RosterPayload, e: Edit): string | undefined {
  return e.kind === "add" ? e.weekId : p.shifts.find((s) => s.id === e.shiftId)?.weekId
}

export function optimistic(p: RosterPayload, e: Edit): RosterPayload {
  if (e.kind === "add") return shiftsAddedLocal(p, e.weekId, e.type, e.form, e.localKey)
  if (e.kind === "remove") return removeShiftLocal(p, e.shiftId)
  return setShiftLocal(p, e.shiftId, e.edit)
}

export async function runEdit(before: EditorState, e: Edit, api: EditorApi, onOptimistic?: (s: EditorState) => void): Promise<EditResult> {
  const base = withoutLocal(before.payload)
  const week = weekOf(base, e)
  const done = (state: EditorState, ok: boolean, toast: RosterToast | null = null, ask: Ask | null = null, sent = false): EditResult => ({ ok, sent, state, toast, ask })
  // The request. A shift that is gone from the payload, or an edit that changes nothing, sends nothing.
  let send: (() => Promise<RosterWriteResult<{ violations: RuleViolation[]; apply: (p: RosterPayload) => RosterPayload; touched: string[] }>>) | null = null
  if (e.kind === "patch") {
    const s = base.shifts.find((x) => x.id === e.shiftId)
    if (!s) return done({ payload: base, violations: before.violations }, false) // the shift is gone (or only the card of an add that has not been answered): nothing to move, and nothing to celebrate
    const body = patchBody(s, e.edit, e.gate)
    if (!body) return done({ payload: base, violations: before.violations }, true)
    send = async () => {
      const r = await api.patchShift(s.id, body)
      return r.ok ? { ok: true, value: { violations: r.value.violations, apply: (p) => replaceShift(p, r.value.shift), touched: [s.id] } } : r
    }
  } else if (e.kind === "add") {
    const body = addBody(e.type, e.form, e.gate)
    send = async () => {
      const r = await api.addShifts(e.weekId, body)
      return r.ok ? { ok: true, value: { violations: r.value.violations, apply: (p) => r.value.shifts.reduce(replaceShift, withoutLocal(p)), touched: r.value.shifts.map((x) => x.id) } } : r
    }
  } else {
    const s = base.shifts.find((x) => x.id === e.shiftId)
    if (!s) return done({ payload: base, violations: before.violations }, false)
    send = async () => {
      const r = await api.deleteShift(s.id, { version: s.version, ...(e.reason ? { reason: e.reason } : {}) })
      return r.ok ? { ok: true, value: { violations: [], apply: (p) => removeShiftLocal(p, s.id), touched: [s.id] } } : r
    }
  }

  const local: EditorState = { payload: optimistic(base, e), violations: before.violations }
  onOptimistic?.(local)

  let result: RosterWriteResult<{ violations: RuleViolation[]; apply: (p: RosterPayload) => RosterPayload; touched: string[] }>
  try {
    result = await send()
  } catch (err) {
    result = { ok: false, error: mapRosterError(err) } // the call itself failed (no network, a thrown action): the same mapping
  }

  if (result.ok) {
    const { violations, apply, touched } = result.value
    const applied = apply(local.payload)
    // The edit went through (over a rule, perhaps): the blocking lines that stopped it, and any line about the shifts it touched, are stale now.
    const people = new Set(applied.shifts.filter((x) => touched.includes(x.id)).map((x) => x.personId).filter((x): x is string => !!x))
    const stale = (v: RuleViolation) => touched.includes(v.shiftId) || (v.severity === "block" && people.has(v.personId))
    const confirmed: EditorState = { payload: applied, violations: [...before.violations.filter((v) => !stale(v)), ...violations] }
    const again = await settle(api)
    return done(again ? { ...confirmed, payload: again } : confirmed, true, null, null, true)
  }

  const error: RosterError = result.error
  const reverted: EditorState = { payload: base, violations: before.violations }
  switch (error.state) {
    case "conflict": {
      const server = await settle(api) // the server copy wins; the local edit is gone either way
      return done({ payload: server ?? base, violations: before.violations }, false, error.toast)
    }
    case "locked": {
      const server = await settle(api)
      const next = server ?? base
      return done({ payload: week ? lockWeek(next, week) : next, violations: before.violations }, false, null)
    }
    case "reason_required":
      return done(reverted, false, null, { kind: "reason" })
    case "rule_blocked":
      return done({ payload: base, violations: error.violations }, false, null, { kind: "override", violations: error.violations, needsOffice: error.needsOffice })
    default: {
      const server = error.refetch ? await settle(api) : null
      return done(server ? { payload: server, violations: before.violations } : reverted, false, error.toast)
    }
  }
}

/** Read the week again; null when that fails too (the caller keeps what it has). */
async function settle(api: EditorApi): Promise<RosterPayload | null> {
  try {
    const r = await api.reload()
    return r.ok ? r.value : null
  } catch {
    return null
  }
}

// ----------------------------------------------------------------------------------------------------------------- what is on screen while edits wait
/** The payload with the edits that are still waiting for the API applied in order (each on top of the one before): the second queued edit shows its place at once, not when the first one is answered. */
export function pendingView(p: RosterPayload, waiting: Edit[]): RosterPayload {
  return waiting.reduce((acc, e) => optimistic(acc, e), p)
}

/** One edit at a time, in order (the second sees the first's answer and its new `version`). `reset` is the shown range changing (a navigation): an answer for the old range is dropped, never laid over the new one (m2). */
export class EditQueue {
  private tail: Promise<unknown> = Promise.resolve()
  private epoch = 0
  reset(): void {
    this.epoch++
  }
  /** `work` runs after the earlier ones; `apply` gets its result only while the range it was queued for is still the one shown. */
  add<T>(work: (current: () => boolean) => Promise<T>, apply: (r: T) => void): Promise<void> {
    const e = this.epoch
    const current = () => e === this.epoch
    const next = this.tail.then(async () => {
      const r = await work(current)
      if (current()) apply(r)
    })
    this.tail = next.catch(() => undefined)
    return next
  }
}
