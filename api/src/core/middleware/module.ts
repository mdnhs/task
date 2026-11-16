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

/** Whether a (blocked) tenant may still call this non-GET route: billing, data export and DSR handling. */
async function exemptWhenBlocked(c: Context<AppEnv>): Promise<boolean> {
  const p = c.req.path
  if (p === BILLING_PREFIX || p.startsWith(`${BILLING_PREFIX}/`)) return true
  if (p === DATA_EXPORT || p.startsWith(`${DATA_EXPORT}/`)) return true
  if (p === DATA_REQUESTS) {
    // Opening an export request stays possible; erase/correct/restrict are ordinary writes.
    const body = (await c.req.raw.clone().json().catch(() => null)) as { kind?: unknown } | null
    return body?.kind === "export"
  }
  // Working an EXISTING request (complete / reject / retry) must not be blocked by billing: the GDPR clock keeps running.
  return p.startsWith(`${DATA_REQUESTS}/`)
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
