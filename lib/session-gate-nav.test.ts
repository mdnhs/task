import { describe, expect, test } from "vitest"
import { resolveSession } from "@/lib/session-core"
import { STATIC_ROLES, world } from "@/test/support/session-world"

describe("the MFA gate keeps the shell usable (nav items) without opening any data", () => {
  test("a gated session keeps a fail-closed role but carries the catalogue role for the sidebar", async () => {
    const e = await resolveSession(world({ tenants: { alpha: { status: 401, code: "mfa_enrolment_required" } } }).deps)
    if (e.kind !== "ok") throw new Error("expected ok")
    expect(e.session.role.access.tasks).toBe("none")
    expect(e.session.navRole?.id).toBe("owner")
    expect(e.session.navRole).toBe(STATIC_ROLES[0]) // the catalogue entry itself
  })
  test("a role the catalogue does not know gets Dashboard only", async () => {
    const me = { user: { id: "u1", email: "a@x.ie", name: "A", emailVerified: true, twoFactorEnabled: false }, platformRole: null, tenants: [{ slug: "alpha", name: "Alpha", roleKey: "custom-x" }] }
    const e = await resolveSession(world({ me, tenants: { alpha: { status: 401, code: "mfa_enrolment_required" } } }).deps)
    if (e.kind !== "ok") throw new Error("expected ok")
    expect(Object.entries(e.session.navRole!.access).filter(([, v]) => v !== "none")).toEqual([["dashboard", "read"]])
  })
  test("an ok session has no navRole", async () => {
    const r = await resolveSession(world().deps)
    expect(r.kind === "ok" && r.session.navRole).toBeUndefined()
  })
  test("the API is still asked only for /v1/me and /v1/me/tenant while gated (no tenant data is read)", async () => {
    const w = world({ tenants: { alpha: { status: 401, code: "mfa_enrolment_required" } } })
    await resolveSession(w.deps)
    expect(w.calls.map((c) => c.path)).toEqual(["/v1/me", "/v1/me/tenant"])
  })
})
