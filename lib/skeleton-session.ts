// What a loading.tsx may know about the caller (B6 ruling I9, K1): NOTHING from the API. A loading skeleton is the Suspense fallback, so it must be
// instant: it calls no API and no session lookup. It renders the TYPICAL case from static seed data: the owner role (every module writable), the
// plan with every module, the company PC (Drive on), the seed demo person for ghost text. The real page then replaces it; a role with less access
// sees a small layout change, never a delay. Do not import lib/session or lib/api/* here (test/auth-static.test.ts enforces it for loading.tsx).
import { getData } from "./data"
import { restrictRole, type EntitlementsData } from "./entitlements"
import { DEFAULT_BRAND } from "./brand"
import type { Session } from "./session-core"
import type { Role } from "./types"

export type SkeletonUser = { name: string; role: string; email: string; initials: string }

export async function getSkeletonSession(): Promise<Session> {
  const [{ roles }, ent] = await Promise.all([getData<{ roles: Role[] }>("shell/roles.json"), getData<EntitlementsData>("billing/entitlements.json")])
  const owner = roles.find((r) => r.id === "owner") ?? roles.find((r) => !r.platform)
  if (!owner) throw new Error("shell/roles.json has no tenant role")
  const planId = ent.plans.business ? "business" : ent.defaultPlan
  const entitlements = { planId, allowed: ent.plans[planId] ?? [], modules: ent.modules, assistant: ent.assistant }
  const role = restrictRole(owner, entitlements)
  const tenant = { id: "skeleton", name: "", slug: "skeleton", initials: "", brand: DEFAULT_BRAND, status: "active" as const, plan: "" }
  return {
    signedIn: true, role, roles: [role], tenant, tenants: [tenant], entitlements, user: { id: "", email: "", name: "" }, tenantSlug: "skeleton",
    billingState: "ok", device: { id: null, label: "", trusted: true }, drive: true, mfa: "ok", twoFactorEnabled: false, mfaPolicy: { mode: "off", roles: [] }, platformRole: null,
  }
}

/** The seed person (shell/user.json) for ghost text; never the signed-in user. */
export async function getSkeletonUser(): Promise<SkeletonUser> {
  return getData<SkeletonUser>("shell/user.json")
}
