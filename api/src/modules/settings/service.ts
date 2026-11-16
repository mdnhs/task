import { and, between, eq, sql } from "drizzle-orm"
import { AppError } from "../../core/errors"
import { files, publicHolidays, tenants, tenantSettings } from "../../db/schema"
import { withTenant, type TenantTx } from "../../db/tenant-tx"
import type { Deps } from "../../deps"
import { recordAudit } from "../audit"
import { lockActor } from "../rbac"
import { onboardingDefaults } from "../tenants"

const SETTINGS_LOCK_NS = 0x73657474 // "sett"
/** Serialises settings writes per tenant (take FIRST, before lockActor; the audit lock stays last). */
const lockSettings = (tx: TenantTx, tenantId: string) => tx.execute(sql`select pg_advisory_xact_lock(${SETTINGS_LOCK_NS}::int, hashtext(${tenantId}::text))`)

const unprocessable = (code: string) => new AppError(422, code, "Unprocessable Entity")

// ------------------------------------------------------------------ validation

/** IANA zone known to this runtime's ICU; returns the canonical spelling. Offsets ("+01:00") are not zone names. */
export function canonicalTimezone(v: string): string | null {
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(v)) return null
  try {
    return new Intl.DateTimeFormat("en", { timeZone: v }).resolvedOptions().timeZone
  } catch {
    return null
  }
}
/** A single well-formed BCP-47 tag (canonicalised), or null. */
export function canonicalLocale(v: string): string | null {
  if (!v || v.includes("*")) return null
  try {
    const l = Intl.getCanonicalLocales(v)
    return l.length === 1 ? l[0] : null
  } catch {
    return null
  }
}
const CURRENCIES = new Set((Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("currency"))
/** ISO 4217 alphabetic code known to this runtime. */
export const isCurrency = (v: string): boolean => /^[A-Z]{3}$/.test(v) && CURRENCIES.has(v)
export const isDeadline = (v: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
export const isColor = (v: string): boolean => /^#[0-9A-Fa-f]{6}$/.test(v)
const NAME = /^[^\r\n\u0000-\u001f\u007f]+$/

// ------------------------------------------------------------------ organisation

export type OrganisationDto = { name: string; slug: string; timezone: string; currency: string; locale: string; reportDeadline: string }
export type OrganisationPatch = Partial<Pick<OrganisationDto, "name" | "timezone" | "currency" | "locale" | "reportDeadline">>
type Org = Omit<OrganisationDto, "slug">
const ORG_KEYS = ["name", "timezone", "currency", "locale", "reportDeadline"] as const

async function readSetting(tx: TenantTx, tenantId: string, key: string): Promise<unknown> {
  const [r] = await tx.select({ value: tenantSettings.value }).from(tenantSettings).where(and(eq(tenantSettings.tenantId, tenantId), eq(tenantSettings.key, key)))
  return r?.value
}
async function writeSetting(tx: TenantTx, tenantId: string, key: string, value: unknown): Promise<void> {
  await tx.insert(tenantSettings).values({ tenantId, key, value }).onConflictDoUpdate({ target: [tenantSettings.tenantId, tenantSettings.key], set: { value } })
}

async function readOrg(tx: TenantTx, tenantId: string, lock = false): Promise<OrganisationDto> {
  const q = tx.select().from(tenants).where(eq(tenants.id, tenantId))
  const [t] = lock ? await q.for("update") : await q
  const dl = await readSetting(tx, tenantId, "report_deadline")
  // The default is DATA (public/data/auth/onboarding-defaults.json `deadline`), never a literal in code.
  const reportDeadline = typeof dl === "string" && isDeadline(dl) ? dl : onboardingDefaults().deadline
  return { name: t.name, slug: t.slug, timezone: t.timezone, currency: t.currency, locale: t.locale, reportDeadline }
}
export const getOrganisation = (tx: TenantTx, tenantId: string) => readOrg(tx, tenantId)

export async function patchOrganisation(deps: Deps, tenantId: string, actorId: string, patch: OrganisationPatch): Promise<OrganisationDto> {
  const next: OrganisationPatch = {}
  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (!name || name.length > 120 || !NAME.test(name)) throw unprocessable("invalid_name")
    next.name = name
  }
  if (patch.timezone !== undefined) {
    const tz = canonicalTimezone(patch.timezone)
    if (!tz) throw unprocessable("invalid_timezone")
    next.timezone = tz
  }
  if (patch.locale !== undefined) {
    const l = canonicalLocale(patch.locale)
    if (!l) throw unprocessable("invalid_locale")
    next.locale = l
  }
  if (patch.currency !== undefined) {
    if (!isCurrency(patch.currency)) throw unprocessable("invalid_currency")
    next.currency = patch.currency
  }
  if (patch.reportDeadline !== undefined) {
    if (!isDeadline(patch.reportDeadline)) throw unprocessable("invalid_report_deadline")
    next.reportDeadline = patch.reportDeadline
  }
  return withTenant(deps.db, tenantId, async (tx) => {
    await lockSettings(tx, tenantId)
    await lockActor(tx, tenantId, actorId, "settings", "write")
    const cur = await readOrg(tx, tenantId, true)
    const keys = ORG_KEYS.filter((k) => next[k] !== undefined && next[k] !== cur[k])
    if (keys.length === 0) return cur // nothing changes: no write, no audit entry
    const before: Partial<Org> = {}
    const after: Partial<Org> = {}
    for (const k of keys) {
      before[k] = cur[k]
      after[k] = next[k]
    }
    const cols: Partial<Record<"name" | "timezone" | "currency" | "locale", string>> = {}
    for (const k of keys) if (k !== "reportDeadline") cols[k] = next[k]
    if (Object.keys(cols).length > 0) await tx.update(tenants).set(cols).where(eq(tenants.id, tenantId))
    if (after.reportDeadline !== undefined) await writeSetting(tx, tenantId, "report_deadline", after.reportDeadline)
    await recordAudit(tx, tenantId, { action: "tenant.settings_updated", entity: "tenant", entityId: tenantId, actorId, before, after }, deps.clock.now())
    return { ...cur, ...after }
  })
}

// ------------------------------------------------------------------ branding

export type BrandingDto = { logoFileId: string | null; primaryColor: string | null }

async function readBranding(tx: TenantTx, tenantId: string): Promise<BrandingDto> {
  const v = (await readSetting(tx, tenantId, "branding")) as Partial<BrandingDto> | undefined
  return { logoFileId: typeof v?.logoFileId === "string" ? v.logoFileId : null, primaryColor: typeof v?.primaryColor === "string" ? v.primaryColor : null }
}
export const getBranding = readBranding

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function putBranding(deps: Deps, tenantId: string, actorId: string, input: BrandingDto): Promise<BrandingDto> {
  if (input.primaryColor !== null && !isColor(input.primaryColor)) throw unprocessable("invalid_color")
  if (input.logoFileId !== null && !UUID.test(input.logoFileId)) throw unprocessable("invalid_logo")
  return withTenant(deps.db, tenantId, async (tx) => {
    await lockSettings(tx, tenantId)
    await lockActor(tx, tenantId, actorId, "settings", "write")
    if (input.logoFileId !== null) {
      // a CLEAN (scanned) file of this tenant; share-locked so it cannot be deleted under us
      const [f] = await tx.select({ id: files.id }).from(files).where(and(eq(files.id, input.logoFileId), eq(files.tenantId, tenantId), eq(files.status, "clean"))).for("share")
      if (!f) throw unprocessable("invalid_logo")
    }
    const before = await readBranding(tx, tenantId)
    const after: BrandingDto = { logoFileId: input.logoFileId, primaryColor: input.primaryColor }
    await writeSetting(tx, tenantId, "branding", after)
    await recordAudit(tx, tenantId, { action: "tenant.branding_updated", entity: "tenant", entityId: tenantId, actorId, before, after }, deps.clock.now())
    return after
  })
}

// ------------------------------------------------------------------ holidays

export type Holiday = { date: string; name: string }

const yearBounds = (year: number) => [`${year}-01-01`, `${year}-12-31`] as const
const realDate = (s: string): boolean => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.toISOString().slice(0, 10) === s
}

async function holidaysOf(tx: TenantTx, tenantId: string, year: number): Promise<Holiday[]> {
  const [from, to] = yearBounds(year)
  return tx.select({ date: publicHolidays.date, name: publicHolidays.name }).from(publicHolidays).where(and(eq(publicHolidays.tenantId, tenantId), between(publicHolidays.date, from, to))).orderBy(publicHolidays.date)
}
export const getHolidays = holidaysOf

/** The current calendar year in the tenant's own timezone (never the server's). */
export async function currentYear(tx: TenantTx, tenantId: string, now: Date): Promise<number> {
  const [t] = await tx.select({ tz: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId))
  const year = (tz: string) => Number(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric" }).format(now))
  try {
    return year(t.tz)
  } catch {
    return year("UTC")
  }
}

export async function replaceHolidays(deps: Deps, tenantId: string, actorId: string, year: number, holidays: Holiday[]): Promise<Holiday[]> {
  const seen = new Set<string>()
  const clean: Holiday[] = []
  for (const h of holidays) {
    if (!realDate(h.date)) throw unprocessable("invalid_holiday_date")
    if (!h.date.startsWith(`${year}-`)) throw unprocessable("holiday_out_of_year")
    const name = h.name.trim()
    if (!name || name.length > 120 || !NAME.test(name)) throw unprocessable("invalid_holiday_name")
    if (seen.has(h.date)) throw unprocessable("duplicate_holiday_date")
    seen.add(h.date)
    clean.push({ date: h.date, name })
  }
  clean.sort((a, b) => a.date.localeCompare(b.date))
  return withTenant(deps.db, tenantId, async (tx) => {
    await lockSettings(tx, tenantId)
    await lockActor(tx, tenantId, actorId, "settings", "write")
    const before = await holidaysOf(tx, tenantId, year)
    const [from, to] = yearBounds(year)
    await tx.delete(publicHolidays).where(and(eq(publicHolidays.tenantId, tenantId), between(publicHolidays.date, from, to)))
    if (clean.length > 0) await tx.insert(publicHolidays).values(clean.map((h) => ({ tenantId, ...h })))
    await recordAudit(
      tx, tenantId,
      { action: "tenant.holidays_replaced", entity: "tenant", entityId: tenantId, actorId, before: { year, holidays: before }, after: { year, holidays: clean } },
      deps.clock.now(),
    )
    return clean
  })
}
