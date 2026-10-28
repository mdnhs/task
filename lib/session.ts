// Server-only: reads request cookies. Import from server components/actions, never from "use client" files.
import { cookies } from "next/headers"
import { getData } from "./data"
import { canWriteFor } from "./permissions"
import type { Module, Role, Tenant } from "./types"

export type Session = { signedIn: boolean; role: Role; tenant: Tenant; roles: Role[]; tenants: Tenant[] }

export async function getSession(): Promise<Session> {
  const [{ roles }, { tenants }, jar] = await Promise.all([
    getData<{ roles: Role[] }>("shell/roles.json"),
    getData<{ tenants: Tenant[] }>("shell/tenants.json"),
    cookies(),
  ])
  const role = roles.find((r) => r.id === jar.get("od-role")?.value) ?? roles.find((r) => r.id === "owner") ?? roles[0]
  const all = tenants.map((t) => withBranding(t, jar.get(`od-brand-${t.id}`)?.value))
  const tenant = all.find((t) => t.id === jar.get("od-tenant")?.value) ?? all[0]
  return { signedIn: jar.get("od-auth")?.value !== "out", role, tenant, roles, tenants: all }
}

// Saved branding (see saveBranding) overrides the seed name and colour; a bad cookie is ignored.
function withBranding(t: Tenant, raw: string | undefined): Tenant {
  if (!raw) return t
  try {
    const b = JSON.parse(raw) as { name?: string; color?: string }
    const name = b.name?.trim() || t.name
    const initials = name === t.name ? t.initials : name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("")
    return { ...t, name, initials, brand: /^#[0-9a-f]{6}$/i.test(b.color ?? "") ? b.color! : t.brand }
  } catch {
    return t
  }
}

// Suspended tenants are read-only (FR-SAAS-08).
export function canWrite(s: Session, m: Module): boolean {
  return canWriteFor(s.role, s.tenant.status, m)
}
