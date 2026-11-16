import type { Env } from "../../env"
import { OAuthError, type OAuthClient, type ProviderOAuth, type RefreshedTokens } from "./oauth"

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
const TOKEN = "https://oauth2.googleapis.com/token"
const REVOKE = "https://oauth2.googleapis.com/revoke"
const USERINFO = "https://openidconnect.googleapis.com/v1/userinfo"

/**
 * Scopes requested for the tenant integration: the minimal Drive scope that can read files (`drive.readonly`, no write,
 * no delete) plus `openid email` so the connection can show WHICH Google account it is. Nothing else.
 */
export const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/drive.readonly", "openid", "email"] as const
export const DRIVE_SCOPE = GOOGLE_SCOPES[0]

type TokenBody = { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; scope?: unknown }

/**
 * Google's documented OAuth 2.0 endpoints over plain fetch (authorization-code + PKCE for web servers). Uses its OWN
 * client (GOOGLE_INTEGRATION_CLIENT_ID/_SECRET), separate from the sign-in Google client. Errors carry a short code
 * only: provider response bodies can echo codes/tokens and are never propagated.
 */
export function makeGoogleOAuth(env: Pick<Env, "GOOGLE_INTEGRATION_CLIENT_ID" | "GOOGLE_INTEGRATION_CLIENT_SECRET">, fetchFn: typeof fetch = fetch): ProviderOAuth {
  const creds = () => {
    const id = env.GOOGLE_INTEGRATION_CLIENT_ID
    const secret = env.GOOGLE_INTEGRATION_CLIENT_SECRET
    if (!id || !secret) throw new OAuthError("not_configured")
    return { id, secret }
  }
  async function token(params: Record<string, string>, fail: "exchange_failed" | "refresh_failed"): Promise<TokenBody> {
    const { id, secret } = creds()
    let res: Response
    try {
      res = await fetchFn(TOKEN, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({ client_id: id, client_secret: secret, ...params }),
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      throw new OAuthError(fail)
    }
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: unknown }
      throw new OAuthError(err.error === "invalid_grant" ? "invalid_grant" : fail)
    }
    const body = (await res.json().catch(() => null)) as TokenBody | null
    if (!body || typeof body.access_token !== "string" || typeof body.expires_in !== "number") throw new OAuthError(fail)
    return body
  }
  const scopesOf = (b: TokenBody) => (typeof b.scope === "string" ? b.scope.split(" ").filter(Boolean) : [])
  return {
    configured: () => Boolean(env.GOOGLE_INTEGRATION_CLIENT_ID && env.GOOGLE_INTEGRATION_CLIENT_SECRET),
    authUrl(state, codeChallenge, redirectUri) {
      const u = new URL(AUTH)
      u.search = new URLSearchParams({
        client_id: creds().id,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: GOOGLE_SCOPES.join(" "),
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        access_type: "offline", // a refresh token
        prompt: "consent", // ... even when the account connected before
      }).toString()
      return u.toString()
    },
    async exchange(code, verifier, redirectUri) {
      const b = await token({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri }, "exchange_failed")
      let accountEmail: string | undefined
      try {
        const r = await fetchFn(USERINFO, { headers: { authorization: `Bearer ${b.access_token as string}` }, signal: AbortSignal.timeout(10_000) })
        if (r.ok) {
          const u = (await r.json()) as { email?: unknown }
          if (typeof u.email === "string") accountEmail = u.email
        }
      } catch {
        // the email is informational; the connection works without it
      }
      return {
        accessToken: b.access_token as string,
        refreshToken: typeof b.refresh_token === "string" ? b.refresh_token : undefined,
        expiresInSec: b.expires_in as number,
        scopes: scopesOf(b),
        accountEmail,
      }
    },
    async refresh(refreshToken): Promise<RefreshedTokens> {
      const b = await token({ grant_type: "refresh_token", refresh_token: refreshToken }, "refresh_failed")
      return {
        accessToken: b.access_token as string,
        refreshToken: typeof b.refresh_token === "string" ? b.refresh_token : undefined,
        expiresInSec: b.expires_in as number,
        scopes: scopesOf(b).length ? scopesOf(b) : undefined,
      }
    },
    async revoke(tokenValue) {
      await fetchFn(REVOKE, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: tokenValue }),
        signal: AbortSignal.timeout(10_000),
      })
    },
  }
}

export function makeOAuthClient(env: Pick<Env, "GOOGLE_INTEGRATION_CLIENT_ID" | "GOOGLE_INTEGRATION_CLIENT_SECRET">): OAuthClient {
  return { google: makeGoogleOAuth(env) }
}
