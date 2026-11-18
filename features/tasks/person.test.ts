import { describe, expect, test } from "vitest"
import { personOf } from "./person"
import type { Person } from "./types"

const ann: Person = { id: "u-1", name: "Ann Byrne", initials: "AB", avatar: "av2", role: "Employee", dept: "Cleaning" }

describe("personOf", () => {
  test("a person the caller can see is returned as is", () => {
    expect(personOf(new Map([[ann.id, ann]]), "u-1")).toBe(ann)
  })
  test("an out-of-scope person reads as Member, never the raw id", () => {
    const p = personOf(new Map(), "UrQ2ac12C87NDL579QRlgEuqUramxuLN")
    expect(p.name).toBe("Member")
    expect(JSON.stringify(p.name)).not.toContain("UrQ2")
    expect(p.id).toBe("UrQ2ac12C87NDL579QRlgEuqUramxuLN")
  })
})
