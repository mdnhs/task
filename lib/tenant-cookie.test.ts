import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const store = new Map<string, string>()
const setSpy = vi.fn()
const deleteSpy = vi.fn()
vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (store.has(n) ? { name: n, value: store.get(n)! } : undefined),
    set: (...a: unknown[]) => setSpy(...a),
    delete: (...a: unknown[]) => deleteSpy(...a),
  }),
}))

import { TENANT_COOKIE, clearTenantSlug, isTenantSlug, readTenantSlug, tenantCookieOptions, writeTenantSlug } from "@/lib/tenant-cookie"

beforeEach(() => {
  store.clear()
  setSpy.mockClear()
  deleteSpy.mockClear()
})
afterEach(() => vi.unstubAllEnvs())

describe("lib/tenant-cookie (I5): the active tenant is a server-only httpOnly cookie", () => {
  test("the cookie is called od-tenant", () => {
    expect(TENANT_COOKIE).toBe("od-tenant")
  })

  test("options: httpOnly, sameSite lax, path /, secure in production only", () => {
    expect(tenantCookieOptions({ production: true })).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", secure: true })
    expect(tenantCookieOptions({ production: false })).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", secure: false })
    expect(tenantCookieOptions({ production: true })).not.toHaveProperty("domain") // host-only: never shared with sibling subdomains
  })

  test("readTenantSlug returns the slug, or null when absent or not a slug", async () => {
    expect(await readTenantSlug()).toBeNull()
    store.set("od-tenant", "acme")
    expect(await readTenantSlug()).toBe("acme")
    for (const bad of ["ACME", "a", "x y", "../etc", "acme\r\nSet-Cookie: x=1", "-acme", "acme-"]) {
      store.set("od-tenant", bad)
      expect(await readTenantSlug(), bad).toBeNull()
    }
  })

  test("writeTenantSlug sets the cookie with the server-side options; an invalid slug throws and writes nothing", async () => {
    vi.stubEnv("NODE_ENV", "production")
    await writeTenantSlug("acme")
    expect(setSpy).toHaveBeenCalledWith("od-tenant", "acme", expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/", secure: true }))
    setSpy.mockClear()
    await expect(writeTenantSlug("Not A Slug")).rejects.toThrow()
    expect(setSpy).not.toHaveBeenCalled()
  })

  test("clearTenantSlug removes it", async () => {
    await clearTenantSlug()
    expect(deleteSpy).toHaveBeenCalledWith("od-tenant")
  })

  test("isTenantSlug matches the API's slug rule (3-40 chars, lowercase, digits, inner hyphens)", () => {
    for (const ok of ["acme", "a1b", "co-pper-s", "x".repeat(40)]) expect(isTenantSlug(ok), ok).toBe(true)
    for (const bad of ["ab", "x".repeat(41), "Acme", "a_b", "-ab", "ab-", ""]) expect(isTenantSlug(bad), bad).toBe(false)
  })
})
