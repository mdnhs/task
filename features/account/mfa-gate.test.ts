import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { describe, expect, test, vi } from "vitest"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, replace() {}, push() {} }), usePathname: () => "/settings/template", useSearchParams: () => new URLSearchParams() }))
vi.mock("@/app/actions/session", () => ({ signOutAction: async () => {} }))
vi.mock("@/lib/auth-client", () => ({ enableTotp: async () => ({ totpURI: "", backupCodes: [] }), verifyTotp: async () => {} }))
vi.mock("sonner", () => ({ toast: { success() {}, error() {} } }))

import { MfaGate } from "./components/mfa-gate"
import { MfaBanner } from "./components/mfa-banner"

const html = (who: "owner" | "member" | "staff", onSkip?: () => void) => renderToStaticMarkup(createElement(MfaGate, { account: "ana@x.ie", who, onSkip }))

describe("the MFA gate card", () => {
  test("owner and non-owner copy, the effort line, and the old wording is gone", () => {
    const o = html("owner")
    expect(o).toContain("Two-step verification is required for this workspace. You can change this under Settings → Roles.")
    expect(o).toContain("Takes about 2 minutes. You need an authenticator app on your phone.")
    expect(o).not.toContain("administrator requires")
    expect(html("member")).toContain("Your workspace admin turned on two-step verification.")
    expect(html("member")).not.toContain("Settings → Roles")
  })
  test("Sign out is always there; Skip for now only when the caller passes it (grace)", () => {
    expect(html("owner")).toContain("Sign out")
    expect(html("owner")).not.toContain("Skip for now")
    expect(html("owner", () => {})).toContain("Skip for now")
  })
})

describe("the grace banner", () => {
  test("says days left, links to set-up and can be dismissed", () => {
    const b = renderToStaticMarkup(createElement(MfaBanner, { daysLeft: 3 }))
    expect(b).toContain("Secure your account in 2 minutes: 3 days left")
    expect(b).toContain('href="/account/security"')
    expect(b).toContain("Set up now")
    expect(b).toContain('aria-label="Dismiss"')
    expect(renderToStaticMarkup(createElement(MfaBanner, { daysLeft: 1 }))).toContain("1 day left")
  })
})

describe("server-side enforcement is untouched", () => {
  const read = (p: string) => readFileSync(p, "utf8")
  test("every data page still gates itself and the API's 401 mfa_* still closes the session; the layout's nav relaxation is cosmetic", () => {
    expect(read("lib/session.ts")).toMatch(/if \(s\.mfa !== "ok"\) return redirect\(MFA_PATH\)/)
    const core = read("lib/session-core.ts")
    expect(core).toMatch(/isStatus\(e, 401, "mfa_enrolment_required"\)\) return gate\(me, slug, "enrol", deps\)/)
    expect(core).toMatch(/role: Role = \{ id: t\.roleKey, label: t\.roleKey, description: "", home: "staff", access: \{ \.\.\.NO_ACCESS \} \}/) // role stays fail-closed
    const layout = read("app/(app)/layout.tsx")
    expect(layout).toContain("session.navRole")
    expect(layout).toMatch(/session\.mfa === "enrol" \? <MfaGate/)
  })
})
