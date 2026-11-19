import { describe, expect, it } from "vitest"
import { ApiError } from "@/lib/api/problem"
import type { RuleViolation } from "@/lib/roster-rules"
import { mapRosterError, type RosterWriteResult } from "./errors"
import { EditQueue, pendingView, runEdit, type Edit, type EditorApi, type EditorState } from "./editor"
import { DAY_T, PERSON, SHIFTS, WEEK_ID, payloadFixture } from "./fixtures"
import { overrideFields } from "./editing"
import type { RosterPayload, WeekShift } from "./types"

const fail = <T,>(status: number, code: string, extra: Record<string, unknown> = {}): RosterWriteResult<T> => ({ ok: false, error: mapRosterError(new ApiError(status, code, "req-9", extra)) })
const good = <T,>(value: T): RosterWriteResult<T> => ({ ok: true, value })
const dateOf = (p: RosterPayload, id: string) => p.shifts.find((s) => s.id === id)!.date
const fresh = (): EditorState => ({ payload: payloadFixture(), violations: [] })
const ann = () => payloadFixture().shifts.find((s) => s.id === "sh-mon-ann")!
const blocked: RuleViolation = { rule: "double_booking", shiftId: "sh-mon-ann", personId: PERSON.ann, severity: "block", message: "Ann Byrne is on two shifts", otherShiftIds: ["sh-mon-ben"] }
const warn: RuleViolation = { rule: "daily_rest", shiftId: "sh-mon-ann", personId: PERSON.ann, severity: "warn", message: "Ann Byrne has 9h rest", otherShiftIds: [] }

const calls: { fn: string; args: unknown[] }[] = []
function fakeApi(o: Partial<EditorApi> = {}) {
  calls.length = 0
  const api: EditorApi = {
    patchShift: async (id, body) => { calls.push({ fn: "patch", args: [id, body] }); return good({ shift: { ...ann(), id, date: String((body.patch as { date?: string }).date ?? "2026-11-02"), version: 2 } as WeekShift, violations: [] }) },
    addShifts: async (weekId, body) => { calls.push({ fn: "add", args: [weekId, body] }); return good({ shifts: [{ ...ann(), id: "sh-new", version: 1 }], violations: [] }) },
    deleteShift: async (id, o2) => { calls.push({ fn: "delete", args: [id, o2] }); return good(null) },
    reload: async () => { calls.push({ fn: "reload", args: [] }); return good(payloadFixture()) },
    ...o,
  }
  return { api, calls }
}
const move = (date: string) => ({ kind: "patch" as const, shiftId: "sh-mon-ann", edit: { date } })

describe("a draft edit is optimistic, carries the shift's version, and the API's answer settles it", () => {
  it("shows the move at once, sends the version, and keeps the API's copy and its warnings", async () => {
    const { api, calls } = fakeApi({ patchShift: async (id, body) => { calls.push({ fn: "patch", args: [id, body] }); return good({ shift: { ...ann(), date: "2026-11-05", version: 2 } as WeekShift, violations: [warn] }) } })
    const seen: string[] = []
    const r = await runEdit(fresh(), move("2026-11-05"), api, (s) => seen.push(dateOf(s.payload, "sh-mon-ann")))
    expect(seen).toEqual(["2026-11-05"]) // before the API answered
    expect(calls[0]).toEqual({ fn: "patch", args: ["sh-mon-ann", { version: 1, patch: { date: "2026-11-05" } }] })
    expect(r.ok).toBe(true)
    expect(r.toast).toBeNull()
    expect(r.state.violations).toEqual([warn])
    expect(calls.some((c) => c.fn === "reload")).toBe(true) // the week is read again after a write: the API is the truth
  })

  it("an edit that changes nothing sends nothing", async () => {
    const { api, calls } = fakeApi()
    const r = await runEdit(fresh(), { kind: "patch", shiftId: "sh-mon-ann", edit: { date: "2026-11-02" } }, api)
    expect(calls).toEqual([])
    expect(r.ok).toBe(true)
  })

  it("add replaces the temporary shifts with the API's; remove sends the version and the reason", async () => {
    const { api, calls } = fakeApi({ reload: async () => fail(500, "boom") })
    const p = payloadFixture()
    const type = p.shiftTypes.find((t) => t.id === DAY_T)!
    const seen: number[] = []
    const added = await runEdit({ payload: p, violations: [] }, { kind: "add", weekId: WEEK_ID, type, form: { date: "2026-11-06", people: [PERSON.ann], start: "08:00", end: "16:00", unpaidBreakMin: 30 } }, api, (s) => seen.push(s.payload.shifts.filter((x) => x.id.startsWith("local-")).length))
    expect(seen).toEqual([1])
    expect(added.state.payload.shifts.filter((x) => x.id.startsWith("local-"))).toHaveLength(0)
    expect(added.state.payload.shifts.some((x) => x.id === "sh-new")).toBe(true)
    const removed = await runEdit(fresh(), { kind: "remove", shiftId: "sh-mon-ann", reason: "Cover" }, api)
    expect(calls.find((c) => c.fn === "delete")!.args).toEqual(["sh-mon-ann", { version: 1, reason: "Cover" }])
    expect(removed.state.payload.shifts.some((s) => s.id === "sh-mon-ann")).toBe(false)
  })
})

describe("a conflict (409): the server copy is shown, the local edit is dropped, and the toast says so", () => {
  it("shows 'Changed by someone else.', refetches and does not keep the local move", async () => {
    // someone else moved Ann's shift to Friday first
    const theirs = payloadFixture({ shifts: SHIFTS.map((s) => (s.id === "sh-mon-ann" ? { ...s, date: "2026-11-06", version: 2 } : s)) })
    const { api, calls } = fakeApi({ patchShift: async () => fail(409, "version_conflict"), reload: async () => { calls.push({ fn: "reload", args: [] }); return good(theirs) } })
    const seen: string[] = []
    const r = await runEdit(fresh(), move("2026-11-05"), api, (s) => seen.push(dateOf(s.payload, "sh-mon-ann")))
    expect(seen).toEqual(["2026-11-05"]) // it was optimistic ...
    expect(dateOf(r.state.payload, "sh-mon-ann")).toBe("2026-11-06") // ... and the server copy wins
    expect(r.state.payload.shifts.find((s) => s.id === "sh-mon-ann")!.version).toBe(2)
    expect(r.toast).toEqual({ text: "Changed by someone else.", ref: "req-9" })
    expect(r.ok).toBe(false)
    expect(r.ask).toBeNull()
    expect(calls.filter((c) => c.fn === "reload")).toHaveLength(1)
  })

  it("if the reload fails too the local edit is still dropped (back to what was shown)", async () => {
    const { api } = fakeApi({ patchShift: async () => fail(409, "version_conflict"), reload: async () => fail(500, "boom") })
    const r = await runEdit(fresh(), move("2026-11-05"), api)
    expect(dateOf(r.state.payload, "sh-mon-ann")).toBe("2026-11-02")
    expect(r.toast?.text).toBe("Changed by someone else.")
  })
})

describe("403 roster_locked flips the view read-only without an error toast", () => {
  it("no toast; the edit is dropped; the week reads as locked even if the reload fails", async () => {
    const { api } = fakeApi({ patchShift: async () => fail(403, "roster_locked"), reload: async () => fail(500, "boom") })
    const r = await runEdit(fresh(), move("2026-11-05"), api)
    expect(r.toast).toBeNull()
    expect(r.ask).toBeNull()
    expect(dateOf(r.state.payload, "sh-mon-ann")).toBe("2026-11-02")
    expect(r.state.payload.weeks[0]!.access).toMatchObject({ canEdit: false, locked: true, lockReason: "roster_locked" })
  })

  it("with a reload, the server's week (published, locked) is what shows", async () => {
    const published = payloadFixture({ status: "published", access: { level: "supervisor", canEdit: false, locked: true, lockReason: "roster_locked" } })
    const { api } = fakeApi({ patchShift: async () => fail(403, "roster_locked"), reload: async () => good(published) })
    const r = await runEdit(fresh(), move("2026-11-05"), api)
    expect(r.toast).toBeNull()
    expect(r.state.payload.weeks[0]).toMatchObject({ status: "published", access: { locked: true } })
  })
})

describe("the other refusals", () => {
  it("reason_required asks for a reason (no toast), and the retry carries the reason", async () => {
    let n = 0
    const { api, calls } = fakeApi({ patchShift: async (id, body) => { calls.push({ fn: "patch", args: [id, body] }); n++; return n === 1 ? fail(422, "reason_required") : good({ shift: { ...ann(), date: "2026-11-05", version: 2 } as WeekShift, violations: [] }) } })
    const first = await runEdit(fresh(), move("2026-11-05"), api)
    expect(first.ask).toEqual({ kind: "reason" })
    expect(first.toast).toBeNull()
    expect(dateOf(first.state.payload, "sh-mon-ann")).toBe("2026-11-02")
    const second = await runEdit(first.state, { ...move("2026-11-05"), gate: { reason: "Cover" } }, api)
    expect(second.ok).toBe(true)
    expect((calls.at(-2)!.args[1] as { reason: string }).reason).toBe("Cover")
  })

  it("rule_blocked shows the violations with the person and shifts (no toast) and asks for an override; the retry sends reason and rule ids together", async () => {
    let n = 0
    const { api, calls } = fakeApi({ patchShift: async (id, body) => { calls.push({ fn: "patch", args: [id, body] }); n++; return n === 1 ? fail(422, "rule_blocked", { violations: [blocked] }) : good({ shift: { ...ann(), date: "2026-11-05", version: 2 } as WeekShift, violations: [] }) } })
    const first = await runEdit(fresh(), move("2026-11-05"), api)
    expect(first.toast).toBeNull()
    expect(first.state.violations).toEqual([blocked])
    expect(first.ask).toEqual({ kind: "override", violations: [blocked], needsOffice: false })
    const second = await runEdit(first.state, { ...move("2026-11-05"), gate: overrideFields("Cover for sickness", first.state.violations) }, api)
    expect(second.ok).toBe(true)
    expect(calls.at(-2)!.args[1]).toMatchObject({ reason: "Cover for sickness", overrideRuleIds: ["double_booking"] })
  })

  it("403 rule_blocked_office_required is the same panel with needsOffice", async () => {
    const { api } = fakeApi({ patchShift: async () => fail(403, "rule_blocked_office_required", { violations: [blocked] }) })
    const r = await runEdit(fresh(), move("2026-11-05"), api)
    expect(r.ask).toEqual({ kind: "override", violations: [blocked], needsOffice: true })
    expect(r.toast).toBeNull()
  })

  it("a network failure (the call throws) reverts and says so calmly; a plain error reverts with its toast", async () => {
    const down = await runEdit(fresh(), move("2026-11-05"), fakeApi({ patchShift: async () => { throw new TypeError("fetch failed") } }).api)
    expect(down.toast?.text).toBe("No connection. Your change was not saved.")
    expect(dateOf(down.state.payload, "sh-mon-ann")).toBe("2026-11-02")
    const bad = await runEdit(fresh(), move("2026-11-05"), fakeApi({ patchShift: async () => fail(422, "ineligible") }).api)
    expect(bad.toast?.text).toBe("That person can't take this shift.")
    expect(bad.state.payload.shifts.find((s) => s.id === "sh-mon-ann")!.date).toBe("2026-11-02")
  })
})

describe("Task 20 review carry-ins (I1, m1, m2, m4)", () => {
  it("I1: an edit of a shift that is not in the payload (gone, or only the local card of an add) is NOT ok, sends nothing and reports no success", async () => {
    const { api, calls } = fakeApi()
    const p = payloadFixture()
    const r = await runEdit({ payload: p, violations: [] }, { kind: "patch", shiftId: "local-1-1", edit: { date: "2026-11-05" } }, api)
    expect(r.ok).toBe(false)
    expect(r.sent).toBe(false)
    expect(r.toast).toBeNull()
    expect(r.ask).toBeNull()
    expect(calls).toEqual([])
    const gone = await runEdit({ payload: p, violations: [] }, { kind: "remove", shiftId: "nope" }, api)
    expect([gone.ok, gone.sent, calls.length]).toEqual([false, false, 0])
  })

  it("an edit that changes nothing is ok but not sent (no success toast either); a real edit is sent", async () => {
    const { api } = fakeApi()
    const same = await runEdit(fresh(), { kind: "patch", shiftId: "sh-mon-ann", edit: { date: "2026-11-02" } }, api)
    expect([same.ok, same.sent]).toEqual([true, false])
    const moved = await runEdit(fresh(), move("2026-11-05"), api)
    expect([moved.ok, moved.sent]).toEqual([true, true])
  })

  it("m4: after an add goes through over a block, the stale blocking lines for that person are gone; other people's lines stay", async () => {
    const other: RuleViolation = { ...blocked, personId: PERSON.ben, shiftId: "sh-mon-ben", message: "Ben Walsh is on two shifts" }
    const p = payloadFixture()
    const type = p.shiftTypes.find((t) => t.id === DAY_T)!
    const { api } = fakeApi({ addShifts: async () => good({ shifts: [{ ...ann(), id: "sh-new", date: "2026-11-06", version: 1 } as WeekShift], violations: [warn] }) })
    const r = await runEdit({ payload: p, violations: [blocked, other] }, { kind: "add", weekId: WEEK_ID, type, form: { date: "2026-11-06", people: [PERSON.ann], start: "08:00", end: "16:00", unpaidBreakMin: 30 }, gate: overrideFields("Cover", [blocked]) }, api)
    expect(r.ok).toBe(true)
    expect(r.state.violations).toEqual([other, warn]) // Ann's block is gone, Ben's stays, the API's new warning is added
  })

  it("m1: the edits still waiting are laid over the payload in order, so the second shows its place at once", () => {
    const p = payloadFixture()
    const edits: Edit[] = [{ kind: "patch", shiftId: "sh-mon-ann", edit: { date: "2026-11-05" } }, { kind: "patch", shiftId: "sh-mon-ben", edit: { date: "2026-11-06" } }, { kind: "patch", shiftId: "sh-mon-ann", edit: { start: "09:00" } }]
    const shown = pendingView(p, edits)
    expect(dateOf(shown, "sh-mon-ann")).toBe("2026-11-05")
    expect(dateOf(shown, "sh-mon-ben")).toBe("2026-11-06")
    expect(shown.shifts.find((s) => s.id === "sh-mon-ann")!.start).toBe("09:00") // the third builds on the first
    expect(dateOf(p, "sh-mon-ann")).toBe("2026-11-02") // the payload itself is untouched
    expect(pendingView(p, [])).toBe(p)
  })

  it("m1: a waiting add keeps the same temporary ids on every render", () => {
    const p = payloadFixture()
    const type = p.shiftTypes.find((t) => t.id === DAY_T)!
    const add: Edit = { kind: "add", weekId: WEEK_ID, type, form: { date: "2026-11-06", people: [PERSON.ann, PERSON.ben], start: "08:00", end: "16:00", unpaidBreakMin: 30 }, localKey: "k1" }
    const ids = (q: RosterPayload) => q.shifts.filter((s) => s.id.startsWith("local-")).map((s) => s.id)
    expect(ids(pendingView(p, [add]))).toEqual(["local-k1-0", "local-k1-1"])
    expect(ids(pendingView(p, [add]))).toEqual(ids(pendingView(p, [add])))
  })

  it("m2: edits run one at a time, in order; an answer for a range that was left is not applied (a stale reload never overwrites the new week)", async () => {
    const q = new EditQueue()
    const log: string[] = []
    const gate = () => { let go!: () => void; const p = new Promise<void>((r) => { go = r }); return { p, go } }
    const first = gate()
    const a = q.add(async () => { log.push("a start"); await first.p; log.push("a end"); return "week-1" }, (r) => log.push(`apply ${r}`))
    const b = q.add(async () => { log.push("b start"); return "week-1 again" }, (r) => log.push(`apply ${r}`))
    await Promise.resolve()
    expect(log).toEqual(["a start"]) // b waits for a
    q.reset() // the user navigated to another week while a was in flight
    first.go()
    await Promise.all([a, b])
    expect(log).toEqual(["a start", "a end", "b start"]) // both ran, neither was applied
    const c = q.add(async () => "week-2", (r) => log.push(`apply ${r}`))
    await c
    expect(log.at(-1)).toBe("apply week-2") // an edit queued after the navigation applies
  })

  it("m2: a failing step does not stop the queue", async () => {
    const q = new EditQueue()
    const seen: string[] = []
    await q.add(async () => { throw new Error("boom") }, () => {}).catch(() => seen.push("failed"))
    await q.add(async () => "ok", (r) => seen.push(r))
    expect(seen).toEqual(["failed", "ok"])
  })
})
