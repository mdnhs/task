import { describe, expect, test } from "vitest"
import { enforcementOf, enforcementText, needsStrictConfirm, withEnforcement, withMode, withRoles } from "@/lib/mfa-enforcement"
import type { MfaPolicy } from "@/lib/mfa"

const all: MfaPolicy = { mode: "all", roles: [] }

describe("prompt vs strict choice", () => {
  test("prompt is the default; strict only when the policy says so", () => {
    expect(enforcementOf(all)).toBe("prompt")
    expect(enforcementOf({ ...all, enforcement: "prompt" })).toBe("prompt")
    expect(enforcementOf({ ...all, enforcement: "strict" })).toBe("strict")
  })
  test("changing the rule or the chosen roles keeps the enforcement choice (it must not silently reset to prompt)", () => {
    const strict: MfaPolicy = { mode: "roles", roles: ["manager"], enforcement: "strict" }
    expect(withMode(strict, "all")).toEqual({ mode: "all", roles: [], enforcement: "strict" })
    expect(withMode(strict, "roles")).toEqual(strict)
    expect(withRoles(strict, ["manager", "admin"])).toEqual({ mode: "roles", roles: ["manager", "admin"], enforcement: "strict" })
    expect(withMode(all, "roles")).toEqual({ mode: "roles", roles: [] }) // no enforcement key added when none was set
  })
  test("withEnforcement sets the choice", () => {
    expect(withEnforcement(all, "strict")).toEqual({ mode: "all", roles: [], enforcement: "strict" })
    expect(withEnforcement({ ...all, enforcement: "strict" }, "prompt")).toEqual({ mode: "all", roles: [], enforcement: "prompt" })
  })
  test("only switching TO strict asks for confirmation", () => {
    expect(needsStrictConfirm(all, "strict")).toBe(true)
    expect(needsStrictConfirm({ ...all, enforcement: "prompt" }, "strict")).toBe(true)
    expect(needsStrictConfirm({ ...all, enforcement: "strict" }, "strict")).toBe(false)
    expect(needsStrictConfirm({ ...all, enforcement: "strict" }, "prompt")).toBe(false)
    expect(needsStrictConfirm(all, "prompt")).toBe(false)
  })
  test("copy: plain English, never the word Tenant", () => {
    expect(enforcementText("prompt")).toBe("People who have not set it up see a reminder and can keep working.")
    expect(enforcementText("strict")).toBe("People who have not set it up are blocked until they do.")
    for (const e of ["prompt", "strict"] as const) expect(enforcementText(e)).not.toMatch(/tenant/i)
  })
})
