import { and, desc, eq, sql } from "drizzle-orm"
import { buildKeyring, open, seal } from "../../core/crypto/secret-box"
import { sha256Hex } from "../../core/middleware/device"
import { AppError, Forbidden, NotFound } from "../../core/errors"
import { memberships, notificationDeliveries, notifications, pushTokens, tenants, user } from "../../db/schema"
import { notificationPreferences } from "../../db/schema"
import { withTenant, type TenantTx } from "../../db/tenant-tx"
import type { Deps } from "../../deps"
import { isHHMM, quietWindow } from "./quiet-hours"
import { KINDS, loadPrefs, type NotificationKind, type Prefs } from "./prefs"

export type NotifyInput = { userId: string; kind: NotificationKind; title: string; body: string; link?: string; subjectUserId?: string }
export type Enqueue = (name: string, data: unknown, opts?: { delayMs?: number; key?: string }) => void

export const SEND_JOB = "notification.send"
export const SWEEP_JOB = "notification.sweep"
/** A claimed delivery is leased this long; after that another worker may take it over (crashed worker). */
export const LEASE_MS = 2 * 60_000
/** The sweep re-enqueues deliveries that are due for longer than this and not leased. */
export const SWEEP_STALE_MS = 2 * 60_000
/** Job ids get a per-enqueue nonce so a running job never dedupes its own re-hold/retry (BullMQ ids: no ':'). */
const nonce = (): string => crypto.randomUUID()
/** Delivery attempts per external channel before the delivery is marked failed. */
export const MAX_ATTEMPTS = 5
/** Wait before attempt n+1 after attempt n failed: 30 s, 60 s, 120 s, 240 s (own scheduling, see sendNotification). */
export const backoffMs = (attempt: number): number => 30_000 * 2 ** (attempt - 1)

const pushAad = (tenantId: string, userId: string) => `push_token:${tenantId}:${userId}`
const safeCode = (e: unknown): string => {
  const c = e && typeof e === "object" ? ((e as { code?: unknown }).code ?? (e as { name?: unknown }).name) : undefined
  return typeof c === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(c) ? c : "error"
}

/**
 * Creates the in-app notification for `input.userId` and a `notification_deliveries` row per external channel (email,
 * push) that the user's preferences enable. It never sends: sends are `notification.send` jobs handed to `enqueue`,
 * which MUST buffer until the surrounding tx commits (a subscriber's ctx.enqueue, or withTenantAfterCommit below).
 * Quiet hours (tenant timezone) mark email/push deliveries `held` with send_after = the window end and a delayed job;
 * `security` ignores quiet hours. Nothing is created when the user turned every channel off for the kind.
 *
 * Deviates from the locked signature only by the extra `enqueue` argument, which is what makes after-commit sends possible.
 */
export async function notify(tx: TenantTx, tenantId: string, input: NotifyInput, deps: Deps, enqueue: Enqueue): Promise<void> {
  const prefs = await loadPrefs(tx, tenantId, input.userId)
  const ch = prefs.channels[input.kind]
  const [tok] = await tx.select({ id: pushTokens.id }).from(pushTokens).where(and(eq(pushTokens.tenantId, tenantId), eq(pushTokens.userId, input.userId))).limit(1)
  const channels = ([ch.email && "email", ch.push && tok && "push"] as const).filter((c): c is "email" | "push" => Boolean(c))
  if (!ch.inApp && channels.length === 0) return
  const now = deps.clock.now()
  const [n] = await tx
    .insert(notifications)
    .values({ tenantId, userId: input.userId, kind: input.kind, title: input.title, body: input.body, link: input.link ?? null, subjectUserId: input.subjectUserId ?? null, inApp: ch.inApp, createdAt: now })
    .returning({ id: notifications.id })
  if (channels.length === 0) return
  const [t] = await tx.select({ tz: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId))
  const win = input.kind === "security" ? { quiet: false, endsAt: now } : quietFor(prefs, t?.tz, now)
  for (const channel of channels) {
    const [d] = await tx
      .insert(notificationDeliveries)
      .values({ tenantId, notificationId: n.id, channel, status: win.quiet ? "held" : "queued", sendAfter: win.quiet ? win.endsAt : now })
      .returning({ id: notificationDeliveries.id })
    enqueue(SEND_JOB, { deliveryId: d.id, tenantId }, { key: d.id, delayMs: win.quiet ? Math.max(0, win.endsAt.getTime() - now.getTime()) : undefined })
  }
}

function quietFor(prefs: Prefs, tz: string | undefined, now: Date) {
  try {
    return quietWindow(prefs, tz ?? "UTC", now)
  } catch {
    return quietWindow(prefs, "UTC", now) // unknown tenant timezone: UTC, never fail a notification
  }
}

/**
 * Request-side after-commit sends: runs fn in a tenant tx and hands it an `enqueue` that only buffers. The buffered
 * jobs go to deps.queue AFTER the tx commits; if fn throws (rollback) nothing is enqueued. A failed post-commit
 * enqueue is logged (ids only) and the delivery row stays `queued`.
 */
export async function withTenantAfterCommit<T>(deps: Deps, tenantId: string, fn: (tx: TenantTx, enqueue: Enqueue) => Promise<T>): Promise<T> {
  const buffered: { name: string; data: unknown; delayMs?: number; key?: string }[] = []
  const result = await withTenant(deps.db, tenantId, (tx) => {
    buffered.length = 0 // the tx callback runs once; defensive against a retrying driver
    return fn(tx, (name, data, o) => void buffered.push({ name, data, delayMs: o?.delayMs, key: o?.key }))
  })
  for (const j of buffered) {
    try {
      await deps.queue.add(j.name, j.data, { delayMs: j.delayMs, jobId: j.key ? `${j.name}.${j.key}` : undefined })
    } catch (err) {
      deps.logger.error({ job: j.name, errCode: safeCode(err) }, "post-commit enqueue failed")
    }
  }
  return result
}

// ---------------------------------------------------------------- the send job

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Claim =
  | { kind: "done" }
  | { kind: "rehold"; delayMs: number; sendAfter: Date }
  | { kind: "send"; channel: "email" | "push"; attempt: number; userId: string; title: string; body: string; link: string | null; to?: string; sealed?: string[] }

/**
 * Job `notification.send` (data: { deliveryId, tenantId }, ids only). Three short steps so no DB tx spans the network call:
 *  1. (tx) load delivery + notification, skip if already sent/failed/skipped, re-check preferences and quiet hours at
 *     SEND time (security exempt), otherwise claim it (attempts + 1);
 *  2. send via deps.mailer / deps.push;
 *  3. (tx) mark `sent`, or on error: attempts < 5 -> back to `queued` and a new job delayed backoffMs(attempts);
 *     attempts >= 5 -> `failed`. This is our own scheduling (BullMQ attempts would need Queue.add options we do not
 *     have); the job itself returns normally so BullMQ never double-retries. Logs carry ids and err.name/code only.
 * Held deliveries re-hold themselves (new delayed job) when picked up while still inside the quiet window.
 */
export async function sendNotification(data: unknown, deps: Deps): Promise<void> {
  const d = data as { deliveryId?: unknown; tenantId?: unknown }
  if (typeof d?.deliveryId !== "string" || typeof d?.tenantId !== "string" || !UUID.test(d.deliveryId) || !UUID.test(d.tenantId)) throw new Error("invalid notification.send job data")
  const { deliveryId, tenantId } = { deliveryId: d.deliveryId, tenantId: d.tenantId }
  const ring = buildKeyring(deps.env)

  const claim = await withTenant(deps.db, tenantId, async (tx): Promise<Claim> => {
    const [row] = await tx
      .select({ status: notificationDeliveries.status, claimedUntil: notificationDeliveries.claimedUntil, channel: notificationDeliveries.channel, attempts: notificationDeliveries.attempts, n: notifications })
      .from(notificationDeliveries)
      .innerJoin(notifications, and(eq(notifications.tenantId, notificationDeliveries.tenantId), eq(notifications.id, notificationDeliveries.notificationId)))
      .where(eq(notificationDeliveries.id, deliveryId))
      .for("update", { of: [notificationDeliveries] })
    const nowTs = deps.clock.now()
    const claimable = row && (row.status === "queued" || row.status === "held" || (row.status === "sending" && (!row.claimedUntil || row.claimedUntil.getTime() <= nowTs.getTime())))
    if (!row || !claimable) return { kind: "done" }
    const skip = async (why: string): Promise<Claim> => {
      await tx.update(notificationDeliveries).set({ status: "skipped", lastError: why, claimedUntil: null }).where(eq(notificationDeliveries.id, deliveryId))
      return { kind: "done" }
    }
    const security = row.n.kind === "security"
    const prefs = await loadPrefs(tx, tenantId, row.n.userId)
    const wanted = prefs.channels[row.n.kind as NotificationKind]
    if (!security && !wanted[row.channel]) return skip("preference_off")
    if (!security) {
      const [t] = await tx.select({ tz: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId))
      const now = deps.clock.now()
      const w = quietFor(prefs, t?.tz, now)
      if (w.quiet) {
        await tx.update(notificationDeliveries).set({ status: "held", sendAfter: w.endsAt, claimedUntil: null }).where(eq(notificationDeliveries.id, deliveryId))
        return { kind: "rehold", delayMs: Math.max(0, w.endsAt.getTime() - now.getTime()), sendAfter: w.endsAt }
      }
    }
    const base = { kind: "send" as const, channel: row.channel, attempt: row.attempts + 1, userId: row.n.userId, title: row.n.title, body: await renderBody(tx, tenantId, row.n), link: row.n.link }
    let extra: { to?: string; sealed?: string[] } = {}
    if (row.channel === "email") {
      const [u] = await tx.select({ email: user.email }).from(user).where(eq(user.id, row.n.userId))
      if (!u) return skip("no_recipient")
      extra = { to: u.email }
    } else {
      const toks = await tx.select({ c: pushTokens.tokenCiphertext }).from(pushTokens).where(and(eq(pushTokens.tenantId, tenantId), eq(pushTokens.userId, row.n.userId)))
      if (toks.length === 0) return skip("no_token")
      extra = { sealed: toks.map((x) => x.c) }
    }
    await tx.update(notificationDeliveries).set({ status: "sending", attempts: base.attempt, claimedUntil: new Date(nowTs.getTime() + LEASE_MS) }).where(eq(notificationDeliveries.id, deliveryId))
    return { ...base, ...extra }
  })

  if (claim.kind === "done") return
  if (claim.kind === "rehold") {
    await deps.queue.add(SEND_JOB, data, { delayMs: claim.delayMs, jobId: `${SEND_JOB}.${deliveryId}.h${claim.sendAfter.getTime()}.${nonce()}` })
    return
  }

  let failure: string | null = null
  let skippedReason: string | null = null
  try {
    if (claim.channel === "email") {
      const link = claim.link ? (claim.link.startsWith("/") ? `${deps.env.APP_URL}${claim.link}` : claim.link) : null
      await deps.mailer.send({ to: claim.to!, subject: claim.title, text: link ? `${claim.body}\n\n${link}` : claim.body })
    } else {
      let ok = 0
      let skipped: string | null = null
      let last = "push_failed"
      for (const sealed of claim.sealed ?? []) {
        try {
          const token = open(sealed, ring, pushAad(tenantId, claim.userId))
          const res = await deps.push.send(token, { title: claim.title, body: claim.body, data: claim.link ? { link: claim.link } : undefined })
          if (res && res.status === "skipped") skipped = res.reason
          else ok++
        } catch (err) {
          last = safeCode(err)
        }
      }
      if (ok === 0 && skipped !== null && last === "push_failed") skippedReason = skipped // nothing went out and nothing failed: no provider
      else if (ok === 0) failure = last
    }
  } catch (err) {
    failure = safeCode(err)
  }

  const final = failure !== null && claim.attempt >= MAX_ATTEMPTS
  await withTenant(deps.db, tenantId, (tx) =>
    tx
      .update(notificationDeliveries)
      .set(skippedReason !== null ? { status: "skipped", lastError: skippedReason, claimedUntil: null } : failure === null ? { status: "sent", lastError: null, claimedUntil: null } : { status: final ? "failed" : "queued", lastError: failure, claimedUntil: null })
      .where(eq(notificationDeliveries.id, deliveryId)),
  )
  if (failure === null) return
  deps.logger[final ? "error" : "warn"]({ deliveryId, tenantId, channel: claim.channel, attempt: claim.attempt, errCode: failure, final }, "notification delivery failed")
  if (!final) await deps.queue.add(SEND_JOB, data, { delayMs: backoffMs(claim.attempt), jobId: `${SEND_JOB}.${deliveryId}.a${claim.attempt}.${nonce()}` })
}

/**
 * Job `notification.sweep` (every 5 min in the worker). Per tenant: deliveries still `queued`/`held` whose send_after is
 * more than 2 min past (their job was lost, or the Redis add failed after commit), or `sending` with an expired lease
 * (crashed worker), get a fresh `notification.send` job with a nonce id. Leased deliveries are left alone. A duplicate
 * job is harmless: the claim lets only one run. One tenant failing never stops the rest (ids and safe code logged).
 */
export async function sweepNotifications(_data: unknown, deps: Deps): Promise<void> {
  const now = deps.clock.now()
  const cutoff = new Date(now.getTime() - SWEEP_STALE_MS).toISOString()
  const ids = await deps.db.select({ id: tenants.id }).from(tenants) // `tenants` has no RLS; every status
  for (const { id: tenantId } of ids) {
    try {
      const due = await withTenant(deps.db, tenantId, (tx) =>
        tx
          .select({ id: notificationDeliveries.id })
          .from(notificationDeliveries)
          .where(and(
            eq(notificationDeliveries.tenantId, tenantId),
            sql`((${notificationDeliveries.status} in ('queued', 'held') and ${notificationDeliveries.sendAfter} < ${cutoff}::timestamptz)
              or (${notificationDeliveries.status} = 'sending' and ${notificationDeliveries.claimedUntil} < ${now.toISOString()}::timestamptz))`,
          ))
          .limit(500),
      )
      for (const r of due) await deps.queue.add(SEND_JOB, { deliveryId: r.id, tenantId }, { jobId: `${SEND_JOB}.${r.id}.s${nonce()}` })
    } catch (err) {
      deps.logger.error({ tenantId, errCode: safeCode(err) }, "notification sweep failed for a tenant")
    }
  }
}

// ---------------------------------------------------------------- inbox + preferences + tokens (used by routes.ts)

const NotFoundN = () => NotFound("notification_not_found")

export const SUBJECT_TOKEN = "{{subject}}"

/**
 * Renders the person a notice is about at READ time, from the current records: their name while they are a member,
 * "Erased user" once erased, "A former member" once removed. So an erase never has to chase copies of a name.
 */
export async function renderBody(tx: TenantTx, tenantId: string, n: { body: string; subjectUserId: string | null }): Promise<string> {
  if (!n.subjectUserId || !n.body.includes(SUBJECT_TOKEN)) return n.body
  const [r] = await tx
    .select({ name: user.name, erasedAt: user.erasedAt, member: memberships.userId })
    .from(user)
    .leftJoin(memberships, and(eq(memberships.userId, user.id), eq(memberships.tenantId, tenantId)))
    .where(eq(user.id, n.subjectUserId))
  const label = !r ? "A former member" : r.erasedAt ? "Erased user" : !r.member ? "A former member" : r.name
  return n.body.split(SUBJECT_TOKEN).join(label)
}

const view = (n: typeof notifications.$inferSelect, body: string = n.body) => ({
  id: n.id, kind: n.kind as NotificationKind, title: n.title, body, link: n.link, createdAt: n.createdAt.toISOString(), readAt: n.readAt?.toISOString() ?? null,
})

export async function listNotifications(tx: TenantTx, tenantId: string, userId: string, o: { unreadOnly: boolean; limit: number }) {
  const mine = and(eq(notifications.tenantId, tenantId), eq(notifications.userId, userId), eq(notifications.inApp, true))
  const rows = await tx
    .select()
    .from(notifications)
    .where(o.unreadOnly ? and(mine, sql`${notifications.readAt} is null`) : mine)
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(o.limit)
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(notifications).where(and(mine, sql`${notifications.readAt} is null`))
  const items = []
  for (const r of rows) items.push(view(r, await renderBody(tx, tenantId, r)))
  return { items, unread: n }
}

/** Another user's (or tenant's) id is indistinguishable from a missing one: 404 notification_not_found. */
export async function markRead(tx: TenantTx, tenantId: string, userId: string, id: string, now: Date) {
  const [row] = await tx
    .update(notifications)
    .set({ readAt: sql`coalesce(${notifications.readAt}, ${now.toISOString()}::timestamptz)` })
    .where(and(eq(notifications.id, id), eq(notifications.tenantId, tenantId), eq(notifications.userId, userId), eq(notifications.inApp, true)))
    .returning()
  if (!row) throw NotFoundN()
  return view(row, await renderBody(tx, tenantId, row))
}

export async function markAllRead(tx: TenantTx, tenantId: string, userId: string, now: Date): Promise<number> {
  const rows = await tx
    .update(notifications)
    .set({ readAt: now })
    .where(and(eq(notifications.tenantId, tenantId), eq(notifications.userId, userId), eq(notifications.inApp, true), sql`${notifications.readAt} is null`))
    .returning({ id: notifications.id })
  return rows.length
}

export async function getPreferences(tx: TenantTx, tenantId: string, userId: string) {
  const p = await loadPrefs(tx, tenantId, userId)
  return { channels: p.channels, quietStart: p.quietStart, quietEnd: p.quietEnd }
}

const InvalidQuiet = () => new AppError(422, "invalid_quiet_hours", "Unprocessable Entity")

async function assertActiveMember(tx: TenantTx, tenantId: string, userId: string): Promise<void> {
  const [m] = await tx
    .select({ status: memberships.status })
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
    .for("share")
  if (!m || m.status !== "active") throw Forbidden("forbidden")
}

/** quietStart/quietEnd: both null or both "HH:MM" and different; otherwise 422 invalid_quiet_hours. */
export async function setPreferences(
  tx: TenantTx, tenantId: string, userId: string,
  input: { channels: Record<string, { inApp?: boolean; email?: boolean; push?: boolean }>; quietStart: string | null; quietEnd: string | null },
) {
  const { quietStart, quietEnd } = input
  if ((quietStart === null) !== (quietEnd === null)) throw InvalidQuiet()
  if (quietStart !== null && quietEnd !== null && (!isHHMM(quietStart) || !isHHMM(quietEnd) || quietStart === quietEnd)) throw InvalidQuiet()
  await assertActiveMember(tx, tenantId, userId)
  const channels = Object.fromEntries(Object.entries(input.channels).filter(([k]) => (KINDS as readonly string[]).includes(k)))
  await tx
    .insert(notificationPreferences)
    .values({ tenantId, userId, channels, quietStart, quietEnd })
    .onConflictDoUpdate({ target: [notificationPreferences.tenantId, notificationPreferences.userId], set: { channels, quietStart, quietEnd } })
  return getPreferences(tx, tenantId, userId)
}

/** Stores the token sealed (AAD push_token:<tenant>:<user>) next to its sha256; a repeat registration returns the existing row. */
export async function addPushToken(tx: TenantTx, tenantId: string, userId: string, token: string, platform: "android", deps: Deps) {
  await assertActiveMember(tx, tenantId, userId)
  const tokenHash = sha256Hex(token)
  const ciphertext = seal(token, buildKeyring(deps.env), pushAad(tenantId, userId))
  await tx
    .insert(pushTokens)
    .values({ tenantId, userId, tokenHash, tokenCiphertext: ciphertext, platform, createdAt: deps.clock.now() })
    .onConflictDoNothing()
  const [row] = await tx
    .select({ id: pushTokens.id, platform: pushTokens.platform, createdAt: pushTokens.createdAt })
    .from(pushTokens)
    .where(and(eq(pushTokens.tenantId, tenantId), eq(pushTokens.userId, userId), eq(pushTokens.tokenHash, tokenHash)))
  return { id: row.id, platform: row.platform, createdAt: row.createdAt.toISOString() }
}

export async function removePushToken(tx: TenantTx, tenantId: string, userId: string, id: string): Promise<void> {
  const rows = await tx
    .delete(pushTokens)
    .where(and(eq(pushTokens.id, id), eq(pushTokens.tenantId, tenantId), eq(pushTokens.userId, userId)))
    .returning({ id: pushTokens.id })
  if (rows.length === 0) throw NotFound("push_token_not_found")
}
