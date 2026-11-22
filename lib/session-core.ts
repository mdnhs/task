// The real session (B6 T6.3, rulings I5, I7, I8): who the caller is, which company they are in, their role there, the plan.
// Pure: every input is injected (cookies, the API client factory, the static plan table), so it is unit-tested with a fake fetch and has no Next import.
// lib/session.ts wraps it for server components (React cache, redirects).
//
// FAIL CLOSED. The presence of a session cookie proves nothing: only an answer from /v1/me does. A 401 is "expired", never "probably fine".
// The role comes from the API (/v1/me/tenant.member.role: the caller's own role, readable by every member), never from a cookie or a switcher,
// and an unknown or malformed access value reads as "none".
import type { ApiClient } from "./api/client"
import { ApiError } from "./api/problem"
import { DEFAULT_BRAND } from "./brand"
import { initialsOf } from "./branding"
import type { MfaPolicy } from "./mfa"
import { restrictRole, toTenantEntitlements, type EntitlementsData, type TenantEntitlements } from "./entitlements"
import type { Access, Module, Role, Tenant } from "./types"

export type PlatformRoleKey = "owner" | "support" | "billing" | "viewer"
export type SessionUser = { id: string; email: string; name: string }
export type Me = {
  user: SessionUser & { emailVerified: boolean; twoFactorEnabled: boolean }
  platformRole: PlatformRoleKey | null
  tenants: { slug: string; name: string; roleKey: string }[]
}

/** `mfa` says why the workspace is closed: "enrol" (the workspace requires two-step verification and this person has none) or "challenge" (this sign-in has not passed the code step). */
export type Session = {
  signedIn: boolean
  /** Already narrowed to the plan (FR-M0-15): modules outside the plan read as "none". */
  role: Role
  /** I8: only the current role. Settings pages fetch GET /v1/roles themselves. */
  roles: Role[]
  tenant: Tenant
  tenants: Tenant[]
  entitlements: TenantEntitlements
  user: SessionUser
  tenantSlug: string
  billingState: "ok" | "grace" | "blocked"
  /** ISO instants from /v1/entitlements (null when the plan has none): the banner formats them in the tenant zone. */
  trialEndsAt: string | null
  graceEndsAt: string | null
  device: { id: string | null; label: string; trusted: boolean }
  drive: boolean
  mfa: "ok" | "enrol" | "challenge"
  twoFactorEnabled: boolean
  mfaPolicy: MfaPolicy
  /** Only while the MFA gate is up: the role CATALOGUE entry (not the API's), used by the sidebar alone so people can still navigate. Never an authorisation: `role` stays fail-closed. */
  navRole?: Role
  platformRole: PlatformRoleKey | null
}

export type SessionDeps = {
  /** A Better Auth session cookie is present on the request (never proof of a session). */
  hasSessionCookie: boolean
  /** The od-tenant cookie (a slug), if valid-looking. */
  tenantCookie: string | null
  /** The API client; `tenant` overrides the cookie slug (see apiServer). */
  api: (o?: { tenant?: string | null }) => Promise<ApiClient>
  entitlementsData: () => Promise<EntitlementsData>
  /** Mock-era role extras (reportScope) and the console's platform role, from public/data/shell/roles.json. The roster level comes from the API. */
  staticRoles: () => Promise<Role[]>
}

export type Resolved =
  | { kind: "anonymous" }
  | { kind: "expired" }
  | { kind: "no_tenant"; me: Me }
  | { kind: "ok"; session: Session; me: Me; /** the od-tenant cookie does not name the tenant this session uses: repair it */ cookieStale: boolean }

const MODULES: Module[] = ["dashboard", "tasks", "reports", "attention", "staff", "shifts", "recruitment", "files", "payroll", "orders", "settings", "audit", "roster"]
const NO_ACCESS = Object.fromEntries(MODULES.map((m) => [m, "none"])) as Record<Module, Access>

const dateOnly = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : undefined)
const titleCase = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s)

function accessOf(raw: Record<string, unknown>): Record<Module, Access> {
  const out = { ...NO_ACCESS }
  for (const m of MODULES) {
    const v = raw[m]
    out[m] = v === "read" || v === "write" ? v : "none"
  }
  return out
}

function statusOf(ent: { status: string; billingState: string }): Tenant["status"] {
  if (ent.billingState === "blocked") return "suspended" // 402 on writes: read-only through the existing canWriteFor path (I20)
  switch (ent.status) {
    case "trialing": return "trial"
    case "active": return "active"
    case "past_due": return "past_due"
    default: return "suspended" // canceled, unpaid, paused, incomplete
  }
}

/** The tenants the shell lists (switcher): only name and slug are known without entering each; the active one is filled in by `activeTenant`. */
const listed = (t: Me["tenants"][number]): Tenant => ({ id: t.slug, name: t.name, slug: t.slug, initials: initialsOf(t.name), brand: DEFAULT_BRAND, status: "active", plan: "" })

const isStatus = (e: unknown, status: number, code?: string): e is ApiError => e instanceof ApiError && e.status === status && (code === undefined || e.code === code)

type TenantCtx = {
  tenant: { id: string; slug: string; name: string; mfaPolicy: MfaPolicy }
  member: { roleKey: string; role: { label: string; description: string; home: "manager" | "staff"; access: Record<string, string>; rosterLevel?: "office" | "supervisor" | null } }
  brand: { primaryColor: string | null }
  device: { id: string | null; label: string; trusted: boolean }
  features: { drive: boolean }
}

export async function resolveSession(deps: SessionDeps): Promise<Resolved> {
  if (!deps.hasSessionCookie) return { kind: "anonymous" }

  let me: Me
  try {
    me = (await (await deps.api({ tenant: null })).get("/v1/me")) as Me
  } catch (e) {
    if (isStatus(e, 401)) return { kind: "expired" }
    throw e
  }

  // The cookie's tenant first (when the caller is really a member), then the others in the API's order. A 404 means the membership was removed or
  // suspended (or the tenant is gone): try the next one.
  const slugs = me.tenants.map((t) => t.slug)
  const order = deps.tenantCookie && slugs.includes(deps.tenantCookie) ? [deps.tenantCookie, ...slugs.filter((s) => s !== deps.tenantCookie)] : slugs
  for (const slug of order) {
    const api = await deps.api({ tenant: slug })
    let ctx: TenantCtx
    try {
      ctx = (await api.get("/v1/me/tenant")) as unknown as TenantCtx
    } catch (e) {
      if (isStatus(e, 404)) continue
      if (isStatus(e, 401, "mfa_enrolment_required")) return gate(me, slug, "enrol", deps)
      if (isStatus(e, 401, "mfa_challenge")) return gate(me, slug, "challenge", deps)
      if (isStatus(e, 401)) return { kind: "expired" }
      throw e
    }
    const [entData, ent, statics] = await Promise.all([deps.entitlementsData(), api.get("/v1/entitlements"), deps.staticRoles()])
    const entitlements: TenantEntitlements = toTenantEntitlements(ent, entData)
    const extras = statics.find((r) => r.id === ctx.member.roleKey && !r.platform)
    const role: Role = restrictRole(
      {
        id: ctx.member.roleKey,
        label: ctx.member.role.label,
        description: ctx.member.role.description,
        home: ctx.member.role.home,
        access: accessOf(ctx.member.role.access),
        // the API's roster level (a custom role may have one, a template may have lost it): it decides whether the shell offers Location Rosters (Task 23 review I2)
        ...(ctx.member.role.rosterLevel ? { rosterLevel: ctx.member.role.rosterLevel } : {}),
        ...(extras?.reportScope ? { reportScope: extras.reportScope } : {}),
      },
      entitlements,
    )
    const status = statusOf(ent)
    const tenant: Tenant = {
      id: ctx.tenant.id, name: ctx.tenant.name, slug: ctx.tenant.slug, initials: initialsOf(ctx.tenant.name), brand: ctx.brand.primaryColor ?? DEFAULT_BRAND,
      status, plan: ent.status === "trialing" ? "Trial" : titleCase(ent.planId),
      ...(ent.trialEndsAt ? { trialEndsOn: dateOnly(ent.trialEndsAt) } : {}),
      ...(ent.graceEndsAt && (status === "past_due" || status === "suspended") ? { graceEndsOn: dateOnly(ent.graceEndsAt) } : {}),
    }
    const session: Session = {
      signedIn: true, role, roles: [role], tenant, tenants: me.tenants.map((t) => (t.slug === ctx.tenant.slug ? tenant : listed(t))), entitlements,
      user: { id: me.user.id, email: me.user.email, name: me.user.name }, tenantSlug: ctx.tenant.slug, billingState: ent.billingState, trialEndsAt: ent.trialEndsAt, graceEndsAt: ent.graceEndsAt,
      device: { id: ctx.device.id, label: ctx.device.label, trusted: ctx.device.trusted }, drive: ctx.features.drive === true,
      mfa: "ok", twoFactorEnabled: me.user.twoFactorEnabled, mfaPolicy: ctx.tenant.mfaPolicy, platformRole: me.platformRole,
    }
    return { kind: "ok", session, me, cookieStale: slug !== deps.tenantCookie }
  }
  return { kind: "no_tenant", me }
}

/** The workspace is closed until the second factor is in place: no role, no plan, no tenant data (the API refused them). */
async function gate(me: Me, slug: string, mfa: "enrol" | "challenge", deps: SessionDeps): Promise<Resolved> {
  const [entData, statics] = await Promise.all([deps.entitlementsData(), deps.staticRoles()])
  const t = me.tenants.find((x) => x.slug === slug)!
  const role: Role = { id: t.roleKey, label: t.roleKey, description: "", home: "staff", access: { ...NO_ACCESS } }
  const tenant = listed(t)
  // Sidebar only: a custom role the catalogue does not know gets Dashboard alone (never a guess at its grants).
  const navRole: Role = statics.find((r) => r.id === t.roleKey && !r.platform) ?? { ...role, access: { ...NO_ACCESS, dashboard: "read" } }
  const session: Session = {
    signedIn: true, role, navRole, roles: [role], tenant, tenants: me.tenants.map(listed),
    entitlements: { planId: entData.defaultPlan, allowed: [], modules: entData.modules, assistant: entData.assistant },
    user: { id: me.user.id, email: me.user.email, name: me.user.name }, tenantSlug: slug, billingState: "ok", trialEndsAt: null, graceEndsAt: null,
    device: { id: null, label: "Unregistered browser", trusted: false }, drive: false, mfa,
    twoFactorEnabled: me.user.twoFactorEnabled, mfaPolicy: { mode: "off", roles: [] }, platformRole: me.platformRole,
  }
  return { kind: "ok", session, me, cookieStale: slug !== deps.tenantCookie }
}

/**
 * The console's second-factor state (B6 T6.8, carry-in from T6.3): the same three answers a company page gets, from the same source. Every /v1/platform route needs an
 * enrolled factor AND a session that passed it (401 mfa_enrolment_required / mfa_challenge), always, with no policy switch. A person with no factor is known from /v1/me
 * alone; otherwise one cheap staff-gated read (GET /v1/platform/session: one staff lookup, open to every staff role, no tenant query) shows whether this session passed the code step. Any other refusal is
 * not an MFA answer and is thrown.
 */
export async function resolvePlatformMfa(me: Pick<Me, "user">, api: { get(path: "/v1/platform/session"): Promise<unknown> }): Promise<"ok" | "enrol" | "challenge"> {
  if (!me.user.twoFactorEnabled) return "enrol"
  try {
    await api.get("/v1/platform/session")
    return "ok"
  } catch (e) {
    if (isStatus(e, 401, "mfa_enrolment_required")) return "enrol"
    if (isStatus(e, 401, "mfa_challenge")) return "challenge"
    throw e
  }
}
