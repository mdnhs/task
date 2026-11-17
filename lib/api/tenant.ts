// The active-tenant rules shared by the BFF, apiServer and the browser client (B6 ruling I5). Pure.
// The tenant is a SERVER-side fact: the httpOnly cookie `od-tenant`. Nothing the browser sends can name it.

export const TENANT_COOKIE = "od-tenant"
/** The only tenant header that crosses to the API. Set by the web server from the cookie; a client-sent one is dropped. */
export const TENANT_HEADER = "x-tenant"
/** What the browser sends: the tenant its page was rendered for. The BFF compares it with the cookie (409 `tenant_changed` on a mismatch); it is never forwarded. */
export const PAGE_TENANT_HEADER = "x-od-tenant"

/** The API's own slug rule (POST /v1/tenants): 3-40 chars, lowercase letters and digits, hyphens inside. */
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/
export const isTenantSlug = (v: unknown): v is string => typeof v === "string" && SLUG.test(v)

/** httpOnly (JS never sees it), SameSite=Lax, Secure in production, host-only (no Domain: sibling subdomains cannot set or read it), session-long. */
export function tenantCookieOptions(o: { production?: boolean } = {}) {
  return { httpOnly: true, sameSite: "lax" as const, secure: o.production ?? process.env.NODE_ENV === "production", path: "/" }
}
