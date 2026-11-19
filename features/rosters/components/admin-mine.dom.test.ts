// @vitest-environment jsdom
// B8 Task 22: the locations admin, the licence editor and My roster as a user drives them, on the API's shapes. The server actions and the calendar download are mocked; the API decides.
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => {
  const fn = () => vi.fn()
  return {
    archiveShiftType: fn(), cancelExchange: fn(), cancelLeave: fn(), confirmShift: fn(), createLeave: fn(), createLocation: fn(), createShiftType: fn(), decideLeave: fn(), declineExchange: fn(),
    proposeSwap: fn(), readLocation: fn(), readQualifications: fn(), setAvailability: fn(), setLocationSupervisors: fn(), setQualifications: fn(), setShiftTypeTargets: fn(), updateLocation: fn(),
    updateShiftType: fn(), download: fn(), refresh: fn(), push: fn(), toast: Object.assign(fn(), { success: fn(), error: fn() }),
  }
})
vi.mock("@/app/actions/rosters", () => Object.fromEntries(Object.entries(m).filter(([k]) => !["download", "refresh", "push", "toast"].includes(k))))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: m.push, refresh: m.refresh }) }))
vi.mock("sonner", () => ({ toast: m.toast }))
vi.mock("../ics-download", () => ({ downloadMyCalendar: m.download }))
// Native stand-ins for the Base UI select and the date picker (their popups do not open in jsdom); the components under test are unchanged.
vi.mock("@/components/filter-bar", async (orig) => {
  const { createElement: h } = await import("react")
  const real = await orig<typeof import("@/components/filter-bar")>()
  return {
    ...real,
    FilterSelect: ({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange(v: string): void }) =>
      h("select", { "aria-label": label, value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) }, options.map((o) => h("option", { key: o.value, value: o.value }, o.label))),
  }
})
vi.mock("@/components/date-picker", async () => {
  const { createElement: h } = await import("react")
  return { DatePicker: ({ label, value, onChange }: { label: string; value: string; onChange(v: string): void }) => h("input", { "aria-label": label, value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) }) }
})

import { ApiError } from "@/lib/api/problem"
import { toExchange, toLeave, toLocation, toShiftType } from "../adapters"
import { mapRosterError } from "../errors"
import { LID, STID, exchangeDto, leaveDto, locationDto, mineShiftDto, shiftTypeDto } from "../fixtures"
import type { ApiLeave, MineShift, MyRoster, RosterMember } from "../types"
import { LocationFormPage } from "./location-form"
import { LocationsView } from "./locations-view"
import { MyRosterView, type MyRosterProps } from "./my-roster"

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  class RO { observe() {} unobserve() {} disconnect() {} }
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = RO
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never
  Element.prototype.scrollIntoView ??= () => {}
  class IO { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } }
  ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver ??= IO
})

let root: Root | null = null
let host: HTMLElement | null = null
async function mount(el: React.ReactElement) {
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root!.render(el) })
}
const rerender = (el: React.ReactElement) => act(async () => { root!.render(el) })
afterEach(async () => {
  await act(async () => { root?.unmount() })
  host?.remove()
  document.body.innerHTML = ""
  root = null
  host = null
})
beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset()
  m.toast.success.mockReset()
  m.toast.error.mockReset()
})

const flush = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) })
const click = async (el: Element) => { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })) }); await flush() }
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>("button")]
const byText = (text: string) => buttons().find((b) => b.textContent?.trim() === text)
const byLabel = (label: string) => document.querySelector<HTMLElement>(`[aria-label="${label}"]`)
const typeInto = (el: HTMLInputElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value)
  el.dispatchEvent(new Event("input", { bubbles: true }))
})
const choose = (el: HTMLSelectElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, value)
  el.dispatchEvent(new Event("change", { bubbles: true }))
})
const ok = <T,>(value: T) => ({ ok: true as const, value })
const fail = (status: number, code: string) => ({ ok: false as const, error: mapRosterError(new ApiError(status, code, "req-1")) })
const text = () => document.body.textContent ?? ""

const loc = toLocation(locationDto) // version 1, one supervisor (UID) the people list below does not hold
const people: RosterMember[] = [{ id: "u-ann", name: "Ann Byrne", active: true, homeLocationId: LID }, { id: "u-ben", name: "Ben Walsh", active: true, homeLocationId: null }]

describe("location form (B8 Task 22)", () => {
  it("location form saves with version and shows the conflict banner (O1 pattern): Keep mine resends on their version, Reload theirs takes their copy", async () => {
    await mount(createElement(LocationFormPage, { location: loc, shiftTypes: [], people, truncated: false }))
    await typeInto(document.getElementById("lf-contact") as HTMLInputElement, "01 999")
    m.updateLocation.mockResolvedValueOnce(fail(409, "version_conflict"))
    m.readLocation.mockResolvedValueOnce(ok({ ...loc, version: 3, contact: "theirs", name: "Harbour St" }))
    await click(byText("Save location")!)
    expect(m.updateLocation).toHaveBeenCalledWith(LID, { version: 1, contact: "01 999" }) // the version it was opened on, only the changed field
    expect(text()).toContain("Changed by someone else")
    expect((document.getElementById("lf-contact") as HTMLInputElement).value).toBe("01 999") // my text is kept
    expect(byText("Save location")!.disabled).toBe(true) // no save until the person chooses
    await click(byText("Keep mine")!)
    m.updateLocation.mockResolvedValueOnce(ok({ ...loc, version: 4, contact: "01 999", name: "Harbour St" }))
    await click(byText("Save location")!)
    expect(m.updateLocation).toHaveBeenLastCalledWith(LID, { version: 3, contact: "01 999" }) // on THEIR version: only my edit goes on top (their name change stays: Task 22 review I1)
    expect((document.getElementById("lf-name") as HTMLInputElement).value).toBe("Harbour St")
    expect(m.refresh).toHaveBeenCalled()
    await act(async () => { await new Promise((r) => setTimeout(r, 800)) }) // the button's "done" tick (ACTION.done) ends before the next save

    m.updateLocation.mockResolvedValueOnce(fail(409, "version_conflict"))
    m.readLocation.mockResolvedValueOnce(ok({ ...loc, version: 6, contact: "their new" }))
    await typeInto(document.getElementById("lf-contact") as HTMLInputElement, "mine again")
    await click(byText("Save location")!)
    await click(byText("Reload theirs")!)
    expect((document.getElementById("lf-contact") as HTMLInputElement).value).toBe("their new")
    expect(text()).not.toContain("Changed by someone else")
  })

  it("a refusal other than a conflict is one short line (the app's copy, never the server's text)", async () => {
    await mount(createElement(LocationFormPage, { location: loc, shiftTypes: [], people, truncated: false }))
    await typeInto(document.getElementById("lf-name") as HTMLInputElement, "Docklands")
    m.updateLocation.mockResolvedValueOnce(fail(409, "location_name_taken"))
    await click(byText("Save location")!)
    expect(document.querySelector(".rl-err")?.textContent).toBe("That location name is taken.")
  })

  it("supervisor grants multi-select lists only people the caller may see; a granted person out of reach is a count, never a name, and is kept on save", async () => {
    await mount(createElement(LocationFormPage, { location: loc, shiftTypes: [], people, truncated: false }))
    const select = document.querySelector<HTMLSelectElement>('select[aria-label="Supervisors"]')!
    expect([...select.options].map((o) => o.textContent)).toEqual(["Add a person…", "Ann Byrne", "Ben Walsh"])
    expect(text()).toContain("+1 not shown")
    expect(text()).not.toContain(locationDto.supervisorIds[0])
    await choose(select, "u-ann")
    m.setLocationSupervisors.mockResolvedValueOnce(ok(["u-ann", locationDto.supervisorIds[0]]))
    await click(byText("Save location")!)
    expect(m.updateLocation).not.toHaveBeenCalled() // nothing else changed: no PATCH
    expect(m.setLocationSupervisors).toHaveBeenCalledWith(LID, ["u-ann", locationDto.supervisorIds[0]])
  })

  it("shift types in use show Archive, not Delete; archiving goes through the action; a new card can only be removed", async () => {
    const day = toShiftType(shiftTypeDto)
    const old = { ...day, id: "st-old", name: "Old", archived: true }
    await mount(createElement(LocationFormPage, { location: loc, shiftTypes: [day, old], people, truncated: false }))
    expect(byLabel("Archive Night")).not.toBeNull()
    expect(buttons().some((b) => /delete/i.test(b.textContent ?? "") || /delete/i.test(b.getAttribute("aria-label") ?? ""))).toBe(false)
    expect(byLabel("Archive Old")).toBeNull() // archived: nothing to do, listed under Archived
    expect(text()).toContain("Archived (1)")
    m.archiveShiftType.mockResolvedValueOnce(ok(null))
    await click(byLabel("Archive Night")!)
    expect(m.archiveShiftType).toHaveBeenCalledWith(STID)
    await click(byText("Add")!)
    expect(byLabel("Remove New shift type")).not.toBeNull()
    expect(byLabel("Archive New shift type")).toBeNull()
  })

  it("a shift type saves with its own version and only what changed; targets are their own set", async () => {
    await mount(createElement(LocationFormPage, { location: loc, shiftTypes: [toShiftType(shiftTypeDto)], people, truncated: false }))
    expect(byText("Save")!.disabled).toBe(true) // nothing changed yet
    await typeInto(document.getElementById(`${STID}-break`) as HTMLInputElement, "45")
    await typeInto(byLabel("Night Fri") as HTMLInputElement, "3")
    m.updateShiftType.mockResolvedValueOnce(ok(toShiftType({ ...shiftTypeDto, unpaidBreakMin: 45, version: 2 })))
    m.setShiftTypeTargets.mockResolvedValueOnce(ok(toShiftType({ ...shiftTypeDto, version: 3 })))
    await click(byText("Save")!)
    expect(m.updateShiftType).toHaveBeenCalledWith(STID, { version: 1, unpaidBreakMin: 45 })
    expect(m.setShiftTypeTargets).toHaveBeenCalledWith(STID, [{ weekday: 1, count: 2 }, { weekday: 5, count: 3 }])
  })
})

describe("Task 22 review carry-ins (I1 I2 I3 m6)", () => {
  const field = (id: string) => document.getElementById(id) as HTMLInputElement
  const card = (label: string) => document.querySelector<HTMLFieldSetElement>(`fieldset[aria-label="${label}"]`)!
  const inCard = (label: string, text: string) => [...card(label).querySelectorAll("button")].find((b) => b.textContent?.trim() === text)
  const waitTick = () => act(async () => { await new Promise((r) => setTimeout(r, 800)) }) // the button's "done" tick ends before the next action

  it("I1: Keep mine sends only the fields I changed; another session's edit of a different field (and of the supervisors) is kept, never sent back over", async () => {
    await mount(createElement(LocationFormPage, { location: loc, shiftTypes: [], people, truncated: false }))
    await typeInto(field("lf-address"), "2 Quay St")
    m.updateLocation.mockResolvedValueOnce(fail(409, "version_conflict"))
    m.readLocation.mockResolvedValueOnce(ok({ ...loc, version: 3, contact: "their phone", supervisorIds: [...loc.supervisorIds, "u-ben"] }))
    await click(byText("Save location")!)
    await click(byText("Keep mine")!)
    expect(field("lf-contact").value).toBe("their phone") // I never touched it: theirs shows
    expect(field("lf-address").value).toBe("2 Quay St") // mine stays
    m.updateLocation.mockResolvedValueOnce(ok({ ...loc, version: 4, contact: "their phone", address: "2 Quay St", supervisorIds: [...loc.supervisorIds, "u-ben"] }))
    await click(byText("Save location")!)
    expect(m.updateLocation).toHaveBeenLastCalledWith(LID, { version: 3, address: "2 Quay St" })
    expect(m.setLocationSupervisors).not.toHaveBeenCalled() // their new supervisor is not removed
  })

  it("I2: details saved but the supervisors refused: the next Save sends the new version and only what is still unsaved (no false conflict)", async () => {
    await mount(createElement(LocationFormPage, { location: loc, shiftTypes: [], people, truncated: false }))
    await typeInto(field("lf-contact"), "01 777")
    await choose(document.querySelector<HTMLSelectElement>('select[aria-label="Supervisors"]')!, "u-ann")
    m.updateLocation.mockResolvedValueOnce(ok({ ...loc, version: 2, contact: "01 777" }))
    m.setLocationSupervisors.mockResolvedValueOnce(fail(403, "forbidden"))
    await click(byText("Save location")!)
    expect(document.querySelector(".rl-err")?.textContent).toBeTruthy()
    await waitTick()
    m.setLocationSupervisors.mockResolvedValueOnce(ok(["u-ann", locationDto.supervisorIds[0]]))
    await click(byText("Save location")!)
    expect(m.updateLocation).toHaveBeenCalledTimes(1) // the details were saved: not sent again on the old version
    expect(m.setLocationSupervisors).toHaveBeenLastCalledWith(LID, ["u-ann", locationDto.supervisorIds[0]])
    await waitTick()
    await typeInto(field("lf-contact"), "01 888")
    m.updateLocation.mockResolvedValueOnce(ok({ ...loc, version: 3, contact: "01 888" }))
    await click(byText("Save location")!)
    expect(m.updateLocation).toHaveBeenLastCalledWith(LID, { version: 2, contact: "01 888" })
  })

  it("I2: a shift type PATCH saved but its targets refused: the next Save sends only the targets, never the old version again", async () => {
    await mount(createElement(LocationFormPage, { location: loc, shiftTypes: [toShiftType(shiftTypeDto)], people, truncated: false }))
    await typeInto(field(`${STID}-break`), "45")
    await typeInto(byLabel("Night Fri") as HTMLInputElement, "3")
    m.updateShiftType.mockResolvedValueOnce(ok(toShiftType({ ...shiftTypeDto, unpaidBreakMin: 45, version: 2 })))
    m.setShiftTypeTargets.mockResolvedValueOnce(fail(422, "invalid_targets"))
    await click(inCard("Night", "Save")!)
    expect(card("Night").querySelector(".rl-err")?.textContent).toBeTruthy()
    await waitTick()
    m.setShiftTypeTargets.mockResolvedValueOnce(ok(toShiftType({ ...shiftTypeDto, unpaidBreakMin: 45, targets: [{ weekday: 1, count: 2 }, { weekday: 5, count: 3 }], version: 3 })))
    await click(inCard("Night", "Save")!)
    expect(m.updateShiftType).toHaveBeenCalledTimes(1)
    expect(m.setShiftTypeTargets).toHaveBeenCalledTimes(2)
    expect(m.toast.error).not.toHaveBeenCalledWith("Changed by someone else.")
  })

  it("m3 (Task 23 review): a successful targets PUT moves the card on to its answer, so the next Save sends that version and no targets again", async () => {
    await mount(createElement(LocationFormPage, { location: loc, shiftTypes: [toShiftType(shiftTypeDto)], people, truncated: false }))
    await typeInto(byLabel("Night Fri") as HTMLInputElement, "3")
    m.setShiftTypeTargets.mockResolvedValueOnce(ok(toShiftType({ ...shiftTypeDto, targets: [{ weekday: 1, count: 2 }, { weekday: 5, count: 3 }], version: 2 })))
    await click(inCard("Night", "Save")!)
    expect(m.updateShiftType).not.toHaveBeenCalled() // only the targets changed
    await waitTick()
    await typeInto(field(`${STID}-break`), "45")
    m.updateShiftType.mockResolvedValueOnce(ok(toShiftType({ ...shiftTypeDto, unpaidBreakMin: 45, targets: [{ weekday: 1, count: 2 }, { weekday: 5, count: 3 }], version: 3 })))
    await click(inCard("Night", "Save")!)
    expect(m.updateShiftType).toHaveBeenLastCalledWith(STID, { version: 2, unpaidBreakMin: 45 }) // the targets PUT's version, not the stale 1
    expect(m.setShiftTypeTargets).toHaveBeenCalledTimes(1)
  })

  it("I3: a new type created but its targets refused becomes the saved type (Archive, no Remove); saving again sends the targets, never a second create", async () => {
    await mount(createElement(LocationFormPage, { location: loc, shiftTypes: [], people, truncated: false }))
    await click(byText("Add")!)
    await typeInto(byLabel("New shift type")!.querySelector<HTMLInputElement>('input[placeholder="Night"]')!, "Early")
    await typeInto(byLabel("New shift type")!.querySelector<HTMLInputElement>('input[placeholder="Security officer"]')!, "Porter")
    await typeInto(byLabel("New shift type Mon") as HTMLInputElement, "2")
    const created = toShiftType({ ...shiftTypeDto, id: "st-new", name: "Early", role: "Porter", start: "09:00", end: "17:00", requires: [], targets: [], version: 1 })
    m.createShiftType.mockResolvedValueOnce(ok(created))
    m.setShiftTypeTargets.mockResolvedValueOnce(fail(422, "invalid_targets"))
    await click(inCard("New shift type", "Add")!)
    expect(m.createShiftType).toHaveBeenCalledTimes(1)
    expect(byLabel("Remove New shift type")).toBeNull()
    expect(byLabel("Remove Early")).toBeNull()
    expect(byLabel("Archive Early")).not.toBeNull() // it exists on the API now
    expect(card("Early").querySelector(".rl-err")?.textContent).toBeTruthy() // the short error stays
    expect((byLabel("Early Mon") as HTMLInputElement).value).toBe("2") // the unsaved target is kept
    await waitTick()
    m.setShiftTypeTargets.mockResolvedValueOnce(ok({ ...created, targets: [{ weekday: 1, count: 2 }], version: 2 }))
    await click(inCard("Early", "Save")!)
    expect(m.createShiftType).toHaveBeenCalledTimes(1)
    expect(m.setShiftTypeTargets).toHaveBeenLastCalledWith("st-new", [{ weekday: 1, count: 2 }])
  })

  it("m6: a 409 on a shift type keeps my edit and shows the conflict; Keep mine saves only my change on their version", async () => {
    const night = toShiftType(shiftTypeDto)
    await mount(createElement(LocationFormPage, { location: loc, shiftTypes: [night], people, truncated: false }))
    await typeInto(field(`${STID}-break`), "45")
    m.updateShiftType.mockResolvedValueOnce(fail(409, "version_conflict"))
    await click(inCard("Night", "Save")!)
    expect(m.refresh).toHaveBeenCalled()
    // the refresh brings their copy (they renamed it): my edit must survive the new props
    await rerender(createElement(LocationFormPage, { location: loc, shiftTypes: [{ ...night, name: "Late", version: 2 }], people, truncated: false }))
    expect(field(`${STID}-break`).value).toBe("45")
    expect(card("Night").textContent).toContain("Changed by someone else")
    expect(inCard("Night", "Save")!.disabled).toBe(true)
    await click(inCard("Night", "Keep mine")!)
    expect(field(`${STID}-name`).value).toBe("Late")
    m.updateShiftType.mockResolvedValueOnce(ok({ ...night, name: "Late", unpaidBreakMin: 45, version: 3 }))
    await click(inCard("Late", "Save")!)
    expect(m.updateShiftType).toHaveBeenLastCalledWith(STID, { version: 2, unpaidBreakMin: 45 })
  })
})

describe("licence editor (B8 Task 22)", () => {
  it("qualifications editor shows expiry state (expired, due soon) from the API, never from the dates", async () => {
    await mount(createElement(LocationsView, { locations: [loc], people, truncated: false, today: "2026-11-19" }))
    m.readQualifications.mockResolvedValueOnce(ok([
      { type: "SIA licence", expiresOn: "2026-11-30", expired: false, dueSoon: true }, // a key stored before the lower-case rule keeps its case: still the same row
      { type: "first aid", expiresOn: "2030-01-01", expired: true, dueSoon: false }, // the API says expired: the far date does not matter
      { type: "manual handling", expiresOn: "2020-01-01", expired: false, dueSoon: false }, // and valid here, whatever the date says
      { type: "induction", expiresOn: null, expired: false, dueSoon: false },
    ]))
    await choose(byLabel("Person") as HTMLSelectElement, "u-ann")
    await flush()
    expect(m.readQualifications).toHaveBeenCalledWith("u-ann")
    const pills = [...document.querySelectorAll(".rl-lic-row .st")].map((p) => p.textContent)
    expect(pills).toEqual(["Due soon", "Expired", "Valid", "No expiry"])
    expect(text()).toContain("1 expired · 1 due")
    expect(byText("Save")!.disabled).toBe(true) // nothing edited yet
    await typeInto(byLabel("Licence 1") as HTMLInputElement, "SIA door licence")
    expect([...document.querySelectorAll(".rl-lic-row .st")][0]?.textContent).toBe("Unsaved") // an edited row has no verdict until the API answers
    m.setQualifications.mockResolvedValueOnce(fail(422, "invalid_qualification"))
    await click(byText("Save")!)
    expect(m.setQualifications).toHaveBeenCalledWith("u-ann", [{ type: "SIA door licence", expiresOn: "2026-11-30" }, { type: "first aid", expiresOn: "2030-01-01" }, { type: "manual handling", expiresOn: "2020-01-01" }, { type: "induction", expiresOn: null }])
    expect(document.querySelector(".rl-err")?.textContent).toBeTruthy()
  })

  it("the list names only visible supervisors and counts the rest", async () => {
    await mount(createElement(LocationsView, { locations: [{ ...loc, supervisorIds: ["u-ann", "x-hidden"] }], people, truncated: false, today: "2026-11-19" }))
    expect(document.querySelector(".rl-sups")?.textContent).toBe("Ann Byrne, +1")
  })
})

// ------------------------------------------------------------------------------------------------------------------------------- My roster
const shift = (o: Partial<MineShift>): MineShift => ({ ...(mineShiftDto as unknown as MineShift), ...o })
const mineOf = (shifts: MineShift[], leave: ApiLeave[] = []): MyRoster => ({ from: "2026-10-22", to: "2027-02-17", shifts, truncated: false, availability: [], leave, access: { level: null, canEdit: false, locked: false, lockReason: "forbidden" } })
const NOW = "2026-11-19T09:00:00.000Z"
const props = (o: Partial<MyRosterProps> = {}): MyRosterProps => ({ mine: mineOf([]), queue: [], names: {}, exchanges: [], people: null, peopleTruncated: false, me: "me", today: "2026-11-19T09:00:00", nowAt: NOW, ...o })
const coppers = shift({ id: "s1", date: "2026-11-20", startAt: "2026-11-20T08:00:00.000Z", endAt: "2026-11-20T16:00:00.000Z", locationId: "L1", locationName: "Coppers" })
const docklands = shift({ id: "s2", date: "2026-11-21", startAt: "2026-11-21T22:00:00.000Z", endAt: "2026-11-22T06:00:00.000Z", start: "22:00", end: "06:00", locationId: "L2", locationName: "Docklands" })

describe("My roster (B8 Task 22)", () => {
  it("My roster combines shifts across locations and confirms through the action; confirmed state survives reload", async () => {
    await mount(createElement(MyRosterView, props({ mine: mineOf([coppers, docklands]) })))
    await click(byText("Shifts · 2")!)
    expect([...document.querySelectorAll(".mr-where .rl-note")].map((e) => e.textContent)).toEqual(["Coppers", "Docklands"]) // one list, two sites
    m.confirmShift.mockResolvedValueOnce(ok({ id: "s1", confirmedAt: "2026-11-19T09:01:00.000Z" }))
    await click(byLabel("Confirm Fri 20 Nov")!)
    expect(m.confirmShift).toHaveBeenCalledWith("s1")
    expect(document.querySelectorAll(".mr-tile b.num")[0]?.textContent).toMatch(/^1+$/) // To confirm: 2 -> 1 (CountUp draws its value twice: visible and for screen readers; the button crossfades to the pill)
    expect(m.refresh).toHaveBeenCalled()
    // the reload: the API's payload now carries confirmedAt; a fresh page shows it confirmed with no local state at all
    await act(async () => { root!.unmount() })
    root = createRoot(host!)
    await rerender(createElement(MyRosterView, props({ mine: mineOf([{ ...coppers, confirmedAt: "2026-11-19T09:01:00.000Z" }, docklands]) })))
    await click(byText("Shifts · 2")!)
    expect(byLabel("Confirm Fri 20 Nov")).toBeNull()
    expect(byLabel("Confirm Sat 21 Nov")).not.toBeNull()
    expect(document.querySelectorAll(".mr-shift .st").length).toBe(1) // one Confirmed pill
  })

  it("m4: a confirmation made here never outlives the server's confirmedAt (the office cleared it: Confirm again)", async () => {
    await mount(createElement(MyRosterView, props({ mine: mineOf([coppers]) })))
    await click(byText("Shifts · 1")!)
    m.confirmShift.mockResolvedValueOnce(ok({ id: "s1", confirmedAt: "2026-11-19T09:01:00.000Z" }))
    await click(byLabel("Confirm Fri 20 Nov")!)
    expect(document.querySelectorAll(".mr-tile b.num")[0]?.textContent).toMatch(/^0+$/) // To confirm: 1 -> 0
    // a later refresh: the API says not confirmed (an office edit cleared it): the server wins
    await rerender(createElement(MyRosterView, props({ mine: mineOf([{ ...coppers, confirmedAt: null }]) })))
    await flush()
    expect(document.querySelectorAll(".mr-tile b.num")[0]?.textContent).toMatch(/^1+$/)
    expect(byLabel("Confirm Fri 20 Nov")).not.toBeNull()
  })

  it("a refused confirm stays unconfirmed with a short toast", async () => {
    await mount(createElement(MyRosterView, props({ mine: mineOf([coppers]) })))
    await click(byText("Shifts · 1")!)
    m.confirmShift.mockResolvedValueOnce(fail(409, "week_not_published"))
    await click(byLabel("Confirm Fri 20 Nov")!)
    expect(byLabel("Confirm Fri 20 Nov")).not.toBeNull()
    expect(m.toast.error).toHaveBeenCalledWith("Only a published week has open shifts to claim.")
  })

  it("the download button fetches mine.ics through the BFF and the browser receives an attachment (the page asks the download helper for the shown range)", async () => {
    m.download.mockResolvedValueOnce({ ok: true, filename: "roster.ics" })
    await mount(createElement(MyRosterView, props({ mine: mineOf([coppers]) })))
    await click(byText("Add to calendar")!)
    expect(m.download).toHaveBeenCalledWith({ from: "2026-11-19", to: "2027-02-17" })
  })

  it("availability and leave forms submit and show server errors short", async () => {
    await mount(createElement(MyRosterView, props({ mine: { ...mineOf([coppers]), availability: [{ personId: "me", weekday: 1, from: "09:00", to: "12:00" }] } })))
    await click(byText("Time off")!)
    // leave: the dates and type go to the action; the API's overlap refusal is one short line
    await typeInto(byLabel("From") as HTMLInputElement, "2026-12-01")
    await typeInto(byLabel("To") as HTMLInputElement, "2026-12-03")
    await click(byText("Sick")!)
    m.createLeave.mockResolvedValueOnce(fail(409, "leave_overlap"))
    await click(byText("Request leave")!)
    expect(m.createLeave).toHaveBeenCalledWith({ from: "2026-12-01", to: "2026-12-03", kind: "sick" })
    expect([...document.querySelectorAll(".rl-err")].map((e) => e.textContent)).toEqual(["You already have leave on those days."])
    // availability: the whole set goes out (what is on record plus the new window); a refusal is one short line
    await click(byText("Wed")!)
    m.setAvailability.mockResolvedValueOnce(fail(422, "invalid_availability"))
    await click(byText("Add window")!)
    expect(m.setAvailability).toHaveBeenCalledWith([{ weekday: 1, from: "09:00", to: "12:00" }, { weekday: 3, from: "09:00", to: "17:00" }])
    expect([...document.querySelectorAll(".rl-err")].map((e) => e.textContent)).toContain("Check the times of that window.")
    m.setAvailability.mockResolvedValueOnce(ok(1))
    await click(byLabel("Remove Mon 09:00 window")!)
    expect(m.setAvailability).toHaveBeenLastCalledWith([])
  })

  it("leave approval buttons only for approvers; own leave never shows Approve", async () => {
    const own = { ...toLeave(leaveDto), id: "l-own", personId: "me" }
    const theirs = { ...toLeave(leaveDto), id: "l-ann", personId: "u-ann", from: "2026-12-02" }
    // staff: the API lists only their own request
    await mount(createElement(MyRosterView, props({ queue: [own], mine: mineOf([], [own]) })))
    await click(byText("Time off")!)
    expect(buttons().filter((b) => /^(Approve|Reject)/.test(b.getAttribute("aria-label") ?? ""))).toEqual([])
    expect(text()).not.toContain("Leave to decide")
    await act(async () => { root!.unmount() })
    root = createRoot(host!)
    // an approver: the API lists their own request too, but only the other person's has buttons
    await rerender(createElement(MyRosterView, props({ queue: [own, theirs], names: { "u-ann": "Ann Byrne" }, mine: mineOf([], [own]) })))
    await click(byText("Time off · 1")!)
    expect(buttons().map((b) => b.getAttribute("aria-label")).filter((l) => /^(Approve|Reject)/.test(l ?? ""))).toEqual(["Approve Ann Byrne", "Reject Ann Byrne"])
    m.decideLeave.mockResolvedValueOnce(ok(theirs))
    await click(byLabel("Approve Ann Byrne")!)
    expect(m.decideLeave).toHaveBeenCalledWith("l-ann", { decision: "approve" })
  })

  it("own claims and swaps can be cancelled, a swap offered to me declined; the swap dialog lists only the API's people", async () => {
    const claim = { ...toExchange(exchangeDto), id: "x1", fromUserId: "me" }
    const offered = { ...toExchange(exchangeDto), id: "x2", kind: "swap" as const, fromUserId: "u-ben", toUserId: "me" }
    await mount(createElement(MyRosterView, props({ mine: mineOf([coppers]), exchanges: [claim, offered], people: [{ id: "u-ann", name: "Ann Byrne" }, { id: "me", name: "Me" }] })))
    await click(byText("Shifts · 1")!)
    m.cancelExchange.mockResolvedValueOnce(ok(claim))
    await click(byLabel("Cancel Mon 23 Nov")!)
    expect(m.cancelExchange).toHaveBeenCalledWith("x1")
    m.declineExchange.mockResolvedValueOnce(ok(offered))
    await click(byLabel("Decline Mon 23 Nov")!)
    expect(m.declineExchange).toHaveBeenCalledWith("x2")
    await click(byLabel("Swap Fri 20 Nov")!)
    const select = document.querySelector<HTMLSelectElement>('select[aria-label="Give it to"]')
    expect([...select!.options].map((o) => o.textContent).filter((t) => t !== "Choose a person")).toEqual(["Ann Byrne"]) // never yourself
  })
})
