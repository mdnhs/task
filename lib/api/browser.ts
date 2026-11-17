// The browser's API client (B6 ruling I4): same-origin relative /v1 URLs only, so every call goes through the BFF.
// It cannot choose a tenant, a bearer key or a cookie: the browser sends its httpOnly cookies itself, and the BFF builds X-Tenant from the
// od-tenant cookie. The one thing it adds is x-od-tenant, the tenant the page was rendered for, so the BFF can refuse a stale tab (409 tenant_changed).
import { makeApiClient, type ApiClient } from "./client"
import { PAGE_TENANT_HEADER, isTenantSlug } from "./tenant"

let pageTenant: string | null = null

/** Called once by the app shell with the tenant slug this page was rendered for. A value that is not a slug is ignored. */
export function setPageTenant(slug: string | null): void {
  pageTenant = isTenantSlug(slug) ? slug : null
}

export const apiBrowser: ApiClient = makeApiClient({
  baseUrl: "",
  cache: "no-store",
  credentials: "same-origin",
  headers: () => {
    const h = new Headers()
    if (pageTenant) h.set(PAGE_TENANT_HEADER, pageTenant)
    return h
  },
})
