import { createHash } from "node:crypto"
import { and, desc, eq, gt, inArray, ne, or, sql } from "drizzle-orm"
import { AppError, Conflict, NotFound } from "../../core/errors"
import { fileKey } from "../../core/storage/storage"
import { publish } from "../../core/events"
import { dataRequests, files, memberships, roles, session, account, twoFactor, user, verification, tenants, type DsrKind, type DsrStatus } from "../../db/schema"
import { withTenant, withUser, type TenantTx } from "../../db/tenant-tx"
import type { Deps } from "../../deps"
import { recordAudit } from "../audit"
import { expireFile, storeGeneratedFile } from "../files/service"
import { notify, withTenantAfterCommit, type Enqueue } from "../notifications"
import { lockActor, lockRbac } from "../rbac"
import { ERASED } from "./core-handlers"
import { dsrHandlers } from "./registry"

export const EXPORT_JOB = "dsr.export"
export const ERASE_JOB = "dsr.erase"
export const EXPIRE_JOB = "dsr.export-expire"
export const SWEEP_JOB = "dsr.sweep"
/** The sweeper re-enqueues `pending` requests older than this (their post-commit enqueue was probably lost)... */
export const SWEEP_PENDING_MS = 2 * 60 * 1000
/** ...and `running` ones older than this (a crashed worker). */
export const SWEEP_RUNNING_MS = 30 * 60 * 1000
/** GDPR answers within one month; we use 30 calendar days in the tenant's timezone. */
export const DUE_DAYS = 30
/** A generated export file is deleted this long after it was produced. */
export const EXPORT_TTL_MS = 30 * 24 * 3600 * 1000
/** A `running` request older than this is assumed to belong to a crashed worker and may be claimed again. */
export const STALE_RUNNING_MS = 10 * 60 * 1000
export const MAX_LIST = 200

type Row = typeof dataRequests.$inferSelect
type Actor = { userId: string }

export type DataRequestDto = {
  id: string
  subjectUserId: string
  kind: DsrKind
  status: DsrStatus
  requestedBy: string
  reason: string
  createdAt: string
  dueAt: string
  overdue: boolean
  startedAt: string | null
  completedAt: string | null
  resultFileId: string | null
  errorCode: string | null
  notes: string | null
}

const dto = (r: Row, now: Date): DataRequestDto => ({
  id: r.id, subjectUserId: r.subjectUserId, kind: r.kind as DsrKind, status: r.status as DsrStatus, requestedBy: r.requestedBy, reason: r.reason,
  createdAt: r.createdAt.toISOString(), dueAt: r.dueAt.toISOString(), overdue: isOpen(r.status) && r.dueAt.getTime() < now.getTime(),
  startedAt: r.startedAt?.toISOString() ?? null, completedAt: r.completedAt?.toISOString() ?? null, resultFileId: r.resultFileId, errorCode: r.errorCode, notes: r.notes,
})

/** Needs attention: not finished and not turned down. `failed` stays open (someone must act). */
const isOpen = (status: string): boolean => status === "pending" || status === "running" || status === "failed"

const NotFoundRequest = () => NotFound("data_request_not_found")
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Short machine code of an error: never its message (which could carry data). */
const safeCode = (e: unknown): string => {
  const c = e && typeof e === "object" ? ((e as { code?: unknown }).code ?? (e as { name?: unknown }).name) : undefined
  return typeof c === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(c) ? c : "error"
}

// Two-key advisory lock namespace for DSR mutations ("dsr"); taken FIRST (after lockRbac when both are needed, never before it).
const DSR_LOCK_NS = 0x00647372
const lockDsr = (tx: TenantTx, tenantId: string) => tx.execute(sql`select pg_advisory_xact_lock(${DSR_LOCK_NS}::int, hashtext(${tenantId}::text))`)

/** created + 30 days as the tenant's wall clock sees it (DST-aware), stored as UTC. Unknown timezone falls back to UTC. */
async function dueAt(tx: TenantTx, tenantId: string, now: Date): Promise<Date> {
  const [t] = await tx.select({ tz: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId))
  let tz = t?.tz ?? "UTC"
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz })
  } catch {
    tz = "UTC"
  }
  const res = await tx.execute(sql`select ((${now.toISOString()}::timestamptz at time zone ${tz}) + interval '30 days') at time zone ${tz} as due`)
  return new Date((res.rows[0] as { due: Date | string }).due)
}

async function requestIn(tx: TenantTx, tenantId: string, id: string, lock = false): Promise<Row> {
  const q = tx.select().from(dataRequests).where(and(eq(dataRequests.id, id), eq(dataRequests.tenantId, tenantId)))
  const [row] = lock ? await q.for("update") : await q
  if (!row) throw NotFoundRequest()
  return row
}

/** The subject's membership in THIS tenant, or 404 member_not_found (another tenant's user looks like no user). */
async function subjectMembership(tx: TenantTx, tenantId: string, userId: string): Promise<{ roleKey: string; status: string }> {
  const [m] = await tx
    .select({ roleKey: roles.key, status: memberships.status })
    .from(memberships)
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
  if (!m) throw NotFound("member_not_found")
  return m
}

/** Same rule as role changes: an active tenant must keep at least one active owner. */
async function assertNotLastOwner(tx: TenantTx, tenantId: string, userId: string, lockRows: boolean): Promise<void> {
  const q = tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, "active"), eq(roles.key, "owner")))
    .orderBy(memberships.userId)
  const owners = lockRows ? await q.for("update", { of: memberships }) : await q
  if (owners.some((o) => o.userId === userId) && owners.length <= 1) throw new AppError(409, "last_owner", "Conflict")
}

/** An erase must never delete a membership that began AFTER the request was made (the person re-joined). */
async function assertNotRejoined(tx: TenantTx, tenantId: string, req: Row): Promise<void> {
  const [m] = await tx.select({ joinedAt: memberships.joinedAt }).from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, req.subjectUserId)))
  if (m && m.joinedAt.getTime() > req.createdAt.getTime()) throw new AppError(409, "subject_rejoined", "Conflict")
}

async function isMember(tx: TenantTx, tenantId: string, userId: string): Promise<boolean> {
  const [m] = await tx.select({ u: memberships.userId }).from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
  return Boolean(m)
}

/** Tells the requester, unless they are gone (a notification needs a live membership). */
async function tellRequester(tx: TenantTx, deps: Deps, enqueue: Enqueue, req: Row, title: string, body: string, link?: string): Promise<void> {
  if (await isMember(tx, req.tenantId, req.requestedBy)) await notify(tx, req.tenantId, { userId: req.requestedBy, kind: "dsr", title, body, link }, deps, enqueue)
}

// ---------------------------------------------------------------- requests

/**
 * Opens a request. `self` = the self-service route (any member, export of themselves only); otherwise the actor needs
 * settings:write, re-checked inside the tx. Erase and correct about yourself are refused (422): they need someone else.
 * Erase of the last active owner is refused (409 last_owner, checked again by the job). One open (pending/running)
 * export or erase per subject (409 request_open). `reason` is stored here only; the audit entry carries ids and kind.
 * The `dsr.export` / `dsr.erase` job is enqueued after commit with jobId = request id.
 */
export async function createRequest(
  deps: Deps, tenantId: string, actor: Actor, input: { subjectUserId: string; kind: DsrKind; reason: string }, o: { self?: boolean } = {},
): Promise<DataRequestDto> {
  return withTenantAfterCommit(deps, tenantId, async (tx, enqueue) => {
    await lockDsr(tx, tenantId)
    if (o.self) {
      const [me] = await tx.select({ status: memberships.status }).from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, actor.userId))).for("share")
      if (!me || me.status !== "active") throw new AppError(403, "forbidden", "Forbidden")
    } else await lockActor(tx, tenantId, actor.userId, "settings", "write")
    const member = await subjectMembership(tx, tenantId, input.subjectUserId)
    if (input.kind !== "export" && input.subjectUserId === actor.userId) throw new AppError(422, "self_request_not_allowed", "Unprocessable Entity")
    if (input.kind === "erase" && member.roleKey === "owner" && member.status === "active") await assertNotLastOwner(tx, tenantId, input.subjectUserId, false)
    if (input.kind !== "correct") {
      const [open] = await tx
        .select({ id: dataRequests.id })
        .from(dataRequests)
        .where(and(eq(dataRequests.tenantId, tenantId), eq(dataRequests.subjectUserId, input.subjectUserId), eq(dataRequests.kind, input.kind), inArray(dataRequests.status, ["pending", "running"])))
      if (open) throw Conflict("request_open")
    }
    const now = deps.clock.now()
    const [row] = await tx
      .insert(dataRequests)
      .values({ tenantId, subjectUserId: input.subjectUserId, kind: input.kind, status: "pending", requestedBy: actor.userId, reason: input.reason, createdAt: now, dueAt: await dueAt(tx, tenantId, now) })
      .returning()
    await recordAudit(tx, tenantId, { action: "dsr.requested", entity: "data_request", entityId: row.id, actorId: actor.userId, before: null, after: { kind: row.kind, subjectUserId: row.subjectUserId, status: "pending", dueAt: row.dueAt } }, now)
    await publish(tx, { tenantId, type: "dsr.requested", payload: { requestId: row.id, kind: row.kind, subjectUserId: row.subjectUserId }, actorId: actor.userId }, now)
    if (row.kind === "erase") {
      // An export of someone about to be erased is pointless and would write their data to a file: cancel the open ones.
      const cancelled = await tx
        .update(dataRequests)
        .set({ status: "rejected", errorCode: "superseded_by_erase", completedAt: now })
        .where(and(eq(dataRequests.tenantId, tenantId), eq(dataRequests.subjectUserId, input.subjectUserId), eq(dataRequests.kind, "export"), inArray(dataRequests.status, ["pending", "running"])))
        .returning({ id: dataRequests.id })
      for (const c of cancelled) await recordAudit(tx, tenantId, { action: "dsr.rejected", entity: "data_request", entityId: c.id, actorId: actor.userId, before: { status: "pending" }, after: { status: "rejected", kind: "export", subjectUserId: input.subjectUserId, errorCode: "superseded_by_erase" } }, now)
    }
    if (row.kind === "export") enqueue(EXPORT_JOB, { requestId: row.id, tenantId }, { key: row.id })
    if (row.kind === "erase") enqueue(ERASE_JOB, { requestId: row.id, tenantId }, { key: row.id })
    return dto(row, now)
  })
}

/**
 * Open requests first, overdue ones at the very top (earliest due date first), then the other open ones by due date,
 * then finished ones newest first. Optional status filter.
 */
export async function listRequests(tx: TenantTx, tenantId: string, now: Date, f: { status?: DsrStatus; subjectUserId?: string; requestedBy?: string; limit?: number } = {}): Promise<DataRequestDto[]> {
  const open = sql`${dataRequests.status} in ('pending','running','failed')`
  const rows = await tx
    .select()
    .from(dataRequests)
    .where(and(eq(dataRequests.tenantId, tenantId), f.status ? eq(dataRequests.status, f.status) : undefined, f.subjectUserId ? eq(dataRequests.subjectUserId, f.subjectUserId) : undefined, f.requestedBy ? eq(dataRequests.requestedBy, f.requestedBy) : undefined))
    .orderBy(
      sql`case when ${open} and ${dataRequests.dueAt} < ${now.toISOString()}::timestamptz then 0 when ${open} then 1 else 2 end`,
      sql`case when ${open} then ${dataRequests.dueAt} end asc nulls last`,
      desc(dataRequests.createdAt),
      dataRequests.id,
    )
    .limit(Math.min(f.limit ?? 100, MAX_LIST))
  return rows.map((r) => dto(r, now))
}

export async function getRequest(tx: TenantTx, tenantId: string, id: string, now: Date): Promise<DataRequestDto> {
  return dto(await requestIn(tx, tenantId, id), now)
}

/** Closes a `correct` request after the data was edited by hand (through the normal APIs). pending only; else 409. */
export async function completeCorrection(deps: Deps, tenantId: string, actor: Actor, id: string, notes: string | undefined): Promise<DataRequestDto> {
  return withTenantAfterCommit(deps, tenantId, async (tx, enqueue) => {
    await lockDsr(tx, tenantId)
    await lockActor(tx, tenantId, actor.userId, "settings", "write")
    const cur = await requestIn(tx, tenantId, id, true)
    if (cur.kind !== "correct") throw Conflict("not_a_correction")
    if (cur.status !== "pending") throw Conflict("request_closed")
    const now = deps.clock.now()
    const [row] = await tx.update(dataRequests).set({ status: "completed", completedAt: now, notes: notes ?? null }).where(and(eq(dataRequests.id, id), eq(dataRequests.tenantId, tenantId))).returning()
    await recordAudit(tx, tenantId, { action: "dsr.completed", entity: "data_request", entityId: id, actorId: actor.userId, before: { status: cur.status }, after: { status: "completed", kind: cur.kind, subjectUserId: cur.subjectUserId } }, now)
    if (cur.requestedBy !== actor.userId) await tellRequester(tx, deps, enqueue, cur, "Data request completed", "A correction request was completed.")
    await publish(tx, { tenantId, type: "dsr.completed", payload: { requestId: id, kind: cur.kind, subjectUserId: cur.subjectUserId }, actorId: actor.userId }, now)
    return dto(row, now)
  })
}

/** Turns a request down (with a stored reason in `notes`). Only pending or failed ones; a running job cannot be stopped (409). */
export async function rejectRequest(deps: Deps, tenantId: string, actor: Actor, id: string, notes: string): Promise<DataRequestDto> {
  return withTenantAfterCommit(deps, tenantId, async (tx, enqueue) => {
    await lockDsr(tx, tenantId)
    await lockActor(tx, tenantId, actor.userId, "settings", "write")
    const cur = await requestIn(tx, tenantId, id, true)
    if (cur.status !== "pending" && cur.status !== "failed") throw Conflict("request_closed")
    const now = deps.clock.now()
    const [row] = await tx.update(dataRequests).set({ status: "rejected", completedAt: now, notes }).where(and(eq(dataRequests.id, id), eq(dataRequests.tenantId, tenantId))).returning()
    await recordAudit(tx, tenantId, { action: "dsr.rejected", entity: "data_request", entityId: id, actorId: actor.userId, before: { status: cur.status }, after: { status: "rejected", kind: cur.kind, subjectUserId: cur.subjectUserId } }, now)
    if (cur.requestedBy !== actor.userId) await tellRequester(tx, deps, enqueue, cur, "Data request rejected", "A data request was rejected.")
    return dto(row, now)
  })
}

/**
 * Puts a `failed` request back to `pending` and enqueues its job again (fresh job id, so BullMQ does not drop it as a
 * duplicate). Needed because erase step 1 may already have removed the membership: a new request would 404, the same
 * request must be finishable. Steps are idempotent. Audited as `dsr.retried`.
 */
export async function retryRequest(deps: Deps, tenantId: string, actor: Actor, id: string): Promise<DataRequestDto> {
  return withTenantAfterCommit(deps, tenantId, async (tx, enqueue) => {
    await lockDsr(tx, tenantId)
    await lockActor(tx, tenantId, actor.userId, "settings", "write")
    const cur = await requestIn(tx, tenantId, id, true)
    if (cur.status !== "failed" || (cur.kind !== "export" && cur.kind !== "erase")) throw Conflict("request_not_failed")
    if (cur.kind === "erase") await assertNotRejoined(tx, tenantId, cur)
    const now = deps.clock.now()
    const [row] = await tx.update(dataRequests).set({ status: "pending", errorCode: null, startedAt: null }).where(and(eq(dataRequests.id, id), eq(dataRequests.tenantId, tenantId))).returning()
    await recordAudit(tx, tenantId, { action: "dsr.retried", entity: "data_request", entityId: id, actorId: actor.userId, before: { status: "failed", errorCode: cur.errorCode }, after: { status: "pending", kind: cur.kind, subjectUserId: cur.subjectUserId } }, now)
    enqueue(cur.kind === "export" ? EXPORT_JOB : ERASE_JOB, { requestId: id, tenantId }, { key: `${id}-${crypto.randomUUID()}` })
    return dto(row, now)
  })
}

/**
 * Job `dsr.sweep` (every 5 min in the worker). Re-enqueues export/erase requests that no worker is on: `pending` older
 * than 2 min (enqueue lost) and `running` older than 30 min (crashed worker), and expires completed exports whose file
 * is still available 30 days after completion (the delayed expire job was lost). A duplicate job is harmless: `claim` lets
 * only one run and finished requests are a no-op.
 */
export async function sweepRequests(_data: unknown, deps: Deps): Promise<void> {
  const now = deps.clock.now()
  const ids = await deps.db.select({ id: tenants.id }).from(tenants) // `tenants` has no RLS; every status: GDPR duties continue for suspended tenants
  for (const { id: tenantId } of ids) {
    try {
      const due = await withTenant(deps.db, tenantId, (tx) =>
        tx
          .select({ id: dataRequests.id, kind: dataRequests.kind })
          .from(dataRequests)
          .where(and(
            eq(dataRequests.tenantId, tenantId), inArray(dataRequests.kind, ["export", "erase"]),
            sql`((${dataRequests.status} = 'pending' and ${dataRequests.createdAt} < ${new Date(now.getTime() - SWEEP_PENDING_MS).toISOString()}::timestamptz)
              or (${dataRequests.status} = 'running' and coalesce(${dataRequests.startedAt}, ${dataRequests.createdAt}) < ${new Date(now.getTime() - SWEEP_RUNNING_MS).toISOString()}::timestamptz))`,
          )),
      )
      for (const r of due) {
        const name = r.kind === "export" ? EXPORT_JOB : ERASE_JOB
        await deps.queue.add(name, { requestId: r.id, tenantId }, { jobId: `${name}.${r.id}-${crypto.randomUUID()}` })
      }
      // The 30-day expiry normally rides a delayed job; if that job was lost, expire the export from here.
      const stale = await withTenant(deps.db, tenantId, (tx) =>
        tx
          .select({ id: dataRequests.id, fileId: files.id })
          .from(dataRequests)
          .innerJoin(files, and(eq(files.tenantId, dataRequests.tenantId), eq(files.id, dataRequests.resultFileId)))
          .where(and(
            eq(dataRequests.tenantId, tenantId), eq(dataRequests.kind, "export"), eq(dataRequests.status, "completed"),
            eq(files.purpose, "dsr_export"), ne(files.status, "deleted"),
            sql`${dataRequests.completedAt} + (${EXPORT_TTL_MS}::bigint * interval '1 millisecond') < ${now.toISOString()}::timestamptz`,
          )),
      )
      for (const r of stale) await deps.queue.add(EXPIRE_JOB, { requestId: r.id, tenantId, fileId: r.fileId }, { jobId: `${EXPIRE_JOB}.${r.id}-${crypto.randomUUID()}` })
    } catch (err) {
      deps.logger.error({ tenantId, errCode: safeCode(err) }, "dsr sweep failed for a tenant") // one tenant never stops the rest
    }
  }
}

// ---------------------------------------------------------------- jobs

type JobData = { requestId: string; tenantId: string }
function parseJob(data: unknown, name: string): JobData {
  const d = data as { requestId?: unknown; tenantId?: unknown }
  if (typeof d?.requestId !== "string" || typeof d?.tenantId !== "string" || !UUID.test(d.requestId) || !UUID.test(d.tenantId)) throw new Error(`invalid ${name} job data`)
  return { requestId: d.requestId, tenantId: d.tenantId }
}

/**
 * Moves pending/failed (or a stale running) request of `kind` to running; null when there is nothing to do (finished,
 * rejected, another worker is on it, wrong kind, unknown). This is the re-run guard: a second job for a completed
 * request is a no-op.
 */
async function claim(deps: Deps, job: JobData, kind: DsrKind): Promise<Row | null> {
  return withTenant(deps.db, job.tenantId, async (tx) => {
    const [cur] = await tx.select().from(dataRequests).where(and(eq(dataRequests.id, job.requestId), eq(dataRequests.tenantId, job.tenantId))).for("update")
    if (!cur || cur.kind !== kind) return null
    const now = deps.clock.now()
    const stale = cur.status === "running" && (!cur.startedAt || now.getTime() - cur.startedAt.getTime() > STALE_RUNNING_MS)
    if (cur.status !== "pending" && cur.status !== "failed" && !stale) return null
    const [row] = await tx.update(dataRequests).set({ status: "running", startedAt: now, errorCode: null }).where(and(eq(dataRequests.id, cur.id), eq(dataRequests.tenantId, job.tenantId))).returning()
    return row
  })
}

/** A handler/job failure: status failed + a short error code (never the message) + an audit entry; logs carry ids and the code only. */
async function markFailed(deps: Deps, job: JobData, err: unknown): Promise<void> {
  const code = safeCode(err)
  deps.logger.warn({ requestId: job.requestId, errCode: code }, "data request failed")
  try {
    await withTenant(deps.db, job.tenantId, async (tx) => {
      const [cur] = await tx.select().from(dataRequests).where(and(eq(dataRequests.id, job.requestId), eq(dataRequests.tenantId, job.tenantId))).for("update")
      if (!cur || cur.status !== "running") return
      const now = deps.clock.now()
      await tx.update(dataRequests).set({ status: "failed", errorCode: code }).where(and(eq(dataRequests.id, cur.id), eq(dataRequests.tenantId, job.tenantId)))
      await recordAudit(tx, job.tenantId, { action: "dsr.failed", entity: "data_request", entityId: cur.id, actorId: null, before: { status: "running" }, after: { status: "failed", kind: cur.kind, errorCode: code } }, now)
    })
  } catch (e) {
    deps.logger.error({ requestId: job.requestId, errCode: safeCode(e) }, "could not record data request failure")
  }
}

/** A stable uuid per request, so a re-run writes the same key and finds the same files row (no orphans). */
export function exportFileId(requestId: string): string {
  const h = createHash("sha256").update(`dsr-export:${requestId}`).digest()
  h[6] = (h[6] & 0x0f) | 0x50
  h[8] = (h[8] & 0x3f) | 0x80
  const x = h.subarray(0, 16).toString("hex")
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`
}

/**
 * Job `dsr.export` { requestId, tenantId }. One tx: every registered handler's export (registration order) goes into one
 * JSON document `{ schema, requestId, tenantId, subjectUserId, generatedAt, modules: { <module>: ... } }`, which is
 * written server-side to the final key as a `clean` file (purpose dsr_export, owner = requester) named
 * `dsr-export-<requestId>.json`; request completed, `dsr.export_completed` audited, requester notified, `dsr.completed`
 * published, and a `dsr.export-expire` job scheduled 30 days out. Any failure -> status failed + error code, no throw.
 */
export async function runExport(data: unknown, deps: Deps): Promise<void> {
  const job = parseJob(data, EXPORT_JOB)
  const req = await claim(deps, job, "export")
  if (!req) return
  try {
    await withTenantAfterCommit(deps, job.tenantId, async (tx, enqueue) => {
      await lockDsr(tx, job.tenantId) // serialises with erase requests: no export is written for someone being erased
      const cur = await requestIn(tx, job.tenantId, job.requestId, true)
      if (cur.status !== "running") return
      const [mem] = await tx.select({ joinedAt: memberships.joinedAt }).from(memberships).where(and(eq(memberships.tenantId, job.tenantId), eq(memberships.userId, cur.subjectUserId)))
      // An erase blocks while it is open, or when it finished AFTER the current membership began (a person who re-joined later may export again).
      const [erase] = await tx
        .select({ id: dataRequests.id })
        .from(dataRequests)
        .where(and(
          eq(dataRequests.tenantId, job.tenantId), eq(dataRequests.subjectUserId, cur.subjectUserId), eq(dataRequests.kind, "erase"),
          or(inArray(dataRequests.status, ["pending", "running"]), and(eq(dataRequests.status, "completed"), mem ? gt(dataRequests.completedAt, mem.joinedAt) : undefined)),
        ))
      if (erase || !mem) throw new AppError(409, "subject_erased", "Conflict")
      const now = deps.clock.now()
      const modules: Record<string, unknown> = {}
      for (const [name, h] of dsrHandlers()) modules[name] = await h.export(tx, job.tenantId, cur.subjectUserId)
      const body = Buffer.from(JSON.stringify({ schema: "opsdesk.dsr-export/1", requestId: cur.id, tenantId: job.tenantId, subjectUserId: cur.subjectUserId, generatedAt: now.toISOString(), modules }, null, 2), "utf8")
      const fileId = exportFileId(cur.id)
      const owner = (await isMember(tx, job.tenantId, cur.requestedBy)) ? cur.requestedBy : null
      await storeGeneratedFile(deps, tx, { tenantId: job.tenantId, id: fileId, ownerUserId: owner, name: `dsr-export-${cur.id}.json`, mime: "application/json", body, purpose: "dsr_export" })
      await tx.update(dataRequests).set({ status: "completed", completedAt: now, resultFileId: fileId, errorCode: null }).where(and(eq(dataRequests.id, cur.id), eq(dataRequests.tenantId, job.tenantId)))
      await recordAudit(tx, job.tenantId, { action: "dsr.export_completed", entity: "data_request", entityId: cur.id, actorId: null, before: { status: "running" }, after: { status: "completed", kind: "export", subjectUserId: cur.subjectUserId, fileId, sizeBytes: body.length, modules: Object.keys(modules) } }, now)
      await tellRequester(tx, deps, enqueue, cur, "Your data export is ready", "The export is available for 30 days.", `/v1/files/${fileId}/download`)
      enqueue(EXPIRE_JOB, { requestId: cur.id, tenantId: job.tenantId, fileId }, { key: cur.id, delayMs: EXPORT_TTL_MS })
      await publish(tx, { tenantId: job.tenantId, type: "dsr.completed", payload: { requestId: cur.id, kind: "export", subjectUserId: cur.subjectUserId }, actorId: null }, now)
    })
  } catch (err) {
    await markFailed(deps, job, err)
    await dropUncommittedExport(deps, job)
  }
}

/**
 * The export object is written before its tx commits (the file row needs its size/etag). If the tx then failed there is
 * no files row, so the object holds personal data nobody can reach: delete it. With a row (a successful earlier run) it is kept.
 */
async function dropUncommittedExport(deps: Deps, job: JobData): Promise<void> {
  const id = exportFileId(job.requestId)
  try {
    const [row] = await withTenant(deps.db, job.tenantId, (tx) => tx.select({ id: files.id }).from(files).where(and(eq(files.id, id), eq(files.tenantId, job.tenantId))))
    if (!row) await deps.storage.delete(fileKey(job.tenantId, id))
  } catch (e) {
    deps.logger.error({ requestId: job.requestId, errCode: safeCode(e) }, "could not remove an uncommitted export object")
  }
}

/**
 * Job `dsr.export-expire` { requestId, tenantId, fileId }: deletes the generated export (soft delete + object removal job)
 * once its 30 days are over. Re-runs find the file already deleted and do nothing.
 */
export async function expireExport(data: unknown, deps: Deps): Promise<void> {
  const job = parseJob(data, EXPIRE_JOB)
  const fileId = (data as { fileId?: unknown }).fileId
  if (typeof fileId !== "string" || !UUID.test(fileId)) throw new Error(`invalid ${EXPIRE_JOB} job data`)
  await withTenantAfterCommit(deps, job.tenantId, async (tx, enqueue) => {
    const [f] = await tx.select({ purpose: files.purpose }).from(files).where(and(eq(files.id, fileId), eq(files.tenantId, job.tenantId)))
    if (!f || f.purpose !== "dsr_export") return
    if (await expireFile(tx, job.tenantId, fileId, enqueue)) {
      await recordAudit(tx, job.tenantId, { action: "dsr.export_expired", entity: "data_request", entityId: job.requestId, actorId: null, before: { fileId, status: "available" }, after: { status: "deleted" } }, deps.clock.now())
    }
  })
}

/**
 * Job `dsr.erase` { requestId, tenantId }. Three steps, each safe to repeat, so a crash in between just resumes:
 *  1. tenant tx: rbac lock then dsr lock; last active owner -> 409 last_owner (request fails with that code); every
 *     registered handler's erase; requests about the subject get reason/notes scrubbed to "[erased]" and their generated
 *     export files deleted; the membership is removed (audit `member.removed`, event `member.removed`);
 *  2. user tx: only when the person has NO membership left in any tenant, the global identity is anonymised
 *     (email erased+<uuid>@invalid, name "Erased user", image null) and its sessions/accounts/two_factor/verification
 *     rows are deleted; otherwise the global identity is left alone;
 *  3. tenant tx: request completed, `dsr.erasure_completed` audited (module names, never values), requester notified,
 *     `dsr.completed` published.
 * audit_events is never modified. Any failure -> status failed + error code, no throw.
 */
export async function runErase(data: unknown, deps: Deps): Promise<void> {
  const job = parseJob(data, ERASE_JOB)
  const req = await claim(deps, job, "erase")
  if (!req) return
  const subject = req.subjectUserId
  try {
    const modules: string[] = []
    await withTenantAfterCommit(deps, job.tenantId, async (tx, enqueue) => {
      await lockRbac(tx, job.tenantId)
      await lockDsr(tx, job.tenantId)
      const [m] = await tx
        .select({ roleKey: roles.key, status: memberships.status })
        .from(memberships)
        .innerJoin(roles, eq(roles.id, memberships.roleId))
        .where(and(eq(memberships.tenantId, job.tenantId), eq(memberships.userId, subject)))
        .for("update", { of: memberships })
      await assertNotRejoined(tx, job.tenantId, req)
      if (m && m.roleKey === "owner" && m.status === "active") await assertNotLastOwner(tx, job.tenantId, subject, true)
      const now = deps.clock.now()
      for (const [name, h] of dsrHandlers()) {
        await h.erase(tx, job.tenantId, subject, now, enqueue)
        modules.push(name)
      }
      // exports generated ABOUT this person hold their data: delete them with it
      const mine = await tx.select({ id: dataRequests.id, fileId: dataRequests.resultFileId }).from(dataRequests).where(and(eq(dataRequests.tenantId, job.tenantId), eq(dataRequests.subjectUserId, subject)))
      for (const r of mine) if (r.fileId) await expireFile(tx, job.tenantId, r.fileId, enqueue)
      await tx
        .update(dataRequests)
        .set({ reason: ERASED, notes: sql`case when ${dataRequests.notes} is null then null else ${ERASED} end` })
        .where(and(eq(dataRequests.tenantId, job.tenantId), eq(dataRequests.subjectUserId, subject)))
      if (m) {
        await tx.delete(memberships).where(and(eq(memberships.tenantId, job.tenantId), eq(memberships.userId, subject)))
        await recordAudit(tx, job.tenantId, { action: "member.removed", entity: "membership", entityId: subject, actorId: req.requestedBy, before: { roleKey: m.roleKey, status: m.status }, after: null }, now)
        await publish(tx, { tenantId: job.tenantId, type: "member.removed", payload: { userId: subject }, actorId: req.requestedBy }, now)
      }
    })
    const globalErased = await eraseGlobalIdentity(deps, subject)
    await withTenantAfterCommit(deps, job.tenantId, async (tx, enqueue) => {
      const cur = await requestIn(tx, job.tenantId, job.requestId, true)
      if (cur.status !== "running") return
      const now = deps.clock.now()
      await tx.update(dataRequests).set({ status: "completed", completedAt: now, errorCode: null }).where(and(eq(dataRequests.id, cur.id), eq(dataRequests.tenantId, job.tenantId)))
      await recordAudit(tx, job.tenantId, { action: "dsr.erasure_completed", entity: "data_request", entityId: cur.id, actorId: null, before: { status: "running" }, after: { status: "completed", kind: "erase", subjectUserId: subject, modules, globalIdentityErased: globalErased } }, now)
      await tellRequester(tx, deps, enqueue, cur, "Erasure completed", "The person's data was erased from this workspace.")
      await publish(tx, { tenantId: job.tenantId, type: "dsr.completed", payload: { requestId: cur.id, kind: "erase", subjectUserId: subject }, actorId: null }, now)
    })
  } catch (err) {
    await markFailed(deps, job, err)
  }
}

/**
 * Anonymises the Better Auth user when it has no membership in ANY tenant (the user's own memberships are visible
 * through withUser). The `user` row is locked first and the count re-read, so a membership created concurrently
 * (invite accepted elsewhere) either shows up in the count or waits for us. Returns whether the identity was erased.
 */
async function eraseGlobalIdentity(deps: Deps, userId: string): Promise<boolean> {
  return withUser(deps.db, userId, async (tx) => {
    const [u] = await tx.select({ id: user.id, email: user.email, erasedAt: user.erasedAt }).from(user).where(eq(user.id, userId)).for("update")
    if (!u) return false
    if (u.erasedAt) return true // an earlier run already anonymised it (erased_at, never the email shape)
    const left = await tx.select({ t: memberships.tenantId }).from(memberships).where(eq(memberships.userId, userId))
    if (left.length > 0) return false
    const now = deps.clock.now()
    await tx.update(user).set({ email: `erased+${crypto.randomUUID()}@invalid`, name: "Erased user", image: null, emailVerified: false, twoFactorEnabled: false, erasedAt: now, updatedAt: now }).where(eq(user.id, userId))
    await tx.delete(session).where(eq(session.userId, userId))
    await tx.delete(account).where(eq(account.userId, userId))
    await tx.delete(twoFactor).where(eq(twoFactor.userId, userId))
    await tx.delete(verification).where(sql`${verification.value} = ${userId} or lower(${verification.identifier}) = ${u.email.toLowerCase()}`)
    return true
  })
}
