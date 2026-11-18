// A fake API + request for the session tests (no Next, no network): /v1/me, /v1/me/tenant, /v1/entitlements answered from a small description.
import { makeApiClient } from "@/lib/api/client"
import type { EntitlementsData } from "@/lib/entitlements"
import type { SessionDeps } from "@/lib/session-core"
import type { Role } from "@/lib/types"

export const ENT_DATA: EntitlementsData = {
  productModules: [{ id: "M0", label: "Core", description: "" }, { id: "M1", label: "Tasks", description: "" }, { id: "M4", label: "People", description: "" }],
  modules: { dashboard: "M0", settings: "M0", audit: "M0", tasks: "M1", reports: "M1", files: "M4" },
  assistant: "M2",
  defaultPlan: "starter",
  core: ["M0"],
  plans: { starter: ["M0", "M1"], business: ["M0", "M1", "M4"] },
}
export const STATIC_ROLES: Role[] = [
  { id: "owner", label: "Tenant Owner", description: "", home: "manager", access: {} as Role["access"], rosterLevel: "office" },
  { id: "manager", label: "Manager", description: "", home: "manager", access: {} as Role["access"], reportScope: "team" },
  { id: "platform", label: "Platform", description: "", home: "manager", access: { dashboard: "read" } as Role["access"], platform: true },
]
const ALL = ["dashboard", "tasks", "reports", "attention", "staff", "shifts", "recruitment", "files", "payroll", "orders", "settings", "audit", "roster"]
const access = (v: "none" | "read" | "write") => Object.fromEntries(ALL.map((m) => [m, v]))

type Tenants = Record<string, { status?: number; code?: string; body?: unknown; roleKey?: string }>
export function world(o: {
  cookie?: boolean; tenantCookie?: string | null; me?: unknown | number | { status: number; code: string }; tenants?: Tenants
  ent?: Record<string, unknown>
  /** What GET /v1/platform/session answers (the console's second-factor probe): ok by default. */
  platform?: { status: number; code: string }
} = {}) {
  const calls: { path: string; tenant: string | null }[] = []
  const me = o.me ?? { user: { id: "u1", email: "ana@x.ie", name: "Ana Byrne", emailVerified: true, twoFactorEnabled: false }, platformRole: null, tenants: [{ slug: "alpha", name: "Alpha Co", roleKey: "owner" }, { slug: "bravo", name: "Bravo Co", roleKey: "manager" }] }
  const tenantCtx = (slug: string, roleKey = "owner") => ({
    tenant: { id: `id-${slug}`, slug, name: slug.toUpperCase(), timezone: "Europe/Dublin", currency: "EUR", locale: "en-IE", sessionIdleHours: 12, mfaPolicy: { mode: "off", roles: [] } },
    member: { userId: "u1", roleId: "r1", roleKey, role: { label: roleKey === "owner" ? "Tenant Owner" : "Manager", description: "d", home: "manager", access: access("write") } },
    brand: { primaryColor: "#3b5bdb" }, reportDeadline: "17:30", reportDueAfterMinutes: 60,
    device: { id: null, type: "browser", label: "Unregistered browser", trusted: false }, features: { drive: false },
  })
  const ent = { planId: "starter", status: "active", modules: ["M0", "M1"], seats: 10, seatsUsed: 2, trialEndsAt: null, graceEndsAt: null, billingState: "ok", ...o.ent }
  const fetch = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname
    const tenant = new Headers(init.headers).get("x-tenant")
    calls.push({ path, tenant })
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": status === 200 ? "application/json" : "application/problem+json" } })
    const problem = (status: number, code: string) => json({ status, code, requestId: "r" }, status)
    if (path === "/v1/me") {
      if (typeof me === "object" && me !== null && "status" in me) return problem((me as { status: number }).status, (me as unknown as { code: string }).code)
      return json(me)
    }
    const t = o.tenants?.[tenant ?? ""]
    if (path === "/v1/me/tenant") {
      if (t?.status) return problem(t.status, t.code ?? "not_found")
      if (!tenant) return problem(404, "not_found")
      return json(tenantCtx(tenant, t?.roleKey))
    }
    if (path === "/v1/platform/session") return o.platform ? problem(o.platform.status, o.platform.code) : json({ staff: true, role: "owner", mfa: "ok" })
    if (path === "/v1/entitlements") return json(ent)
    return problem(404, "not_found")
  }) as unknown as typeof globalThis.fetch
  const deps: SessionDeps = {
    hasSessionCookie: o.cookie ?? true,
    tenantCookie: o.tenantCookie === undefined ? "alpha" : o.tenantCookie,
    api: async (opt) => makeApiClient({ baseUrl: "http://api.test", fetch, headers: () => new Headers(opt?.tenant ? { "x-tenant": opt.tenant } : {}) }),
    entitlementsData: async () => ENT_DATA,
    staticRoles: async () => STATIC_ROLES,
  }
  return { deps, calls }
}

