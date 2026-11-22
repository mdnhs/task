import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { describe, expect, test, vi } from "vitest"

vi.mock("@/hooks/use-api-action", () => ({ useApiAction: () => async () => ({ ok: true }) }))
vi.mock("@/lib/api/browser", () => ({ apiBrowser: {} }))
vi.mock("../client", () => ({ makeSettingsClient: () => ({ setMfaPolicy: async () => ({}) }) }))
vi.mock("sonner", () => ({ toast: { success() {}, error() {} } }))

import { MfaPolicyCard } from "./components/mfa-policy-card"
import type { MfaPolicy } from "@/lib/mfa"

const roles = [{ id: "manager", label: "Manager" }]
const html = (policy: MfaPolicy, canWrite: boolean) => renderToStaticMarkup(createElement(MfaPolicyCard, { policy, roles, canWrite }))

describe("MfaPolicyCard: Soft prompt vs Strict", () => {
  test("people who can write settings get the choice; everyone else only reads the rule", () => {
    const w = html({ mode: "all", roles: [] }, true)
    expect(w).toContain("Soft prompt")
    expect(w).toContain("Strict")
    expect(w).toContain("People who have not set it up see a reminder and can keep working.")
    const r = html({ mode: "all", roles: [] }, false)
    expect(r).not.toContain("Soft prompt")
    expect(r).not.toContain('aria-label="How strictly"')
    expect(r).toContain("People who have not set it up see a reminder and can keep working.") // still told what the rule means
  })
  test("strict is described plainly; optional shows no enforcement row at all", () => {
    expect(html({ mode: "all", roles: [], enforcement: "strict" }, true)).toContain("People who have not set it up are blocked until they do.")
    expect(html({ mode: "off", roles: [] }, true)).not.toContain("Soft prompt")
  })
  test("never says Tenant", () => {
    expect(html({ mode: "roles", roles: ["manager"], enforcement: "strict" }, true)).not.toMatch(/tenant/i)
  })
  test("switching to strict goes through a confirmation dialog before the save; the policy loader keeps the enforcement field", () => {
    const src = readFileSync("features/settings/components/mfa-policy-card.tsx", "utf8")
    expect(src).toContain("needsStrictConfirm(stored, v)) return setConfirmStrict(true)")
    expect(src).toContain("Block people who have not set it up?")
    expect(src).toMatch(/setConfirmStrict\(false\); await save\(withEnforcement\(stored, "strict"\)\)/)
    expect(readFileSync("features/settings/api.ts", "utf8")).toContain("enforcement")
  })
})
