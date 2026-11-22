// The two-step enrolment as a stepper (FR-M0-03). Pure. The server contract is unchanged: password -> enable (secret + backup codes) -> verify the first code -> done.
import { safeNext } from "./safe-next"

export type Step = "password" | "scan" | "code" | "backup"
export const STEPS: { id: Step; label: string; short: string }[] = [
  { id: "password", label: "Password", short: "Password" },
  { id: "scan", label: "Scan with your authenticator app", short: "Scan" },
  { id: "code", label: "Enter the 6-digit code", short: "Code" },
  { id: "backup", label: "Save your backup codes", short: "Backup" },
]

export const stepNumber = (s: Step): number => STEPS.findIndex((x) => x.id === s) + 1
export const nextOf = (s: Step): Step | null => STEPS[STEPS.findIndex((x) => x.id === s) + 1]?.id ?? null

/** Back only while nothing is turned on yet: not from the first step, and not from the backup codes (2FA is on and the codes are shown once). */
export function backOf(s: Step): Step | null {
  if (s === "scan") return "password"
  if (s === "code") return "scan"
  return null
}

/** The backup codes step ends only after the person confirms they saved them. */
export const canFinish = (confirmed: boolean): boolean => confirmed === true

/** The page to return to after set-up: a same-origin path (safeNext), never an auth page or the set-up page itself; otherwise "/". */
export function mfaReturnTarget(raw: unknown): string {
  const t = safeNext(raw)
  return t === "/mfa" || t.startsWith("/mfa?") || t.startsWith("/mfa/") ? "/" : t
}

/** The link to the set-up card that remembers where the person was. */
export function mfaSetupHref(currentPath: string): string {
  const t = mfaReturnTarget(currentPath)
  return t === "/" && currentPath !== "/" ? "/mfa" : `/mfa?next=${encodeURIComponent(t)}`
}
