import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test, vi } from "vitest"
import { fakeApi, problem } from "@/test/support/fake-api"
import { ApiError, userMessage } from "@/lib/api/problem"
import { idleLabel, inviteDaysOf, needsRoleConfirm, toRoles } from "./adapters"
import { makeSettingsClient } from "./client"
import { LOGO_UPLOAD_ENABLED } from "./constants"

const root = path.resolve(__dirname, "../..")
const read = (p: string) => readFileSync(path.join(root, p), "utf8")
const nav = () => ({ go: vi.fn() })
const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const BUILT_IN = { id: UUID(5), key: "manager", label: "Manager", description: "", home: "manager", access: { tasks: "write" }, fieldRules: {}, isTemplate: true, clonedFrom: null }

describe("T6.5 fix I1: copy a built-in role, then edit the copy", () => {
  test("Copy role calls the clone endpoint with the source uuid and the new name", async () => {
    const { client, calls } = fakeApi({ "POST /v1/roles/{id}/clone": { ...BUILT_IN, id: UUID(6), key: "night-lead", label: "Night lead", isTemplate: false, clonedFrom: UUID(5) } })
    const r = await makeSettingsClient(client, nav()).cloneRole(UUID(5), "Night lead")
    expect(calls[0]).toMatchObject({ method: "post", path: "/v1/roles/{id}/clone", body: { label: "Night lead" } })
    expect(r.label).toBe("Night lead")
  })
  test("a built-in role is locked, the copy is not (editable through PATCH), and the owner stays fixed", () => {
    const copy = { ...BUILT_IN, id: UUID(6), key: "night-lead", label: "Night lead", isTemplate: false, clonedFrom: UUID(5) }
    const roles = toRoles([BUILT_IN, copy, { ...BUILT_IN, id: UUID(1), key: "owner", isTemplate: false }])
    expect(roles.map((r) => [r.id, r.locked])).toEqual([["manager", true], ["night-lead", false], ["owner", true]])
  })
  test("a refused copy shows the right message (403 escalation, 409 locked, 403 plain)", async () => {
    for (const [status, code, text] of [[403, "role_escalation", "That role has more access than yours."], [409, "template_locked", "Built-in roles can't be edited. Copy the role first."], [403, "forbidden", "You can't do that."]] as const) {
      const { client } = fakeApi({ "POST /v1/roles/{id}/clone": problem(status, code) })
      const e = await makeSettingsClient(client, nav()).cloneRole(UUID(5), "X").catch((x: unknown) => x)
      expect(e).toBeInstanceOf(ApiError)
      expect(userMessage(e).text).toBe(text)
    }
  })
  test("the matrix has the Copy role action and the locked-column note", () => {
    const src = read("features/settings/components/roles-matrix.tsx")
    expect(src).toMatch(/cloneRole/)
    expect(src).toMatch(/Copy role/)
    expect(src).toMatch(/Built-in roles are fixed/)
  })
})

describe("T6.5 fix I2: the logo upload control is hidden (code kept), the colour control stays", () => {
  test("LOGO_UPLOAD_ENABLED is false, named for the later phase, and the panel keeps both controls in code", () => {
    expect(LOGO_UPLOAD_ENABLED).toBe(false)
    expect(read("features/settings/constants.ts")).toMatch(/\/v1\/me\/tenant/)
    const src = read("features/settings/components/branding-panel.tsx")
    expect(src).toMatch(/LOGO_UPLOAD_ENABLED/)
    expect(src).toMatch(/ColorPicker/)
    expect(src).toMatch(/uploadLogo/) // the code is kept
    expect(read("app/(app)/settings/[tab]/page.tsx")).toMatch(/LOGO_UPLOAD_ENABLED/)
  })
})

describe("T6.5 fix I3: session timeout read-only; deactivate and last active are demo-only", () => {
  test("idleLabel formats the platform's hours", () => {
    expect(idleLabel(12)).toBe("12 hours")
    expect(idleLabel(1)).toBe("1 hour")
  })
  test("the organisation form shows the timeout read-only with the platform hint and has no write path for it", () => {
    const src = read("features/settings/components/organisation-form.tsx")
    expect(src).toMatch(/sessionIdleHours/)
    expect(src).toMatch(/set by the platform/i)
    expect(src).not.toMatch(/set\("sessionIdleHours"|sessionTimeout/)
  })
  test("deactivate and last active exist only behind mock modules and never call the API", () => {
    const panel = read("features/settings/components/users-panel.tsx")
    expect(panel).toMatch(/mockActivity/)
    expect(panel).not.toMatch(/deactivate.*api\.|client\.deactivate/i)
    const page = read("app/(app)/settings/[tab]/page.tsx")
    expect(page).toMatch(/mockEnabled\(\)\s*\?[^\n]*getMockUserActivity/)
  })
})

describe("T6.5 fix minors", () => {
  test("invite lifetime comes from the invites' own dates, never a literal", () => {
    expect(inviteDaysOf([{ createdAt: "2026-11-18T09:00:00", expiresAt: "2026-11-25T09:00:00" }])).toBe(7)
    expect(inviteDaysOf([{ createdAt: "2026-11-18T09:00:00", expiresAt: "2026-11-19T09:00:00" }])).toBe(1)
    expect(inviteDaysOf([])).toBeNull()
    expect(read("features/settings/constants.ts")).not.toMatch(/INVITE_DAYS/)
    expect(read("features/settings/components/users-panel.tsx")).not.toMatch(/INVITE_DAYS|7 days/)
  })
  test("changing the role of yourself or of an owner asks first", () => {
    const u = (id: string, role: string) => ({ id, name: "N", email: "e", role, dept: "" })
    expect(needsRoleConfirm(u("me", "admin"), "me")).toBe(true)
    expect(needsRoleConfirm(u("x", "owner"), "me")).toBe(true)
    expect(needsRoleConfirm(u("x", "employee"), "me")).toBe(false)
    expect(read("features/settings/components/users-panel.tsx")).toMatch(/needsRoleConfirm/)
  })
})
