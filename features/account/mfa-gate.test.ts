import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { describe, expect, test, vi } from "vitest"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, replace() {}, push() {} }), usePathname: () => "/settings/template", useSearchParams: () => new URLSearchParams("a=1") }))
vi.mock("@/app/actions/session", () => ({ signOutAction: async () => {} }))
vi.mock("@/lib/auth-client", () => ({ enableTotp: async () => ({ totpURI: "", backupCodes: [] }), verifyTotp: async () => {} }))
vi.mock("sonner", () => ({ toast: { success() {}, error() {} } }))

import { MfaGate } from "./components/mfa-gate"
import { MfaBanner } from "./components/mfa-banner"

const html = (who: "owner" | "member" | "staff", soft = false) => renderToStaticMarkup(createElement(MfaGate, { account: "ana@x.ie", who, soft }))

describe("the MFA gate card", () => {
  test("owner and non-owner copy, the effort line, and the old wording is gone", () => {
    const o = html("owner")
    expect(o).toContain("Two-step verification is required for this workspace. You can change this under Settings → Roles.")
    expect(o).toContain("Takes about 2 minutes. You need an authenticator app on your phone.")
    expect(o).not.toContain("administrator requires")
    expect(html("member")).toContain("Your workspace admin turned on two-step verification.")
    expect(html("member")).not.toContain("Settings → Roles")
  })
  test("the stepper shows the four real steps with the first current; Cancel is Sign out in strict mode and Cancel in the soft card", () => {
    const o = html("owner")
    for (const t of ["Password", "Scan", "Code", "Backup"]) expect(o).toContain(t)
    expect(o).toContain('aria-current="step"')
    expect(o).toContain("Confirm your password for ana@x.ie")
    expect(o).toContain("Sign out")
    expect(o).not.toContain(">Cancel<")
    expect(html("owner", true)).toContain(">Cancel<")
    expect(html("owner", true)).not.toContain("Sign out")
    expect(o).not.toContain(">Back<") // no previous step from step 1
  })
})

describe("the prompt banner", () => {
  test("a quiet reminder: set-up link to the card, dismissible", () => {
    const b = renderToStaticMarkup(createElement(MfaBanner))
    expect(b).toContain("Secure your account in 2 minutes")
    expect(b).toContain('href="/mfa?next=%2Fsettings%2Ftemplate%3Fa%3D1"') // carries the current page
    expect(b).toContain("Set up now")
    expect(b).toContain('aria-label="Dismiss"')
  })
})

describe("server-side enforcement is untouched", () => {
  const read = (p: string) => readFileSync(p, "utf8")
  test("every data page still gates itself and the API's 401 mfa_* still closes the session; the layout's nav relaxation is cosmetic", () => {
    expect(read("lib/session.ts")).toMatch(/if \(s\.mfa !== "ok"\) return redirect\(mfaSetupHref\(await landing\(\)\)\)/)
    const core = read("lib/session-core.ts")
    expect(core).toMatch(/isStatus\(e, 401, "mfa_enrolment_required"\)\) return gate\(me, slug, "enrol", deps\)/)
    expect(core).toMatch(/role: Role = \{ id: t\.roleKey, label: t\.roleKey, description: "", home: "staff", access: \{ \.\.\.NO_ACCESS \} \}/) // role stays fail-closed
    const layout = read("app/(app)/layout.tsx")
    expect(layout).toContain("session.navRole")
    expect(layout).toMatch(/session\.mfa === "enrol" \? <MfaGate/)
  })
})
