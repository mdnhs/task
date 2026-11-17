// Server-only: the real session (B6 T6.3). Import from server components and server actions, never from "use client" files.
// proxy.ts only does an OPTIMISTIC redirect (no session cookie -> /sign-in). THIS is the real check: every protected render asks the API who the caller is
// (one /v1/me per request, memoised by React's per-request cache), and an invalid cookie is a redirect before any page data is read.
import "server-only"
import { cache } from "react"
import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import { apiServer } from "./api/server"
import { hasSessionCookie } from "./api/cookies"
import { parseAppearance } from "./appearance"
import { DEFAULT_BRAND } from "./brand"
import { getData } from "./data"
import type { EntitlementsData } from "./entitlements"
import { canWriteFor } from "./permissions"
import { resolveSession, type Me, type Resolved, type Session } from "./session-core"
import { TENANT_COOKIE, isTenantSlug } from "./api/tenant"
import type { Module, Role, Tenant } from "./types"

export type { Session } from "./session-core"

/** Where an expired session lands: a route handler (a server component cannot delete cookies) that clears the session and tenant cookies once, then goes to /sign-in?reason=expired. */
export const EXPIRED_PATH = "/api/session/expired"
/** Where a missing or stale od-tenant is repaired: a route handler that verifies the memberships and sets the cookie, then returns to `next`. */
export const TENANT_REPAIR_PATH = "/api/session/tenant"

const resolved = cache(async (): Promise<Resolved> => {
  const jar = await cookies()
  const slug = jar.get(TENANT_COOKIE)?.value
  return resolveSession({
    hasSessionCookie: hasSessionCookie(jar.getAll().map((c) => c.name)),
    tenantCookie: isTenantSlug(slug) ? slug : null,
    api: (o) => apiServer(o),
    entitlementsData: () => getData<EntitlementsData>("billing/entitlements.json"),
    staticRoles: async () => (await getData<{ roles: Role[] }>("shell/roles.json")).roles,
  })
})

async function landing(): Promise<string> {
  const h = await headers()
  return `${h.get("x-od-path") ?? "/"}${h.get("x-od-search") ?? ""}`
}

/** The session for a company page. Never returns a half-signed-in state: signed out, expired and company-less callers are redirected (a thrown redirect). */
export async function getSession(): Promise<Session> {
  const r = await resolved()
  switch (r.kind) {
    case "anonymous": return redirect("/sign-in")
    case "expired": return redirect(EXPIRED_PATH)
    case "no_tenant": return redirect(r.me.platformRole ? "/platform" : "/onboarding")
    case "ok":
      if (r.cookieStale) redirect(`${TENANT_REPAIR_PATH}?next=${encodeURIComponent(await landing())}`)
      return withBranding(r.session, (await cookies()).get(`od-brand-${r.session.tenant.id}`)?.value)
  }
}

/** Who the caller is, with or without a company (onboarding, the console): redirects only a signed-out or expired caller. */
export async function getIdentity(): Promise<{ me: Me; hasTenant: boolean }> {
  const r = await resolved()
  switch (r.kind) {
    case "anonymous": return redirect("/sign-in")
    case "expired": return redirect(EXPIRED_PATH)
    case "no_tenant": return { me: r.me, hasTenant: false }
    case "ok": return { me: r.me, hasTenant: true }
  }
}

/** The session or null: never redirects. For skeletons and fallbacks, where a thrown redirect would be wrong. */
export async function peekSession(): Promise<Session | null> {
  const r = await resolved()
  return r.kind === "ok" ? r.session : null
}

/** The console's session (/platform): staff need no company. Anyone who is not active staff keeps their company role, which the console answers with "Access restricted". */
export async function getPlatformSession(): Promise<Session> {
  const r = await resolved()
  switch (r.kind) {
    case "anonymous": return redirect("/sign-in")
    case "expired": return redirect(EXPIRED_PATH)
    case "no_tenant": if (!r.me.platformRole) return redirect("/onboarding")
  }
  return platformSessionOf(r)
}

/** Like getPlatformSession but never redirects (null when there is no console session): for skeletons. */
export async function peekPlatformSession(): Promise<Session | null> {
  const r = await resolved()
  if (r.kind === "ok" || (r.kind === "no_tenant" && r.me.platformRole)) return platformSessionOf(r)
  return null
}

async function platformSessionOf(r: Extract<Resolved, { kind: "ok" } | { kind: "no_tenant" }>): Promise<Session> {
  if (r.kind === "ok") {
    if (r.session.platformRole === null) return r.session
    const role = await platformRole()
    return { ...r.session, role, roles: [role] }
  }
  const role = await platformRole()
  const tenant: Tenant = { id: "platform", name: "OpsDesk", slug: "opsdesk", initials: "OD", brand: DEFAULT_BRAND, status: "active", plan: "" }
  const entData = await getData<EntitlementsData>("billing/entitlements.json")
  return {
    signedIn: true, role, roles: [role], tenant, tenants: [], entitlements: { planId: entData.defaultPlan, allowed: [], modules: entData.modules, assistant: entData.assistant },
    user: { id: r.me.user.id, email: r.me.user.email, name: r.me.user.name }, tenantSlug: "", billingState: "ok", device: { id: null, label: "Unregistered browser", trusted: false },
    drive: false, mfa: "ok", twoFactorEnabled: r.me.user.twoFactorEnabled, mfaPolicy: { mode: "off", roles: [] }, platformRole: r.me.platformRole,
  }
}

async function platformRole(): Promise<Role> {
  const { roles } = await getData<{ roles: Role[] }>("shell/roles.json")
  const role = roles.find((x) => x.platform)
  if (!role) throw new Error("the platform role is missing from shell/roles.json")
  return role
}

// Saved branding (see saveBranding, still a mock until the settings task) overrides the API's name, colour and appearance; a bad cookie is ignored.
function withBranding(s: Session, raw: string | undefined): Session {
  if (!raw) return s
  const t = s.tenant
  try {
    const b = JSON.parse(raw) as { name?: string; color?: string; appearance?: unknown }
    const name = b.name?.trim() || t.name
    const initials = name === t.name ? t.initials : name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("")
    const tenant = { ...t, name, initials, brand: /^#[0-9a-f]{6}$/i.test(b.color ?? "") ? b.color! : t.brand, ...(b.appearance ? { appearance: parseAppearance(b.appearance) } : {}) }
    return { ...s, tenant, tenants: s.tenants.map((x) => (x.slug === t.slug ? tenant : x)) }
  } catch {
    return s
  }
}

// Suspended tenants are read-only (FR-SAAS-08).
export function canWrite(s: Session, m: Module): boolean {
  return canWriteFor(s.role, s.tenant.status, m)
}
