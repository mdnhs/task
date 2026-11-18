import { beforeEach, describe, expect, test, vi } from "vitest"

// Behaviour of the console gate (T6.8 review): the second factor and the staff check are asserted on what gate() and the search action RETURN, not on source text.
const state = { session: null as unknown, apiCalls: [] as unknown[] }
vi.mock("@/lib/session", () => ({ getPlatformSession: async () => state.session }))
vi.mock("@/lib/api/server", () => ({ apiServer: async (o?: unknown) => { state.apiCalls.push(o); return { get: async () => ({ items: [], page: 1, pageSize: 100, total: 0 }) } } }))
vi.mock("@/features/account", () => ({ MfaGate: function MfaGate() { return null }, MfaStepUp: function MfaStepUp() { return null } }))
vi.mock("@/features/shell", () => ({ AccessRestricted: function AccessRestricted() { return null }, apiFailureView: () => null }))

import { gate } from "@/app/(platform)/gate"
import { platformSearchIndex } from "@/app/actions/platform-search"

const session = (o: { platformRole: string | null; mfa: string }) => ({ signedIn: true, platformRole: o.platformRole, mfa: o.mfa, twoFactorEnabled: true, user: { id: "u1", name: "Ann", email: "ann@x.ie" } })
const nameOf = (n: unknown) => ((n as { type: { name: string } }).type.name)
beforeEach(() => { state.apiCalls = [] })

describe("gate()", () => {
  test("an outstanding second factor blocks the page with the gate component, never the operator", async () => {
    state.session = session({ platformRole: "owner", mfa: "challenge" })
    const c = await gate("tenants.read", "x")
    expect("denied" in c && nameOf(c.denied)).toBe("MfaStepUp")
    state.session = session({ platformRole: "owner", mfa: "enrol" })
    const e = await gate("tenants.read", "x")
    expect("denied" in e && nameOf(e.denied)).toBe("MfaGate")
  })
  test("active staff with the factor in order pass; a role without the action is refused", async () => {
    state.session = session({ platformRole: "owner", mfa: "ok" })
    expect(await gate("tenants.read", "x")).toMatchObject({ op: { id: "u1", role: "owner" } })
    state.session = session({ platformRole: "viewer", mfa: "ok" })
    const r = await gate("tenants.suspend", "x")
    expect("denied" in r && nameOf(r.denied)).toBe("AccessRestricted")
  })
  test("a non-staff session gets Access restricted, whatever its mfa", async () => {
    for (const mfa of ["ok", "challenge", "enrol"]) {
      state.session = session({ platformRole: null, mfa })
      const r = await gate("tenants.read", "x")
      expect("denied" in r && nameOf(r.denied), mfa).toBe("AccessRestricted")
    }
  })
})

describe("platformSearchIndex()", () => {
  test("empty unless staff AND mfa ok, and no API call is made otherwise", async () => {
    for (const s of [session({ platformRole: "owner", mfa: "challenge" }), session({ platformRole: "owner", mfa: "enrol" }), session({ platformRole: null, mfa: "ok" })]) {
      state.session = s
      expect((await platformSearchIndex()).items).toEqual([])
    }
    expect(state.apiCalls).toEqual([])
  })
  test("for staff with mfa ok it reads the API with NO tenant (no X-Tenant to /v1/platform/*)", async () => {
    state.session = session({ platformRole: "owner", mfa: "ok" })
    const r = await platformSearchIndex()
    expect(r.items.length).toBeGreaterThan(0)
    expect(state.apiCalls).toEqual([{ tenant: null }])
  })
})
