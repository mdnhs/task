// A thin client over the Better Auth endpoints the app uses (B6 ruling I3): no better-auth package in the browser, typed responses (zod),
// every failure an ApiError (so classifyApiError / userMessage apply). The browser calls same-origin /api/auth/*, which the BFF forwards;
// the session cookie is set by the API (httpOnly) and never readable here. Paths and bodies are pinned by the contract tests
// (test/contract/smoke.test.ts) against the real API, so a better-auth upgrade that renames an endpoint fails a test.
import { z } from "zod"
import { ApiError } from "./api/problem"

export type AuthClientOptions = {
  /** `/api/auth` in the browser; the contract tests pass the real app. */
  baseUrl: string
  fetch?: typeof globalThis.fetch
  headers?: () => Promise<Headers> | Headers
}

const Ok = z.object({}).loose()
const SignIn = z.object({ twoFactorRedirect: z.boolean().optional() }).loose()
const TotpEnabled = z.object({ totpURI: z.string(), backupCodes: z.array(z.string()) })
const TotpUri = z.object({ totpURI: z.string() })
const BackupCodes = z.object({ backupCodes: z.array(z.string()) })

export function makeAuthClient(o: AuthClientOptions) {
  const base = o.baseUrl.replace(/\/+$/, "")

  async function send<S extends z.ZodType>(method: "GET" | "POST", path: string, schema: S, body?: unknown): Promise<z.infer<S>> {
    const headers = new Headers({ accept: "application/json" })
    for (const [k, v] of (await o.headers?.())?.entries() ?? []) headers.set(k, v)
    if (body !== undefined) headers.set("content-type", "application/json")
    const doFetch = o.fetch ?? globalThis.fetch
    const res = await doFetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin", cache: "no-store" })
    if (!res.ok) throw await ApiError.fromResponse(res)
    const text = await res.text()
    let json: unknown = {}
    try {
      json = text ? JSON.parse(text) : {}
    } catch {
      throw new ApiError(502, "bad_response", res.headers.get("x-request-id") ?? "")
    }
    const parsed = schema.safeParse(json)
    if (!parsed.success) throw new ApiError(502, "bad_response", res.headers.get("x-request-id") ?? "")
    return parsed.data
  }

  return {
    /** Resolves `{ twoFactorRedirect: true }` when a second factor is still needed (no session yet), otherwise `{}` and the session cookie is set. */
    async signInEmail(b: { email: string; password: string; rememberMe?: boolean }): Promise<{ twoFactorRedirect?: true }> {
      const r = await send("POST", "/sign-in/email", SignIn, b)
      return r.twoFactorRedirect === true ? { twoFactorRedirect: true } : {}
    },
    async signUpEmail(b: { name: string; email: string; password: string }): Promise<void> {
      await send("POST", "/sign-up/email", Ok, b)
    },
    async verifyEmail(token: string): Promise<void> {
      await send("GET", `/verify-email?token=${encodeURIComponent(token)}`, Ok)
    },
    async resendVerification(email: string, callbackURL?: string): Promise<void> {
      await send("POST", "/send-verification-email", Ok, { email, ...(callbackURL ? { callbackURL } : {}) })
    },
    async requestPasswordReset(email: string, redirectTo: string): Promise<void> {
      await send("POST", "/request-password-reset", Ok, { email, redirectTo })
    },
    async resetPassword(token: string, newPassword: string): Promise<void> {
      await send("POST", "/reset-password", Ok, { token, newPassword })
    },
    async verifyTotp(code: string, opt: { trustDevice?: boolean } = {}): Promise<void> {
      await send("POST", "/two-factor/verify-totp", Ok, { code, ...(opt.trustDevice !== undefined ? { trustDevice: opt.trustDevice } : {}) })
    },
    async verifyBackupCode(code: string): Promise<void> {
      await send("POST", "/two-factor/verify-backup-code", Ok, { code })
    },
    enableTotp: (password: string) => send("POST", "/two-factor/enable", TotpEnabled, { password }),
    async disableTotp(password: string): Promise<void> {
      await send("POST", "/two-factor/disable", Ok, { password })
    },
    getTotpUri: (password: string) => send("POST", "/two-factor/get-totp-uri", TotpUri, { password }),
    generateBackupCodes: (password: string) => send("POST", "/two-factor/generate-backup-codes", BackupCodes, { password }),
    async signOut(): Promise<void> {
      await send("POST", "/sign-out", Ok, {})
    },
  }
}

export type AuthClient = ReturnType<typeof makeAuthClient>

/** The browser's client: same-origin /api/auth through the BFF. */
const browserAuth = makeAuthClient({ baseUrl: "/api/auth" })
export const { signInEmail, signUpEmail, verifyEmail, resendVerification, requestPasswordReset, resetPassword, verifyTotp, verifyBackupCode, enableTotp, disableTotp, getTotpUri, generateBackupCodes, signOut } = browserAuth
