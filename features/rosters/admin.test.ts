import { describe, expect, it } from "vitest"
import { toLocation, toShiftType } from "./adapters"
import { locationDto, shiftTypeDto } from "./fixtures"
import {
  createBody, draftOf, formOf, patchBody, qualBody, qualState, saveIds, supervisorChoice, targetsBody, typeAction, typePatchBody, validateLocation, validateQuals, validateType,
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
