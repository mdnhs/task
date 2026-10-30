// Server-only: reads request cookies. Import from server components/actions, never from "use client" files.
import { cookies } from "next/headers"
import { getData } from "./data"
import { restrictRole, type TenantEntitlements } from "./entitlements"
import { getTenantEntitlements } from "./entitlements-data"
import { canWriteFor } from "./permissions"
import { parseAppearance } from "./appearance"
import type { Module, Role, Tenant } from "./types"

// `role` is already narrowed to the tenant's plan (FR-M0-15): modules outside the plan read as "none", so every can() check follows the plan.
export type Session = { signedIn: boolean; role: Role; tenant: Tenant; roles: Role[]; tenants: Tenant[]; entitlements: TenantEntitlements }

export async function getSession(): Promise<Session> {
  const [{ roles }, { tenants }, jar] = await Promise.all([
    getData<{ roles: Role[] }>("shell/roles.json"),
    getData<{ tenants: Tenant[] }>("shell/tenants.json"),
    cookies(),
  ])
  const role = roles.find((r) => r.id === jar.get("od-role")?.value) ?? roles.find((r) => r.id === "owner") ?? roles[0]
  const all = tenants.map((t) => withBranding(t, jar.get(`od-brand-${t.id}`)?.value))
  const tenant = all.find((t) => t.id === jar.get("od-tenant")?.value) ?? all[0]
  const entitlements = await getTenantEntitlements(tenant.id)
  return { signedIn: jar.get("od-auth")?.value !== "out", role: restrictRole(role, entitlements), tenant, roles, tenants: all, entitlements }
}

// Saved branding (see saveBranding) overrides the seed name, colour and appearance; a bad cookie is ignored.
function withBranding(t: Tenant, raw: string | undefined): Tenant {
  if (!raw) return t
  try {
    const b = JSON.parse(raw) as { name?: string; color?: string; appearance?: unknown }
    const name = b.name?.trim() || t.name
    const initials = name === t.name ? t.initials : name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("")
    return { ...t, name, initials, brand: /^#[0-9a-f]{6}$/i.test(b.color ?? "") ? b.color! : t.brand, ...(b.appearance ? { appearance: parseAppearance(b.appearance) } : {}) }
  } catch {
    return t
  }
}

// Suspended tenants are read-only (FR-SAAS-08).
export function canWrite(s: Session, m: Module): boolean {
  return canWriteFor(s.role, s.tenant.status, m)
}
