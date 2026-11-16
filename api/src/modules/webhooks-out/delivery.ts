import { createHmac, randomUUID } from "node:crypto"
import { and, eq, isNull, lt, sql } from "drizzle-orm"
import { buildKeyring, open } from "../../core/crypto/secret-box"
import { subscribe } from "../../core/events"
import { assertSafeUrl, WebhookUrlError } from "../../core/net/ssrf-guard"
import { registerJob } from "../../core/queue/queue"
import { memberships, roles, tenants, webhookDeliveries, webhookEndpoints } from "../../db/schema"
import { withTenant } from "../../db/tenant-tx"
import type { Deps } from "../../deps"
import { recordAudit } from "../audit"
import { notify, withTenantAfterCommit } from "../notifications"
import { envelope, isWebhookEvent } from "./events"
import { webhookAad } from "./service"

export const DELIVER_JOB = "webhook.deliver"
export const SWEEP_JOB = "webhook.sweep"
export const FANOUT_SUBSCRIBER = "webhooks.fanout"
/** At most this many attempts per delivery, all within DELIVERY_WINDOW_MS of its creation, then it is `failed`. */
export const MAX_DELIVERY_ATTEMPTS = 8
export const DELIVERY_WINDOW_MS = 24 * 3_600_000
/** An endpoint whose deliveries have failed continuously for this long is switched off. */
export const AUTO_DISABLE_MS = 3 * 24 * 3_600_000
export const REQUEST_TIMEOUT_MS = 10_000
export const MAX_RESPONSE_BYTES = 64 * 1024
/** A claimed delivery is leased this long (next_attempt_at is pushed out); a crashed worker's delivery is taken over after it. */
export const LEASE_MS = 2 * 60_000
const SWEEP_STALE_MS = 2 * 60_000
/** Wait before retry n (after attempt n failed): ~1 min, 5 min, 15 min, 1 h, 2 h, 4 h, 8 h, each with +-20% jitter (total <= ~18.5 h < 24 h). */
const BASE_DELAYS_MS = [60_000, 300_000, 900_000, 3_600_000, 7_200_000, 14_400_000, 28_800_000]
const JITTER = 0.2
/** Exponential backoff with jitter for the retry that follows attempt `attempt` (1-based). `random` is injectable for tests. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = BASE_DELAYS_MS[Math.min(attempt, BASE_DELAYS_MS.length) - 1]
  return Math.round(base * (1 - JITTER + 2 * JITTER * random()))
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SAFE_CODE = /^[A-Za-z0-9_.-]{1,64}$/
const safeCode = (e: unknown): string => {
  const c = e && typeof e === "object" ? (e as { code?: unknown }).code : undefined
  return typeof c === "string" && SAFE_CODE.test(c) ? c : "network"
}

/**
 * Bus subscriber (reuses the transactional outbox + relay; there is no second outbox): for a committed event of an allow-listed
 * type, one `webhook_deliveries` row per active, subscribed endpoint of the tenant, written in the relay's tenant tx. UNIQUE
 * (endpoint_id, event_id) + ON CONFLICT DO NOTHING make it idempotent; the `webhook.deliver` job is buffered by ctx.enqueue and
 * reaches the queue only after commit, with a sha256 job id.
 */
export function registerWebhooks(): void {
  registerJob(DELIVER_JOB, deliverWebhook)
  registerJob(SWEEP_JOB, sweepWebhooks)
  try {
    subscribe("*", FANOUT_SUBSCRIBER, async (e, { tx, deps, enqueue }) => {
      const type = e.type
      if (!isWebhookEvent(type)) return
      const endpoints = await tx
        .select({ id: webhookEndpoints.id })
        .from(webhookEndpoints)
        .where(and(eq(webhookEndpoints.tenantId, e.tenantId), eq(webhookEndpoints.active, true), isNull(webhookEndpoints.deletedAt), sql`${e.type} = any(${webhookEndpoints.events})`))
      if (endpoints.length === 0) return
      const now = deps.clock.now()
      const payload = envelope({ ...e, type })
      for (const ep of endpoints) {
        const [d] = await tx
          .insert(webhookDeliveries)
          .values({ tenantId: e.tenantId, endpointId: ep.id, eventId: e.id, eventType: e.type, payload, nextAttemptAt: now, createdAt: now })
          .onConflictDoNothing()
          .returning({ id: webhookDeliveries.id })
        if (d) enqueue(DELIVER_JOB, { deliveryId: d.id, tenantId: e.tenantId }, { key: d.id })
      }
    })
  } catch (err) {
    if (!(err instanceof Error) || !err.message.startsWith("Duplicate event subscriber")) throw err
  }
}

type Claim =
  | { kind: "done" }
  | { kind: "send"; attempt: number; createdAt: Date; endpointId: string; url: string; sealed: string; payload: Record<string, unknown>; eventType: string; eventId: string }

type Outcome =
  | { kind: "delivered"; status: number }
  | { kind: "retry"; status: number | null; error: string | null }
  | { kind: "fail"; status: number | null; error: string }

/**
 * Job `webhook.deliver` (data: { deliveryId, tenantId }, ids only). Three short steps so no DB tx spans the network call:
 *  1. (tx) lock the delivery; skip unless `pending` and due (a claimed delivery is leased by pushing next_attempt_at out);
 *     a deleted / inactive endpoint fails it (endpoint_inactive); otherwise attempts + 1;
 *  2. outside any tx: open the sealed secret, RE-RESOLVE DNS and re-run the SSRF guard (every delivery, so a record flipped to a
 *     private address after create is refused: `unsafe_webhook_url`, final), then POST the signed body to the VETTED address
 *     (pinned: no second lookup between check and connect), never following redirects, 10 s timeout, <= 64 KB read, status only;
 *  3. (tx) record: 2xx -> delivered; 5xx, 429, network error/timeout -> retry with backoff (<= 8 attempts, all within 24 h, else
 *     failed); any other status (4xx, 3xx) -> failed at once. Each non-success also drives the auto-disable check.
 * Signature header: `X-OpsDesk-Signature: t=<unix seconds>,v1=<hex hmac_sha256(secret, "<t>.<body>")>`, plus X-OpsDesk-Event-Id
 * and X-OpsDesk-Event-Type. The body is the stored envelope, byte-identical on every retry (the receiver dedupes on the event id).
 * Logs carry ids, attempt, status and safe codes only: never the URL, secret or payload.
 */
export async function deliverWebhook(data: unknown, deps: Deps): Promise<void> {
  const d = data as { deliveryId?: unknown; tenantId?: unknown }
  if (typeof d?.deliveryId !== "string" || typeof d?.tenantId !== "string" || !UUID.test(d.deliveryId) || !UUID.test(d.tenantId)) throw new Error("invalid webhook.deliver job data")
  const { deliveryId, tenantId } = { deliveryId: d.deliveryId, tenantId: d.tenantId }

  const claim = await withTenant(deps.db, tenantId, async (tx): Promise<Claim> => {
    const [row] = await tx.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, deliveryId)).for("update")
    const now = deps.clock.now()
    if (!row || row.status !== "pending" || row.nextAttemptAt > now) return { kind: "done" }
    const [ep] = await tx.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, row.endpointId))
    if (!ep || ep.deletedAt !== null || !ep.active) {
      await tx.update(webhookDeliveries).set({ status: "failed", lastError: "endpoint_inactive" }).where(eq(webhookDeliveries.id, deliveryId))
      return { kind: "done" }
    }
    await tx.update(webhookDeliveries).set({ attempts: row.attempts + 1, nextAttemptAt: new Date(now.getTime() + LEASE_MS) }).where(eq(webhookDeliveries.id, deliveryId))
    return { kind: "send", attempt: row.attempts + 1, createdAt: row.createdAt, endpointId: ep.id, url: ep.url, sealed: ep.secretCiphertext, payload: row.payload, eventType: row.eventType, eventId: row.eventId }
  })
  if (claim.kind === "done") return

  const outcome = await attempt(deps, tenantId, claim)
  const now = deps.clock.now()
  const retryDelay = outcome.kind === "retry" ? backoffMs(claim.attempt) : 0
  const exhausted = outcome.kind === "retry" && (claim.attempt >= MAX_DELIVERY_ATTEMPTS || now.getTime() + retryDelay - claim.createdAt.getTime() > DELIVERY_WINDOW_MS)
  const final = outcome.kind === "fail" || exhausted
  await withTenantAfterCommit(deps, tenantId, async (tx, enqueue) => {
    if (outcome.kind === "delivered") {
      await tx.update(webhookDeliveries).set({ status: "delivered", deliveredAt: now, lastStatusCode: outcome.status, lastError: null }).where(eq(webhookDeliveries.id, deliveryId))
      await tx.update(webhookEndpoints).set({ failingSince: null }).where(eq(webhookEndpoints.id, claim.endpointId)) // a success resets the failing clock
      return
    }
    if (final) {
      await tx.update(webhookDeliveries).set({ status: "failed", lastStatusCode: outcome.status, lastError: outcome.error ?? "retries_exhausted" }).where(eq(webhookDeliveries.id, deliveryId))
    } else {
      await tx.update(webhookDeliveries).set({ nextAttemptAt: new Date(now.getTime() + retryDelay), lastStatusCode: outcome.status, lastError: outcome.error }).where(eq(webhookDeliveries.id, deliveryId))
      enqueue(DELIVER_JOB, { deliveryId, tenantId }, { delayMs: retryDelay, key: `${deliveryId}.a${claim.attempt}.${randomUUID()}` })
    }
    await noteFailure(tx, deps, tenantId, claim.endpointId, now, enqueue)
  })
  if (outcome.kind !== "delivered") {
    deps.logger[final ? "error" : "warn"]({ deliveryId, tenantId, attempt: claim.attempt, status: outcome.status, errCode: outcome.error, final }, "webhook delivery failed")
  }
}

async function attempt(deps: Deps, tenantId: string, claim: Extract<Claim, { kind: "send" }>): Promise<Outcome> {
  let secret: string
  try {
    secret = open(claim.sealed, buildKeyring(deps.env), webhookAad(tenantId, claim.endpointId))
  } catch {
    return { kind: "fail", status: null, error: "secret_unreadable" }
  }
  let target: Awaited<ReturnType<typeof assertSafeUrl>>
  try {
    target = await assertSafeUrl(claim.url, deps.net.resolve) // re-resolved on EVERY delivery
  } catch (err) {
    if (err instanceof WebhookUrlError && err.code === "resolve_timeout") return { kind: "retry", status: null, error: "dns_timeout" } // a slow resolver is a network error: retryable
    return { kind: "fail", status: null, error: "unsafe_webhook_url" }
  }
  const body = JSON.stringify(claim.payload)
  const ts = Math.floor(deps.clock.now().getTime() / 1000)
  const sig = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")
  const pinned = target.addresses[0]
  try {
    const res = await deps.net.send({
      url: target.url, address: pinned.address, family: pinned.family, body,
      headers: {
        "content-type": "application/json", "user-agent": "OpsDesk-Webhooks/1",
        "x-opsdesk-signature": `t=${ts},v1=${sig}`, "x-opsdesk-event-id": claim.eventId, "x-opsdesk-event-type": claim.eventType,
      },
      timeoutMs: REQUEST_TIMEOUT_MS, maxBytes: MAX_RESPONSE_BYTES,
    })
    if (res.status >= 200 && res.status < 300) return { kind: "delivered", status: res.status }
    if (res.status >= 500 || res.status === 429) return { kind: "retry", status: res.status, error: `http_${res.status}` }
    return { kind: "fail", status: res.status, error: `http_${res.status}` } // 4xx (not 429) and 3xx: not retryable, redirects are never followed
  } catch (err) {
    return { kind: "retry", status: null, error: safeCode(err) } // timeout / network error
  }
}

/**
 * Auto-disable (a check on every failed attempt; no separate sweep needed because a failing endpoint is, by definition, being
 * delivered to): `failing_since` is the start of the current unbroken run of failures (any success clears it). When a failure
 * lands >= 3 days after it, the endpoint is set active=false, audited (actor system:webhooks) and every active tenant owner gets
 * an in-app notification (host name only, never the URL). An owner resumes it with PATCH {active:true}.
 */
async function noteFailure(tx: Parameters<Parameters<typeof withTenant>[2]>[0], deps: Deps, tenantId: string, endpointId: string, now: Date, enqueue: Parameters<typeof notify>[4]): Promise<void> {
  const [ep] = await tx.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, endpointId)).for("update")
  if (!ep || ep.deletedAt !== null || !ep.active) return
  if (ep.failingSince === null) {
    await tx.update(webhookEndpoints).set({ failingSince: now }).where(eq(webhookEndpoints.id, endpointId))
    return
  }
  if (now.getTime() - ep.failingSince.getTime() < AUTO_DISABLE_MS) return
  await tx.update(webhookEndpoints).set({ active: false }).where(eq(webhookEndpoints.id, endpointId))
  const host = new URL(ep.url).host
  await recordAudit(tx, tenantId, { action: "webhook.auto_disabled", entity: "webhook", entityId: endpointId, actorId: "system:webhooks", before: { active: true, failingSince: ep.failingSince }, after: { active: false, reason: "failing_3_days", host } }, now)
  const owners = await tx.select({ userId: memberships.userId }).from(memberships).innerJoin(roles, eq(roles.id, memberships.roleId)).where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, "active"), eq(roles.key, "owner")))
  for (const o of owners) {
    await notify(tx, tenantId, { userId: o.userId, kind: "system", title: "Webhook endpoint disabled", body: `Deliveries to ${host} have failed for 3 days, so the endpoint was turned off. Fix it and resume it in Settings.`, link: "/settings/webhooks" }, deps, enqueue)
  }
}

/**
 * Job `webhook.sweep` (every 5 min in the worker): per tenant, pending deliveries whose next_attempt_at is more than 2 min past
 * (their job was lost, the Redis add failed after commit, or a worker crashed holding the lease) get a fresh `webhook.deliver`
 * job with a nonce id. A duplicate job is harmless: the lease lets only one run. One tenant failing never stops the rest.
 */
export async function sweepWebhooks(_data: unknown, deps: Deps): Promise<void> {
  const cutoff = new Date(deps.clock.now().getTime() - SWEEP_STALE_MS)
  const ids = await deps.db.select({ id: tenants.id }).from(tenants) // `tenants` has no RLS
  for (const { id: tenantId } of ids) {
    try {
      const due = await withTenant(deps.db, tenantId, (tx) =>
        tx.select({ id: webhookDeliveries.id }).from(webhookDeliveries).where(and(eq(webhookDeliveries.status, "pending"), lt(webhookDeliveries.nextAttemptAt, cutoff))).limit(200),
      )
      for (const r of due) await deps.queue.add(DELIVER_JOB, { deliveryId: r.id, tenantId }, { jobId: `${DELIVER_JOB}.${r.id}.s${randomUUID()}` })
    } catch (err) {
      deps.logger.error({ tenantId, errCode: safeCode(err) }, "webhook sweep failed for tenant")
    }
  }
}
