import { describe, expect, it } from "vitest"

import { archiveBlock, canArchive, planChoices, planStats, plansData, validateNewPlan } from "./plans"
import type { Plan, PlatformSeed, StaffMember } from "./types"

const limits = { activeUsers: 5, storageGb: 5, messages: 100, transcriptionMinutes: 10 }
const plans: Plan[] = [
  { id: "starter", name: "Starter", priceMonthly: 49, currency: "EUR", trialDays: 14, limits },
  { id: "pro", name: "Pro", priceMonthly: 149, currency: "EUR", trialDays: 14, limits },
]
const input = { id: "scale", name: "Scale", price: "299", trialDays: "14", activeUsers: "50", storageGb: "100", messages: "9000", transcriptionMinutes: "900" }
const op = (role: StaffMember["role"]): StaffMember => ({ id: "s", name: "Sam", email: "s@x.io", role, mfa: true, lastSignInAt: null, status: "active" })

describe("canArchive", () => {
  it("is false while a tenant is on the plan, whatever its status", () => {
    expect(canArchive(plans[0], [{ plan: "starter" }])).toBe(false)
    expect(archiveBlock(plans[0], [{ plan: "starter" }, { plan: "starter" }])).toMatch(/2 tenants are/)
  })
  it("is true with no tenants, false when already archived or the default plan", () => {
    expect(canArchive(plans[0], [{ plan: "pro" }])).toBe(true)
    expect(canArchive({ ...plans[0], archived: true }, [])).toBe(false)
    expect(canArchive(plans[0], [], "starter")).toBe(false)
    expect(archiveBlock(plans[0], [], "starter")).toMatch(/default/)
  })
})

describe("validateNewPlan", () => {
  it("accepts a valid plan and builds it", () => {
    const r = validateNewPlan(input, plans, "EUR")
    expect(r.errors).toEqual({})
    expect(r.plan).toEqual({ id: "scale", name: "Scale", priceMonthly: 299, currency: "EUR", trialDays: 14, limits: { activeUsers: 50, storageGb: 100, messages: 9000, transcriptionMinutes: 900 } })
  })
  it("rejects a duplicate id (case-insensitive) and a malformed one", () => {
    expect(validateNewPlan({ ...input, id: "Starter" }, plans, "EUR").errors.id).toMatch(/already/)
    expect(validateNewPlan({ ...input, id: "my plan!" }, plans, "EUR").errors.id).toBeTruthy()
    expect(validateNewPlan({ ...input, id: "" }, plans, "EUR").errors.id).toBeTruthy()
  })
  it("rejects a negative or malformed price but allows free", () => {
    expect(validateNewPlan({ ...input, price: "-1" }, plans, "EUR").errors.price).toBeTruthy()
    expect(validateNewPlan({ ...input, price: "abc" }, plans, "EUR").errors.price).toBeTruthy()
    expect(validateNewPlan({ ...input, price: "0" }, plans, "EUR").errors.price).toBeUndefined()
  })
  it("requires a name and whole-number limits of at least 1", () => {
    expect(validateNewPlan({ ...input, name: " " }, plans, "EUR").errors.name).toBeTruthy()
    expect(validateNewPlan({ ...input, storageGb: "0" }, plans, "EUR").errors.storageGb).toBeTruthy()
    expect(validateNewPlan({ ...input, trialDays: "-3" }, plans, "EUR").errors.trialDays).toBeTruthy()
  })
})

describe("plan stats and view model", () => {
  const tenants = [{ id: "a", plan: "starter", status: "active" as const }, { id: "b", plan: "starter", status: "trial" as const }, { id: "c", plan: "pro", status: "past_due" as const }]
  it("counts tenants and MRR per plan, MRR null without amounts", () => {
    expect(planStats(plans, tenants, true)).toEqual({ starter: { tenants: 2, mrr: 49 }, pro: { tenants: 1, mrr: 149 } })
    expect(planStats(plans, tenants, false).pro).toEqual({ tenants: 1, mrr: null })
  })
  it("gates writes on plans.write and sends no tenant names", () => {
    const seed = { tenants: [{ id: "a", name: "Secret Co", plan: "starter", status: "active" }], plans, entitlements: { productModules: [], plans: {}, core: [], modules: {}, assistant: "", defaultPlan: "starter" } } as unknown as PlatformSeed
    expect(plansData(seed, op("billing")).can).toEqual({ amounts: true, write: true })
    expect(plansData(seed, op("viewer")).can).toEqual({ amounts: true, write: false })
    expect(plansData(seed, op("support")).can).toEqual({ amounts: false, write: false })
    expect(JSON.stringify(plansData(seed, op("owner")))).not.toContain("Secret")
  })
})

describe("archived plans in the tenant 360", () => {
  it("changePlan refuses an archived target", async () => {
    const { changePlan } = await import("./logic")
    const t = { id: "t", name: "T", slug: "t", subdomain: "t.x", plan: "starter", status: "active", users: 1, storageGb: 1, messages: 1, transcriptionMinutes: 1, createdAt: "2026-01-01T10:00:00", contacts: [], billing: { paymentMethod: "Card", renewsOn: "2026-11-01" } } as never
    expect(() => changePlan(t, { ...plans[1], archived: true }, "2026-10-30T09:00:00", "moving on please", { plans, events: [] })).toThrow(/archived/)
  })
})

describe("planChoices (tenant 360 change plan)", () => {
  const mk = (id: string, archived?: boolean) => ({ id, name: id, priceMonthly: 1, currency: "EUR", trialDays: 14, archived, limits: { activeUsers: 1, storageGb: 1, messages: 1, transcriptionMinutes: 1 } }) as Plan
  const plans = [mk("a"), mk("b", true), mk("c"), mk("d")]
  it("leaves out archived plans, from the server flag or archived this session", () => {
    expect(planChoices(plans, "a", new Set(["c"])).map((p) => p.id)).toEqual(["a", "d"])
  })
  it("keeps the tenant's current plan even when it is archived", () => {
    expect(planChoices(plans, "b", new Set()).map((p) => p.id)).toEqual(["a", "b", "c", "d"])
  })
})
