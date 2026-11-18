import { describe, expect, test, vi } from "vitest"
import { ApiError } from "@/lib/api/problem"
import { forgotStep, resetStep, secondFactorStep, signInStep, signUpStep, verifyEmailStep } from "@/lib/auth-flow"

const err = (status: number, code: string) => new ApiError(status, code, "req-9")
const GENERIC = "Wrong email or password."

describe("T6.3 sign-in step: one message for every credential failure (no account enumeration)", () => {
  test("a wrong password and an unknown email give the same message", async () => {
    const wrongPassword = await signInStep({ signInEmail: async () => { throw err(401, "invalid_email_or_password") } }, { email: "a@x.ie", password: "bad" })
    const unknownEmail = await signInStep({ signInEmail: async () => { throw err(401, "invalid_email_or_password") } }, { email: "nobody@x.ie", password: "bad" })
    expect(wrongPassword).toEqual({ kind: "error", message: GENERIC })
    expect(unknownEmail).toEqual(wrongPassword)
    // whatever 401 / 400 code the API uses for a bad credential, the text stays the same (a codes table must not leak which half was wrong)
    for (const code of ["invalid_password", "user_not_found", "credential_account_not_found", "invalid_email"]) {
      expect(await signInStep({ signInEmail: async () => { throw err(401, code) } }, { email: "a@x.ie", password: "x" }), code).toEqual({ kind: "error", message: GENERIC })
    }
  })

  test("429 shows the rate-limit copy", async () => {
    const r = await signInStep({ signInEmail: async () => { throw err(429, "too_many_requests") } }, { email: "a@x.ie", password: "x" })
    expect(r).toEqual({ kind: "error", message: "Too many attempts, wait a minute." })
  })

  test("403 email_not_verified offers the resend; nothing else does", async () => {
    expect(await signInStep({ signInEmail: async () => { throw err(403, "email_not_verified") } }, { email: "a@x.ie", password: "x" })).toEqual({ kind: "unverified" })
    expect(await signInStep({ signInEmail: async () => { throw err(403, "forbidden") } }, { email: "a@x.ie", password: "x" })).toMatchObject({ kind: "error" })
  })

  test("twoFactorRedirect leads to the code step; a plain success is signed in", async () => {
    expect(await signInStep({ signInEmail: async () => ({ twoFactorRedirect: true }) }, { email: "a@x.ie", password: "x" })).toEqual({ kind: "mfa" })
    expect(await signInStep({ signInEmail: async () => ({}) }, { email: "a@x.ie", password: "x" })).toEqual({ kind: "signed_in" })
  })

  test("an unreachable or failing API is a retry message, never 'wrong password'", async () => {
    expect(await signInStep({ signInEmail: async () => { throw new TypeError("fetch failed") } }, { email: "a@x.ie", password: "x" })).toEqual({ kind: "error", message: "No connection. Try again." })
    expect(await signInStep({ signInEmail: async () => { throw err(502, "upstream_unavailable") } }, { email: "a@x.ie", password: "x" })).toMatchObject({ kind: "error", message: "Something went wrong. Try again." })
  })

  test("the request id is kept for support, the server's text never", async () => {
    const r = await signInStep({ signInEmail: async () => { throw err(500, "internal") } }, { email: "a@x.ie", password: "x" })
    expect(r).toMatchObject({ kind: "error", ref: "req-9" })
    expect(JSON.stringify(r)).not.toMatch(/internal/)
  })
})

describe("T6.3 second factor: a code, or a backup code", () => {
  test("a 6-digit code (spaces allowed) calls verifyTotp with digits only", async () => {
    const verifyTotp = vi.fn(async () => {})
    expect(await secondFactorStep({ verifyTotp, verifyBackupCode: vi.fn() }, "totp", "123 456")).toEqual({ ok: true })
    expect(verifyTotp).toHaveBeenCalledWith("123456")
  })

  test("a backup code goes to verifyBackupCode as typed (trimmed)", async () => {
    const verifyBackupCode = vi.fn(async () => {})
    expect(await secondFactorStep({ verifyTotp: vi.fn(), verifyBackupCode }, "backup", "  abcd-efgh  ")).toEqual({ ok: true })
    expect(verifyBackupCode).toHaveBeenCalledWith("abcd-efgh")
  })

  test("a malformed code never reaches the API; a wrong one is one generic message; 429 is the rate-limit copy", async () => {
    const verifyTotp = vi.fn()
    expect(await secondFactorStep({ verifyTotp, verifyBackupCode: vi.fn() }, "totp", "12ab")).toMatchObject({ ok: false, message: "Enter the 6-digit code from your authenticator app" })
    expect(await secondFactorStep({ verifyTotp: vi.fn(), verifyBackupCode: vi.fn() }, "backup", "")).toMatchObject({ ok: false })
    expect(verifyTotp).not.toHaveBeenCalled()
    expect(await secondFactorStep({ verifyTotp: async () => { throw err(401, "invalid_code") }, verifyBackupCode: vi.fn() }, "totp", "000000")).toEqual({ ok: false, message: "That code is not right. Try again." })
    expect(await secondFactorStep({ verifyTotp: vi.fn(), verifyBackupCode: async () => { throw err(401, "invalid_backup_code") } }, "backup", "x-y")).toEqual({ ok: false, message: "That code is not right. Try again." })
    expect(await secondFactorStep({ verifyTotp: async () => { throw err(429, "too_many_requests") }, verifyBackupCode: vi.fn() }, "totp", "000000")).toMatchObject({ ok: false, message: "Too many attempts, wait a minute." })
  })
})

describe("B7 T3 copy", () => {
  test("mfa_attempts_exceeded says to wait about 15 minutes, other 429s keep the generic copy, rate_limit_unavailable is 'try again shortly'", async () => {
    const lock = await secondFactorStep({ verifyTotp: async () => { throw err(429, "mfa_attempts_exceeded") }, verifyBackupCode: vi.fn() }, "totp", "000000")
    expect(lock).toEqual({ ok: false, message: "Too many wrong codes. Wait about 15 minutes." })
    expect(await secondFactorStep({ verifyTotp: async () => { throw err(429, "rate_limited") }, verifyBackupCode: vi.fn() }, "totp", "000000")).toMatchObject({ message: "Too many attempts, wait a minute." })
    expect(await secondFactorStep({ verifyTotp: async () => { throw err(503, "rate_limit_unavailable") }, verifyBackupCode: vi.fn() }, "totp", "000000")).toEqual({ ok: false, message: "Try again shortly." })
    expect(await signInStep({ signInEmail: async () => { throw err(503, "rate_limit_unavailable") } }, { email: "a@x.ie", password: "p" })).toEqual({ kind: "error", message: "Try again shortly." })
  })
})

describe("T6.3 sign-up, verification and reset", () => {
  test("sign-up creates no session: success is only 'check your inbox'; an existing email looks the same as a new one", async () => {
    expect(await signUpStep({ signUpEmail: async () => {} }, { name: "A", email: "a@x.ie", password: "Passw0rd!long" })).toEqual({ ok: true })
    // Better Auth answers an existing address with 422 USER_ALREADY_EXISTS...: the wizard must not reveal it
    for (const code of ["user_already_exists", "user_already_exists_use_another_email"]) {
      expect(await signUpStep({ signUpEmail: async () => { throw err(422, code) } }, { name: "A", email: "a@x.ie", password: "Passw0rd!long" }), code).toEqual({ ok: true })
    }
    expect(await signUpStep({ signUpEmail: async () => { throw err(429, "too_many_requests") } }, { name: "A", email: "a@x.ie", password: "x" })).toMatchObject({ ok: false, message: "Too many attempts, wait a minute." })
  })

  test("verifyEmailStep: success; an expired or bad token is one 'expired' state with a resend; nothing else says why", async () => {
    expect(await verifyEmailStep({ verifyEmail: async () => {} }, "tok")).toEqual({ kind: "verified" })
    for (const code of ["invalid_token", "token_expired", "user_not_found"]) expect(await verifyEmailStep({ verifyEmail: async () => { throw err(400, code) } }, "tok"), code).toEqual({ kind: "expired" })
    expect(await verifyEmailStep({ verifyEmail: async () => { throw new TypeError("x") } }, "tok")).toEqual({ kind: "error", message: "No connection. Try again." })
    expect(await verifyEmailStep({ verifyEmail: vi.fn() }, "")).toEqual({ kind: "expired" })
  })

  test("forgot password: the same confirmation for a known address, an unknown one and any 4xx; only an outage or a rate limit differ", async () => {
    const ok = await forgotStep({ requestPasswordReset: async () => {} }, "a@x.ie")
    expect(ok).toEqual({ ok: true })
    for (const status of [400, 404, 422]) expect(await forgotStep({ requestPasswordReset: async () => { throw err(status, "x") } }, "nobody@x.ie")).toEqual(ok)
    expect(await forgotStep({ requestPasswordReset: async () => { throw err(429, "too_many_requests") } }, "a@x.ie")).toMatchObject({ ok: false, message: "Too many attempts, wait a minute." })
    expect(await forgotStep({ requestPasswordReset: async () => { throw new TypeError("x") } }, "a@x.ie")).toMatchObject({ ok: false, message: "No connection. Try again." })
  })

  test("reset: a bad, used or expired token is ONE generic error; the new password is checked before any call", async () => {
    const requestReset = vi.fn(async () => {})
    expect(await resetStep({ resetPassword: requestReset }, "tok", "Another!Passw0rd")).toEqual({ ok: true })
    for (const code of ["invalid_token", "user_not_found", "token_expired"]) {
      expect(await resetStep({ resetPassword: async () => { throw err(400, code) } }, "tok", "Another!Passw0rd"), code).toEqual({ ok: false, message: "This link is not valid or has expired. Ask for a new one.", expired: true })
    }
    expect(await resetStep({ resetPassword: requestReset }, "", "Another!Passw0rd")).toMatchObject({ ok: false, expired: true })
    const spy = vi.fn()
    expect(await resetStep({ resetPassword: spy }, "tok", "short")).toMatchObject({ ok: false, message: expect.stringMatching(/8/) })
    expect(spy).not.toHaveBeenCalled()
  })
})
