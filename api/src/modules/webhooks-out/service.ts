import { randomBytes, randomUUID } from "node:crypto"
import { and, asc, eq, isNull, sql } from "drizzle-orm"
import { buildKeyring, seal } from "../../core/crypto/secret-box"
import { AppError, Conflict, NotFound } from "../../core/errors"
import { assertSafeUrl, WebhookUrlError } from "../../core/net/ssrf-guard"
import { webhookEndpoints } from "../../db/schema"
import { withTenant, type TenantTx } from "../../db/tenant-tx"
import type { Deps } from "../../deps"
import { recordAudit } from "../audit"
import { isWebhookEvent } from "./events"

const unprocessable = (code: string) => new AppError(422, code, "Unprocessable Entity")
const EndpointNotFound = () => NotFound("webhook_not_found")
export const MAX_ENDPOINTS = 10
const MAX_EVENTS = 32
// Two-key advisory lock namespace for webhook endpoints ("whk1"): distinct from the other module namespaces.
const WEBHOOK_LOCK_NS = 0x77686b31
const lock = (tx: TenantTx, tenantId: string) => tx.execute(sql`select pg_advisory_xact_lock(${WEBHOOK_LOCK_NS}::int4, hashtext(${tenantId}::text))`)

/** secret-box v2 purpose AAD: binds the ciphertext to its tenant AND endpoint (it cannot be moved to another row). */
export const webhookAad = (tenantId: string, endpointId: string) => `webhook:${tenantId}:${endpointId}`

type Row = typeof webhookEndpoints.$inferSelect
export type EndpointView = { id: string; url: string; events: string[]; active: boolean; createdBy: string; createdAt: Date; failingSince: Date | null }
const toView = (r: Row): EndpointView => ({ id: r.id, url: r.url, events: r.events, active: r.active, createdBy: r.createdBy, createdAt: r.createdAt, failingSince: r.failingSince })
/** What the audit trail keeps of an endpoint: never the secret and never the path/query of the URL (it can embed a token). */
const snap = (r: { url: string; events: string[]; active: boolean }) => ({ host: new URL(r.url).host, events: r.events, active: r.active })

async function vetUrl(deps: Deps, url: unknown): Promise<string> {
  try {
    return (await assertSafeUrl(url, deps.net.resolve)).url.toString()
  } catch (err) {
    if (err instanceof WebhookUrlError) throw unprocessable(err.code === "resolve_timeout" ? "unsafe_webhook_url" : err.code)
    throw err
  }
}

function assertEvents(events: unknown): string[] {
  if (!Array.isArray(events) || events.length < 1 || events.length > MAX_EVENTS || events.some((e) => typeof e !== "string" || !isWebhookEvent(e))) throw unprocessable("invalid_events")
  return [...new Set(events as string[])]
}

/**
 * Creates an endpoint. Order: 422 invalid_webhook_url | unsafe_webhook_url (SSRF guard: https, port, no userinfo, every resolved
 * address public), 422 invalid_events, then in one transaction (webhook lock first, audit last): 409 webhook_limit (10 per tenant,
 * soft-deleted ones do not count), the row with the secret sealed under AAD webhook:<tenant>:<endpoint>, audit. The secret is
 * returned ONCE, here, and never again.
 */
export async function createEndpoint(deps: Deps, tenantId: string, actorId: string, input: { url?: unknown; events?: unknown }): Promise<{ view: EndpointView; secret: string }> {
  const url = await vetUrl(deps, input.url)
  const events = assertEvents(input.events)
  const now = deps.clock.now()
  const id = randomUUID()
  const secret = `whsec_${randomBytes(32).toString("base64url")}`
  const sealed = seal(secret, buildKeyring(deps.env), webhookAad(tenantId, id))
  const row = await withTenant(deps.db, tenantId, async (tx) => {
    await lock(tx, tenantId)
    const live = await tx.select({ id: webhookEndpoints.id }).from(webhookEndpoints).where(and(eq(webhookEndpoints.tenantId, tenantId), isNull(webhookEndpoints.deletedAt)))
    if (live.length >= MAX_ENDPOINTS) throw Conflict("webhook_limit")
    const [r] = await tx.insert(webhookEndpoints).values({ id, tenantId, url, secretCiphertext: sealed, events, createdBy: actorId, createdAt: now }).returning()
    await recordAudit(tx, tenantId, { action: "webhook.created", entity: "webhook", entityId: id, actorId, before: null, after: snap(r) }, now)
    return r
  })
  return { view: toView(row), secret }
}

export async function listEndpoints(deps: Deps, tenantId: string): Promise<EndpointView[]> {
  const rows = await withTenant(deps.db, tenantId, (tx) =>
    tx.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.tenantId, tenantId), isNull(webhookEndpoints.deletedAt))).orderBy(asc(webhookEndpoints.createdAt), asc(webhookEndpoints.id)),
  )
  return rows.map(toView)
}

/** PATCH: url (re-vetted, 422), events (422), active (resuming clears the failing clock). 404 webhook_not_found (also another tenant's id). */
export async function updateEndpoint(deps: Deps, tenantId: string, actorId: string, id: string, patch: { url?: unknown; events?: unknown; active?: boolean }): Promise<EndpointView> {
  const url = patch.url === undefined ? undefined : await vetUrl(deps, patch.url)
  const events = patch.events === undefined ? undefined : assertEvents(patch.events)
  const now = deps.clock.now()
  return withTenant(deps.db, tenantId, async (tx) => {
    await lock(tx, tenantId)
    const [cur] = await tx.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.id, id), isNull(webhookEndpoints.deletedAt))).for("update")
    if (!cur) throw EndpointNotFound()
    const set: Partial<Pick<Row, "url" | "events" | "active" | "failingSince">> = {}
    if (url !== undefined) set.url = url
    if (events !== undefined) set.events = events
    if (patch.active !== undefined) {
      set.active = patch.active
      if (patch.active) set.failingSince = null
    }
    const [row] = await tx.update(webhookEndpoints).set(set).where(eq(webhookEndpoints.id, id)).returning()
    await recordAudit(tx, tenantId, { action: "webhook.updated", entity: "webhook", entityId: id, actorId, before: snap(cur), after: snap(row) }, now)
    return toView(row)
  })
}

/** Soft delete: deleted_at set, inactive, the sealed secret blanked. Pending deliveries to it are failed by the job (endpoint_inactive). */
export async function deleteEndpoint(deps: Deps, tenantId: string, actorId: string, id: string): Promise<void> {
  const now = deps.clock.now()
  await withTenant(deps.db, tenantId, async (tx) => {
    await lock(tx, tenantId)
    const [cur] = await tx.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.id, id), isNull(webhookEndpoints.deletedAt))).for("update")
    if (!cur) throw EndpointNotFound()
    // the secret is blanked and the URL redacted to scheme+host: no path or query token survives a delete
    await tx.update(webhookEndpoints).set({ deletedAt: now, active: false, secretCiphertext: "", url: new URL(cur.url).origin }).where(eq(webhookEndpoints.id, id))
    await recordAudit(tx, tenantId, { action: "webhook.deleted", entity: "webhook", entityId: id, actorId, before: snap(cur), after: null }, now)
  })
}
