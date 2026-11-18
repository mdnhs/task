import { createHash } from "node:crypto"
import { and, between, eq, sql } from "drizzle-orm"
import { AppError } from "../../core/errors"
import { files, publicHolidays, tenants, tenantSettings } from "../../db/schema"
import { withTenant, type TenantTx } from "../../db/tenant-tx"
import type { Deps } from "../../deps"
import { recordAudit } from "../audit"
import { isScopedPurpose } from "../files"
import { lockActor } from "../rbac"
import { onboardingDefaults } from "../tenants"

const SETTINGS_LOCK_NS = 0x73657474 // "sett"
/** Serialises settings writes per tenant (take FIRST, before lockActor; the audit lock stays last). */
export const lockSettings = (tx: TenantTx, tenantId: string) => tx.execute(sql`select pg_advisory_xact_lock(${SETTINGS_LOCK_NS}::int, hashtext(${tenantId}::text))`)

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

export type OrganisationDto = { name: string; slug: string; timezone: string; currency: string; locale: string; reportDeadline: string; reportDueAfterMinutes: number }
export type OrganisationPatch = Partial<Pick<OrganisationDto, "name" | "timezone" | "currency" | "locale" | "reportDeadline" | "reportDueAfterMinutes">>
const ORG_KEYS = ["name", "timezone", "currency", "locale", "reportDeadline", "reportDueAfterMinutes"] as const
export const isDueAfterMinutes = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 1440

async function readSetting(tx: TenantTx, tenantId: string, key: string): Promise<unknown> {
  const [r] = await tx.select({ value: tenantSettings.value }).from(tenantSettings).where(and(eq(tenantSettings.tenantId, tenantId), eq(tenantSettings.key, key)))
  return r?.value
}
async function writeSetting(tx: TenantTx, tenantId: string, key: string, value: unknown): Promise<void> {
  await tx.insert(tenantSettings).values({ tenantId, key, value }).onConflictDoUpdate({ target: [tenantSettings.tenantId, tenantSettings.key], set: { value } })
}

/**
 * How long after a shift ends its end-of-shift report is due (FR-M1-21, Q7, F13): the tenant setting `report_due_after_minutes` (0-1440, edited with
 * PATCH /v1/settings/organisation), else the default from DATA (onboarding-defaults.json `reportDueAfterMinutes`), never a literal in code.
 */
export async function reportDueAfterMinutes(tx: TenantTx, tenantId: string): Promise<number> {
  const v = await readSetting(tx, tenantId, "report_due_after_minutes")
  return isDueAfterMinutes(v) ? v : onboardingDefaults().reportDueAfterMinutes
}

async function readOrg(tx: TenantTx, tenantId: string, lock = false): Promise<OrganisationDto> {
  const q = tx.select().from(tenants).where(eq(tenants.id, tenantId))
  const [t] = lock ? await q.for("update") : await q
  const dl = await readSetting(tx, tenantId, "report_deadline")
  // The default is DATA (public/data/auth/onboarding-defaults.json `deadline`), never a literal in code.
  const reportDeadline = typeof dl === "string" && isDeadline(dl) ? dl : onboardingDefaults().deadline
  return { name: t.name, slug: t.slug, timezone: t.timezone, currency: t.currency, locale: t.locale, reportDeadline, reportDueAfterMinutes: await reportDueAfterMinutes(tx, tenantId) }
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
  if (patch.reportDueAfterMinutes !== undefined) {
    if (!isDueAfterMinutes(patch.reportDueAfterMinutes)) throw unprocessable("invalid_report_due")
    next.reportDueAfterMinutes = patch.reportDueAfterMinutes
  }
  return withTenant(deps.db, tenantId, async (tx) => {
    await lockSettings(tx, tenantId)
    await lockActor(tx, tenantId, actorId, "settings", "write")
    const cur = await readOrg(tx, tenantId, true)
    const keys = ORG_KEYS.filter((k) => next[k] !== undefined && next[k] !== cur[k])
    if (keys.length === 0) return cur // nothing changes: no write, no audit entry
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    for (const k of keys) {
      before[k] = cur[k]
      after[k] = next[k]
    }
    const cols: Partial<Record<"name" | "timezone" | "currency" | "locale", string>> = {}
    for (const k of keys) if (k !== "reportDeadline" && k !== "reportDueAfterMinutes") cols[k] = next[k]
    if (Object.keys(cols).length > 0) await tx.update(tenants).set(cols).where(eq(tenants.id, tenantId))
    if (after.reportDeadline !== undefined) await writeSetting(tx, tenantId, "report_deadline", after.reportDeadline)
    if (after.reportDueAfterMinutes !== undefined) await writeSetting(tx, tenantId, "report_due_after_minutes", after.reportDueAfterMinutes)
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
      // not a task or report file (isScopedPurpose, C6): those are private to their task or report and 404 on /v1/files, so a settings:write holder must not publish one as the logo
      const [f] = await tx.select({ id: files.id, purpose: files.purpose }).from(files).where(and(eq(files.id, input.logoFileId), eq(files.tenantId, tenantId), eq(files.status, "clean"))).for("share")
      if (!f || isScopedPurpose(f.purpose)) throw unprocessable("invalid_logo")
    }
    const before = await readBranding(tx, tenantId)
    const after: BrandingDto = { logoFileId: input.logoFileId, primaryColor: input.primaryColor }
    await writeSetting(tx, tenantId, "branding", after)
    await recordAudit(tx, tenantId, { action: "tenant.branding_updated", entity: "tenant", entityId: tenantId, actorId, before, after }, deps.clock.now())
    return after
  })
}

// ------------------------------------------------------------------ report template (FR-M1-25, T5.3)

const REPORT_TEMPLATE_KEY = "report_template"

/** The stored report template (`TemplateData`, validated by the shift-reports module before it gets here), or undefined when the tenant never set one (then the default is DATA, ruling F13). */
export const readReportTemplate = (tx: TenantTx, tenantId: string): Promise<unknown> => readSetting(tx, tenantId, REPORT_TEMPLATE_KEY)

/** The strong ETag of the STORED template (ruling S6): a hash of what the settings row holds, so any rewrite of it (a save, a team rename carrying the department name) changes it. Unset hashes as null. */
export const reportTemplateEtag = (stored: unknown): string => `"${createHash("sha256").update(JSON.stringify(stored ?? null)).digest("hex").slice(0, 32)}"`

/** RFC 9110 If-Match, strong comparison: a list of quoted tags; a weak tag (W/) and `*` never match (the template always exists, so `*` would defeat the check). */
export const ifMatchHolds = (header: string, etag: string): boolean => header.split(",").some((t) => t.trim() === etag)

/** The current ETag, read in the caller's tx. */
export const readReportTemplateEtag = async (tx: TenantTx, tenantId: string): Promise<string> => reportTemplateEtag(await readSetting(tx, tenantId, REPORT_TEMPLATE_KEY))

const shape = (v: unknown): { custom: boolean; departments: number } => {
  const d = (v as { departments?: unknown } | undefined)?.departments
  return Array.isArray(d) ? { custom: true, departments: d.length } : { custom: false, departments: 0 }
}

/**
 * Replaces the tenant's report template. Lock order: the settings advisory lock, the actor lock (`settings:write`, role re-read FOR SHARE), the write, the audit (ids and counts only,
 * never the labels). It applies to NEW submissions only: a saved report is never re-validated, and submit reads the template in force when it runs.
 */
export async function putReportTemplate(deps: Deps, tenantId: string, actorId: string, value: object, ifMatch: string): Promise<void> {
  await withTenant(deps.db, tenantId, async (tx) => {
    await lockSettings(tx, tenantId)
    await lockActor(tx, tenantId, actorId, "settings", "write")
    const stored = await readSetting(tx, tenantId, REPORT_TEMPLATE_KEY)
    // compared AFTER the locks: the loser of two PUTs with the same tag reads what the winner committed (412 with the current tag, nothing written)
    const current = reportTemplateEtag(stored)
    if (!ifMatchHolds(ifMatch, current)) throw new AppError(412, "precondition_failed", "Precondition Failed", undefined, { etag: current })
    const before = shape(stored)
    await writeSetting(tx, tenantId, REPORT_TEMPLATE_KEY, value)
    await recordAudit(tx, tenantId, { action: "tenant.report_template_updated", entity: "tenant", entityId: tenantId, actorId, before, after: shape(value) }, deps.clock.now())
  })
}

/**
 * Team rename (ruling I26): the report template is keyed by team name, so the entry named `from` becomes `to` in the same transaction as the rename. Returns whether the stored template
 * changed (nothing is written when none is stored or no entry matches). 409 template_dept_exists when the template already holds an entry named `to` (no silent merge of two entries).
 * The caller holds the settings lock (lockSettings) and the actor lock. No separate audit row: the team.updated entry carries `reportTemplateRenamed`.
 */
export async function renameTemplateDept(tx: TenantTx, tenantId: string, from: string, to: string): Promise<boolean> {
  const stored = (await readSetting(tx, tenantId, REPORT_TEMPLATE_KEY)) as { departments?: { dept?: unknown }[] } | undefined
  if (!stored || !Array.isArray(stored.departments)) return false
  if (!stored.departments.some((d) => d.dept === from)) return false
  if (stored.departments.some((d) => d.dept === to)) throw new AppError(409, "template_dept_exists", "Conflict")
  await writeSetting(tx, tenantId, REPORT_TEMPLATE_KEY, { ...stored, departments: stored.departments.map((d) => (d.dept === from ? { ...d, dept: to } : d)) })
  return true
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
