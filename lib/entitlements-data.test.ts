import { describe, expect, test, vi } from "vitest"
import { fakeApi, problem } from "@/test/support/fake-api"
import { ApiError } from "@/lib/api/problem"
import { classifyApiError } from "@/lib/api/problem"
import { filterByEntitlement, hasModule, toTenantEntitlements, type EntitlementsData } from "./entitlements"
import { loadTenantEntitlements } from "./entitlements-data"

const DATA: EntitlementsData = {
  productModules: [{ id: "M0", label: "Core", description: "" }, { id: "M1", label: "Tasks", description: "" }, { id: "M1A", label: "Rostering", description: "" }, { id: "M4", label: "People", description: "" }, { id: "M2", label: "Assistant", description: "" }],
  modules: { dashboard: "M0", settings: "M0", tasks: "M1", reports: "M1", roster: "M1A", recruitment: "M4", files: "M4" },
  assistant: "M2", defaultPlan: "starter", core: ["M0"], plans: { starter: ["M0", "M1"], business: ["M0", "M1", "M1A", "M4", "M2"] },
}
const ent = (modules: string[], over: Record<string, unknown> = {}) => ({ planId: "starter", status: "active", modules, seats: 10, seatsUsed: 2, trialEndsAt: null, graceEndsAt: null, billingState: "ok", ...over })
const NAV = [{ href: "/tasks" }, { href: "/rosters" }, { href: "/recruitment" }, { href: "/files" }, { href: "/settings" }]

describe("T6.4 entitlements", () => {
  test("modules ['M0','M1'] map through the static module table and hide the M1A and M4 nav entries", () => {
    const t = toTenantEntitlements(ent(["M0", "M1"]), DATA)
    expect(t).toEqual({ planId: "starter", allowed: ["M0", "M1"], modules: DATA.modules, assistant: "M2" })
    expect(hasModule(t, "tasks")).toBe(true)
    expect(hasModule(t, "roster")).toBe(false)
    expect(hasModule(t, "recruitment")).toBe(false)
    expect(filterByEntitlement(NAV, t).map((n) => n.href)).toEqual(["/tasks", "/settings"])
  })

  test("the API's module list is the truth, not the plan table (a per-tenant grant shows its entry)", () => {
    const t = toTenantEntitlements(ent(["M0", "M1", "M4"]), DATA)
    expect(filterByEntitlement(NAV, t).map((n) => n.href)).toEqual(["/tasks", "/recruitment", "/files", "/settings"])
  })

  test("the entitlements call is never cached: every read goes to the API with fresh data", async () => {
    let n = 0
    const { client, calls } = fakeApi({ "GET /v1/entitlements": () => ent(n++ === 0 ? ["M0", "M1"] : ["M0", "M1", "M4"]) })
    const a = await loadTenantEntitlements(client, async () => DATA)
    const b = await loadTenantEntitlements(client, async () => DATA)
    expect(calls).toHaveLength(2)
    expect(a.allowed).toEqual(["M0", "M1"])
    expect(b.allowed).toEqual(["M0", "M1", "M4"])
  })

  test("the server read opts out of every cache: no 'use cache', no revalidate, and the client is the no-store apiServer", async () => {
    const { readFileSync } = await import("node:fs")
    const src = readFileSync(new URL("./entitlements-data.ts", import.meta.url), "utf8")
    expect(src).not.toMatch(/["']use cache["']|unstable_cache|revalidate|cacheLife/)
    expect(src).toContain("apiServer")
    const server = readFileSync(new URL("./api/server.ts", import.meta.url), "utf8")
    expect(server).toContain('cache: "no-store"')
  })

  test("a 403 module_not_entitled from any module route classifies as the 'Not in your plan' state", () => {
    const e = new ApiError(403, "module_not_entitled", "r1")
    expect(classifyApiError(e).kind).toBe("module_not_entitled")
  })

  test("a plain refusal while loading entitlements surfaces as the ApiError (no silent default plan)", async () => {
    const { client } = fakeApi({ "GET /v1/entitlements": problem(403, "forbidden") })
    await expect(loadTenantEntitlements(client, async () => DATA)).rejects.toMatchObject({ status: 403 })
    vi.restoreAllMocks()
  })
})
