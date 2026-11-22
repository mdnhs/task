// Two-step verification prompts (AC-M0-02). Pure.
// The API decides whether data is readable (401 mfa_enrolment_required); nothing here weakens that. This module only chooses the WORDS and,
// when the API tells us a grace deadline, whether to show a banner instead of the gate.

/** The wording of the set-up gate: the owner turned it on themselves (they can change it), anyone else was told by an admin. */
export type GateAudience = "owner" | "member" | "staff"
export function mfaGateCopy(who: GateAudience): { reason: string; effort: string } {
  return {
    reason:
      who === "owner" ? "Two-step verification is required for this workspace. You can change this under Settings → Roles."
      : who === "staff" ? "Two-step verification is always required for the Platform console."
      : "Your workspace admin turned on two-step verification.",
    effort: "Takes about 2 minutes. You need an authenticator app on your phone.",
  }
}

/**
 * GRACE ADAPTER. The API does not send a grace deadline yet (tenant `mfaPolicy` is { mode, roles } only). When it adds `mfaGraceEndsAt` to
 * GET /v1/me/tenant (ISO instant, and keeps answering 200 until then), this is the only place that reads it. Until then: no grace, so the gate applies.
 */
export function mfaGraceEndsAtOf(raw: unknown): string | null {
  const v = raw && typeof raw === "object" ? (raw as { mfaGraceEndsAt?: unknown }).mfaGraceEndsAt : undefined
  return typeof v === "string" && v !== "" && !Number.isNaN(Date.parse(v)) ? v : null
}

/** Whole days left (rounded up, at least 1) while the grace runs; null when there is none or it has passed. */
export function mfaGraceDaysLeft(endsAt: string | null, now: Date): number | null {
  if (!endsAt) return null
  const ms = Date.parse(endsAt) - now.getTime()
  return ms > 0 ? Math.ceil(ms / 86_400_000) : null
}

export type MfaPrompt = { kind: "none" } | { kind: "banner"; daysLeft: number }

/** A banner (the app keeps working) while a required, not yet enrolled person is inside the grace window. After it, the API's gate applies. */
export function mfaPrompt(i: { required: boolean; enrolled: boolean; graceEndsAt: string | null; now: Date }): MfaPrompt {
  if (!i.required || i.enrolled) return { kind: "none" }
  const daysLeft = mfaGraceDaysLeft(i.graceEndsAt, i.now)
  return daysLeft === null ? { kind: "none" } : { kind: "banner", daysLeft }
}
