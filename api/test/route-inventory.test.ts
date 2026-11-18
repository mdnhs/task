import { beforeAll, describe, expect, test } from "vitest"
import { call, resetDb, testApp } from "./harness"
import { ownerQuery } from "./db"
import { makeMember, makeTenant } from "./factories"
import { ROUTE_PARAMS, routeInventory } from "./route-fixtures"
import { ROUTE_CLASSIFICATION } from "./route-classification"
import { HASHED_TABLES, TABLE_EXEMPT } from "./isolation-tables"

/**
 * B7 Task 14: the isolation gate cannot be outrun by a new route or a new tenant table. The inventory is derived from the live
 * OpenAPI document (plus the registered routes that are not in it); a route without an entry in route-classification.ts, a stale
 * entry, or a tenant_id table that no walker hashes fails the build by name. The tenant-record routes themselves are walked by
 * isolation.test.ts, which fails when its SPECS differ from this manifest.
 */
let t: ReturnType<typeof testApp>
beforeAll(async () => {
  await resetDb()
  t = testApp()
}, 120_000)

describe("route inventory", () => {
  test("every OpenAPI operation is classified (a new route fails the build until classified)", () => {
    const inv = routeInventory(t.app)
    expect(inv.length).toBeGreaterThan(150)
    expect(inv.filter((e) => !e.classification).map((e) => `${e.key} (${e.source}): add it to api/test/route-classification.ts`)).toEqual([])
    expect(inv.filter((e) => !e.reason || e.reason.length < 10).map((e) => `${e.key}: needs a one-line reason`)).toEqual([])
    const keys = new Set(inv.map((e) => e.key))
    expect(Object.keys(ROUTE_CLASSIFICATION).filter((k) => !keys.has(k)).map((k) => `stale classification ${k}: no such route`)).toEqual([])
  })

  test("the B7 routes are in the inventory with the right class", () => {
    const by = new Map(routeInventory(t.app).map((e) => [e.key, e.classification]))
    expect(by.get("GET /v1/platform/session")).toBe("platform")
    expect(by.get("GET /v1/platform/support-grants")).toBe("platform")
    expect(by.get("GET /v1/audit")).toBe("tenant-static")
    expect(by.get("GET /v1/audit/export")).toBe("tenant-static")
    expect(by.get("GET /v1/tasks")).toBe("tenant-static")
    expect(by.get("GET /v1/shift-reports/template")).toBe("tenant-static")
    expect(by.get("PUT /v1/shift-reports/template")).toBe("tenant-static")
  })

  test("a classification cannot contradict the route shape: platform = /v1/platform, tenant-record = a tenant record id in ROUTE_PARAMS", () => {
    const wrong: string[] = []
    for (const e of routeInventory(t.app)) {
      const isPlatform = e.path.startsWith("/v1/platform/")
      if (isPlatform !== (e.classification === "platform")) wrong.push(`${e.key}: ${e.classification} vs path`)
      const params = ROUTE_PARAMS[e.path]
      const hasRecordId = params !== undefined && Object.values(params).some((r) => r !== "feature")
      if (e.classification === "tenant-record" && !hasRecordId) wrong.push(`${e.key}: tenant-record but no record id in ROUTE_PARAMS`)
      if (e.classification !== "tenant-record" && hasRecordId) wrong.push(`${e.key}: has a tenant record id in ROUTE_PARAMS but is ${e.classification}`)
      // a parameterised tenant-side route must declare what its params are, or the walker cannot build its fixtures
      if (e.source === "openapi" && !isPlatform && e.path.includes("{") && !params) wrong.push(`${e.key}: path param without ROUTE_PARAMS entry`)
    }
    expect(wrong).toEqual([])
  })

  test("every table with tenant_id is touched by at least one walker or control assertion (row-hash list equals the RLS-guard table list)", async () => {
    const rows = await ownerQuery("select table_name from information_schema.columns where table_schema = 'public' and column_name = 'tenant_id' order by 1") // the selector family of rls-guard.test.ts
    const live = rows.map((r) => String(r.table_name))
    const covered = [...HASHED_TABLES, ...Object.keys(TABLE_EXEMPT)]
    expect(live.filter((x) => !covered.includes(x)).map((x) => `${x}: add to HASHED_TABLES (or TABLE_EXEMPT with a reason) in isolation-tables.ts`)).toEqual([])
    expect(covered.filter((x) => !live.includes(x)).map((x) => `${x}: listed but no such tenant table`)).toEqual([])
    expect(new Set(covered).size).toBe(covered.length)
  })

  test("public and webhook routes accept no tenant header and leak no tenant data", async () => {
    const ta = await makeTenant(t.deps, { slug: "inv-alpha", name: "Inventory Alpha Ltd" })
    const owner = await makeMember(t.deps, ta.id, "owner")
    const targets = routeInventory(t.app).filter((e) => (e.classification === "public" || e.classification === "webhook") && !e.path.includes("*") && e.key !== "GET /v1/openapi.json")
    expect(targets.map((e) => e.key).sort()).toEqual(["GET /healthz", "GET /readyz", "GET /v1/auth/providers", "POST /webhooks/billing/stripe"])
    const norm = async (r: Response) => {
      const text = await r.text()
      return { status: r.status, text: text.replace(/"requestId":"[^"]+"/, '"requestId":"-"') }
    }
    const marks = [ta.id, ta.slug, "Inventory Alpha", owner.email]
    for (const e of targets) {
      const body = e.method === "POST" ? { id: "evt_1", type: "customer.subscription.updated" } : undefined
      const plain = await norm(await call(t.app, e.method, e.path, { body }))
      const withHdr = await norm(await call(t.app, e.method, e.path, { body, tenant: ta.slug }))
      expect(withHdr, `${e.key}: the tenant header changed the answer`).toEqual(plain)
      for (const m of marks) expect(plain.text.includes(m), `${e.key} leaks ${m}`).toBe(false)
    }
  })
})
