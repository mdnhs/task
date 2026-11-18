import { describe, expect, it } from "vitest"

import { PLATFORM_QUICK_ACTIONS, buildPlatformIndex, platformQuickActions, type PlatformSearchSources } from "./search-index"
import type { StaffMember } from "./types"

const op = (role: StaffMember["role"]): StaffMember => ({ id: "s", name: "S", email: "s@x", role, mfa: true, lastSignInAt: null, status: "active" })
const src: PlatformSearchSources = {
  pages: [{ href: "/platform", label: "Overview" }, { href: "/platform/audit", label: "Audit log", section: "Trust" }, { href: "/platform/team", label: "Team", section: "Admin" }],
  tenants: [{ id: "t1", name: "Acme", slug: "acme", plan: "Business", status: "active", createdAt: "2026-01-01T00:00:00Z" }, { id: "t2", name: "Gone", slug: "gone", plan: "", status: "suspended", createdAt: "2026-01-01T00:00:00Z" }],
}

describe("platformQuickActions", () => {
  it("keeps only the actions whose page the role may open", () => {
    expect(platformQuickActions(op("owner")).map((a) => a.id)).toEqual(PLATFORM_QUICK_ACTIONS.map((a) => a.id))
    expect(platformQuickActions(op("billing")).map((a) => a.id)).not.toContain("support")
  })
})

describe("buildPlatformIndex", () => {
  it("gives the owner pages, tenants and a support action per live tenant", () => {
    const items = buildPlatformIndex(src, op("owner"))
    expect(new Set(items.map((i) => i.type))).toEqual(new Set(["page", "tenant", "action"]))
    expect(items.filter((i) => i.type === "action").map((i) => i.title)).toEqual(["Request support access for Acme"])
  })
  it("indexes tenants by name and links to the tenant page", () => {
    expect(buildPlatformIndex(src, op("viewer")).find((i) => i.type === "tenant")).toMatchObject({ title: "Acme", ref: "acme", href: "/platform/tenants/t1" })
  })
  it("a role only gets pages it may open, and no support action without support.request", () => {
    const items = buildPlatformIndex(src, op("viewer"))
    expect(items.filter((i) => i.type === "page").map((i) => i.href)).toEqual(["/platform", "/platform/audit"])
    expect(items.some((i) => i.type === "action")).toBe(false)
  })
})
