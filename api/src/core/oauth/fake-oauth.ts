import { createHash } from "node:crypto"
import { OAuthError, type OAuthClient } from "./oauth"
import { GOOGLE_SCOPES } from "./google-oauth"

export type FakeOAuth = OAuthClient & {
  /** Every call, in order (secrets included: tests only). */
  calls: { op: "authUrl" | "exchange" | "refresh" | "revoke"; arg: string }[]
  /** Codes handed out by `codeFor`; `exchange` accepts only these (and verifies the PKCE verifier). */
  codeFor(email?: string): string
  /** What the next `exchange` grants (default: every requested scope). */
  grantScopes: string[]
  /** When set, `refresh` throws this. */
  failRefresh: OAuthError["code"] | null
  failRevoke: boolean
  configured: boolean
  expiresInSec: number
}

/** Deterministic in-memory Google: code "code-N" -> tokens "at-N" / "rt-N"; refresh gives "at-N-rK". */
export function fakeOAuth(): FakeOAuth {
  let seq = 0
  let refreshSeq = 0
  const codes = new Map<string, { email: string; challenge?: string }>()
  const f: FakeOAuth = {
    calls: [],
    grantScopes: [...GOOGLE_SCOPES],
    failRefresh: null,
    failRevoke: false,
    configured: true,
    expiresInSec: 3600,
    codeFor(email = "drive@example.com") {
      const code = `code-${++seq}`
      codes.set(code, { email })
      return code
    },
    google: {
      configured: () => f.configured,
      authUrl(state, challenge, redirectUri) {
        f.calls.push({ op: "authUrl", arg: state })
        const u = new URL("https://accounts.fake.test/auth")
        u.search = new URLSearchParams({ state, code_challenge: challenge, code_challenge_method: "S256", redirect_uri: redirectUri, scope: GOOGLE_SCOPES.join(" ") }).toString()
        return u.toString()
      },
      async exchange(code, verifier) {
        f.calls.push({ op: "exchange", arg: `${code}|${verifier}` })
        const c = codes.get(code)
        if (!c) throw new OAuthError("exchange_failed")
        codes.delete(code) // codes are single use at Google too
        const n = code.slice("code-".length)
        return { accessToken: `at-${n}`, refreshToken: `rt-${n}`, expiresInSec: f.expiresInSec, scopes: f.grantScopes, accountEmail: c.email }
      },
      async refresh(refreshToken) {
        f.calls.push({ op: "refresh", arg: refreshToken })
        if (f.failRefresh) throw new OAuthError(f.failRefresh)
        return { accessToken: `${refreshToken.replace("rt-", "at-")}-r${++refreshSeq}`, expiresInSec: f.expiresInSec }
      },
      async revoke(token) {
        f.calls.push({ op: "revoke", arg: token })
        if (f.failRevoke) throw new Error("boom")
      },
    },
  }
  return f
}

/** The S256 challenge for a verifier (tests recompute it to check the auth URL). */
export const s256 = (verifier: string): string => createHash("sha256").update(verifier).digest("base64url")
