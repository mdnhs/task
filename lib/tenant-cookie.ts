// The active tenant (B6 ruling I5): the httpOnly cookie `od-tenant`, holding the tenant SLUG. Server-only: client code can neither read nor write it.
// Only the server action `switchTenant(slug)` (T6.3) writes it, after checking the slug against GET /v1/me; the API's membership check stays the authority
// (a forged slug is a 404). The BFF and apiServer read it and set X-Tenant from it.
import "server-only"
import { cookies } from "next/headers"
import { TENANT_COOKIE, isTenantSlug, tenantCookieOptions } from "./api/tenant"

export { TENANT_COOKIE, isTenantSlug, tenantCookieOptions }

/** The active tenant slug, or null when absent or not a slug. */
export async function readTenantSlug(): Promise<string | null> {
  const v = (await cookies()).get(TENANT_COOKIE)?.value
  return isTenantSlug(v) ? v : null
}

/** Sets the active tenant. Call it only from a server action or route handler, after the slug was checked against the caller's memberships. */
export async function writeTenantSlug(slug: string): Promise<void> {
  if (!isTenantSlug(slug)) throw new Error("not a tenant slug")
  ;(await cookies()).set(TENANT_COOKIE, slug, tenantCookieOptions())
}

export async function clearTenantSlug(): Promise<void> {
  ;(await cookies()).delete(TENANT_COOKIE)
}
