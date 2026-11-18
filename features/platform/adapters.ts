// The platform staff API's DTOs mapped to what the console views show (B6 T6.8). Pure: no Next, no fetch. Aggregates only: the API sends no member name, email or
// business record in these answers, and nothing here asks for one. Money stays in integer minor units until it is formatted for display.
import type { Res } from "@/lib/api/client"
import type { StaffMember, StaffRole, TenantStatus } from "./types"

type TenantsDto = Res<"/v1/platform/tenants", "get">
type DetailDto = Res<"/v1/platform/tenants/{tenantId}", "get">
type MetricsDto = Res<"/v1/platform/metrics", "get">
type AuditDto = Res<"/v1/platform/audit", "get">
type DsrDto = Res<"/v1/platform/data-requests", "get">
type StaffDto = Res<"/v1/platform/staff", "get">
type EmailDto = Res<"/v1/platform/settings/email", "get">
type StorageDto = Res<"/v1/platform/settings/storage", "get">
type BillingDto = Res<"/v1/platform/settings/billing", "get">

const titleCase = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s)

/** The one status the console shows: a suspended tenant first, then what its subscription says. */
export function tenantStatus(t: { status: string; subscriptionStatus: string | null }): TenantStatus {
  if (t.status === "suspended") return "suspended"
  if (t.subscriptionStatus === "trialing") return "trial"
  if (t.subscriptionStatus === "past_due") return "past_due"
  return "active"
}

export type LiveTenantRow = { id: string; slug: string; name: string; status: TenantStatus; planId: string | null; plan: string; subscriptionStatus: string | null; seats: number | null; createdAt: string }
export type LiveTenantList = { rows: LiveTenantRow[]; page: number; pageSize: number; total: number }

export function toTenantList(dto: TenantsDto): LiveTenantList {
  return {
    rows: dto.items.map((i) => ({ id: i.id, slug: i.slug, name: i.name, status: tenantStatus(i), planId: i.planId, plan: i.planId ? titleCase(i.planId) : "", subscriptionStatus: i.subscriptionStatus, seats: i.seats, createdAt: i.createdAt })),
    page: dto.page, pageSize: dto.pageSize, total: dto.total,
  }
}

export type LiveOverride = { module: string; mode: "grant" | "revoke"; reason: string; setAt: string }
export type Live360 = {
  id: string; slug: string; name: string; status: TenantStatus; suspended: boolean; timezone: string; currency: string; locale: string; createdAt: string
  planId: string | null; plan: string; subscriptionStatus: string | null; seats: number | null; seatsUsed: number; memberCount: number
  trialEndsAt: string | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; hasProviderSubscription: boolean
  overrides: LiveOverride[]; lastActivityDate: string | null; openDataRequests: number
}

export function toTenant360(dto: DetailDto): Live360 {
  const s = dto.subscription
  const t = dto.tenant
  return {
    id: t.id, slug: t.slug, name: t.name, status: tenantStatus({ status: t.status, subscriptionStatus: s?.status ?? null }), suspended: t.status === "suspended",
    timezone: t.timezone, currency: t.currency, locale: t.locale, createdAt: t.createdAt,
    planId: s?.planId ?? null, plan: s ? titleCase(s.planId) : "", subscriptionStatus: s?.status ?? null, seats: s?.seats ?? null, seatsUsed: dto.seatsUsed, memberCount: dto.memberCount,
    trialEndsAt: s?.trialEndsAt ?? null, currentPeriodEnd: s?.currentPeriodEnd ?? null, cancelAtPeriodEnd: s?.cancelAtPeriodEnd ?? false, hasProviderSubscription: s?.hasProviderSubscription ?? false,
    overrides: dto.moduleOverrides.map((o) => ({ module: o.module, mode: o.mode, reason: o.reason, setAt: o.setAt })),
    lastActivityDate: dto.lastActivityDate, openDataRequests: dto.openDataRequests,
  }
}

export type LiveMetrics = { mrr: { currency: string; minor: number }[]; arr: { currency: string; minor: number }[]; trials: number; pastDue: number; churn: number }
const perCurrency = (r: Record<string, number>) => Object.entries(r).map(([currency, minor]) => ({ currency, minor }))
export const toMetrics = (dto: MetricsDto): LiveMetrics => ({ mrr: perCurrency(dto.mrrMinor), arr: perCurrency(dto.arrMinor), trials: dto.trials, pastDue: dto.pastDue, churn: dto.churnLast30Days })

export type LiveAuditLine = { seq: number; at: string; actor: string; action: string; entity: string; entityId: string; tenantId: string | null; before: unknown; after: unknown }
export const toAuditLines = (dto: AuditDto): LiveAuditLine[] => dto.map((r) => ({ seq: r.seq, at: r.at, actor: r.actorId, action: r.action, entity: r.entity, entityId: r.entityId, tenantId: r.targetTenantId, before: r.before, after: r.after }))

export const DSR_KIND: Record<string, string> = { export: "Export", erase: "Erase", correct: "Correct" }
export type LiveDataRequest = { id: string; tenantId: string; tenant: string; kind: string; kindLabel: string; status: string; createdAt: string; dueAt: string; overdue: boolean }
export type LiveDataRequests = { rows: LiveDataRequest[]; page: number; pageSize: number; total: number }
export const toDataRequests = (dto: DsrDto): LiveDataRequests => ({
  rows: dto.items.map((i) => ({ id: i.id, tenantId: i.tenantId, tenant: i.tenantName, kind: i.kind, kindLabel: DSR_KIND[i.kind] ?? titleCase(i.kind), status: i.status, createdAt: i.createdAt, dueAt: i.dueAt, overdue: i.overdue })),
  page: dto.page, pageSize: dto.pageSize, total: dto.total,
})

export type LiveStaff = StaffMember & { addedAt: string }
export const toStaffRows = (dto: StaffDto): LiveStaff[] => dto.map((m) => ({ id: m.userId, name: m.name, email: m.email, role: m.role as StaffRole, mfa: m.twoFactorEnabled, lastSignInAt: null, status: m.status === "suspended" ? "disabled" : "active", addedAt: m.addedAt }))

/** Settings views: a secret is never in them, only its last 4 as a hint. */
export type LiveEmail = { configured: false } | { configured: true; fromAddress: string; fromName: string; keyHint: string; updatedAt: string }
export const toEmailSettings = (dto: EmailDto): LiveEmail => (dto.configured ? { configured: true, fromAddress: dto.fromAddress, fromName: dto.fromName, keyHint: `••••${dto.keyLast4}`, updatedAt: dto.updatedAt } : { configured: false })
export type LiveStorage = { configured: false } | { configured: true; accountId: string; bucket: string; accessKeyId: string; secretHint: string; updatedAt: string }
export const toStorageSettings = (dto: StorageDto): LiveStorage => (dto.configured ? { configured: true, accountId: dto.accountId, bucket: dto.bucket, accessKeyId: dto.accessKeyId, secretHint: `••••${dto.secretLast4}`, updatedAt: dto.updatedAt } : { configured: false })
export type LiveBilling = { configured: false } | { configured: true; secretHint: string; webhookHint: string; publishableKey: string | null; priceMap: Record<string, string>; webhookUrl: string; updatedAt: string }
export const toBillingSettings = (dto: BillingDto): LiveBilling => (dto.configured ? { configured: true, secretHint: `••••${dto.secretKeyLast4}`, webhookHint: `••••${dto.webhookSecretLast4}`, publishableKey: dto.publishableKey, priceMap: dto.priceMap, webhookUrl: dto.webhookUrl, updatedAt: dto.updatedAt } : { configured: false })

/** The topbar pill: the Stripe mode, read from the publishable key's prefix (the API never returns the secret key). null when unknown, so no pill. */
export function billingMode(dto: BillingDto): { label: string; live: boolean } | null {
  if (!dto.configured || !dto.publishableKey) return null
  if (dto.publishableKey.startsWith("pk_live_")) return { label: "Live", live: true }
  if (dto.publishableKey.startsWith("pk_test_")) return { label: "Test mode", live: false }
  return null
}
