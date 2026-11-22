// Two-step verification (FR-M0-03, FR-M0-04, AC-M0-02). Pure mock rules, no cookies.
// Mock TOTP: the authenticator secret is fixed and the code that verifies is fixed (a real backend replaces this).

/**
 * `enforcement` says what "required" means for a person who has not set up a code step yet. "prompt" (the default when absent): the app asks them, keeps working, and
 * they can go back; "strict": the API refuses every tenant route until they enrol (401 mfa_enrolment_required). A person who HAS enrolled must always pass the
 * code step on their session, in both modes (401 mfa_challenge).
 */
export type MfaEnforcement = "prompt" | "strict"
export type MfaPolicy = { mode: "off" | "all" | "roles"; roles: string[]; enforcement?: MfaEnforcement }

export const mfaStrict = (policy: MfaPolicy): boolean => policy.enforcement === "strict"

export const MOCK_TOTP_SECRET = "JBSW Y3DP EHPK 3PXP"
export const MOCK_TOTP_CODE = "123456"
export const RECOVERY_CODES = ["4F7K-92QD", "M3XA-8RTN", "Z6BP-1WHC", "Q9LE-5YUV", "T2GD-7NJS", "H8RC-4KFA", "V1MW-6XEB", "C5ZP-3TQL"]

export const verifyMockTotp = (code: string) => code.replace(/\s/g, "") === MOCK_TOTP_CODE

export function mfaRequired(policy: MfaPolicy, roleId: string): boolean {
  return policy.mode === "all" || (policy.mode === "roles" && policy.roles.includes(roleId))
}

/** AC-M0-02: required, strict and not set up means every page shows the setup gate (in "prompt" mode it is a dismissible prompt instead). */
export const needsMfaGate = (policy: MfaPolicy, roleId: string, enrolled: boolean) => mfaRequired(policy, roleId) && mfaStrict(policy) && !enrolled
/** Required, not strict and not set up: the app keeps working and asks. */
export const needsMfaPrompt = (policy: MfaPolicy, roleId: string, enrolled: boolean) => mfaRequired(policy, roleId) && !mfaStrict(policy) && !enrolled

export function parseMfaPolicy(input: unknown, validRoles: string[]): MfaPolicy | null {
  const p = input as { mode?: unknown; roles?: unknown; enforcement?: unknown } | null
  if (!p || (p.mode !== "off" && p.mode !== "all" && p.mode !== "roles")) return null
  if (p.enforcement !== undefined && p.enforcement !== "prompt" && p.enforcement !== "strict") return null
  const roles = Array.isArray(p.roles) ? p.roles : []
  if (!roles.every((r) => typeof r === "string" && validRoles.includes(r))) return null
  const base: MfaPolicy = { mode: p.mode, roles: p.mode === "roles" ? [...new Set(roles as string[])] : [] }
  return p.enforcement === undefined ? base : { ...base, enforcement: p.enforcement }
}

export function describeMfaPolicy(policy: MfaPolicy, roleLabels: Record<string, string>): string {
  if (policy.mode === "off") return "Two-step verification is optional"
  if (policy.mode === "all") return "Required for everyone"
  return policy.roles.length ? `Required for ${policy.roles.map((r) => roleLabels[r] ?? r).join(", ")}` : "Required for no roles yet"
}

/** Deterministic placeholder pattern for the QR image (not a scannable code). */
export function qrPattern(seed: string, size = 25): boolean[][] {
  let h = 2166136261
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0
  const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0), (h & 0xffff) / 0xffff)
  const finder = (x: number, y: number) => {
    for (const [ox, oy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
      const dx = x - ox, dy = y - oy
      if (dx >= 0 && dx < 7 && dy >= 0 && dy < 7) return dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4)
      if (dx >= -1 && dx < 8 && dy >= -1 && dy < 8) return false
    }
    return null
  }
  return Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => finder(x, y) ?? rnd() > 0.52))
}
