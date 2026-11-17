import { describe, expect, test } from "vitest"
import { fakeApi } from "@/test/support/fake-api"
import { avatarFor, loadPeople, toPerson } from "./people"

const dto = (over: Partial<{ userId: string; name: string; email: string; roleKey: string; managerId: string | null }> = {}) => ({ userId: "usr_1", name: "Grace Mensah", email: "grace@demo.example", roleKey: "employee", managerId: null, ...over })
const ctx = { roleLabel: (k: string): string | undefined => ({ employee: "Employee", manager: "Team Manager" })[k as "employee"], departmentOf: (id: string) => ({ usr_1: "Cleaning" })[id] ?? "" }

describe("T6.4 toPerson maps /v1/people", () => {
  test("id is the user id, role is the role LABEL, dept comes from the team, initials from the name", () => {
    expect(toPerson(dto(), ctx)).toEqual({ id: "usr_1", name: "Grace Mensah", role: "Employee", initials: "GM", avatar: avatarFor("usr_1"), dept: "Cleaning" })
  })

  test("the avatar is stable for the same id, always av1..av6, and spreads across ids", () => {
    expect(avatarFor("usr_1")).toBe(avatarFor("usr_1"))
    const seen = new Set(Array.from({ length: 60 }, (_, i) => avatarFor(`user-${i}`)))
    for (const a of seen) expect(a).toMatch(/^av[1-6]$/)
    expect(seen.size).toBeGreaterThan(3)
  })

  test("a person with no name falls back to the email local part (and its initials)", () => {
    const p = toPerson(dto({ name: "  ", email: "sam.jones@demo.example" }), ctx)
    expect(p.name).toBe("sam.jones")
    expect(p.initials).toBe("S")
  })

  test("an erased person (anonymised name or address) shows as Former member", () => {
    expect(toPerson(dto({ name: "Erased user", email: "erased+9f2c@invalid" }), ctx).name).toBe("Former member")
    expect(toPerson(dto({ name: "Anyone", email: "erased+9f2c@invalid" }), ctx).name).toBe("Former member")
    expect(toPerson(dto({ name: "Erased user", email: "erased+9f2c@invalid" }), ctx).initials).toBe("FM")
  })

  test("a role key with no label falls back to a readable form of the key, and a person in no department has an empty dept", () => {
    const p = toPerson(dto({ userId: "usr_9", roleKey: "night_lead" }), ctx)
    expect(p.role).toBe("Night lead")
    expect(p.dept).toBe("")
  })
})

describe("T6.4 loadPeople", () => {
  test("reads /v1/people and the department teams only (both open to any member with reports:read), departments by membership", async () => {
    const { client, paths } = fakeApi({
      "GET /v1/people": [dto(), dto({ userId: "usr_2", name: "Daniel Okafor", email: "d@demo.example", roleKey: "manager" })],
      "GET /v1/teams": [{ id: "d1", name: "Cleaning", kind: "department", memberIds: ["usr_1"] }, { id: "d2", name: "Security", kind: "department", memberIds: ["usr_2"] }],
    })
    const people = await loadPeople(client, (k) => ({ employee: "Employee", manager: "Team Manager" })[k])
    expect(people.map((p) => [p.id, p.role, p.dept])).toEqual([["usr_1", "Employee", "Cleaning"], ["usr_2", "Team Manager", "Security"]])
    expect(paths().sort()).toEqual(["GET /v1/people", "GET /v1/teams"])
  })
})
