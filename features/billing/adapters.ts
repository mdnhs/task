// Pure mappers from the billing DTOs to the UI's types. A missing or mistyped required field THROWS (a renamed field must not become a silent 0 or "").
// Money is integer minor units end to end: formatting builds the decimal text from integers, so there is no float rounding.
import { planModules, type EntitlementsData, type ProductModule } from "@/lib/entitlements"
import { isAllowedRedirect } from "./redirect"
import type { Invoice, InvoiceStatus, Plan, PlanCard, Subscription, SubscriptionStatus, BillingState } from "./types"

type Rec = Record<string, unknown>
const bad = (k: string, want: string): never => {
  throw new Error(`billing: ${k} must be ${want}`)
}
const str = (r: Rec, k: string): string => (typeof r[k] === "string" ? (r[k] as string) : bad(k, "a string"))
const int = (r: Rec, k: string): number => (Number.isInteger(r[k]) ? (r[k] as number) : bad(k, "an integer"))
const bool = (r: Rec, k: string): boolean => (typeof r[k] === "boolean" ? (r[k] as boolean) : bad(k, "a boolean"))
const nstr = (r: Rec, k: string): string | null => (r[k] === null ? null : str(r, k))
const oneOf = <T extends string>(r: Rec, k: string, set: readonly T[]): T => (set.includes(r[k] as T) ? (r[k] as T) : bad(k, `one of ${set.join(", ")}`))

const STATUSES = ["trialing", "active", "past_due", "canceled", "incomplete", "unpaid", "paused"] as const satisfies readonly SubscriptionStatus[]
const STATES = ["ok", "grace", "blocked"] as const satisfies readonly BillingState[]
const INVOICE_STATUSES = ["paid", "open", "failed"] as const satisfies readonly InvoiceStatus[]

export function toSubscription(dto: unknown): Subscription {
  const r = dto as Rec
  return {
    planId: str(r, "planId"), planName: str(r, "planName"), priceMinor: int(r, "priceMonthlyMinor"), currency: str(r, "currency"), status: oneOf(r, "status", STATUSES),
    seats: int(r, "seats"), seatsUsed: int(r, "seatsUsed"), trialEndsAt: nstr(r, "trialEndsAt"), currentPeriodEnd: nstr(r, "currentPeriodEnd"), cancelAtPeriodEnd: bool(r, "cancelAtPeriodEnd"),
    billingState: oneOf(r, "billingState", STATES), graceEndsAt: nstr(r, "graceEndsAt"), hasProviderSubscription: bool(r, "hasProviderSubscription"), hasCustomer: bool(r, "hasCustomer"),
  }
}

/** Only a link on the provider's own hosts is kept (./redirect.ts): the page links to it, so any other scheme or host is dropped. */
const httpsOrNull = (u: string | null): string | null => (u && isAllowedRedirect(u) ? u : null)

export function toInvoice(dto: unknown): Invoice {
  const r = dto as Rec
  return {
    id: str(r, "id"), number: str(r, "providerInvoiceId"), amountMinor: int(r, "amountMinor"), currency: str(r, "currency"), status: oneOf(r, "status", INVOICE_STATUSES),
    hostedUrl: httpsOrNull(nstr(r, "hostedUrl")), periodStart: str(r, "periodStart"), periodEnd: str(r, "periodEnd"), createdAt: str(r, "createdAt"),
  }
}

const digitsOf = (currency: string, locale: string) => new Intl.NumberFormat(locale, { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2

/** A whole amount in major units (the static plan table) as integer minor units. */
export function minorOf(major: number, currency: string, locale = "en"): number {
  return Math.round(major * 10 ** digitsOf(currency, locale))
}

/** The seat form's client-side check: a whole number not below the active members. The plan's maximum is the API's call (422 seat_limit_exceeds_plan, shown as copy). */
export function seatProblem(text: string, seatsUsed: number): string | undefined {
  if (!/^\d+$/.test(text.trim())) return "Enter a whole number."
  return Number(text) < seatsUsed ? "Seats can't be fewer than your active members." : undefined
}

/** Integer minor units as money in the tenant's locale: the decimal text is built from integers (14900 -> "149.00") and handed to Intl as a string. */
export function formatMinor(minor: number, currency: string, locale: string): string {
  if (!Number.isInteger(minor)) throw new Error("formatMinor: minor units must be an integer")
  const d = digitsOf(currency, locale)
  const digits = Math.abs(minor).toString().padStart(d + 1, "0")
  const text = `${minor < 0 ? "-" : ""}${d > 0 ? `${digits.slice(0, -d)}.${digits.slice(-d)}` : digits}`
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(text as unknown as number)
}

export function planCards(plans: Plan[], ent: EntitlementsData, currentId: string): PlanCard[] {
  return plans.map((p) => ({
    id: p.id, name: p.name, priceMinor: minorOf(p.priceMonthly, p.currency), currency: p.currency, trialDays: p.trialDays, limits: p.limits, current: p.id === currentId,
    modules: planModules(ent, p.id).filter((m) => m.included).length,
  }))
}

/** The product modules the company can use RIGHT NOW (the API's list: plan plus any grant or revoke), in catalogue order, each marked included or not. */
export function moduleRows(ent: EntitlementsData, allowed: readonly string[]): (ProductModule & { included: boolean })[] {
  return ent.productModules.map((m) => ({ ...m, included: allowed.includes(m.id) }))
}
