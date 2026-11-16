import { desc, eq } from "drizzle-orm"
import { AppError, Conflict, NotFound } from "../../core/errors"
import { apiKeyIndex, apiKeys } from "../../db/schema"
import { withTenant } from "../../db/tenant-tx"
import type { Deps } from "../../deps"
import { recordAudit } from "../audit"
import { creatorHolds, generateKey, hashKey, parseScope } from "./key"

const unprocessable = (code: string) => new AppError(422, code, "Unprocessable Entity")
const KeyNotFound = () => NotFound("api_key_not_found")
const MAX_SCOPES = 50

type Row = typeof apiKeys.$inferSelect
export type ApiKeyView = { id: string; name: string; prefix: string; scopes: string[]; createdBy: string; createdAt: Date; lastUsedAt: Date | null; revokedAt: Date | null }
export const toView = (r: Row): ApiKeyView => ({ id: r.id, name: r.name, prefix: r.prefix, scopes: r.scopes, createdBy: r.createdBy, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt, revokedAt: r.revokedAt })

function assertName(name: unknown): string {
  const n = typeof name === "string" ? name.trim() : ""
  if (n.length < 1 || n.length > 100 || /[\r\n]/.test(n)) throw unprocessable("invalid_name")
  return n
}

/** Every scope: a known `<module>:read|write` (422 invalid_scope) that the creator's CURRENT role holds (422 scope_exceeds_role). Deduplicated. */
function assertScopes(scopes: unknown, creator: Record<string, string>): string[] {
  if (!Array.isArray(scopes) || scopes.length < 1 || scopes.length > MAX_SCOPES) throw unprocessable("invalid_scope")
  const parsed = scopes.map((s) => ({ raw: s as string, p: parseScope(s) }))
  if (parsed.some((x) => !x.p)) throw unprocessable("invalid_scope")
  if (parsed.some((x) => !creatorHolds(x.p!, creator))) throw unprocessable("scope_exceeds_role")
  return [...new Set(parsed.map((x) => x.raw))]
}

/**
 * Creates a key for the calling HUMAN member. Order: 422 invalid_name, 422 invalid_scope, 422 scope_exceeds_role (scopes must
 * be a subset of the creator's current role access: no escalation, ADMIN_MODULES included), then one transaction: key row +
 * ids-only index row + audit (actor = the creator). Returns the full key ONCE; only its sha256 is stored. A prefix collision
 * (62^8, effectively never) retries with a new key.
 */
export async function createApiKey(deps: Deps, tenantId: string, creator: { userId: string; access: Record<string, string> }, input: { name?: unknown; scopes?: unknown }): Promise<{ view: ApiKeyView; key: string }> {
  const name = assertName(input.name)
  const scopes = assertScopes(input.scopes, creator.access)
  const now = deps.clock.now()
  for (let attempt = 0; ; attempt++) {
    const { key, prefix } = generateKey()
    try {
      const row = await withTenant(deps.db, tenantId, async (tx) => {
        const [r] = await tx.insert(apiKeys).values({ tenantId, name, prefix, keyHash: hashKey(key), scopes, createdBy: creator.userId, createdAt: now }).returning()
        await tx.insert(apiKeyIndex).values({ prefix, targetTenantId: tenantId, keyId: r.id })
        await recordAudit(tx, tenantId, { action: "api_key.created", entity: "api_key", entityId: r.id, actorId: creator.userId, before: null, after: { id: r.id, name, prefix, scopes } }, now)
        return r
      })
      return { view: toView(row), key }
    } catch (err) {
      const code = (err as { cause?: { code?: string } })?.cause?.code
      if (code === "23505" && attempt < 4) continue // prefix collision
      throw err
    }
  }
}

export async function listApiKeys(deps: Deps, tenantId: string): Promise<ApiKeyView[]> {
  const rows = await withTenant(deps.db, tenantId, (tx) => tx.select().from(apiKeys).where(eq(apiKeys.tenantId, tenantId)).orderBy(desc(apiKeys.createdAt)).limit(200))
  return rows.map(toView)
}

/** Revokes (sets revoked_at; the row stays for the audit trail). 404 api_key_not_found (also another tenant's id), 409 api_key_revoked. */
export async function revokeApiKey(deps: Deps, tenantId: string, actorId: string, id: string): Promise<ApiKeyView> {
  const now = deps.clock.now()
  return withTenant(deps.db, tenantId, async (tx) => {
    const [cur] = await tx.select().from(apiKeys).where(eq(apiKeys.id, id)).for("update")
    if (!cur) throw KeyNotFound()
    if (cur.revokedAt) throw Conflict("api_key_revoked")
    const [row] = await tx.update(apiKeys).set({ revokedAt: now }).where(eq(apiKeys.id, id)).returning()
    await recordAudit(tx, tenantId, { action: "api_key.revoked", entity: "api_key", entityId: id, actorId, before: { name: cur.name, prefix: cur.prefix, scopes: cur.scopes }, after: { revokedAt: now } }, now)
    return toView(row)
  })
}
