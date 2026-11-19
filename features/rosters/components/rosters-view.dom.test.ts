// @vitest-environment jsdom
// The roster page as a user drives it (B8 Task 21 and the Task 20 review carry-ins): the real component in a DOM, the server actions mocked. Every test names the behaviour it protects.
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => {
  const fn = () => vi.fn()
  return {
    applyWeekTemplate: fn(), checkWeek: fn(), claimShift: fn(), createWeek: fn(), decideChange: fn(), decideExchange: fn(), historyPage: fn(), proposeSwap: fn(), publishWeek: fn(), recommendExchange: fn(),
    reloadRoster: fn(), repeatWeek: fn(), requestChange: fn(), saveWeekTemplate: fn(), addShifts: fn(), deleteShift: fn(), patchShift: fn(), refresh: fn(), toast: { success: fn(), error: fn() },
  }
})
vi.mock("@/app/actions/rosters", () => ({ ...m, refresh: undefined, toast: undefined }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: m.refresh }) }))
vi.mock("sonner", () => ({ toast: m.toast }))

import { ApiError } from "@/lib/api/problem"
import type { RuleViolation } from "@/lib/roster-rules"
import { mapRosterError } from "../errors"
import { LID, PERSON, SHIFTS, WEEK_ID, lockedAccess, openAccess, payloadFixture } from "../fixtures"
import type { ApiChangeRequest, ApiExchange, HistoryEntry, RepeatConflict, RosterPayload, WeekAccess } from "../types"
import { ReasonDialog } from "./reason-dialog"
import { RostersView, type RosterPanels } from "./rosters-view"
import { useKeepFocus } from "../use-keep-focus"

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  class RO { observe() {} unobserve() {} disconnect() {} }
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = RO
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never
  Element.prototype.scrollIntoView ??= () => {}
})

let root: Root | null = null
let host: HTMLElement | null = null
async function mount(el: React.ReactElement) {
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root!.render(el) })
}
afterEach(async () => {
  await act(async () => { root?.unmount() })
  host?.remove()
  document.body.innerHTML = ""
  root = null
  host = null
})
beforeEach(() => { for (const f of Object.values(m)) if (typeof f === "function") f.mockReset(); m.toast.success.mockReset(); m.toast.error.mockReset() })

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const click = (el: Element) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })) })
const byText = (text: string, sel = "button") => [...document.querySelectorAll<HTMLElement>(sel)].find((b) => b.textContent?.trim() === text)
const byLabel = (label: string) => document.querySelector<HTMLElement>(`[aria-label="${label}"]`)
const typeInto = (el: HTMLInputElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value)
  el.dispatchEvent(new Event("input", { bubbles: true }))
})
const submit = (form: HTMLFormElement) => act(async () => { form.requestSubmit() })
const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r }); return { promise, resolve } }

const TODAY = "2026-11-04T09:00:00"
const office: WeekAccess = { level: "office", canEdit: true, locked: false, lockReason: null }
const officeReason: WeekAccess = { level: "office", canEdit: true, locked: false, lockReason: "reason_required" }
const none: RosterPanels = { requests: [], exchanges: [], history: null }
const view = (payload: RosterPayload, panels: RosterPanels = none, me = "", today = TODAY) => createElement(RostersView, { payload, query: { week: "2026-11-02" }, today, panels, me })
const BEFORE = "2026-11-01T09:00:00" // before the shifts of the week: a swap is only offered on a shift still to come
const ok = <T,>(value: T) => ({ ok: true as const, value })
const fail = (status: number, code: string, extra: Record<string, unknown> = {}) => ({ ok: false as const, error: mapRosterError(new ApiError(status, code, "req-1", extra)) })
const blocked: RuleViolation = { rule: "double_booking", shiftId: "sh-mon-ann", personId: PERSON.ann, severity: "block", message: "Ann Byrne is on two shifts", otherShiftIds: ["sh-mon-ben"] }

const shiftCard = (id: string) => document.querySelector<HTMLElement>(`[data-shift-id="${id}"]`)
const ann = (payload: RosterPayload) => payload.shifts.find((x) => x.id === "sh-mon-ann")!
const claimOf = (o: Partial<ApiExchange> = {}): ApiExchange => ({ id: "ex-1", kind: "claim", shiftId: "sh-wed-open", weekId: WEEK_ID, locationId: LID, date: "2026-11-04", start: "08:00", end: "16:00", fromUserId: PERSON.cara, toUserId: null, status: "requested", note: "", decidedBy: null, decidedAt: null, createdAt: "2026-11-03T09:00:00.000Z", expired: false, ...o })
const requestOf = (): ApiChangeRequest => ({ id: "cr-1", shiftId: "sh-mon-ann", weekId: WEEK_ID, locationId: LID, shiftVersion: 1, requestedBy: PERSON.ben, patch: { start: "09:00" }, reason: "Opens late", status: "requested", decidedBy: null, decidedAt: null, decisionNote: null, createdAt: "2026-11-03T09:00:00.000Z" })
const historyOf = (n: number, reason: string | null = null): HistoryEntry => ({ id: `h${n}`, weekId: WEEK_ID, locationId: LID, shiftId: "sh-mon-ann", at: `2026-11-0${n}T09:00:00.000Z`, by: PERSON.ben, action: "shift_moved", before: { date: "2026-11-02" }, after: { date: "2026-11-03" }, reason })
const publishedPayload = (access: WeekAccess) => payloadFixture({ status: "published", access })

describe("the reason dialog (FR-RS-35)", () => {
  it("an office edit of a published week (lockReason reason_required) opens the reason dialog before anything is sent; the reason goes out with the shift's version", async () => {
    m.deleteShift.mockResolvedValue(ok(null))
    m.reloadRoster.mockResolvedValue(fail(500, "boom"))
    await mount(view(publishedPayload(officeReason)))
    await click(byLabel("Edit shift, Ann Byrne, 08:00 to 16:00")!)
    await click(byText("Remove shift")!)
    const input = document.getElementById("rd-reason") as HTMLInputElement | null
    expect(input).not.toBeNull() // the reason dialog is open
    expect(m.deleteShift).not.toHaveBeenCalled()
    await submit(input!.form!)
    expect(m.deleteShift).not.toHaveBeenCalled() // a blank reason is not a reason
    await typeInto(input!, "Cover for sickness")
    await submit(input!.form!)
    await flush()
    expect(m.deleteShift).toHaveBeenCalledTimes(1)
    expect(m.deleteShift).toHaveBeenCalledWith("sh-mon-ann", { version: 1, reason: "Cover for sickness" })
  })

  it("a draft week (no reason needed) sends the edit at once, no dialog", async () => {
    m.deleteShift.mockResolvedValue(ok(null))
    m.reloadRoster.mockResolvedValue(fail(500, "boom"))
    await mount(view(payloadFixture()))
    await click(byLabel("Edit shift, Ann Byrne, 08:00 to 16:00")!)
    await click(byText("Remove shift")!)
    await flush()
    expect(document.getElementById("rd-reason")).toBeNull()
    expect(m.deleteShift).toHaveBeenCalledWith("sh-mon-ann", { version: 1 })
  })

  it("office edit shows its entry in the history with the reason", async () => {
    await mount(view(publishedPayload(officeReason), { ...none, history: { weekId: WEEK_ID, page: { items: [historyOf(3, "Cover for sickness")], nextCursor: null } } }))
    const hist = document.querySelector('[aria-label="Roster history"]')!
    expect(hist.textContent).toContain("Changed a shift")
    expect(hist.textContent).toContain("Cover for sickness")
    expect(hist.textContent).toContain("Ben Walsh")
  })

  it("m6: a refused edit keeps the dialog open with the reason typed; the retry sends it and closes the dialog", async () => {
    m.deleteShift.mockResolvedValueOnce(fail(500, "boom")).mockResolvedValueOnce(ok(null))
    m.reloadRoster.mockResolvedValue(fail(500, "boom"))
    await mount(view(publishedPayload(officeReason)))
    await click(byLabel("Edit shift, Ann Byrne, 08:00 to 16:00")!)
    await click(byText("Remove shift")!)
    const input = document.getElementById("rd-reason") as HTMLInputElement
    await typeInto(input, "Cover for sickness")
    await submit(input.form!)
    await flush()
    expect(m.deleteShift).toHaveBeenCalledTimes(1)
    expect(m.toast.error).toHaveBeenCalled()
    const kept = document.getElementById("rd-reason") as HTMLInputElement | null
    expect(kept).not.toBeNull() // still open
    expect(kept!.value).toBe("Cover for sickness") // and the reason is not lost
    await submit(kept!.form!)
    await flush()
    expect(m.deleteShift).toHaveBeenCalledTimes(2)
    expect(m.deleteShift).toHaveBeenLastCalledWith("sh-mon-ann", { version: 1, reason: "Cover for sickness" })
    expect(document.getElementById("rd-reason")).toBeNull() // closed on success
  })

  it("m6: the dialog confirms once while its request is on its way, and again after a refusal", async () => {
    const d = deferred<boolean>()
    const onConfirm = vi.fn().mockReturnValueOnce(d.promise).mockReturnValueOnce(true)
    await mount(createElement(ReasonDialog, { title: "Say why", description: "d", confirmLabel: "Save", onConfirm, onClose: () => {} }))
    const input = document.getElementById("rd-reason") as HTMLInputElement
    await typeInto(input, "Cover for sickness")
    await act(async () => { input.form!.requestSubmit(); input.form!.requestSubmit() })
    expect(onConfirm).toHaveBeenCalledTimes(1)
    await act(async () => { d.resolve(false); await Promise.resolve() })
    await flush()
    await submit(input.form!)
    expect(onConfirm).toHaveBeenCalledTimes(2)
    expect(onConfirm).toHaveBeenLastCalledWith("Cover for sickness")
  })

  it("m6: an override decision that fails keeps its reason for the retry", async () => {
    m.decideChange.mockResolvedValueOnce(fail(422, "rule_blocked", { violations: [blocked] })).mockResolvedValueOnce(fail(500, "boom")).mockResolvedValueOnce(ok({ request: { ...requestOf(), status: "approved" }, shift: null, violations: [] }))
    await mount(view(publishedPayload(office), { ...none, requests: [requestOf()] }))
    await click(byText("Approve")!)
    await flush()
    const input = document.getElementById("rd-reason") as HTMLInputElement
    await typeInto(input, "Agreed with the client")
    await submit(input.form!)
    await flush()
    expect(m.decideChange).toHaveBeenCalledTimes(2)
    const kept = document.getElementById("rd-reason") as HTMLInputElement | null
    expect(kept?.value).toBe("Agreed with the client")
    await submit(kept!.form!)
    await flush()
    expect(m.decideChange).toHaveBeenCalledTimes(3)
    expect(document.getElementById("rd-reason")).toBeNull()
  })
})

describe("I1: a card the API has not answered for is shown but cannot be dragged or opened", () => {
  it("a local card is plain and busy; the real cards are buttons", async () => {
    const p = payloadFixture()
    const withLocal: RosterPayload = { ...p, shifts: [...p.shifts, { ...ann(p), id: "local-7-0", version: 0, personId: PERSON.cara }] }
    await mount(view(withLocal))
    const local = shiftCard("local-7-0") ?? [...document.querySelectorAll<HTMLElement>("li[data-pending]")][0]!
    expect(local.getAttribute("data-pending")).toBe("")
    expect(local.querySelector("button")).toBeNull()
    expect(local.classList.contains("dnd-card")).toBe(false)
    expect(shiftCard("sh-mon-ann")!.querySelector("button.ros-shift-btn")).not.toBeNull()
  })
})

describe("publish (FR-RS-23/24)", () => {
  const open = async () => { await click(byText("Publish")!); await flush() }
  it("lists the API's violations; a supervisor sees a block as not publishable, with no way to go over it", async () => {
    m.checkWeek.mockResolvedValue(ok({ violations: [blocked], blocking: true }))
    await mount(view(payloadFixture()))
    await open()
    const dlg = document.querySelector('[role="dialog"]')!
    expect(dlg.textContent).toContain("Ann Byrne is on two shifts")
    expect(dlg.textContent).not.toContain("Ann Byrne Ann Byrne") // the person is named once
    expect(dlg.textContent).toContain("Not publishable")
    expect(document.getElementById("pd-reason")).toBeNull()
    await submit(dlg.querySelector("form")!)
    expect(m.publishWeek).not.toHaveBeenCalled()
  })

  it("an office role over a block must give a reason; it goes out with the rule ids and the week's version", async () => {
    m.checkWeek.mockResolvedValue(ok({ violations: [blocked], blocking: true }))
    m.publishWeek.mockResolvedValue(ok({ week: publishedPayload(office).weeks[0], violations: [] }))
    await mount(view(payloadFixture({ access: office })))
    await open()
    const input = document.getElementById("pd-reason") as HTMLInputElement
    expect(input).not.toBeNull()
    await submit(input.form!)
    expect(m.publishWeek).not.toHaveBeenCalled()
    await typeInto(input, "Agreed with the guard")
    await submit(input.form!)
    expect(m.publishWeek).toHaveBeenCalledWith(WEEK_ID, { version: 1, reason: "Agreed with the guard", overrideRuleIds: ["double_booking"] })
  })

  it("warnings only: publishes with no reason", async () => {
    m.checkWeek.mockResolvedValue(ok({ violations: [{ ...blocked, severity: "warn", rule: "daily_rest" }], blocking: false }))
    m.publishWeek.mockResolvedValue(ok({ week: publishedPayload(office).weeks[0], violations: [] }))
    await mount(view(payloadFixture()))
    await open()
    expect(document.getElementById("pd-reason")).toBeNull()
    await submit(document.querySelector('[role="dialog"] form')!)
    expect(m.publishWeek).toHaveBeenCalledWith(WEEK_ID, { version: 1 })
  })

  it("double click guard: two submits while the request runs send ONE publish", async () => {
    const d = deferred<unknown>()
    m.checkWeek.mockResolvedValue(ok({ violations: [], blocking: false }))
    m.publishWeek.mockReturnValue(d.promise)
    await mount(view(payloadFixture()))
    await open()
    const form = document.querySelector<HTMLFormElement>('[role="dialog"] form')!
    await act(async () => { form.requestSubmit(); form.requestSubmit() })
    expect(m.publishWeek).toHaveBeenCalledTimes(1)
    await act(async () => { d.resolve(ok({ week: publishedPayload(lockedAccess).weeks[0], violations: [] })); await Promise.resolve() })
    await flush()
    expect(m.publishWeek).toHaveBeenCalledTimes(1)
  })

  it("AC-RS-05: after publish every edit control is off for a supervisor and 'Request change' is the only action", async () => {
    m.checkWeek.mockResolvedValue(ok({ violations: [], blocking: false }))
    m.publishWeek.mockResolvedValue(ok({ week: publishedPayload(lockedAccess).weeks[0], violations: [] }))
    await mount(view(payloadFixture()))
    expect(document.querySelectorAll(".ros-add").length).toBeGreaterThan(0) // editable before
    expect(document.querySelectorAll(".dnd-card").length).toBeGreaterThan(0)
    await open()
    await submit(document.querySelector('[role="dialog"] form')!)
    await flush()
    expect(document.querySelectorAll(".ros-add")).toHaveLength(0)
    expect(document.querySelectorAll(".dnd-card")).toHaveLength(0)
    expect(document.querySelectorAll(".dnd-grip")).toHaveLength(0)
    expect(byText("Check rules")).toBeUndefined()
    expect(byText("Publish")).toBeUndefined()
    expect(document.querySelectorAll("button.ros-req-btn").length).toBeGreaterThan(0) // Request change on every card
    expect([...document.querySelectorAll("button.ros-req-btn")].every((b) => b.textContent === "Request change")).toBe(true)
    expect(m.refresh).toHaveBeenCalled()
  })
})

describe("change requests (FR-RS-36/37)", () => {
  it("a supervisor's 'Request change' needs a change and a reason before it sends anything", async () => {
    await mount(view(publishedPayload(lockedAccess)))
    await click(byLabel("Request change, Ann Byrne, 08:00 to 16:00")!)
    const why = document.getElementById("cr-why") as HTMLInputElement
    expect(why).not.toBeNull()
    await typeInto(why, "Opens late")
    await submit(why.form!) // nothing changed
    expect(m.requestChange).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain("Change the times or the person")
  })

  it("approve with a NEW block asks for an override reason, then sends reason and rule ids together", async () => {
    m.decideChange.mockResolvedValueOnce(fail(422, "rule_blocked", { violations: [blocked] })).mockResolvedValueOnce(ok({ request: { ...requestOf(), status: "approved" }, shift: null, violations: [] }))
    await mount(view(publishedPayload(office), { ...none, requests: [requestOf()] }))
    await click(byText("Approve")!)
    await flush()
    expect(m.decideChange).toHaveBeenCalledWith("cr-1", { decision: "approve" })
    const input = document.getElementById("rd-reason") as HTMLInputElement
    expect(input).not.toBeNull() // the override reason is asked for
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain("Ann Byrne is on two shifts")
    await submit(input.form!)
    expect(m.decideChange).toHaveBeenCalledTimes(1) // blank: no second request
    await typeInto(input, "Agreed with the client")
    await submit(input.form!)
    await flush()
    expect(m.decideChange).toHaveBeenLastCalledWith("cr-1", { decision: "approve", overrideReason: "Agreed with the client", overrideRuleIds: ["double_booking"] })
  })

  it("double click guard: two clicks on Approve send ONE decision", async () => {
    const d = deferred<unknown>()
    m.decideChange.mockReturnValue(d.promise)
    await mount(view(publishedPayload(office), { ...none, requests: [requestOf()] }))
    const b = byText("Approve")!
    await act(async () => { b.click(); b.click() })
    expect(m.decideChange).toHaveBeenCalledTimes(1)
    await act(async () => { d.resolve(ok({ request: requestOf(), shift: null, violations: [] })); await Promise.resolve() })
  })

  it("a supervisor sees the request waiting, with no approve or reject", async () => {
    await mount(view(publishedPayload(lockedAccess), { ...none, requests: [requestOf()] }))
    const panel = document.querySelector('[aria-label="Change requests"]')!
    expect(panel.textContent).toContain("Opens late")
    expect(panel.textContent).toContain("The office decides")
    expect(panel.querySelector("button")).toBeNull()
  })
})

describe("open shifts and swaps follow the approver matrix (R8-11)", () => {
  const board = (access: WeekAccess, status: "draft" | "published", delegated = false, ex: ApiExchange[] = [claimOf()], me = PERSON.ben) => {
    const p = payloadFixture({ status, access })
    p.locations = [{ ...p.locations[0]!, swapApprovalDelegated: delegated }]
    return view(p, { ...none, exchanges: ex }, me)
  }
  const CLAIM = "Claim Wed 4 Nov 08:00–16:00"
  const labels = () => [...document.querySelectorAll('[aria-label="Open shifts and swaps"] button')].map((b) => b.getAttribute("aria-label") ?? b.textContent)
  it("office approves and rejects on a published week; a supervisor only recommends; a delegated supervisor approves", async () => {
    await mount(board(office, "published"))
    expect(labels()).toEqual([CLAIM, "Reject Cara Doyle", "Approve Cara Doyle"])
    await act(async () => { root!.unmount() }); root = null; host!.remove(); document.body.innerHTML = ""
    await mount(board(lockedAccess, "published"))
    expect(labels()).toEqual([CLAIM, "Recommend Cara Doyle"])
    await act(async () => { root!.unmount() }); root = null; host!.remove(); document.body.innerHTML = ""
    await mount(board(lockedAccess, "published", true))
    expect(labels()).toEqual([CLAIM, "Reject Cara Doyle", "Approve Cara Doyle"])
  })
  it("a supervisor on a draft week approves; an open shift with nobody offering shows Claim on a published week only", async () => {
    await mount(board(openAccess, "draft"))
    expect(labels()).toEqual([]) // a draft week has no open shifts to claim and nothing to decide on a claim
    await act(async () => { root!.unmount() }); root = null; host!.remove(); document.body.innerHTML = ""
    await mount(board(lockedAccess, "published", false, []))
    expect(labels()).toEqual([CLAIM])
  })
  it("I1: nobody is offered a decision or a recommendation on their own claim (the API answers 403 self_decision); m3: Claim stays while only others have claimed", async () => {
    await mount(board(lockedAccess, "published", false, [claimOf()], PERSON.cara))
    expect(labels()).toEqual([]) // Cara's own claim: no Recommend, and no second Claim
    expect(document.querySelector('[aria-label="Open shifts and swaps"]')!.textContent).toContain("Your claim")
    await act(async () => { root!.unmount() }); root = null; host!.remove(); document.body.innerHTML = ""
    await mount(board(office, "published", false, [claimOf()], PERSON.cara))
    expect(labels()).toEqual([]) // nor Approve or Reject for an office role
    await act(async () => { root!.unmount() }); root = null; host!.remove(); document.body.innerHTML = ""
    await mount(board(lockedAccess, "published", false, [claimOf({ status: "approved" }), claimOf({ id: "ex-2", fromUserId: PERSON.ann })], PERSON.cara))
    expect(labels()).toEqual([CLAIM, "Recommend Ann Byrne"]) // Cara's claim was decided; Ann's open claim does not take Cara's Claim away
  })
  it("I1: a swap the caller is party to (either side) offers nothing to them", async () => {
    const swap = (o: Partial<ApiExchange> = {}) => claimOf({ id: "ex-s", kind: "swap", shiftId: "sh-mon-ann", date: "2026-11-02", fromUserId: PERSON.ann, toUserId: PERSON.cara, ...o })
    await mount(board(office, "published", false, [swap()], PERSON.cara))
    expect(labels()).toEqual([CLAIM]) // only the open Wednesday shift's Claim
    expect(document.querySelector('[aria-label="Open shifts and swaps"]')!.textContent).toContain("Your swap")
    await act(async () => { root!.unmount() }); root = null; host!.remove(); document.body.innerHTML = ""
    await mount(board(office, "published", false, [swap()], PERSON.ann))
    expect(labels()).toEqual([CLAIM])
    await act(async () => { root!.unmount() }); root = null; host!.remove(); document.body.innerHTML = ""
    await mount(board(office, "published", false, [swap()], PERSON.ben))
    expect(labels()).toEqual([CLAIM, "Reject swap, Ann Byrne", "Approve swap, Ann Byrne"])
  })
  it("approve is one request per click, and a recommendation is sent as such", async () => {
    const d = deferred<unknown>()
    m.decideExchange.mockReturnValue(d.promise)
    await mount(board(office, "published"))
    const a = byLabel("Approve Cara Doyle")!
    await act(async () => { a.click(); a.click() })
    expect(m.decideExchange).toHaveBeenCalledTimes(1)
    expect(m.decideExchange).toHaveBeenCalledWith("ex-1", { decision: "approve" })
    await act(async () => { d.resolve(ok({ exchange: claimOf({ status: "approved" }), shift: null, violations: [] })); await Promise.resolve() })
    await act(async () => { root!.unmount() }); root = null; host!.remove(); document.body.innerHTML = ""
    m.recommendExchange.mockResolvedValue(ok(claimOf({ status: "recommended" })))
    await mount(board(lockedAccess, "published"))
    await click(byLabel("Recommend Cara Doyle")!)
    expect(m.recommendExchange).toHaveBeenCalledWith("ex-1")
  })
})

describe("history (V1)", () => {
  it("pages with Load more by the API's cursor, and one click is one request", async () => {
    const d = deferred<unknown>()
    m.historyPage.mockReturnValue(d.promise)
    await mount(view(payloadFixture(), { ...none, history: { weekId: WEEK_ID, page: { items: [historyOf(3), historyOf(2)], nextCursor: "c1" } } }))
    const rows = () => document.querySelectorAll('[aria-label="Roster history"] li.ros-hist-row:not([aria-hidden])').length
    expect(rows()).toBe(2)
    const more = byText("Load more")!
    await act(async () => { more.click(); more.click() })
    expect(m.historyPage).toHaveBeenCalledTimes(1)
    expect(m.historyPage).toHaveBeenCalledWith(WEEK_ID, "c1", 20)
    await act(async () => { d.resolve(ok({ items: [historyOf(1)], nextCursor: null })); await Promise.resolve() })
    await flush()
    expect(rows()).toBe(3)
    expect(byText("Load more")).toBeUndefined() // no cursor left
  })

  it("an empty page that still has older entries offers Load older; no entries at all says so", async () => {
    await mount(view(payloadFixture(), { ...none, history: { weekId: WEEK_ID, page: { items: [], nextCursor: "c9" } } }))
    expect(byText("Load older")).toBeDefined()
    await act(async () => { root!.unmount() }); root = null; host!.remove(); document.body.innerHTML = ""
    await mount(view(payloadFixture(), { ...none, history: { weekId: WEEK_ID, page: { items: [], nextCursor: null } } }))
    expect(document.querySelector('[aria-label="Roster history"]')!.textContent).toContain("No changes yet")
    expect(byText("Load older")).toBeUndefined()
  })
})

describe("repeat (FR-RS-26; Review Focus 5)", () => {
  const conflict = (open: boolean, shiftId: string): RepeatConflict => ({ weekId: "w2", shiftId, personId: PERSON.ann, date: "2026-11-09", reason: open ? "approved_leave" : "public_holiday", open, message: open ? "Ann Byrne is on leave" : "Public holiday" })
  const week2 = (status: "draft" | "published", version: number) => ({ ...payloadFixture().weeks[0]!, id: "w2", weekStart: "2026-11-09", status, version })
  const openDialog = async () => { await click(byText("Repeat")!); await flush() }

  it("shows the conflict list with kept, warned and open counts after it runs", async () => {
    m.reloadRoster.mockResolvedValue(ok(payloadFixture()))
    m.repeatWeek.mockResolvedValue(ok({ created: [week2("draft", 1)], conflicts: [conflict(true, "s1"), conflict(false, "s2")], counts: { copied: 12, kept: 9, warned: 2, opened: 1 } }))
    await mount(view(payloadFixture()))
    await openDialog()
    await submit(document.querySelector('[role="dialog"] form')!)
    await flush()
    expect(m.repeatWeek).toHaveBeenCalledWith(WEEK_ID, { version: 1, weeks: 1 })
    const dlg = document.querySelector('[role="dialog"]')!
    expect(dlg.textContent).toContain("9 kept · 2 warned · 1 open")
    expect(dlg.querySelectorAll('[aria-label="Repeat conflicts"] li')).toHaveLength(2)
    expect(document.querySelector('[aria-label="Repeat conflicts"]')).not.toBeNull()
    expect(m.refresh).toHaveBeenCalled()
  })

  it("replace sends the version of every draft it replaces; a published week in the way stops it", async () => {
    const p = payloadFixture()
    m.reloadRoster.mockResolvedValue(ok({ ...p, weeks: [...p.weeks, week2("draft", 4)] }))
    m.repeatWeek.mockResolvedValue(ok({ created: [], conflicts: [], counts: { copied: 4, kept: 4, warned: 0, opened: 0 } }))
    await mount(view(payloadFixture()))
    await openDialog()
    const go = document.querySelector<HTMLButtonElement>('[role="dialog"] button[type="submit"]')!
    expect(go.disabled).toBe(true) // a draft is there: needs Replace
    await click(document.querySelector('[role="switch"]')!)
    expect(document.querySelector<HTMLButtonElement>('[role="dialog"] button[type="submit"]')!.disabled).toBe(false)
    await submit(document.querySelector('[role="dialog"] form')!)
    await flush()
    expect(m.repeatWeek).toHaveBeenCalledWith(WEEK_ID, { version: 1, weeks: 1, replace: true, targetVersions: { "2026-11-09": 4 } })
  })

  it("a published week in the way blocks the repeat", async () => {
    const p = payloadFixture()
    m.reloadRoster.mockResolvedValue(ok({ ...p, weeks: [...p.weeks, week2("published", 3)] }))
    await mount(view(payloadFixture()))
    await openDialog()
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain("already published")
    expect(document.querySelector<HTMLButtonElement>('[role="dialog"] button[type="submit"]')!.disabled).toBe(true)
  })

  it("double click guard: two submits send ONE repeat", async () => {
    const d = deferred<unknown>()
    m.reloadRoster.mockResolvedValue(ok(payloadFixture()))
    m.repeatWeek.mockReturnValue(d.promise)
    await mount(view(payloadFixture()))
    await openDialog()
    const form = document.querySelector<HTMLFormElement>('[role="dialog"] form')!
    await act(async () => { form.requestSubmit(); form.requestSubmit() })
    expect(m.repeatWeek).toHaveBeenCalledTimes(1)
    await act(async () => { d.resolve(ok({ created: [], conflicts: [], counts: { copied: 0, kept: 0, warned: 0, opened: 0 } })); await Promise.resolve() })
  })
})

describe("swap (FR-RS-42)", () => {
  it("your own shift on a published week offers Swap; the colleague is required", async () => {
    await mount(view(publishedPayload(lockedAccess), none, PERSON.ann, BEFORE))
    expect(byLabel("Swap, 08:00 to 16:00")).not.toBeNull()
    expect(document.querySelectorAll('button[aria-label^="Swap,"]')).toHaveLength(1) // only Ann's, not Ben's or Cara's
    await click(byLabel("Swap, 08:00 to 16:00")!)
    await submit(document.querySelector('[role="dialog"] form')!)
    expect(m.proposeSwap).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain("Pick who takes the shift")
  })
})

describe("I2: the API cut a people list at its cap (membersTruncated): the hint is visible wherever people are picked", () => {
  const cut = (p: RosterPayload): RosterPayload => ({ ...p, membersTruncated: true })
  it("in the add/edit shift dialog", async () => {
    await mount(view(cut(payloadFixture())))
    await click(byLabel("Edit shift, Ann Byrne, 08:00 to 16:00")!)
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain("List is cut at 500")
  })
  it("in the change request dialog and the swap dialog", async () => {
    await mount(view(cut(publishedPayload(lockedAccess)), none, PERSON.ann, BEFORE))
    await click(byLabel("Request change, Ann Byrne, 08:00 to 16:00")!)
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain("List is cut at 500")
    await act(async () => { root!.unmount() }); root = null; host!.remove(); document.body.innerHTML = ""
    await mount(view(cut(publishedPayload(lockedAccess)), none, PERSON.ann, BEFORE))
    await click(byLabel("Swap, 08:00 to 16:00")!)
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain("List is cut at 500")
  })
  it("and not when the list is whole", async () => {
    await mount(view(payloadFixture()))
    await click(byLabel("Edit shift, Ann Byrne, 08:00 to 16:00")!)
    expect(document.body.textContent).not.toContain("List is cut at 500")
  })
})

describe("m2: an answer for a range that was left never overwrites the new one", () => {
  it("a delete that is still running when the page navigates: its reload of the OLD range is dropped", async () => {
    const d = deferred<unknown>()
    m.deleteShift.mockReturnValue(d.promise)
    m.reloadRoster.mockResolvedValue(ok(payloadFixture())) // the OLD week as it was (Ann on Monday)
    await mount(view(payloadFixture()))
    await click(byLabel("Edit shift, Ann Byrne, 08:00 to 16:00")!)
    await click(byText("Remove shift")!)
    // navigate: the server sends another payload (here Ann's shift is on Friday)
    const other = payloadFixture({ shifts: SHIFTS.map((x) => (x.id === "sh-mon-ann" ? { ...x, date: "2026-11-06" } : x)) })
    await act(async () => { root!.render(view(other)) })
    expect(shiftCard("sh-mon-ann")!.closest(".ros-day")!.getAttribute("aria-label")).toBe("Fri 6 Nov")
    await act(async () => { d.resolve(ok(null)); await Promise.resolve() })
    await flush()
    expect(shiftCard("sh-mon-ann")!.closest(".ros-day")!.getAttribute("aria-label")).toBe("Fri 6 Nov") // the stale reload did not put Ann back on Monday
  })
})

describe("m5: keyboard focus follows a card to its new column", () => {
  function Cols({ col, keep }: { col: "a" | "b"; keep?: (f: (id: string) => void) => void }) {
    const ref = { current: null as HTMLDivElement | null }
    return createElement(Inner, { col, keep, refBox: ref })
  }
  function Inner({ col, keep, refBox }: { col: "a" | "b"; keep?: (f: (id: string) => void) => void; refBox: { current: HTMLDivElement | null } }) {
    const k = useKeepFocus(refBox)
    keep?.(k)
    return createElement("div", { ref: (el: HTMLDivElement | null) => { refBox.current = el } },
      createElement("ul", { id: "a" }, col === "a" && createElement("li", { "data-shift-id": "s1", key: "a" }, createElement("button", { className: "ros-shift-btn" }, "card"))),
      createElement("ul", { id: "b" }, col === "b" && createElement("li", { "data-shift-id": "s1", key: "b" }, createElement("button", { className: "ros-shift-btn" }, "card"))))
  }
  it("the moved card (a new element in another column) takes focus back when focus was lost", async () => {
    let keep!: (id: string) => void
    await mount(createElement(Cols, { col: "a", keep: (f) => { keep = f } }))
    document.querySelector<HTMLElement>("#a button")!.focus()
    expect(document.activeElement?.parentElement?.parentElement?.id).toBe("a")
    keep("s1")
    await act(async () => { root!.render(createElement(Cols, { col: "b", keep: (f) => { keep = f } })) })
    expect(document.activeElement?.closest("ul")?.id).toBe("b") // focus is on the card in column b, not on the page
  })
  it("a dialog that has focus keeps it", async () => {
    let keep!: (id: string) => void
    await mount(createElement(Cols, { col: "a", keep: (f) => { keep = f } }))
    const input = document.createElement("input")
    document.body.appendChild(input)
    input.focus()
    keep("s1")
    await act(async () => { root!.render(createElement(Cols, { col: "b", keep: (f) => { keep = f } })) })
    expect(document.activeElement).toBe(input)
  })
})
