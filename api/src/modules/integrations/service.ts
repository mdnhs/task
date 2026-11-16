import { emailHmac } from "../../core/crypto/audit-hmac"
import { createHash, randomBytes } from "node:crypto"
import { and, asc, eq, lt, or, sql, isNotNull } from "drizzle-orm"
import { AppError, NotFound } from "../../core/errors"
import { buildKeyring, open, seal } from "../../core/crypto/secret-box"
import { publish } from "../../core/events"
import { DRIVE_SCOPE } from "../../core/oauth/google-oauth"
import { OAuthError } from "../../core/oauth/oauth"
import { integrationConnections, memberships, oauthStates } from "../../db/schema"
import { withTenant, withUser, type TenantTx } from "../../db/tenant-tx"
import type { Deps } from "../../deps"
import { recordAudit } from "../audit"
import { notify, withTenantAfterCommit } from "../notifications"
import { lockActor } from "../rbac"

/** Audit never holds the raw account email (ruling B14): an HMAC reference instead. */
const hmacOf = (deps: Deps, tenantId: string, email: string | null | undefined): string | null => (email ? emailHmac(deps.env, tenantId, email) : null)

export const REFRESH_JOB = "integration.refresh"
/** An OAuth authorisation must be completed within 10 minutes of `start`. */
export const STATE_TTL_MS = 10 * 60_000
/** A token with less than this left is refreshed before use. */
export const REFRESH_SKEW_MS = 5 * 60_000

const INTEGRATION_LOCK_NS = 0x696e7467 // "intg"
/** Serialises connect/disconnect per tenant (take FIRST, before lockActor; row locks and the audit lock come after). */
const lockIntegrations = (tx: TenantTx, tenantId: string) => tx.execute(sql`select pg_advisory_xact_lock(${INTEGRATION_LOCK_NS}::int, hashtext(${tenantId}::text))`)

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex")
const tokenAad = (tenantId: string) => `integration:${tenantId}:google`
const verifierAad = (tenantId: string, userId: string) => `oauth_verifier:${tenantId}:${userId}`
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STATE_FORMAT = /^[A-Za-z0-9_-]{43}$/ // 32 random bytes, base64url
const safeCode = (e: unknown): string => {
  const c = e && typeof e === "object" ? ((e as { code?: unknown }).code ?? (e as { name?: unknown }).name) : undefined
  return typeof c === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(c) ? c : "error"
}

export const redirectUriOf = (deps: Deps): string => deps.env.GOOGLE_INTEGRATION_REDIRECT_URI ?? `${deps.env.APP_URL.replace(/\/+$/, "")}/v1/integrations/google/callback`
/** Where the browser lands after the callback. Only a short status/reason code is ever put in it. */
export const landingUrl = (deps: Deps, status: "connected" | "error", reason?: string): string => {
  const u = `${deps.env.APP_URL.replace(/\/+$/, "")}/settings/integrations?status=${status}`
  return reason ? `${u}&reason=${reason}` : u
}

/** The sealed secret: access + refresh token, expiry and granted scopes, as ONE JSON blob. Never leaves this module. */
type TokenBlob = { accessToken: string; refreshToken: string | null; expiresAt: string; scopes: string[] }
const sealBlob = (deps: Deps, tenantId: string, b: TokenBlob) => seal(JSON.stringify(b), buildKeyring(deps.env), tokenAad(tenantId)) // v2 only
function openBlob(deps: Deps, tenantId: string, sealed: string): TokenBlob {
  const b = JSON.parse(open(sealed, buildKeyring(deps.env), tokenAad(tenantId))) as TokenBlob // v1 (no AAD) is rejected by default
  if (typeof b.accessToken !== "string" || typeof b.expiresAt !== "string") throw new Error("malformed token blob")
  return b
}

export type IntegrationDto = {
  id: string
  provider: string
  status: string
  scopes: string[]
  accountEmail: string | null
  connectedBy: string
  connectedAt: string
  lastRefreshAt: string | null
}

/** Never selects `token_ciphertext`. */
export async function listIntegrations(tx: TenantTx, tenantId: string): Promise<IntegrationDto[]> {
  const rows = await tx
    .select({
      id: integrationConnections.id, provider: integrationConnections.provider, status: integrationConnections.status, scopes: integrationConnections.scopes,
      accountEmail: integrationConnections.accountEmail, connectedBy: integrationConnections.connectedBy, connectedAt: integrationConnections.connectedAt, lastRefreshAt: integrationConnections.lastRefreshAt,
    })
    .from(integrationConnections)
    .where(eq(integrationConnections.tenantId, tenantId))
    .orderBy(asc(integrationConnections.connectedAt))
  return rows.map((r) => ({ ...r, connectedAt: r.connectedAt.toISOString(), lastRefreshAt: r.lastRefreshAt?.toISOString() ?? null }))
}

// ------------------------------------------------------------------ OAuth: start

/**
 * Begins the Google connection: PKCE S256 (verifier = 32 random bytes base64url) and `state` (32 random bytes
 * base64url). The state is stored ONLY as sha256; the verifier is sealed (AAD `oauth_verifier:<tenant>:<user>`).
 * The row is bound to the starting user and valid for 10 minutes.
 */
export async function startGoogle(deps: Deps, tenantId: string, userId: string): Promise<{ url: string }> {
  if (!deps.oauth.google.configured()) throw new AppError(503, "integration_not_configured", "Service Unavailable")
  const state = randomBytes(32).toString("base64url")
  const verifier = randomBytes(32).toString("base64url")
  const challenge = createHash("sha256").update(verifier).digest("base64url")
  const redirectUri = redirectUriOf(deps)
  const now = deps.clock.now()
  await withTenant(deps.db, tenantId, async (tx) => {
    await lockActor(tx, tenantId, userId, "settings", "write")
    // housekeeping: this user's spent or expired attempts
    await tx.delete(oauthStates).where(and(eq(oauthStates.tenantId, tenantId), eq(oauthStates.userId, userId), or(isNotNull(oauthStates.usedAt), lt(oauthStates.expiresAt, now))))
    await tx.insert(oauthStates).values({
      tenantId, userId, provider: "google", stateHash: sha256(state), verifierCiphertext: seal(verifier, buildKeyring(deps.env), verifierAad(tenantId, userId)),
      redirectUri, createdAt: now, expiresAt: new Date(now.getTime() + STATE_TTL_MS),
    })
  })
  return { url: deps.oauth.google.authUrl(state, challenge, redirectUri) }
}

// ------------------------------------------------------------------ OAuth: callback

export type ConsumedState = { tenantId: string; verifier: string; redirectUri: string }

/**
 * Atomically spends a state for THIS user: `UPDATE ... WHERE state_hash AND user_id AND used_at IS NULL AND expires_at > now
 * RETURNING`. The browser callback carries no X-Tenant, so the user's active tenants are tried; the hash is unique, so at
 * most one matches. A state started by someone else (or unknown, expired, reused) matches nothing and is NOT consumed.
 */
export async function consumeState(deps: Deps, userId: string, state: string | undefined): Promise<ConsumedState | null> {
  if (!state || !STATE_FORMAT.test(state)) return null
  const hash = sha256(state)
  const now = deps.clock.now()
  const tenantIds = await withUser(deps.db, userId, async (tx) =>
    (await tx.select({ id: memberships.tenantId }).from(memberships).where(and(eq(memberships.userId, userId), eq(memberships.status, "active")))).map((r) => r.id),
  )
  for (const tenantId of tenantIds) {
    const row = await withTenant(deps.db, tenantId, async (tx) => {
      const [r] = await tx
        .update(oauthStates)
        .set({ usedAt: now })
        .where(and(eq(oauthStates.tenantId, tenantId), eq(oauthStates.stateHash, hash), eq(oauthStates.userId, userId), eq(oauthStates.provider, "google"), sql`${oauthStates.usedAt} is null`, sql`${oauthStates.expiresAt} > ${now}`))
        .returning({ verifier: oauthStates.verifierCiphertext, redirectUri: oauthStates.redirectUri })
      return r
    })
    if (row) return { tenantId, verifier: open(row.verifier, buildKeyring(deps.env), verifierAad(tenantId, userId)), redirectUri: row.redirectUri }
  }
  return null
}

/** Best-effort revoke; failures are logged by code only. */
async function revokeQuietly(deps: Deps, token: string | null | undefined): Promise<void> {
  if (!token) return
  try {
    await deps.oauth.google.revoke(token)
  } catch (err) {
    deps.logger.warn({ errCode: safeCode(err) }, "google token revoke failed")
  }
}

/**
 * Second half of the callback: exchange the code (PKCE verifier), check the grant, then store the sealed tokens, audit and
 * publish in one tx. Returns the landing URL reason on a provider-side failure (`ok:false`); a permission failure of the
 * starting user throws 403 (the grant is revoked first so no orphaned token stays alive at Google).
 */
export async function completeGoogle(deps: Deps, s: ConsumedState, userId: string, code: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  let t
  try {
    t = await deps.oauth.google.exchange(code, s.verifier, s.redirectUri)
  } catch (err) {
    deps.logger.warn({ errCode: safeCode(err) }, "google code exchange failed")
    return { ok: false, reason: err instanceof OAuthError && err.code === "not_configured" ? "not_configured" : "exchange_failed" }
  }
  if (!t.scopes.includes(DRIVE_SCOPE)) {
    await revokeQuietly(deps, t.refreshToken ?? t.accessToken)
    return { ok: false, reason: "insufficient_scope" }
  }
  if (!t.refreshToken) {
    await revokeQuietly(deps, t.accessToken)
    return { ok: false, reason: "no_refresh_token" }
  }
  const now = deps.clock.now()
  const sealed = sealBlob(deps, s.tenantId, { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: new Date(now.getTime() + t.expiresInSec * 1000).toISOString(), scopes: t.scopes })
  try {
    await withTenant(deps.db, s.tenantId, async (tx) => {
      await lockIntegrations(tx, s.tenantId)
      await lockActor(tx, s.tenantId, userId, "settings", "write") // re-checked now: the user may have been demoted since `start`
      const [cur] = await tx.select().from(integrationConnections).where(and(eq(integrationConnections.tenantId, s.tenantId), eq(integrationConnections.provider, "google"))).for("update")
      const values = { status: "connected", scopes: t.scopes, accountEmail: t.accountEmail ?? null, tokenCiphertext: sealed, connectedBy: userId, connectedAt: now, lastRefreshAt: null }
      let id: string
      if (cur) {
        await tx.update(integrationConnections).set(values).where(eq(integrationConnections.id, cur.id))
        id = cur.id
      } else {
        ;[{ id }] = await tx.insert(integrationConnections).values({ tenantId: s.tenantId, provider: "google", ...values }).returning({ id: integrationConnections.id })
      }
      // Audited WITHOUT any token material or ciphertext.
      await recordAudit(
        tx, s.tenantId,
        {
          action: "integration.connected", entity: "integration", entityId: id, actorId: userId,
          before: cur ? { status: cur.status, emailHmac: hmacOf(deps, s.tenantId, cur.accountEmail), scopes: cur.scopes, connectedBy: cur.connectedBy } : null,
          after: { provider: "google", status: "connected", emailHmac: hmacOf(deps, s.tenantId, t.accountEmail), scopes: t.scopes },
        },
        now,
      )
      await publish(tx, { tenantId: s.tenantId, type: "integration.connected", payload: { integrationId: id, provider: "google" }, actorId: userId }, now)
    })
  } catch (err) {
    await revokeQuietly(deps, t.refreshToken)
    throw err
  }
  return { ok: true }
}

// ------------------------------------------------------------------ disconnect

/** Marks the connection revoked and clears the ciphertext in one tx; the Google-side revoke is best effort after commit. Idempotent. */
export async function disconnect(deps: Deps, tenantId: string, userId: string, id: string): Promise<void> {
  const token = await withTenant(deps.db, tenantId, async (tx) => {
    await lockIntegrations(tx, tenantId)
    await lockActor(tx, tenantId, userId, "settings", "write")
    const [row] = await tx.select().from(integrationConnections).where(and(eq(integrationConnections.id, id), eq(integrationConnections.tenantId, tenantId))).for("update")
    if (!row) throw NotFound("integration_not_found")
    if (row.status === "revoked") return null
    let revokeWith: string | null = null
    try {
      const b = openBlob(deps, tenantId, row.tokenCiphertext!)
      revokeWith = b.refreshToken ?? b.accessToken
    } catch {
      // unreadable blob (e.g. a retired key): still disconnect locally
    }
    const now = deps.clock.now()
    await tx.update(integrationConnections).set({ status: "revoked", tokenCiphertext: null }).where(eq(integrationConnections.id, id))
    await recordAudit(
      tx, tenantId,
      { action: "integration.disconnected", entity: "integration", entityId: id, actorId: userId, before: { status: row.status, accountEmail: row.accountEmail, scopes: row.scopes }, after: { status: "revoked" } },
      now,
    )
    await publish(tx, { tenantId, type: "integration.disconnected", payload: { integrationId: id, provider: row.provider }, actorId: userId }, now)
    return revokeWith
  })
  await revokeQuietly(deps, token)
}

// ------------------------------------------------------------------ tokens: lazy refresh

const unavailable = () => new AppError(409, "integration_unavailable", "Conflict")

/**
 * The current access token of a connection, refreshed first when it has < 5 minutes left. This is how every later
 * module obtains a token (refresh is lazy/on-demand; the `integration.refresh` job below is the proactive path). One
 * row lock per connection serialises concurrent refreshes (a held lock across one HTTP call is accepted).
 * A failed refresh (Google rejects the refresh token, network error) sets status `error`, audits, and notifies the
 * connecting admin (kind "security", never quiet-hour-held); the failure is committed, THEN 409 integration_unavailable.
 * Any non-connected connection also answers 409 integration_unavailable; an id of another tenant is 404.
 */
export async function getAccessToken(deps: Deps, tenantId: string, id: string): Promise<string> {
  const out = await withTenantAfterCommit<{ token: string } | null>(deps, tenantId, async (tx, enqueue) => {
    const [row] = await tx.select().from(integrationConnections).where(and(eq(integrationConnections.id, id), eq(integrationConnections.tenantId, tenantId))).for("update")
    if (!row) throw NotFound("integration_not_found")
    if (row.status !== "connected" || !row.tokenCiphertext) return null
    const now = deps.clock.now()
    const blob = openBlob(deps, tenantId, row.tokenCiphertext)
    if (new Date(blob.expiresAt).getTime() - now.getTime() >= REFRESH_SKEW_MS) return { token: blob.accessToken }
    let reason = "refresh_failed"
    try {
      if (!blob.refreshToken) throw new OAuthError("refresh_failed")
      const r = await deps.oauth.google.refresh(blob.refreshToken)
      const next: TokenBlob = {
        accessToken: r.accessToken,
        refreshToken: r.refreshToken ?? blob.refreshToken, // Google usually omits it: keep the one we have
        expiresAt: new Date(now.getTime() + r.expiresInSec * 1000).toISOString(),
        scopes: r.scopes ?? blob.scopes,
      }
      await tx.update(integrationConnections).set({ tokenCiphertext: sealBlob(deps, tenantId, next), lastRefreshAt: now }).where(eq(integrationConnections.id, id))
      return { token: next.accessToken }
    } catch (err) {
      if (err instanceof OAuthError) reason = err.code
      deps.logger.warn({ errCode: safeCode(err), integrationId: id }, "google token refresh failed")
    }
    await tx.update(integrationConnections).set({ status: "error" }).where(eq(integrationConnections.id, id))
    await recordAudit(tx, tenantId, { action: "integration.refresh_failed", entity: "integration", entityId: id, actorId: null, before: { status: "connected" }, after: { status: "error", reason } }, now)
    await notify(
      tx, tenantId,
      { userId: row.connectedBy, kind: "security", title: "Google integration needs attention", body: "OpsDesk could not refresh access to the connected Google account. Reconnect it in Settings > Integrations.", link: "/settings/integrations" },
      deps, enqueue,
    )
    return null
  })
  if (!out) throw unavailable()
  return out.token
}

/**
 * Job `integration.refresh` (data { tenantId, integrationId }, ids only): refreshes the connection if it expires within
 * 5 minutes. A connection that is gone, revoked or in error is a no-op (the failure was already notified).
 */
export async function refreshJob(data: unknown, deps: Deps): Promise<void> {
  const d = data as { tenantId?: unknown; integrationId?: unknown }
  if (typeof d?.tenantId !== "string" || typeof d?.integrationId !== "string" || !UUID.test(d.tenantId) || !UUID.test(d.integrationId)) throw new Error("invalid integration.refresh job data")
  try {
    await getAccessToken(deps, d.tenantId, d.integrationId)
  } catch (err) {
    if (err instanceof AppError && (err.code === "integration_unavailable" || err.code === "integration_not_found")) return
    throw err
  }
}
