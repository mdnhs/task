import { describe, expect, it } from "vitest"

import {
  addNote, applyCredit, cancelDeletion, changePlan, changeSlug, effectiveStatus, exportRequest, extendTrial, filterAudit, filterTenants, formatLeft, overrideModule, reactivateTenant, scheduleDeletion,
  sensitiveEntry, setCancelAtPeriodEnd, summarize, suspendTenant, tenantMrr, EMPTY_FILTERS, TRIAL_EXTENSION_MAX, isoSeconds, limitLabel, priceLabel,
} from "./logic"
import { planEditPath } from "./constants"
import type { AuditEntry, Plan, PlatformTenant, SubEvent, SupportRequest } from "./types"

const plans: Plan[] = [{ id: "p", name: "P", priceMonthly: 100, currency: "GBP", trialDays: 14, limits: { activeUsers: 1, storageGb: 1, messages: 1, transcriptionMinutes: 1 } }]
const tenant = (over: Partial<PlatformTenant> = {}): PlatformTenant => ({
  id: "t", name: "Acme Ltd", slug: "acme", subdomain: "acme.example.app", plan: "p", status: "active", users: 1, storageGb: 1, messages: 1,
  transcriptionMinutes: 1, createdAt: "2026-01-01T10:00:00", contacts: [], billing: { paymentMethod: "Card", renewsOn: "2026-11-01" }, ...over,
})

describe("mrr and summary", () => {
  it("counts active and past-due tenants only", () => {
    expect(tenantMrr(tenant(), plans)).toBe(100)
    expect(tenantMrr(tenant({ status: "past_due" }), plans)).toBe(100)
    expect(tenantMrr(tenant({ status: "trial" }), plans)).toBe(0)
    expect(tenantMrr(tenant({ status: "suspended" }), plans)).toBe(0)
  })
  it("summarizes", () => {
    const s = summarize([tenant(), tenant({ status: "trial" }), tenant({ status: "past_due" })], plans)
    expect(s).toEqual({ tenants: 3, mrr: 200, trials: 1, pastDue: 1 })
  })
})

describe("filterTenants", () => {
  it("filters by status, plan and search", () => {
    const rows = [tenant(), tenant({ id: "u", name: "Beta", slug: "beta", subdomain: "beta.example.app", status: "trial" })]
    expect(filterTenants(rows, { ...EMPTY_FILTERS, status: "trial" })).toHaveLength(1)
    expect(filterTenants(rows, { ...EMPTY_FILTERS, q: "ACME" })[0].id).toBe("t")
    expect(filterTenants(rows, { ...EMPTY_FILTERS, plan: "x" })).toHaveLength(0)
  })
})

describe("suspend and reactivate", () => {
  it("round-trips the status", () => {
    const s = suspendTenant(tenant(), "2026-10-20T09:00:00", "Non-payment")
    expect(s.status).toBe("suspended")
    const r = reactivateTenant(s)
    expect(r.status).toBe("active")
    expect(r.suspendedAt).toBeUndefined()
  })
  it("resumes a trial that never paid as a trial", () => {
    expect(reactivateTenant(tenant({ status: "suspended", billing: { paymentMethod: "None", trialEndsOn: "2026-11-01" } })).status).toBe("trial")
  })
})

describe("support access expiry", () => {
  const req = (over: Partial<SupportRequest> = {}): SupportRequest => ({ id: "SUP-1", tenantId: "t", requester: "x", reason: "r", status: "granted", requestedAt: "2026-10-20T08:00:00", expiresAt: "2026-10-20T12:00:00", grantedBy: "y", ...over })
  it("turns a lapsed grant into expired", () => {
    expect(effectiveStatus(req(), isoSeconds("2026-10-20T11:59:59"))).toBe("granted")
    expect(effectiveStatus(req(), isoSeconds("2026-10-20T12:00:00"))).toBe("expired")
    expect(effectiveStatus(req({ status: "revoked" }), isoSeconds("2026-10-21T00:00:00"))).toBe("revoked")
  })
  it("formats the time left", () => {
    expect(formatLeft(3 * 3600 + 5 * 60 + 9)).toBe("03:05:09")
    expect(formatLeft(86400 + 60)).toBe("1d 00:01:00")
    expect(formatLeft(0)).toBeNull()
  })
})

describe("plan edit form", () => {
  it("labels price with the plan currency and limits with their unit", () => {
    expect(priceLabel("EUR")).toBe("Price per month (EUR)")
    expect(limitLabel({ label: "Storage", unit: "GB" })).toBe("Storage (GB)")
    expect(limitLabel({ label: "Messages", unit: "" })).toBe("Messages")
  })
  it("builds the edit route", () => {
    expect(planEditPath("business")).toBe("/platform/plans/business/edit")
    expect(planEditPath("a b")).toBe("/platform/plans/a%20b/edit")
  })
})

// ---------- Tenant 360 (Task 5) ----------
const tiers: Plan[] = [
  { id: "starter", name: "Starter", priceMonthly: 49, currency: "EUR", trialDays: 14, limits: { activeUsers: 10, storageGb: 10, messages: 1000, transcriptionMinutes: 120 } },
  { id: "business", name: "Business", priceMonthly: 149, currency: "EUR", trialDays: 14, limits: { activeUsers: 40, storageGb: 50, messages: 5000, transcriptionMinutes: 600 } },
]
const AT = "2026-10-20T09:00:00"
const WHY = "Customer asked by email"

describe("changePlan", () => {
  const events: SubEvent[] = [{ id: "SUB-7", tenantId: "x", at: "2026-01-01T09:00:00", kind: "start", plan: "starter", mrrDelta: 49 }]
  it("an upgrade returns the tenant on the new plan and a positive SubEvent", () => {
    const { tenant: t, event } = changePlan(tenant({ plan: "starter" }), tiers[1], AT, WHY, { plans: tiers, events })
    expect(t.plan).toBe("business")
    expect(event).toEqual({ id: "SUB-8", tenantId: "t", at: AT, kind: "upgrade", plan: "business", mrrDelta: 100 })
  })
  it("a downgrade has a negative delta", () => {
    const { event } = changePlan(tenant({ plan: "business", status: "past_due" }), tiers[0], AT, WHY, { plans: tiers, events })
    expect(event?.kind).toBe("downgrade")
    expect(event?.mrrDelta).toBe(-100)
  })
  it("a trial moves plan without a revenue event", () => {
    const { tenant: t, event } = changePlan(tenant({ plan: "starter", status: "trial" }), tiers[1], AT, WHY, { plans: tiers, events })
    expect(t.plan).toBe("business")
    expect(event).toBeNull()
  })
  it("refuses the same plan, a suspended tenant and a short reason", () => {
    expect(() => changePlan(tenant({ plan: "starter" }), tiers[0], AT, WHY, { plans: tiers, events })).toThrow()
    expect(() => changePlan(tenant({ plan: "starter", status: "suspended" }), tiers[1], AT, WHY, { plans: tiers, events })).toThrow()
    expect(() => changePlan(tenant({ plan: "starter" }), tiers[1], AT, "short", { plans: tiers, events })).toThrow()
  })
})

describe("extendTrial", () => {
  const trial = tenant({ status: "trial", billing: { paymentMethod: "None on file", trialEndsOn: "2026-10-30" } })
  it("adds days to the trial end, across a month boundary", () => {
    expect(extendTrial(trial, 7, WHY).billing.trialEndsOn).toBe("2026-11-06")
  })
  it("refuses a tenant that is not on a trial", () => {
    expect(() => extendTrial(tenant(), 7, WHY)).toThrow(/trial/)
  })
  it("refuses zero, fractional and too many days", () => {
    expect(() => extendTrial(trial, 0, WHY)).toThrow()
    expect(() => extendTrial(trial, 1.5, WHY)).toThrow()
    expect(() => extendTrial(trial, TRIAL_EXTENSION_MAX + 1, WHY)).toThrow()
  })
})

describe("scheduleDeletion", () => {
  it("sets deletionAt to today + the retention period", () => {
    expect(scheduleDeletion(tenant(), AT, 90, WHY).deletionAt).toBe("2027-01-18")
  })
  it("refuses a second schedule; cancelDeletion clears it", () => {
    const s = scheduleDeletion(tenant(), AT, 30, WHY)
    expect(() => scheduleDeletion(s, AT, 30, WHY)).toThrow()
    expect(cancelDeletion(s, WHY).deletionAt).toBeUndefined()
  })
})

// The pure status restore. The real write path (patch store, audit outbox, no SubEvent) is tested through commitTenant
// in components/tenant-360/live.test.ts.
describe("Review Focus 5: suspend → reactivate round trip (pure)", () => {
  const ctx = { at: AT, actor: "Aoife Brennan", staffRole: "owner" as const }
  function roundTrip(start: PlatformTenant) {
    let audit: AuditEntry[] = []
    const s = suspendTenant(start, AT, WHY)
    audit = [sensitiveEntry(audit, { ...ctx, tenantId: start.id, action: "tenant.suspended", target: start.name, detail: WHY, before: { status: start.status }, after: { status: s.status }, reason: WHY }), ...audit]
    const r = reactivateTenant(s)
    audit = [sensitiveEntry(audit, { ...ctx, tenantId: start.id, action: "tenant.reactivated", target: start.name, detail: WHY, before: { status: s.status }, after: { status: r.status }, reason: WHY }), ...audit]
    return { r, audit }
  }
  it.each(["active", "trial", "past_due"] as const)("restores %s", (status) => {
    const start = tenant({ status, billing: status === "trial" ? { paymentMethod: "None", trialEndsOn: "2026-11-01" } : { paymentMethod: "Card", renewsOn: "2026-11-01" } })
    const { r, audit } = roundTrip(start)
    expect(r.status).toBe(status)
    expect(r).toEqual(start)
    expect(audit.map((e) => e.action)).toEqual(["tenant.reactivated", "tenant.suspended"])
    expect(audit.every((e) => e.tenantId === "t" && e.reason === WHY)).toBe(true)
  })
  it("keeps the subscription (plan, billing dates) unchanged", () => {
    const start = tenant({ plan: "business" })
    expect(roundTrip(start).r.billing).toEqual(start.billing)
  })
})

describe("other tenant 360 actions", () => {
  it("applyCredit adds to the balance and refuses non-positive amounts", () => {
    expect(applyCredit(applyCredit(tenant(), 20, WHY), 9.5, WHY).creditBalance).toBe(29.5)
    expect(() => applyCredit(tenant(), 0, WHY)).toThrow()
    expect(() => applyCredit(tenant(), -5, WHY)).toThrow()
  })
  it("cancel at period end needs a renewal", () => {
    expect(setCancelAtPeriodEnd(tenant(), true, WHY).cancelAtPeriodEnd).toBe(true)
    expect(setCancelAtPeriodEnd(tenant({ cancelAtPeriodEnd: true }), false, WHY).cancelAtPeriodEnd).toBeUndefined()
    expect(() => setCancelAtPeriodEnd(tenant({ status: "trial", billing: { paymentMethod: "None", trialEndsOn: "2026-11-01" } }), true, WHY)).toThrow()
  })
  it("overrideModule grants an add-on outside the plan, revokes one in it, and clears", () => {
    const o = { at: AT, by: "Aoife Brennan", reason: WHY }
    const g = overrideModule(tenant(), "M8", "grant", false, o)
    expect(g.moduleOverrides).toEqual([{ module: "M8", mode: "grant", reason: WHY, at: AT, by: "Aoife Brennan" }])
    expect(() => overrideModule(tenant(), "M8", "grant", true, o)).toThrow()
    expect(() => overrideModule(tenant(), "M8", "revoke", false, o)).toThrow()
    expect(overrideModule(g, "M8", null, false, o).moduleOverrides).toBeUndefined()
  })
  it("overrideModule refuses to revoke a core module (fix round 1)", () => {
    const o = { at: AT, by: "Aoife Brennan", reason: WHY, core: ["M0"] }
    expect(() => overrideModule(tenant(), "M0", "revoke", true, o)).toThrow(/core/)
    expect(overrideModule(tenant(), "M1", "revoke", true, o).moduleOverrides?.[0]).toMatchObject({ module: "M1", mode: "revoke" })
  })
  it("changeSlug validates the format and uniqueness", () => {
    expect(changeSlug(tenant(), " Acme-Group ", ["beta"], WHY).slug).toBe("acme-group")
    expect(() => changeSlug(tenant(), "beta", ["beta"], WHY)).toThrow(/taken/)
    expect(() => changeSlug(tenant(), "acme", [], WHY)).toThrow()
    expect(() => changeSlug(tenant(), "a_b", [], WHY)).toThrow()
  })
  it("addNote appends a staff note", () => {
    const n = addNote(addNote(tenant(), "First", AT, "A"), "  Second  ", AT, "B")
    expect(n.notes?.map((x) => [x.id, x.text, x.by])).toEqual([["N-1", "First", "A"], ["N-2", "Second", "B"]])
    expect(() => addNote(tenant(), "  ", AT, "A")).toThrow()
  })
  it("exportRequest files a tenant export data request due in 30 days", () => {
    const r = exportRequest(tenant(), { at: AT, by: "Aoife Brennan", reason: WHY, ids: ["DSR-6"] })
    expect(r).toEqual({ id: "DSR-7", tenantId: "t", kind: "export", subject: "tenant", requestedBy: "Aoife Brennan", requestedAt: AT, dueAt: "2026-11-19T09:00:00", status: "received", note: WHY })
  })
})

describe("filterAudit", () => {
  const e = (id: string, over: Partial<AuditEntry>): AuditEntry => ({ id, at: AT, actor: "x", action: "a", target: "Other", detail: "", ...over })
  it("matches tenantId, falling back to the target name for old lines without one", () => {
    const entries = [e("PAU-3", { tenantId: "t" }), e("PAU-2", { target: "Acme Ltd" }), e("PAU-1", { tenantId: "u", target: "Acme Ltd" }), e("PAU-0", {})]
    expect(filterAudit(entries, { tenantId: "t", name: "Acme Ltd" }).map((x) => x.id)).toEqual(["PAU-3", "PAU-2"])
    expect(filterAudit(entries, { tenantId: "t" }).map((x) => x.id)).toEqual(["PAU-3"])
  })
  it("combines actor, action, tenant and an inclusive date range (AND); empty filters keep every line", () => {
    const entries = [
      e("PAU-6", { actor: "Aoife", action: "tenant.suspended", tenantId: "t", at: "2026-10-20T08:00:00" }),
      e("PAU-5", { actor: "Aoife", action: "tenant.suspended", tenantId: "u", at: "2026-10-20T07:00:00" }),
      e("PAU-4", { actor: "Priya", action: "tenant.suspended", tenantId: "t", at: "2026-10-19T23:30:00" }),
      e("PAU-3", { actor: "Aoife", action: "plan.changed", tenantId: "t", at: "2026-10-18T10:00:00" }),
      e("PAU-2", { actor: "Aoife", action: "tenant.suspended", tenantId: "t", at: "2026-10-01T00:00:00" }),
      e("PAU-1", { actor: "Aoife", action: "staff.invited", at: "2026-10-19T10:00:00" }),
    ]
    const ids = (f: Parameters<typeof filterAudit>[1]) => filterAudit(entries, f).map((x) => x.id)
    expect(ids({})).toHaveLength(6)
    expect(ids({ actor: "Aoife" })).toEqual(["PAU-6", "PAU-5", "PAU-3", "PAU-2", "PAU-1"])
    expect(ids({ actor: "Aoife", action: "tenant.suspended" })).toEqual(["PAU-6", "PAU-5", "PAU-2"])
    expect(ids({ actor: "Aoife", action: "tenant.suspended", tenantId: "t" })).toEqual(["PAU-6", "PAU-2"])
    expect(ids({ actor: "Aoife", action: "tenant.suspended", tenantId: "t", from: "2026-10-02", to: "2026-10-20" })).toEqual(["PAU-6"])
    // The range is by the platform's calendar day: 23:30 on the 19th is the 19th.
    expect(ids({ from: "2026-10-19", to: "2026-10-19" })).toEqual(["PAU-4", "PAU-1"])
    expect(ids({ to: "2026-10-18" })).toEqual(["PAU-3", "PAU-2"])
    expect(ids({ actor: "Nobody" })).toEqual([])
  })
})
