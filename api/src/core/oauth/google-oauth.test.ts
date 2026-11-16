import { expect, test } from "vitest"
import { makeGoogleOAuth } from "./google-oauth"
import { OAuthError } from "./oauth"

const env = { GOOGLE_INTEGRATION_CLIENT_ID: "cid", GOOGLE_INTEGRATION_CLIENT_SECRET: "csecret" }

test("unset client: not configured, and every call fails with not_configured", async () => {
  const g = makeGoogleOAuth({})
  expect(g.configured()).toBe(false)
  expect(() => g.authUrl("s", "c", "https://x/cb")).toThrow(OAuthError)
  await expect(g.exchange("c", "v", "https://x/cb")).rejects.toMatchObject({ code: "not_configured" })
})

test("auth URL: documented endpoint, S256, offline access, minimal Drive scope plus openid email", () => {
  const u = new URL(makeGoogleOAuth(env).authUrl("st", "chal", "https://api.test/cb"))
  expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth")
  expect(Object.fromEntries(u.searchParams)).toMatchObject({ client_id: "cid", redirect_uri: "https://api.test/cb", response_type: "code", state: "st", code_challenge: "chal", code_challenge_method: "S256", access_type: "offline", prompt: "consent" })
  expect(u.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/drive.readonly openid email")
})

test("exchange posts the code + PKCE verifier and reads the account email; provider error bodies never leak", async () => {
  const seen: { url: string; body: string }[] = []
  const f = (async (url: string, init: RequestInit) => {
    seen.push({ url, body: String(init.body) })
    if (url.endsWith("/token")) return Response.json({ access_token: "A", refresh_token: "R", expires_in: 3599, scope: "openid email https://www.googleapis.com/auth/drive.readonly" })
    return Response.json({ email: "x@example.com" })
  }) as unknown as typeof fetch
  const t = await makeGoogleOAuth(env, f).exchange("the-code", "the-verifier", "https://api.test/cb")
  expect(t).toEqual({ accessToken: "A", refreshToken: "R", expiresInSec: 3599, scopes: ["openid", "email", "https://www.googleapis.com/auth/drive.readonly"], accountEmail: "x@example.com" })
  const p = new URLSearchParams(seen[0].body)
  expect(Object.fromEntries(p)).toMatchObject({ grant_type: "authorization_code", code: "the-code", code_verifier: "the-verifier", client_id: "cid", client_secret: "csecret" })
  const bad = (async () => Response.json({ error: "invalid_grant", error_description: "secret-code-echo" }, { status: 400 })) as unknown as typeof fetch
  const err = await makeGoogleOAuth(env, bad).refresh("rt").then(() => null, (e: unknown) => e as OAuthError)
  expect(err).toBeInstanceOf(OAuthError)
  expect(err!.code).toBe("invalid_grant")
  expect(String(err!.message)).not.toContain("secret-code-echo")
})
