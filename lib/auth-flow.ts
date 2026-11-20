// The decisions of the auth screens (B6 T6.3), pure so they are tested without a browser: what a response MEANS and the one message to show.
// Security rules enforced here:
//  - no account enumeration: a wrong password and an unknown email, an existing and a new sign-up address, a known and an unknown reset address all
//    produce the same outcome and copy (the API is built to answer them alike; this layer must not add a difference);
//  - the server's own text is never shown, only a short mapped message plus the request id for support;
//  - tokens and passwords only ever go to the injected function (they are not logged, stored or put in a URL here).
import { ApiError, classifyApiError, userMessage } from "./api/problem"

export const GENERIC_CREDENTIALS = "Wrong email or password."
const RATE_LIMITED = "Too many attempts, wait a minute."
export const MFA_LOCKED = "Too many wrong codes. Wait about 15 minutes."
export const TRY_SHORTLY = "Try again shortly."

type Fail = { message: string; ref?: string }

function describe(e: unknown): Fail {
  const { text, ref } = userMessage(e)
  return { message: text, ...(ref ? { ref } : {}) }
}

export type SignInResult = { kind: "signed_in" } | { kind: "mfa" } | { kind: "unverified" } | ({ kind: "error" } & Fail)

export async function signInStep(deps: { signInEmail(b: { email: string; password: string }): Promise<{ twoFactorRedirect?: true }> }, b: { email: string; password: string }): Promise<SignInResult> {
  try {
    const r = await deps.signInEmail({ email: b.email.trim(), password: b.password })
    return r.twoFactorRedirect === true ? { kind: "mfa" } : { kind: "signed_in" }
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 403 && e.code === "email_not_verified") return { kind: "unverified" }
      if (e.status === 429) return { kind: "error", message: RATE_LIMITED }
      if (e.status === 503 && e.code === "rate_limit_unavailable") return { kind: "error", message: TRY_SHORTLY }
      // Every credential problem (wrong password, unknown email, no password account) is the same message. Never branch on the code.
      if (e.status === 401 || e.status === 400 || e.status === 404 || e.status === 422) return { kind: "error", message: GENERIC_CREDENTIALS }
    }
    return { kind: "error", ...describe(e) }
  }
}

export type CodeMode = "totp" | "backup"
export type StepResult = { ok: true } | ({ ok: false } & Fail)

export async function secondFactorStep(deps: { verifyTotp(code: string): Promise<void>; verifyBackupCode(code: string): Promise<void> }, mode: CodeMode, raw: string): Promise<StepResult> {
  const code = mode === "totp" ? raw.replace(/\s/g, "") : raw.trim()
  if (mode === "totp" && !/^\d{6}$/.test(code)) return { ok: false, message: "Enter the 6-digit code from your authenticator app" }
  if (mode === "backup" && !code) return { ok: false, message: "Enter a recovery code" }
  try {
    await (mode === "totp" ? deps.verifyTotp(code) : deps.verifyBackupCode(code))
    return { ok: true }
  } catch (e) {
    if (e instanceof ApiError && e.status === 429) return { ok: false, message: e.code === "mfa_attempts_exceeded" ? MFA_LOCKED : RATE_LIMITED }
    if (e instanceof ApiError && e.status === 503 && e.code === "rate_limit_unavailable") return { ok: false, message: TRY_SHORTLY }
    if (e instanceof ApiError && (e.status === 401 || e.status === 400)) return { ok: false, message: "That code is not right. Try again." }
    return { ok: false, ...describe(e) }
  }
}

/** Sign-up creates NO session (the address must be verified first). An address that already has an account looks exactly like a new one. */
export async function signUpStep(deps: { signUpEmail(b: { name: string; email: string; password: string }): Promise<void> }, b: { name: string; email: string; password: string }): Promise<StepResult> {
  try {
    await deps.signUpEmail({ name: b.name.trim(), email: b.email.trim(), password: b.password })
    return { ok: true }
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 429) return { ok: false, message: RATE_LIMITED }
      if (e.status === 422 && /already_exists|user_already/.test(e.code)) return { ok: true } // no enumeration: "check your inbox" either way
    }
    return { ok: false, ...describe(e) }
  }
}

export type VerifyResult = { kind: "verified" } | { kind: "expired" } | ({ kind: "error" } & Fail)

/** Called ONLY from the Verify button's click (a mail scanner opening the link must not consume the token). Any token problem is the one "expired" state. */
export async function verifyEmailStep(deps: { verifyEmail(token: string): Promise<void> }, token: string): Promise<VerifyResult> {
  if (!token) return { kind: "expired" }
  try {
    await deps.verifyEmail(token)
    return { kind: "verified" }
  } catch (e) {
    const { kind } = classifyApiError(e)
    if (e instanceof ApiError && e.status >= 400 && e.status < 500 && kind !== "rate_limited") return { kind: "expired" }
    if (e instanceof ApiError && e.status === 429) return { kind: "error", message: RATE_LIMITED }
    return { kind: "error", ...describe(e) }
  }
}

/** The confirmation is identical for a known and an unknown address (and for a 4xx); only a rate limit or an outage is shown as such. */
export async function forgotStep(deps: { requestPasswordReset(email: string, redirectTo: string): Promise<void> }, email: string): Promise<StepResult> {
  try {
    await deps.requestPasswordReset(email.trim(), "/reset-password")
    return { ok: true }
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 429) return { ok: false, message: RATE_LIMITED }
      if (e.status >= 400 && e.status < 500) return { ok: true }
    }
    return { ok: false, ...describe(e) }
  }
}

/** The API's own minimum; the form shows the stronger sign-up rules as guidance. */
export const MIN_PASSWORD = 8

export async function resetStep(deps: { resetPassword(token: string, newPassword: string): Promise<void> }, token: string, newPassword: string): Promise<StepResult | { ok: false; message: string; expired: true }> {
  const EXPIRED = { ok: false as const, message: "This link is not valid or has expired. Ask for a new one.", expired: true as const }
  if (!token) return EXPIRED
  if (newPassword.length < MIN_PASSWORD) return { ok: false, message: `Use at least ${MIN_PASSWORD} characters.` }
  try {
    await deps.resetPassword(token, newPassword)
    return { ok: true }
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 429) return { ok: false, message: RATE_LIMITED }
      if (e.status === 400 || e.status === 404 || e.status === 422) return EXPIRED // bad, used, expired and unknown-user are one message
    }
    return { ok: false, ...describe(e) }
  }
}

export type InviteFailKind = "invalid" | "expired" | "used" | "member" | "email_mismatch" | "seats" | "signed_out" | "rate_limited" | "error"
export type AcceptInviteResult = { ok: true; slug: string } | ({ ok: false; kind: InviteFailKind } & Fail)

const INVITE_COPY: Record<Exclude<InviteFailKind, "rate_limited" | "error">, string> = {
  invalid: "This invitation is not valid any more. Ask your admin to send a new one.",
  expired: "This invitation has expired. Ask your admin to send a new one.",
  used: "This invitation was already used.",
  member: "You are already a member of this company.",
  email_mismatch: "This invitation was sent to a different email address. Sign in or sign up with the address it was sent to.",
  seats: "This company has no free seats left. Ask your admin to make room, then try again.",
  signed_out: "Your session ended. Sign in to accept the invitation.",
}

/**
 * Accepts an invitation (POST /v1/invites/accept) and maps every answer to one short message. A revoked, replaced, malformed or suspended-company
 * token is the one "invalid" state (the API answers them alike: nothing here says which). The token only goes to the injected function.
 */
export async function acceptInviteStep(deps: { accept(token: string): Promise<{ slug: string }> }, token: string): Promise<AcceptInviteResult> {
  const fail = (kind: Exclude<InviteFailKind, "rate_limited" | "error">): AcceptInviteResult => ({ ok: false, kind, message: INVITE_COPY[kind] })
  if (!token) return fail("invalid")
  try {
    return { ok: true, slug: (await deps.accept(token)).slug }
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 401) return fail("signed_out")
      if (e.status === 403 && e.code === "invite_email_mismatch") return fail("email_mismatch")
      if (e.status === 404 || (e.status === 410 && e.code === "invite_invalid")) return fail("invalid")
      if (e.status === 410) return fail("expired")
      if (e.status === 409 && e.code === "invite_used") return fail("used")
      if (e.status === 409 && e.code === "already_member") return fail("member")
      if (e.status === 409 && e.code === "seat_limit") return fail("seats")
      if (e.status === 429) return { ok: false, kind: "rate_limited", message: RATE_LIMITED }
    }
    return { ok: false, kind: "error", ...describe(e) }
  }
}
