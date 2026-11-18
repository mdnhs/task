// The browser's API client (B6 ruling I4): same-origin relative /v1 URLs only, so every call goes through the BFF.
// It cannot choose a tenant, a bearer key or a cookie: the browser sends its httpOnly cookies itself, and the BFF builds X-Tenant from the
// od-tenant cookie. The one thing it adds is x-od-tenant, the tenant the page was rendered for, so the BFF can refuse a stale tab (409 tenant_changed).
// T6.3: a 401 that means "the session is gone" (not an MFA challenge) toasts ONCE and sends the page to /api/session/expired ONCE, however many calls fail together.
import { toast } from "sonner"
import { reportBillingBlocked } from "./blocked"
import { clearClientStoresOnce } from "../client-stores"
import { makeApiClient, type ApiClient } from "./client"
import { PAGE_TENANT_HEADER, isTenantSlug } from "./tenant"

let pageTenant: string | null = null

/** Called once by the app shell with the tenant slug this page was rendered for. A value that is not a slug is ignored. */
export function setPageTenant(slug: string | null): void {
  pageTenant = isTenantSlug(slug) ? slug : null
}

/** Where a dead session goes: the route handler clears the cookies, then /sign-in?reason=expired. Kept in step with lib/session.ts EXPIRED_PATH. */
const EXPIRED = "/api/session/expired"

function defaultSessionExpired(): void {
  clearClientStoresOnce("revoked") // another device ended this session, or it ran out while the page was open: nothing of this person stays in the browser
  toast.error("Session expired. Sign in again.")
  window.location.assign(EXPIRED)
}

type Opts = { fetch?: typeof globalThis.fetch; onSessionExpired?: () => void }

export function makeBrowserClient(o: Opts = {}): ApiClient {
  const handler = o.onSessionExpired ?? defaultSessionExpired
  let fired = false
  const guarded: typeof globalThis.fetch = async (input, init) => {
    const res = await (o.fetch ?? globalThis.fetch)(input, init)
    // T6.4: a write refused with 402 billing_required lights the read-only banner (lib/api/blocked.ts); the caller still gets the ApiError and rolls back.
    if (res.status === 402) reportBillingBlocked()
    if (res.status === 401 && !fired) {
      let code = ""
      try {
        code = String(((await res.clone().json()) as { code?: unknown }).code ?? "")
      } catch {
        /* not JSON (a proxy page): a 401 is still a dead session */
      }
      // An MFA challenge is the step-up's job, not an expired session.
      // Check and set with no await in between: parallel failures cannot both pass.
      if (!code.startsWith("mfa_") && !fired) {
        fired = true
        // Also for a custom handler: whoever reacts, this device's stores belong to a session that no longer exists.
        clearClientStoresOnce("revoked")
        handler()
      }
    }
    return res
  }
  return makeApiClient({
    baseUrl: "",
    fetch: guarded,
    cache: "no-store",
    credentials: "same-origin",
    headers: () => {
      const h = new Headers()
      if (pageTenant) h.set(PAGE_TENANT_HEADER, pageTenant)
      return h
    },
  })
}

export const apiBrowser: ApiClient = makeBrowserClient()
