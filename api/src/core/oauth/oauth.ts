/** Tokens as the provider returned them. Never log, audit or return these. */
export type OAuthTokens = {
  accessToken: string
  /** Absent when the provider did not issue one (Google only does so with access_type=offline + consent). */
  refreshToken?: string
  expiresInSec: number
  scopes: string[]
  accountEmail?: string
}
export type RefreshedTokens = { accessToken: string; refreshToken?: string; expiresInSec: number; scopes?: string[] }

/** An OAuth failure; `code` is a short, safe identifier (never provider text, codes or tokens). */
export class OAuthError extends Error {
  constructor(public code: "not_configured" | "exchange_failed" | "refresh_failed" | "invalid_grant") {
    super(code)
  }
}

export type ProviderOAuth = {
  /** False when the provider's client id/secret are not set; start answers 503 and nothing else is attempted. */
  configured(): boolean
  authUrl(state: string, codeChallenge: string, redirectUri: string): string
  exchange(code: string, verifier: string, redirectUri: string): Promise<OAuthTokens>
  refresh(refreshToken: string): Promise<RefreshedTokens>
  /** Best effort: callers swallow failures. */
  revoke(token: string): Promise<void>
}

/** Deps.oauth: one member per integration provider. */
export type OAuthClient = { google: ProviderOAuth }
