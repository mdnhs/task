import { createHash } from "node:crypto"
import { OAuthError, type OAuthClient } from "./oauth"
import { GOOGLE_SCOPES } from "./google-oauth"

export type FakeOAuth = OAuthClient & {
  /** Every call, in order (secrets included: tests only). */
  calls: { op: "authUrl" | "exchange" | "refresh" | "revoke"; arg: string }[]
  /**
   * Issues a single-use code bound to a flow started via `authUrl` (default: the latest one), like Google binds a code to
   * the code_challenge and redirect_uri of its authorisation request. `exchange` rejects (invalid_grant) a code that is
   * unknown or already used, whose verifier does not hash (S256) to the bound challenge, or whose redirect URI differs.
   */
  codeFor(email?: string, flow?: number): string
  /** Set by every `exchange` that passed the PKCE + redirect_uri check (reset with `reset`). */
  verified: { code: string; challenge: string }[]
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
  const codes = new Map<string, { email: string; challenge: string; redirectUri: string }>()
  const flows: { challenge: string; redirectUri: string }[] = []
  const f: FakeOAuth = {
    calls: [],
    grantScopes: [...GOOGLE_SCOPES],
    failRefresh: null,
    failRevoke: false,
    configured: true,
    expiresInSec: 3600,
    verified: [],
    codeFor(email = "drive@example.com", flow = flows.length - 1) {
      const fl = flows[flow]
      if (!fl) throw new Error("fake oauth: no authUrl flow to bind a code to (call start first)")
      const code = `code-${++seq}`
      codes.set(code, { email, ...fl })
      return code
    },
    google: {
      configured: () => f.configured,
      authUrl(state, challenge, redirectUri) {
        f.calls.push({ op: "authUrl", arg: state })
        flows.push({ challenge, redirectUri })
        const u = new URL("https://accounts.fake.test/auth")
        u.search = new URLSearchParams({ state, code_challenge: challenge, code_challenge_method: "S256", redirect_uri: redirectUri, scope: GOOGLE_SCOPES.join(" ") }).toString()
        return u.toString()
      },
      async exchange(code, verifier, redirectUri) {
        f.calls.push({ op: "exchange", arg: `${code}|${verifier}` })
        const c = codes.get(code)
        if (!c) throw new OAuthError("invalid_grant")
        codes.delete(code) // single use, even when the attempt below fails (as at Google)
        if (s256(verifier) !== c.challenge || redirectUri !== c.redirectUri) throw new OAuthError("invalid_grant")
        f.verified.push({ code, challenge: c.challenge })
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
