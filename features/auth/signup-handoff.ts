// What the sign-up wizard hands to onboarding (company name, country, timezone, plan): not secret, kept in sessionStorage for this tab only.
// Onboarding falls back to asking for the company name when it is missing (a different browser, private mode).
import { z } from "zod"

export const SIGNUP_KEY = "od-signup"

const Handoff = z.object({ company: z.string().max(120), country: z.string().max(4), timezone: z.string().max(100), plan: z.string().max(40) })
export type SignupHandoff = z.infer<typeof Handoff>

/** Reads and validates the hand-off (never trusts storage content); null when absent or malformed. */
export function readSignupHandoff(raw: string | null): SignupHandoff | null {
  if (!raw) return null
  try {
    const r = Handoff.safeParse(JSON.parse(raw))
    return r.success ? r.data : null
  } catch {
    return null
  }
}
