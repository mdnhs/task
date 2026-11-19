import { describe, expect, it } from "vitest"
import { toLocation, toShiftType } from "./adapters"
import { locationDto, shiftTypeDto } from "./fixtures"
import {
  createBody, draftOf, formOf, keepMine, keepMineSet, patchBody, qualBody, qualState, saveIds, supervisorChoice, targetsBody, typeAction, typePatchBody, validateLocation, validateQuals, validateType,
} from "./admin"

// B8 Task 22: the locations admin helpers on the API's shapes.
const loc = toLocation(locationDto)
const type = toShiftType(shiftTypeDto)

describe("location form", () => {
  it("opens on the API's values and sends only what changed, with the version it was opened on", () => {
    const f = formOf(loc)
    expect(f).toMatchObject({ name: "Harbour Street", lat: "53.3498", radius: "150", timeZone: "", delegated: false })
    expect(f.hours.mon).toBe("08:00-22:00")
    expect(patchBody(f, loc, loc.version)).toBeNull() // nothing changed: no PATCH at all
    expect(patchBody({ ...f, contact: "01 222", delegated: true }, loc, 4)).toEqual({ version: 4, contact: "01 222", swapApprovalDelegated: true })
    expect(patchBody({ ...f, hours: { ...f.hours, tue: "09:00-17:00" } }, loc, 1)).toEqual({ version: 1, openingHours: { mon: "08:00-22:00", tue: "09:00-17:00" } })
  })
  it("an unchanged Save sends no openingHours when the API's jsonb key order differs from the form's (Task 23 review I1)", () => {
    // jsonb orders keys by length, then bytes (all, fri, mon, sat, sun, ...); the form builds mon..sun. Same content = no change.
    const jsonb = { ...loc, openingHours: { all: "x", fri: "08:00-20:00", sun: "10:00-18:00", mon: "08:00-22:00", sat: "09:00-18:00" } }
    expect(patchBody(formOf(jsonb), jsonb, 2)).toBeNull()
    const f = formOf(jsonb)
    expect(patchBody({ ...f, contact: "01 9" }, jsonb, 2)).toEqual({ version: 2, contact: "01 9" }) // another field changed: hours stay out of the PATCH
    expect(patchBody({ ...f, hours: { ...f.hours, sun: "" } }, jsonb, 2)).toMatchObject({ openingHours: { all: "x", mon: "08:00-22:00", fri: "08:00-20:00", sat: "09:00-18:00" } })
  })
  it("keeps opening-hour keys the form does not show, and sends null for a cleared point or zone", () => {
    const odd = { ...loc, openingHours: { all: "Mon-Sun 24h" } }
    expect(patchBody({ ...formOf(odd), lat: "", lng: "", timeZone: "" }, odd, 1)).toEqual({ version: 1, lat: null, lng: null })
    expect(createBody({ ...formOf(), name: " New ", timeZone: "Europe/Dublin" })).toMatchObject({ name: "New", timeZone: "Europe/Dublin", zoneRadiusM: 150, lat: null })
  })
  it("checks what the API would refuse: a name, both coordinates or neither, a radius of 0..5000, a zone name", () => {
    const f = formOf()
    expect(validateLocation(f)).toEqual({ name: "Enter a name" })
    expect(validateLocation({ ...f, name: "A", lat: "53" })).toEqual({ lng: "Add both or neither" })
    expect(validateLocation({ ...f, name: "A", lat: "91", lng: "0", radius: "6000", timeZone: "dublin" })).toEqual({ lat: "-90 to 90", radius: "0 to 5000 m", timeZone: "e.g. Europe/Dublin" })
  })
})

describe("Keep mine after a conflict (Task 22 review I1): a three-way merge", () => {
  it("a field I changed keeps my value; a field I did not touch takes theirs (per opening-hours day too), so their edit is never sent back over", () => {
    const base = formOf(loc)
    const mine = { ...base, address: "1 Quay St", hours: { ...base.hours, tue: "09:00-17:00" } }
    const theirs = { ...base, contact: "their phone", name: "Harbour St", hours: { ...base.hours, mon: "07:00-23:00" } }
    const merged = keepMine(mine, base, theirs)
    expect(merged).toEqual({ ...theirs, address: "1 Quay St", hours: { ...theirs.hours, tue: "09:00-17:00" } })
    const theirLoc = { ...loc, version: 3, contact: "their phone", name: "Harbour St", openingHours: { mon: "07:00-23:00" } }
    expect(patchBody(merged, theirLoc, 3)).toEqual({ version: 3, address: "1 Quay St", openingHours: { mon: "07:00-23:00", tue: "09:00-17:00" } }) // only my edits
  })
  it("works on a shift type draft too (targets per weekday, skills as one value)", () => {
    const base = draftOf(type)
    const merged = keepMine({ ...base, breakMin: "45", targets: { ...base.targets, 5: "3" } }, base, { ...base, name: "Late", targets: { ...base.targets, 1: "4" } })
    expect(merged).toMatchObject({ name: "Late", breakMin: "45", requires: base.requires })
    expect(merged.targets).toMatchObject({ 1: "4", 5: "3" })
  })
  it("a set merges by what I added and removed", () => {
    expect(keepMineSet(["a", "c"], ["a", "b"], ["a", "b", "d"]).sort()).toEqual(["a", "c", "d"]) // I added c and removed b; they added d
    expect(keepMineSet(["a"], ["a"], ["d"])).toEqual(["d"]) // I changed nothing: theirs
  })
})

describe("supervisor grants", () => {
  it("lists only the people the API gave this caller; a supervisor out of reach is counted, never named, and kept on save", () => {
    const members = [{ id: "u1", name: "Ann", active: true, homeLocationId: null }, { id: "u2", name: "Ben", active: false, homeLocationId: null }]
    const c = supervisorChoice(members, ["u1", "hidden-1"])
    expect(c.people).toEqual([{ id: "u1", name: "Ann" }]) // an inactive person is not offered
    expect(c.hidden).toEqual(["hidden-1"])
    expect(JSON.stringify(c.people)).not.toContain("hidden-1")
    expect(saveIds(["u1"], c.hidden)).toEqual(["u1", "hidden-1"])
  })
})

describe("shift types", () => {
  it("a saved type shows Archive, never Delete (the API archives); an archived one offers nothing; only an unsaved card can be removed", () => {
    expect(typeAction(type)).toBe("archive")
    expect(typeAction({ ...type, archived: true })).toBe("none")
    expect(typeAction(undefined)).toBe("remove")
  })
  it("patches with the type's version and only the changed fields; targets are a separate whole set", () => {
    const d = draftOf(type)
    expect(d.targets[1]).toBe("2")
    expect(typePatchBody(d, type)).toBeNull()
    expect(targetsBody(d, type)).toBeNull()
    expect(typePatchBody({ ...d, end: "07:00" }, type)).toEqual({ version: 1, end: "07:00" })
    expect(targetsBody({ ...d, targets: { ...d.targets, 1: "", 5: "3" } }, type)).toEqual([{ weekday: 5, count: 3 }])
    expect(validateType({ ...d, name: "" })).toBe("Name and role")
    expect(validateType({ ...d, start: "08:00", end: "08:00" })).toBe("Start and end differ")
  })
})

describe("licences", () => {
  it("the expiry state is the API's flags only: a past date the API calls valid stays valid", () => {
    expect(qualState({ type: "a", expiresOn: "2020-01-01", expired: false, dueSoon: false })).toBe("valid")
    expect(qualState({ type: "a", expiresOn: "2099-01-01", expired: true, dueSoon: false })).toBe("expired")
    expect(qualState({ type: "a", expiresOn: "2099-01-01", expired: false, dueSoon: true })).toBe("due")
    expect(qualState({ type: "a", expiresOn: null, expired: false, dueSoon: false })).toBe("open")
  })
  it("rows are named, unique by key (case-insensitive) and sent with null for no expiry", () => {
    expect(validateQuals([{ type: "SIA", expiresOn: "" }, { type: "sia", expiresOn: "" }])).toBe("Each licence once")
    expect(validateQuals([{ type: " ", expiresOn: "" }])).toBe("Name every licence")
    expect(qualBody([{ type: " First aid ", expiresOn: "" }])).toEqual([{ type: "First aid", expiresOn: null }])
  })
})
