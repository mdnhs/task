// Two-step verification set-up and removal (FR-M0-03), on Better Auth (B6 T6.3). The page shows the SECRET and the otpauth LINK only (ruling J1: no QR,
// no new dependency); backup codes are shown once and kept only in component state. Nothing here logs, stores or puts a secret in a URL. Pure, so it
// is tested with fakes; the components pass the real lib/auth-client functions.
import { ApiError, userMessage } from "@/lib/api/problem"

export type TotpDeps = {
  enable(password: string): Promise<{ totpURI: string; backupCodes: string[] }>
  verify(code: string): Promise<void>
}

export type Failure = { ok: false; message: string }

/** The base32 secret inside an otpauth:// link, or null. */
export function secretFromUri(uri: string): string | null {
  try {
    const u = new URL(uri)
    if (u.protocol !== "otpauth:") return null
    const s = u.searchParams.get("secret")
    return s && /^[A-Za-z2-7]+=*$/.test(s) ? s.toUpperCase() : null
  } catch {
    return null
  }
}

/** "JBSWY3DPEHPK3PXP" -> "JBSW Y3DP EHPK 3PXP": easier to type into an authenticator. */
export const formatSecret = (secret: string): string => secret.replace(/(.{4})/g, "$1 ").trim()

/** The link a phone's authenticator app can open: only the otpauth: scheme ever becomes an href. */
export const otpauthHref = (uri: string): string | null => (uri.startsWith("otpauth://") ? uri : null)

const isCode = (e: unknown, ...codes: string[]) => e instanceof ApiError && codes.includes(e.code)

function failure(e: unknown, specific?: string): Failure {
  return { ok: false, message: specific ?? userMessage(e).text }
}

export async function startEnrolment(deps: TotpDeps, password: string): Promise<{ ok: true; secret: string; uri: string; backupCodes: string[] } | Failure> {
  if (!password) return { ok: false, message: "Enter your password." }
  try {
    const r = await deps.enable(password)
    const raw = secretFromUri(r.totpURI)
    if (!raw || !otpauthHref(r.totpURI)) return { ok: false, message: "Something went wrong. Try again." } // fail closed: never show a half-usable set-up
    return { ok: true, secret: formatSecret(raw), uri: r.totpURI, backupCodes: r.backupCodes }
  } catch (e) {
    return failure(e, isCode(e, "invalid_password") ? "That password is not right." : undefined)
  }
}

export async function confirmEnrolment(deps: TotpDeps, code: string): Promise<{ ok: true } | Failure> {
  const digits = code.replace(/\s/g, "")
  if (!/^\d{6}$/.test(digits)) return { ok: false, message: "Enter the 6-digit code" }
  try {
    await deps.verify(digits)
    return { ok: true }
  } catch (e) {
    return failure(e, isCode(e, "invalid_code", "invalid_two_factor_code") || (e instanceof ApiError && e.status === 401) ? "That code is not right. Check your authenticator app and try again." : undefined)
  }
}

export async function disableTotpFlow(disable: (password: string) => Promise<void>, password: string): Promise<{ ok: true } | Failure> {
  if (!password) return { ok: false, message: "Enter your password." }
  try {
    await disable(password)
    return { ok: true }
  } catch (e) {
    return failure(e, isCode(e, "invalid_password") ? "That password is not right." : undefined)
  }
}
