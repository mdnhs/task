import type { Context, MiddlewareHandler } from "hono"
import type { AppEnv } from "../context"
import { entitlementsFor } from "../../modules/entitlements/service"
import { AppError, Forbidden } from "../errors"

/**
 * Guards a route by PRODUCT module (FR-M0-15, AC-M0-05): 403 module_not_entitled when the tenant's plan (plus overrides) does
 * not include it. Place right after requireTenant. Entitlements are cached per tenant for <= 60 s (deps.clock) and dropped
 * in-process on any subscription/override change. Data is never touched by entitlement changes: re-enabling restores access.
 */
export function requireModule(productModule: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const tenant = c.get("tenant")
    if (!tenant) throw Forbidden("forbidden") // fail closed: used without requireTenant
    const ent = await entitlementsFor(c.get("deps"), tenant.id)
    if (!ent.allowed.includes(productModule)) throw Forbidden("module_not_entitled")
    await next()
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])
const BILLING_PREFIX = "/v1/billing" // reserved for T3.3: always open so a blocked tenant can pay
const DATA_EXPORT = "/v1/me/data-export" // NFR-18: data export on exit stays open
const DATA_REQUESTS = "/v1/data-requests"
/** Ruling K5: marking a notification read touches no business data, so a blocked tenant can still dismiss its billing notices. POST only. */
const NOTIFICATION_READ_ALL = "/v1/notifications/read-all"
const NOTIFICATION_READ = new RegExp("^/v1/notifications/[^/]+/read$")

const ONE_ID = "[^/]+"
const REVOKE_DELETES = [
  new RegExp(`^/v1/api-keys/${ONE_ID}$`),
  new RegExp(`^/v1/webhooks/${ONE_ID}$`),
  new RegExp(`^/v1/settings/support-grants/${ONE_ID}$`),
]
/** PATCH routes that are exempt ONLY when the body is exactly the disabling field (decided here from a cloned body, so the handler is untouched). */
const DISABLE_PATCHES: { path: RegExp; field: string; value: boolean }[] = [
  { path: new RegExp(`^/v1/webhooks/${ONE_ID}$`), field: "active", value: false }, // pause an endpoint
  { path: new RegExp(`^/v1/devices/${ONE_ID}$`), field: "trusted", value: false }, // device revoke = withdraw trust
]

/**
 * Whether a (blocked) tenant may still call this non-GET route: billing, data export, DSR handling, and (ruling C13) the
 * security duties that must never need payment: revoking api keys / webhooks / support grants and pausing a webhook or
 * un-trusting a device. Matched on the request path against fixed templates (one id segment), like the other exemptions.
 * (Members have no deactivate/remove route in this API; role changes are ordinary writes.)
 */
async function exemptWhenBlocked(c: Context<AppEnv>): Promise<boolean> {
  const p = c.req.path
  if (p === BILLING_PREFIX || p.startsWith(`${BILLING_PREFIX}/`)) return true
  if (p === DATA_EXPORT || p.startsWith(`${DATA_EXPORT}/`)) return true
  // Opening ANY data request (export, erase, correct, restrict) stays possible: the GDPR clock does not wait for payment (C8, C13).
  if (p === DATA_REQUESTS) return true
  // Working an EXISTING request (complete / reject / retry) must not be blocked by billing either.
  if (p.startsWith(`${DATA_REQUESTS}/`)) return true
  if (c.req.method === "POST" && (p === NOTIFICATION_READ_ALL || NOTIFICATION_READ.test(p))) return true
  if (c.req.method === "DELETE" && REVOKE_DELETES.some((r) => r.test(p))) return true
  if (c.req.method === "PATCH") {
    const rule = DISABLE_PATCHES.find((r) => r.path.test(p))
    if (!rule) return false
    const body = (await c.req.raw.clone().json().catch(() => null)) as Record<string, unknown> | null
    const keys = body && typeof body === "object" ? Object.keys(body) : []
    return keys.length === 1 && keys[0] === rule.field && body![rule.field] === rule.value
  }
  return false
}

/**
 * Trial-expiry / unpaid rule, applied by requireTenant (so every tenant route is covered by construction): GETs are always open;
 * during the 7-day grace after a trial writes are allowed; after it (or when the subscription is canceled / never completed)
 * every non-GET tenant route answers 402 problem+json billing_required, except billing and data-export routes.
 */
export async function enforceBilling(c: Context<AppEnv>): Promise<void> {
  if (SAFE_METHODS.has(c.req.method)) return
  const ent = await entitlementsFor(c.get("deps"), c.get("tenant")!.id)
  if (ent.billingState !== "blocked") return
  if (await exemptWhenBlocked(c)) return
  throw new AppError(402, "billing_required", "Payment Required")
}
