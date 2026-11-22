import { describe, expect, test } from "vitest"
import { mfaGateCopy } from "@/lib/mfa-gate"
import { needsMfaGate, needsMfaPrompt, parseMfaPolicy, type MfaPolicy } from "@/lib/mfa"

describe("mfaGateCopy: who turned it on", () => {
  test("the owner is told it is a workspace setting and where to change it (Settings > Roles); a non-owner that their admin turned it on", () => {
    const o = mfaGateCopy("owner")
    expect(o.reason).toBe("Two-step verification is required for this workspace. You can change this under Settings → Roles.")
    expect(mfaGateCopy("member").reason).toBe("Your workspace admin turned on two-step verification.")
    expect(o.effort).toBe("Takes about 2 minutes. You need an authenticator app on your phone.")
    expect(mfaGateCopy("member").effort).toBe(o.effort)
    for (const c of [o, mfaGateCopy("member")]) expect(c.reason).not.toMatch(/administrator requires/i)
  })
})

describe("prompt (default) vs strict: the web mirrors what the API enforces", () => {
  const all: MfaPolicy = { mode: "all", roles: [] }
  test("prompt is the default: a required, unenrolled person gets a prompt, never the wall", () => {
    expect(needsMfaPrompt(all, "owner", false)).toBe(true)
    expect(needsMfaGate(all, "owner", false)).toBe(false)
    expect(needsMfaPrompt({ ...all, enforcement: "prompt" }, "owner", false)).toBe(true)
  })
  test("strict is the wall; enrolled or not-required people get neither", () => {
    const strict: MfaPolicy = { ...all, enforcement: "strict" }
    expect(needsMfaGate(strict, "owner", false)).toBe(true)
    expect(needsMfaPrompt(strict, "owner", false)).toBe(false)
    expect(needsMfaPrompt(all, "owner", true) || needsMfaGate(strict, "owner", true)).toBe(false)
    expect(needsMfaPrompt({ mode: "off", roles: [] }, "owner", false)).toBe(false)
    expect(needsMfaPrompt({ mode: "roles", roles: ["manager"] }, "owner", false)).toBe(false)
  })
  test("the policy parser accepts only prompt or strict", () => {
    expect(parseMfaPolicy({ mode: "all", enforcement: "strict" }, [])).toEqual({ mode: "all", roles: [], enforcement: "strict" })
    expect(parseMfaPolicy({ mode: "all" }, [])).toEqual({ mode: "all", roles: [] })
    expect(parseMfaPolicy({ mode: "all", enforcement: "sometimes" }, [])).toBeNull()
  })
})
