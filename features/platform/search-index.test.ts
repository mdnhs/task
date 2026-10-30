import { describe, expect, it } from "vitest"

import { PLATFORM_QUICK_ACTIONS, buildPlatformIndex, platformQuickActions, type PlatformSearchSources } from "./search-index"
import type { DataRequest, Invoice, PlatformTenant, StaffMember } from "./types"

const op = (role: StaffMember["role"]): StaffMember => ({ id: "s", name: "S", email: "s@x", role, mfa: true, lastSignInAt: null, status: "active" })
const tenant = { id: "t1", name: "Acme", slug: "acme", subdomain: "acme.x", plan: "p", status: "active", createdAt: "2026-01-01T00:00:00" } as PlatformTenant
const invoice = { id: "INV-1", tenantId: "t1", number: "OD-1001", issuedAt: "2026-10-01T08:00:00", dueAt: "2026-10-15T08:00:00", amount: 149, currency: "EUR", status: "paid", attempts: 1, nextRetryAt: null, lines: [] } as Invoice
const dsr = { id: "DSR-1", tenantId: "t1", kind: "export", subject: "tenant", requestedBy: "Lil", requestedAt: "2026-10-02T09:00:00", dueAt: "2026-11-01T09:00:00", status: "received", note: "n" } as DataRequest
const src: PlatformSearchSources = {
  pages: [
    { href: "/platform", label: "Overview" },
    { href: "/platform/billing", label: "Billing", section: "Revenue" },
    { href: "/platform/team", label: "Team", section: "Admin" },
  ],
  tenants: [tenant],
  requests: [{ id: "SUP-1", tenantId: "t1", requester: "R", reason: "Fix", status: "requested", requestedAt: "2026-10-20T08:00:00", expiresAt: null, grantedBy: null }],
  staff: [op("support")],
  invoices: [invoice],
  dataRequests: [dsr],
}

describe("platformQuickActions", () => {
  it("keeps only the actions whose page the role may open", () => {
    expect(platformQuickActions(op("owner")).map((a) => a.id)).toEqual(PLATFORM_QUICK_ACTIONS.map((a) => a.id))
    const support = platformQuickActions(op("support")).map((a) => a.href)
    expect(support.every((h) => !h.startsWith("/platform/billing") && !h.startsWith("/platform/plans"))).toBe(true)
    expect(support.length).toBeGreaterThan(0)
  })
})

describe("buildPlatformIndex", () => {
  it("gives the owner every kind of row", () => {
    const types = new Set(buildPlatformIndex(src, op("owner")).map((i) => i.type))
    expect([...types].sort()).toEqual(["action", "datarequest", "invoice", "member", "page", "support", "tenant"])
  })
  it("indexes tenants by name and links to the tenant page", () => {
    const t = buildPlatformIndex(src, op("viewer")).find((i) => i.type === "tenant")
    expect(t).toMatchObject({ title: "Acme", ref: "acme.x", href: "/platform/tenants/t1" })
  })
  it("makes tenants findable by slug and id without showing them", () => {
    const t = buildPlatformIndex(src, op("viewer")).find((i) => i.type === "tenant")!
    expect(t.keywords?.split(" ")).toEqual(expect.arrayContaining(["acme", "t1"]))
  })
  it("indexes invoices by number only for roles with billing.read", () => {
    const inv = buildPlatformIndex(src, op("billing")).find((i) => i.type === "invoice")
    expect(inv).toMatchObject({ ref: "OD-1001", keywords: "INV-1", href: "/platform/billing?q=OD-1001", status: "paid" })
    expect(inv?.title).toContain("Acme")
    for (const r of ["support", "viewer"] as const) {
      // viewer has billing.read; support does not.
      const has = buildPlatformIndex(src, op(r)).some((i) => i.type === "invoice")
      expect(has, r).toBe(r === "viewer")
    }
  })
  it("never puts invoice numbers in the index of a role without billing.read", () => {
    expect(JSON.stringify(buildPlatformIndex(src, op("support")))).not.toContain("OD-1001")
  })
  it("indexes data requests for roles that handle them", () => {
    const d = buildPlatformIndex(src, op("support")).find((i) => i.type === "datarequest")
    expect(d).toMatchObject({ ref: "DSR-1", href: "/platform/data-requests?view=all&q=DSR-1", status: "received" })
    expect(buildPlatformIndex(src, op("billing")).some((i) => i.type === "datarequest")).toBe(false)
  })
  it("offers 'Request support access' actions only with support.request", () => {
    const a = buildPlatformIndex(src, op("support")).find((i) => i.type === "action")
    expect(a).toMatchObject({ title: "Request support access for Acme", href: "/platform/support?request=t1" })
    expect(buildPlatformIndex(src, op("viewer")).some((i) => i.type === "action")).toBe(false)
    expect(buildPlatformIndex(src, op("billing")).some((i) => i.type === "action")).toBe(false)
  })
  it("filters rows and pages by staff role", () => {
    const ids = buildPlatformIndex(src, op("support")).map((i) => i.id)
    expect(ids).toContain("support:SUP-1")
    expect(ids).not.toContain("page:/platform/billing")
    expect(ids).not.toContain("page:/platform/team")
    expect(ids.some((i) => i.startsWith("member:"))).toBe(false)
  })
  it("returns nothing for a disabled member", () => {
    expect(buildPlatformIndex(src, { ...op("owner"), status: "disabled" })).toEqual([])
  })
})
