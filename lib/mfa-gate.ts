// Two-step verification prompts (AC-M0-02). Pure. The API decides what is readable (policy.enforcement: "prompt" asks, "strict" refuses with 401 mfa_enrolment_required);
// this module only chooses the WORDS.

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
