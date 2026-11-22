// The owner's choice under Settings → Roles → Two-step verification: what "required" means for people who have not set it up. Pure.
import type { MfaEnforcement, MfaPolicy } from "./mfa"

export const enforcementOf = (p: MfaPolicy): MfaEnforcement => (p.enforcement === "strict" ? "strict" : "prompt")

/** Changing the rule keeps the enforcement choice; no key is added when none was set. */
export function withMode(p: MfaPolicy, mode: MfaPolicy["mode"]): MfaPolicy {
  return { mode, roles: mode === "roles" ? p.roles : [], ...(p.enforcement ? { enforcement: p.enforcement } : {}) }
}
export const withRoles = (p: MfaPolicy, roles: string[]): MfaPolicy => ({ mode: "roles", roles, ...(p.enforcement ? { enforcement: p.enforcement } : {}) })
export const withEnforcement = (p: MfaPolicy, e: MfaEnforcement): MfaPolicy => ({ mode: p.mode, roles: p.roles, enforcement: e })

/** Switching TO strict locks people out until they set it up, so it is confirmed first. */
export const needsStrictConfirm = (current: MfaPolicy, target: MfaEnforcement): boolean => target === "strict" && enforcementOf(current) !== "strict"

export const enforcementText = (e: MfaEnforcement): string =>
  e === "strict" ? "People who have not set it up are blocked until they do." : "People who have not set it up see a reminder and can keep working."
