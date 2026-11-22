import { describe, expect, test } from "vitest"
import { resolveSession } from "@/lib/session-core"
import { world } from "@/test/support/session-world"

describe("T6.3 resolveSession (I7, I8): the real session from /v1/me, /v1/me/tenant and /v1/entitlements", () => {
  test("composes the three calls into the Session; the role is the membership role narrowed to the plan; the tenant is the cookie's", async () => {
    const { deps, calls } = world()
    const r = await resolveSession(deps)
    expect(r.kind).toBe("ok")
    if (r.kind !== "ok") return
    const s = r.session
    expect(s).toMatchObject({ signedIn: true, tenantSlug: "alpha", mfa: "ok", billingState: "ok", drive: false, device: { id: null, label: "Unregistered browser", trusted: false } })
    expect(s.user).toEqual({ id: "u1", email: "ana@x.ie", name: "Ana Byrne" })
    expect(s.tenant).toMatchObject({ id: "id-alpha", slug: "alpha", name: "ALPHA", initials: "A", brand: "#3b5bdb", status: "active", plan: "Starter" })
    expect(s.tenants.map((t) => t.slug)).toEqual(["alpha", "bravo"])
    expect(s.role).toMatchObject({ id: "owner", label: "Owner", home: "manager", rosterLevel: "office" })
    expect(s.roles).toEqual([s.role]) // I8: only the current role
    // plan M0+M1 only: files (M4) is outside the plan, so it reads as "none" even though the role says write
    expect(s.role.access.files).toBe("none")
    expect(s.role.access.tasks).toBe("write")
    expect(s.entitlements).toMatchObject({ planId: "starter", allowed: ["M0", "M1"], assistant: "M2" })
    expect(calls.map((c) => c.path)).toEqual(["/v1/me", "/v1/me/tenant", "/v1/entitlements"])
    expect(calls[0].tenant).toBeNull() // /v1/me is tenant-less
    expect(calls[1].tenant).toBe("alpha")
  })

  test("the tenant carries the uploaded logo and favicon (version, size) from /v1/me/tenant brand; none when the company has none", async () => {
    const asset = { version: "9f86d081884c7d65", mime: "image/png", width: 240, height: 64, sizeBytes: 8123 }
    const withAssets = await resolveSession(world({ tenants: { alpha: { brand: { primaryColor: "#3b5bdb", logo: asset, favicon: { ...asset, width: 64, height: 64 } } } } }).deps)
    if (withAssets.kind !== "ok") throw new Error("not ok")
    expect(withAssets.session.tenant.logo).toEqual(asset)
    expect(withAssets.session.tenant.favicon).toMatchObject({ version: "9f86d081884c7d65", width: 64 })
    const none = await resolveSession(world({ tenants: { alpha: { brand: { primaryColor: "#3b5bdb", logo: null, favicon: null } } } }).deps)
    if (none.kind !== "ok") throw new Error("not ok")
    expect(none.session.tenant.logo ?? null).toBeNull()
    expect(none.session.tenant.favicon ?? null).toBeNull()
    // an older API answer with no such fields reads as none
    const old = await resolveSession(world().deps)
    if (old.kind !== "ok") throw new Error("not ok")
    expect(old.session.tenant.logo ?? null).toBeNull()
  })

  test("no better-auth cookie: anonymous, and the API is never called", async () => {
    const { deps, calls } = world({ cookie: false })
    expect((await resolveSession(deps)).kind).toBe("anonymous")
    expect(calls).toEqual([])
  })

  test("a cookie the API no longer honours (401) is 'expired', not authorisation: no tenant or entitlement call, no data", async () => {
    for (const code of ["unauthenticated", "session_expired"]) {
      const { deps, calls } = world({ me: { status: 401, code } })
      expect((await resolveSession(deps)).kind, code).toBe("expired")
      expect(calls.map((c) => c.path)).toEqual(["/v1/me"])
    }
  })

  test("a failing API (5xx, network) is an error, never a signed-out or signed-in guess", async () => {
    const { deps } = world({ me: { status: 502, code: "upstream_unavailable" } })
    await expect(resolveSession(deps)).rejects.toMatchObject({ status: 502 })
  })

  test("a cookie slug the user is not a member of falls back to the first membership and says so (the cookie must be repaired)", async () => {
    const { deps } = world({ tenantCookie: "gone-co" })
    const r = await resolveSession(deps)
    expect(r.kind === "ok" && r.session.tenantSlug).toBe("alpha")
    expect(r.kind === "ok" && r.cookieStale).toBe(true)
    const none = await resolveSession(world({ tenantCookie: null }).deps)
    expect(none.kind === "ok" && none.cookieStale).toBe(true)
    const fine = await resolveSession(world({ tenantCookie: "bravo" }).deps)
    expect(fine.kind === "ok" && fine.session.tenantSlug).toBe("bravo")
    expect(fine.kind === "ok" && fine.cookieStale).toBe(false)
  })

  test("a removed or suspended membership (404 on the tenant) falls back to the next membership; none left: no_tenant", async () => {
    const { deps, calls } = world({ tenants: { alpha: { status: 404 } } })
    const r = await resolveSession(deps)
    expect(r.kind === "ok" && r.session.tenantSlug).toBe("bravo")
    expect(r.kind === "ok" && r.cookieStale).toBe(true)
    expect(calls.filter((c) => c.path === "/v1/me/tenant").map((c) => c.tenant)).toEqual(["alpha", "bravo"])
    const gone = world({ tenants: { alpha: { status: 404 }, bravo: { status: 404 } } })
    const n = await resolveSession(gone.deps)
    expect(n.kind).toBe("no_tenant")
  })

  test("a user with no membership at all is no_tenant, carrying who they are (staff go to /platform, others to /onboarding)", async () => {
    const me = { user: { id: "u2", email: "s@x.ie", name: "Staff", emailVerified: true, twoFactorEnabled: true }, platformRole: "support", tenants: [] }
    const r = await resolveSession(world({ me }).deps)
    expect(r.kind === "no_tenant" && r.me.platformRole).toBe("support")
  })

  test("401 mfa_enrolment_required on the tenant is the enrolment gate; 401 mfa_challenge is the step-up; neither loads a role or entitlements", async () => {
    const enrol = world({ tenants: { alpha: { status: 401, code: "mfa_enrolment_required" } } })
    const e = await resolveSession(enrol.deps)
    expect(e.kind === "ok" && e.session.mfa).toBe("enrol")
    expect(e.kind === "ok" && e.session.role.access.tasks).toBe("none") // fail closed: no access until the second factor is in place
    expect(enrol.calls.map((c) => c.path)).toEqual(["/v1/me", "/v1/me/tenant"])
    const ch = await resolveSession(world({ tenants: { alpha: { status: 401, code: "mfa_challenge" } } }).deps)
    expect(ch.kind === "ok" && ch.session.mfa).toBe("challenge")
    expect(ch.kind === "ok" && ch.session.tenantSlug).toBe("alpha")
  })

  test("401 session_expired on the tenant call is expired", async () => {
    const r = await resolveSession(world({ tenants: { alpha: { status: 401, code: "session_expired" } } }).deps)
    expect(r.kind).toBe("expired")
  })

  test("billingState blocked makes the tenant read-only (status suspended); grace and trial map to the existing statuses with their dates", async () => {
    const blocked = await resolveSession(world({ ent: { status: "unpaid", billingState: "blocked" } }).deps)
    expect(blocked.kind === "ok" && blocked.session.tenant.status).toBe("suspended")
    expect(blocked.kind === "ok" && blocked.session.billingState).toBe("blocked")
    const grace = await resolveSession(world({ ent: { status: "past_due", billingState: "grace", graceEndsAt: "2026-12-08T00:00:00.000Z" } }).deps)
    expect(grace.kind === "ok" && grace.session.tenant).toMatchObject({ status: "past_due", graceEndsOn: "2026-12-08" })
    const trial = await resolveSession(world({ ent: { status: "trialing", trialEndsAt: "2026-12-01T00:00:00.000Z", graceEndsAt: "2026-12-08T00:00:00.000Z" } }).deps)
    expect(trial.kind === "ok" && trial.session.tenant).toMatchObject({ status: "trial", plan: "Trial", trialEndsOn: "2026-12-01" })
  })

  test("the device and Drive flag come from /v1/me/tenant as the API evaluated them for this request", async () => {
    const { deps } = world()
    const base = deps.api
    deps.api = async (o) => {
      const api = await base(o)
      return { ...api, get: (async (p: string, ...a: unknown[]) => { const r = await (api.get as (p: string, ...a: unknown[]) => Promise<Record<string, unknown>>)(p, ...a); return p === "/v1/me/tenant" ? { ...r, device: { id: "dev-1", type: "pc", label: "Front desk PC", trusted: true }, features: { drive: true } } : r }) as never }
    }
    const r = await resolveSession(deps)
    expect(r.kind === "ok" && r.session).toMatchObject({ drive: true, device: { id: "dev-1", label: "Front desk PC", trusted: true } })
  })

  test("a role the static list does not know (a cloned role) still works from the API's own matrix", async () => {
    const { deps } = world({ tenants: { alpha: { roleKey: "night-lead" } } })
    const r = await resolveSession(deps)
    expect(r.kind === "ok" && r.session.role).toMatchObject({ id: "night-lead", home: "manager" })
    expect(r.kind === "ok" && r.session.role.rosterLevel).toBeUndefined()
  })

  test("the roster level is the API's (Task 23 review I2): a custom role the API gives a level has it; a template the API gives none has none, whatever the static list says", async () => {
    const custom = await resolveSession(world({ tenants: { alpha: { roleKey: "night-lead", rosterLevel: "supervisor" } } }).deps)
    expect(custom.kind === "ok" && custom.session.role.rosterLevel).toBe("supervisor")
    const owner = await resolveSession(world({ tenants: { alpha: { roleKey: "owner", rosterLevel: null } } }).deps)
    expect(owner.kind === "ok" && owner.session.role.rosterLevel).toBeUndefined()
  })

  test("an access value outside none|read|write, or a missing module, is 'none' (never wider than the API said)", async () => {
    const { deps } = world()
    const base = deps.api
    deps.api = async (o) => {
      const api = await base(o)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { ...api, get: (async (p: string, ...a: unknown[]) => { const r = await (api.get as (p: string, ...a: unknown[]) => Promise<Record<string, any>>)(p, ...a); return p === "/v1/me/tenant" ? { ...r, member: { ...r.member, role: { ...r.member.role, access: { tasks: "admin", dashboard: "read" } } } } : r }) as never }
    }
    const r = await resolveSession(deps)
    expect(r.kind === "ok" && r.session.role.access).toMatchObject({ tasks: "none", dashboard: "read", settings: "none", payroll: "none" })
  })

  test("platform staff: the console role comes from the static platform role, only when /v1/me says the user is active staff", async () => {
    const me = { user: { id: "u2", email: "s@x.ie", name: "Staff", emailVerified: true, twoFactorEnabled: true }, platformRole: "owner", tenants: [] }
    const r = await resolveSession(world({ me }).deps)
    expect(r.kind === "no_tenant" && r.me.platformRole).toBe("owner")
  })
})
