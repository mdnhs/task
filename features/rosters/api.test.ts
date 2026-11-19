import { describe, expect, it } from "vitest"
import type { RosterAccess } from "@/lib/roster-access"
import type { WorkforceMember } from "@/lib/workforce"
import { getLeaveQueue, getLocationAdminData, getRosterHistory, scopedMembers } from "./api"

// The mock readers that remain (My roster, the Locations admin) until Tasks 22/23 move them to the API. The week view reads the API only (view.test.ts, editor.test.ts).

const ALL = ["loc-coppers", "loc-docklands", "loc-liffey"]
const manager: RosterAccess = { scope: "all", locationIds: ["loc-coppers", "loc-docklands"], editDraft: true, editPublished: true, approve: true } // p-priya, except loc-liffey
const supervisorAccess: RosterAccess = { scope: "locations", locationIds: ["loc-coppers"], editDraft: true, editPublished: false, approve: false }

describe("an office role with an except (p-priya, except loc-liffey)", () => {
  it("the locations admin payload is cut the same way and carries the history of visible locations", async () => {
    const a = await getLocationAdminData(manager)
    expect(JSON.stringify(a)).not.toContain("loc-liffey")
    expect(a.members.map((m) => m.id)).not.toContain("s-grant")
    expect(a.history.every((h) => h.locationId !== "loc-liffey")).toBe(true)
    expect(a.history).toEqual(await getRosterHistory(manager))
  })
  it("the leave queue and its names hold nobody homed at the excepted site", async () => {
    const q = await getLeaveQueue(manager, "p-priya")
    expect(q.leave.some((l) => l.personId === "s-bell")).toBe(false) // lv-002
    expect(Object.keys(q.names)).not.toContain("s-bell")
    expect(Object.values(q.names).join()).not.toContain("Marcus Bell")
    expect(q.leave.map((l) => l.personId)).toContain("s-haddad") // home Coppers
    const everyone = await getLeaveQueue({ ...manager, locationIds: ALL }, "p-priya")
    expect(everyone.leave.map((l) => l.id)).toContain("lv-002")
  })
})

describe("getLocationAdminData", () => {
  it("the locations payload is empty unless the role edits published weeks", async () => {
    const e = await getLocationAdminData(supervisorAccess)
    expect(e).toEqual({ locations: [], templates: [], targets: [], shifts: [], grants: [], members: [], skills: [], history: [] })
    const full = await getLocationAdminData({ ...manager, locationIds: ALL })
    expect(full.locations.map((l) => l.id).sort()).toEqual([...ALL].sort())
  })
})

describe("a leaver on past shifts keeps their name", () => {
  const gone: WorkforceMember = { id: "gone", name: "Pat Leaver", role: "Guard", dept: "Sec", homeLocationId: "L", qualifications: [], leftOn: "2026-10-10" }
  const other: WorkforceMember = { id: "x", name: "Else Where", role: "Guard", dept: "Sec", homeLocationId: "M", qualifications: [], leftOn: null }
  const shift = { id: "s1", weekId: "w", locationId: "L", date: "2026-10-06", personId: "gone", templateId: "t", role: "Guard", start: "09:00", end: "17:00", unpaidBreakMin: 0, confirmedAt: null }
  it("scopedMembers keeps someone on a shift even when they have left, and drops the unrelated", () => {
    const m = scopedMembers([gone, other], [shift], [])
    expect(m.map((x) => x.id)).toEqual(["gone"])
  })
})
