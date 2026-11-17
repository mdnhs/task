import { createHash } from "node:crypto"
import { and, eq, gte, inArray, isNotNull, lt, lte, ne, sql } from "drizzle-orm"
import type { Context } from "hono"
import { EXPORT_LIMITS, EXPORT_MIME, exportFileName, reportMeta, type ExportFormat, type ExportName } from "@opsdesk/domain/report-export"
import { windowLabel } from "@opsdesk/domain/shift-report"
import { epochToWall } from "@opsdesk/domain/shifts"
import type { AppEnv } from "../../core/context"
import { AppError, Conflict, Forbidden, NotFound } from "../../core/errors"
import { actorIdOf } from "../../core/middleware/principal"
import { fileKey } from "../../core/storage/storage"
import { files, reportExports, shiftReportItems, shiftReports, tenants } from "../../db/schema"
import { withTenant, type TenantTx } from "../../db/tenant-tx"
import type { Deps } from "../../deps"
import { recordAudit } from "../audit"
import { tenantEntitlements } from "../entitlements/service"
import { expireFile, insertGeneratedFileRow, putGeneratedObject, reportExportDownloadUrl } from "../files"
import { notify, withTenantAfterCommit } from "../notifications"
import { lockActor } from "../rbac"
import { directReports, peopleAccess } from "../teams"
import { loadSingle, makeSink, pageThroughRange, rangeRows, rangeTables, singleTables, type BuildStats } from "./export-build"
import { INBOX_STATUSES, type ExportBody, type ExportDto, type InboxStatus } from "./dto"
import { publishReportEvent } from "./events"
import { stateWhere, virtualRows, type InboxFilter } from "./inbox"
import { getReport, loadReportCtx, ReportNotFound, reportScopeWhere, type ReportCtx } from "./scope"

// Shift-report exports (T5.5, FR-M1-31, rulings F5, F10, F16, F20). PRIVACY-SENSITIVE: an export holds other people's report data.
//
//   POST /v1/report-exports           reports:read, a person (never an API key): checks every cap BEFORE anything is queued, stores the request with the requester's report scope, audits
//                                     `report.export_requested` in the same tx, enqueues `report.export` after commit.
//   GET  /v1/report-exports/{id}      the requester's status; anybody else (an owner, an all-scope manager, support) is 404 report_export_not_found.
//   GET  /v1/report-exports/{id}/download   the requester only: 302 to a 60 s presigned GET of the stored file (409 export_not_ready, 404 once the 7 days are over).
//
// The job `report.export` { exportId, tenantId } (three phases, H5: claim and check, a lock-free build, the storage write and a final short tx) re-resolves the requester NOW (membership, role, scope: a downgrade fails the export with `forbidden` and no file is written), reads the reports in
// pages of 200 under THAT scope (the inbox's own query, so the rows equal the inbox rows), builds the file, writes it to Files (purpose `report_export`, hidden from /v1/files, search and webhooks,
// F16) with a deterministic id (a re-run overwrites the same key: no orphans), and in ONE tx marks the export done, notifies the requester (no names), audits `report.exported` (format, count, range) and
// publishes `report.export_completed`. Exactly once: the claim (queued, or running past its lease) is a row lock; the final tx only acts on a `running` row; the file row is ON CONFLICT DO NOTHING.
// A failure marks the export `failed` with a code and removes an uncommitted object; a transient database conflict leaves the row `running` and the sweep re-runs it when the lease ends.
// `report.export-sweep` (every 10 min) re-enqueues lost exports and expires the files 7 days after completion (from the table, so it survives a Redis loss and a suspended tenant).
// Time comes only from deps.clock. Logs carry ids, counts and codes only, never a name or report text.

export const EXPORT_JOB = "report.export"
export const EXPORT_SWEEP_JOB = "report.export-sweep"
/** A claimed export is leased this long; after that the sweep may hand it to another worker (a crashed one). */
export const LEASE_MS = 10 * 60_000
/** A `queued` export older than this was probably never enqueued (Redis lost): the sweep re-enqueues it. */
export const SWEEP_QUEUED_MS = 2 * 60_000
const LOCK_NS = 0x72657870 // "rexp": serialises one requester's export requests (the 3-active limit)
const TTL_MS = EXPORT_LIMITS.ttlDays * 86_400_000
const DAY_MS = 86_400_000
const RETRYABLE = new Set(["40P01", "40001"])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RANK = { own: 1, team: 2, all: 3 } as const
type Scope = keyof typeof RANK
type Row = typeof reportExports.$inferSelect

export const ExportNotFound = () => NotFound("report_export_not_found")
const unprocessable = (code: string) => new AppError(422, code, "Unprocessable Entity")

/** A stable uuid per export, so a re-run writes the same key and finds the same files row (no orphans). */
export function exportFileId(exportId: string): string {
  const h = createHash("sha256").update(`report-export:${exportId}`).digest()
  h[6] = (h[6] & 0x0f) | 0x50
  h[8] = (h[8] & 0x3f) | 0x80
  const x = h.subarray(0, 16).toString("hex")
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`
}

/** `sha256("report.export|<tenant>|<export>|<attempt or nonce>")`: hex, never contains ':' (BullMQ). Idempotency never depends on it: the claim and the unique file key are the guards. */
export const exportJobId = (tenantId: string, exportId: string, attempt: string | number): string => createHash("sha256").update(`${EXPORT_JOB}|${tenantId}|${exportId}|${attempt}`).digest("hex")

async function enqueueExport(deps: Deps, tenantId: string, exportId: string, attempt: string | number): Promise<void> {
  try {
    await deps.queue.add(EXPORT_JOB, { exportId, tenantId }, { jobId: exportJobId(tenantId, exportId, attempt) })
  } catch (err) {
    deps.logger.error({ exportId, errCode: safeCode(err) }, "report export enqueue failed (the sweep will retry)") // the row stays `queued`
  }
}

/** A code that is safe to store and log (never a message: it may hold a name or a SQL fragment). */
function safeCode(e: unknown): string {
  if (e instanceof AppError) return e.code
  const o = e && typeof e === "object" ? (e as { code?: unknown; cause?: unknown }) : {}
  const cause = o.cause && typeof o.cause === "object" ? (o.cause as { code?: unknown }).code : undefined
  const c = cause ?? o.code
  return typeof c === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(c) ? c : "export_failed"
}

const dayNum = (d: string): number => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / DAY_MS
const dateOf = (n: number): string => new Date(n * DAY_MS).toISOString().slice(0, 10)

/** The range: `to` defaults to today (tenant day), `from` to 6 days before it; not backwards (422 invalid_range), at most 92 days (422 range_too_long). */
export function exportRange(now: Date, tz: string, q: { from?: string; to?: string }): { from: string; to: string } {
  const today = epochToWall(now.getTime(), tz).slice(0, 10)
  const to = q.to ?? (q.from && q.from > today ? q.from : today)
  const from = q.from ?? dateOf(dayNum(to) - 6)
  if (from > to) throw unprocessable("invalid_range")
  if (dayNum(to) - dayNum(from) + 1 > EXPORT_LIMITS.rangeDays) throw unprocessable("range_too_long")
  return { from, to }
}

// ---------------------------------------------------------------- the request

type Body = ReturnType<typeof ExportBody.parse>

/** `expired` is derived, never stored: a finished export whose 7 days are over (deps.clock). The sweep deletes the file; the row stays as the record. */
function dtoOf(r: Row, now: Date): ExportDto {
  const expired = r.status === "done" && r.expiresAt !== null && r.expiresAt.getTime() <= now.getTime()
  return { id: r.id, status: expired ? "expired" : (r.status as ExportDto["status"]), format: r.format as ExportFormat, rowCount: r.rowCount, expiresAt: r.expiresAt?.toISOString() ?? null, errorCode: r.errorCode }
}

// An export is a person's act. The key deny-list (EXPORT_OR_DOWNLOAD, 403 api_key_forbidden_route) answers first for every export route, so this is UNREACHABLE through the router; it stays as a
// defence in depth against a route being mounted without the deny-list (the 403 would then be human_required).
const humanOnly = (c: Context<AppEnv>) => {
  if (c.get("apiKey")) throw Forbidden("human_required")
}

/** POST /v1/report-exports. Every limit is checked here, before the row exists and before any job. */
export async function requestExport(c: Context<AppEnv>, body: Body): Promise<{ id: string }> {
  humanOnly(c)
  const deps = c.get("deps")
  const tenant = c.get("tenant")!
  const actor = actorIdOf(c)
  const now = deps.clock.now()
  const range = body.reportId ? null : exportRange(now, tenant.timezone, body)
  const status: InboxStatus = body.status ?? "all"
  const id = crypto.randomUUID()
  await withTenant(deps.db, tenant.id, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_NS}::int, hashtext(${`${tenant.id}|${actor}`}::text))`) // advisory first, then the actor lock
    const ctx = await loadReportCtx(c, tx, "lock")
    const [active] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(reportExports)
      .where(and(eq(reportExports.tenantId, tenant.id), eq(reportExports.requestedBy, actor), inArray(reportExports.status, ["queued", "running"])))
    if (active.n >= EXPORT_LIMITS.active) throw Conflict("export_limit")
    let filters: Record<string, unknown>
    if (body.reportId) {
      await getReport(tx, ctx, body.reportId) // 404 report_not_found: unknown, another tenant's and out of scope look the same
      filters = { reportId: body.reportId, scope: ctx.access.kind }
    } else {
      const f: InboxFilter = { from: range!.from, to: range!.to, team: body.team, person: body.person, status }
      await assertWithinLimits(tx, ctx, f, body.format)
      filters = { from: f.from, to: f.to, ...(f.team ? { team: f.team } : {}), ...(f.person ? { person: f.person } : {}), status, scope: ctx.access.kind }
    }
    await tx.insert(reportExports).values({ id, tenantId: tenant.id, requestedBy: actor, format: body.format, filters, reportId: body.reportId ?? null, status: "queued", createdAt: now })
    await recordAudit(tx, tenant.id, {
      action: "report.export_requested", entity: "report_export", entityId: id, actorId: actor, before: null,
      after: { status: "queued", format: body.format, kind: body.reportId ? "single" : "range", ...(range ? { range: { from: range.from, to: range.to } } : {}), scope: ctx.access.kind },
    }, now)
  })
  await enqueueExport(deps, tenant.id, id, 1) // after commit: a lost enqueue is healed by the sweep
  return { id }
}

/** 422 export_too_large (over 5000 reports or 50000 task rows) and pdf_too_large (a PDF over 500 reports or 5000 rows), counted from the SAME scope and filters the job will read. */
async function assertWithinLimits(tx: TenantTx, ctx: ReportCtx, f: InboxFilter, format: ExportFormat): Promise<void> {
  const where = and(
    eq(shiftReports.tenantId, ctx.tenantId), gte(shiftReports.shiftDate, f.from), lte(shiftReports.shiftDate, f.to), isNotNull(shiftReports.userId), reportScopeWhere(ctx),
    f.team ? eq(shiftReports.teamId, f.team) : undefined, f.person ? eq(shiftReports.userId, f.person) : undefined, stateWhere(f.status, ctx.now),
  )
  const [stored] = await tx.select({ n: sql<number>`count(*)::int` }).from(shiftReports).where(where)
  const [rows] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(shiftReportItems)
    .innerJoin(shiftReports, and(eq(shiftReports.tenantId, shiftReportItems.tenantId), eq(shiftReports.id, shiftReportItems.reportId)))
    .where(where)
  let reports = stored.n
  if (reports <= EXPORT_LIMITS.reports && (f.status === "all" || f.status === "draft" || f.status === "missing")) {
    reports += (await virtualRows(tx, ctx, f, EXPORT_LIMITS.reports + 1 - reports)).length // shifts nobody reported on are rows of the inbox too
  }
  if (reports > EXPORT_LIMITS.reports || rows.n > EXPORT_LIMITS.rows) throw unprocessable("export_too_large")
  if (format === "pdf" && (reports > EXPORT_LIMITS.pdfReports || rows.n > EXPORT_LIMITS.pdfRows)) throw unprocessable("pdf_too_large")
}

// ---------------------------------------------------------------- status and download (the requester only)

async function mineOr404(c: Context<AppEnv>, tx: TenantTx, id: string): Promise<Row> {
  const tenantId = c.get("tenant")!.id
  const [row] = await tx.select().from(reportExports).where(and(eq(reportExports.id, id), eq(reportExports.tenantId, tenantId), eq(reportExports.requestedBy, actorIdOf(c))))
  if (!row) throw ExportNotFound() // unknown, another tenant's and somebody else's export are the same 404
  return row
}

export async function exportStatus(c: Context<AppEnv>, id: string): Promise<ExportDto> {
  humanOnly(c)
  return withTenant(c.get("deps").db, c.get("tenant")!.id, async (tx) => dtoOf(await mineOr404(c, tx, id), c.get("deps").clock.now()))
}

/** The 60 s presigned URL: 409 export_not_ready until it is done, 404 after the 7 days (or when the file is gone). */
export async function exportDownload(c: Context<AppEnv>, id: string): Promise<string> {
  humanOnly(c)
  const deps = c.get("deps")
  const tenantId = c.get("tenant")!.id
  const now = deps.clock.now()
  const row = await withTenant(deps.db, tenantId, async (tx) => {
    const mine = await mineOr404(c, tx, id)
    // H3: the file holds what the requester could see WHEN IT WAS MADE. Their scope now must not be narrower than that, else the file is out of reach (a demoted manager, a lost reports role).
    const access = await peopleAccess(tx, tenantId, c.get("role")!, actorIdOf(c))
    if (!access || RANK[access.kind] < RANK[asFilters(mine).scope]) throw ExportNotFound()
    return mine
  })
  if (row.status !== "done") throw Conflict("export_not_ready")
  if (!row.fileId || !row.expiresAt || row.expiresAt.getTime() <= now.getTime()) throw ExportNotFound()
  try {
    return await reportExportDownloadUrl(deps, tenantId, row.fileId)
  } catch (err) {
    if (err instanceof AppError && err.status === 404) throw ExportNotFound() // expired by the sweep (the file is deleted)
    throw err
  }
}

// ---------------------------------------------------------------- the job

function parseJob(data: unknown): { exportId: string; tenantId: string } {
  const d = data as { exportId?: unknown; tenantId?: unknown }
  if (typeof d?.exportId !== "string" || typeof d?.tenantId !== "string" || !UUID.test(d.exportId) || !UUID.test(d.tenantId)) throw new Error(`invalid ${EXPORT_JOB} job data`)
  return { exportId: d.exportId, tenantId: d.tenantId }
}

/** Jobs run for active tenants (C14) that still have M1 and are not blocked for payment (C13); the others keep their data and the export stays queued. */
async function tenantMayRun(deps: Deps, tenantId: string): Promise<boolean> {
  const [t] = await deps.db.select({ status: tenants.status }).from(tenants).where(eq(tenants.id, tenantId)) // `tenants` has no RLS
  if (t?.status !== "active") return false
  const ent = await tenantEntitlements(deps.db, tenantId, deps.clock.now())
  return ent.allowed.includes("M1") && ent.billingState !== "blocked"
}

/** queued → running with a lease. A `running` row past its lease (a crashed worker) is taken over; one with a live lease is left alone. */
async function claim(deps: Deps, job: { exportId: string; tenantId: string }): Promise<boolean> {
  return withTenant(deps.db, job.tenantId, async (tx) => {
    const [cur] = await tx.select().from(reportExports).where(and(eq(reportExports.id, job.exportId), eq(reportExports.tenantId, job.tenantId))).for("update")
    if (!cur) return false
    const now = deps.clock.now()
    const stale = cur.status === "running" && (!cur.claimedUntil || cur.claimedUntil.getTime() <= now.getTime())
    if (cur.status !== "queued" && !stale) return false
    await tx.update(reportExports).set({ status: "running", claimedUntil: new Date(now.getTime() + LEASE_MS), startedAt: now, errorCode: null }).where(and(eq(reportExports.id, cur.id), eq(reportExports.tenantId, job.tenantId)))
    return true
  })
}

const isScope = (v: unknown): v is Scope => v === "all" || v === "team" || v === "own"
const asFilters = (r: Row): { from: string; to: string; team?: string; person?: string; status: InboxStatus; scope: Scope } => {
  const f = r.filters as Record<string, unknown>
  const status = (INBOX_STATUSES as readonly unknown[]).includes(f.status) ? (f.status as InboxStatus) : "all"
  return {
    from: String(f.from ?? ""), to: String(f.to ?? ""), ...(typeof f.team === "string" ? { team: f.team } : {}), ...(typeof f.person === "string" ? { person: f.person } : {}), status,
    scope: isScope(f.scope) ? f.scope : "own", // an unknown scope can only be narrower than anything real
  }
}

/**
 * Job `report.export` { exportId, tenantId }: see the header. Never throws for an export problem (it is recorded as `failed`); bad job data throws.
 * Three phases (H5), so that a long build never holds a membership or role row or a connection:
 *   1. claim (a short tx), then a short tx that re-resolves the requester (lockActor FOR SHARE for the length of that tx only);
 *   2. the build: one short read-only tx per page and the encoder in memory, NO lockActor, no row lock on memberships or roles; the lease is renewed after every page;
 *   3. the storage write (outside any tx, after a second lock-free re-check so a downgraded requester's data is never written), then a final short tx: lockActor, the scope re-check, the export
 *      row FOR UPDATE, the files row, the notification, the audit entry, the event last.
 * Crash points: after the claim (row `running`, lease lapses, the sweep re-runs it); during the build (nothing written, same); after the storage write and before the final commit (an object with no
 * files row: the deterministic key means the re-run overwrites it, and a failure removes it with dropUncommittedObject); the final commit is atomic (files row, `done`, notification, audit).
 */
export async function runExportJob(data: unknown, deps: Deps): Promise<void> {
  const job = parseJob(data)
  if (!(await tenantMayRun(deps, job.tenantId))) return
  if (!(await claim(deps, job))) return
  try {
    const requested = await withTenant(deps.db, job.tenantId, (tx) => lockRequester(tx, job.tenantId, job.exportId)) // phase 1: locks end with this tx
    if (!requested) return // finished or taken over meanwhile
    const built = await build(deps, job, requested.row, requested.ctx) // phase 2: no locks
    if (!(await withTenant(deps.db, job.tenantId, (tx) => lockRequester(tx, job.tenantId, job.exportId)))) return // a short re-check BEFORE the write: a downgraded requester's data never reaches storage
    const fileId = exportFileId(job.exportId)
    const stored = await putGeneratedObject(deps, { tenantId: job.tenantId, id: fileId, mime: EXPORT_MIME[built.format], body: built.body }) // outside any tx
    await withTenantAfterCommit(deps, job.tenantId, async (tx, enqueue) => {
      const again = await lockRequester(tx, job.tenantId, job.exportId) // phase 3: lockActor, scope re-check, export row FOR UPDATE
      if (!again) return
      await complete(deps, tx, enqueue, again.row, again.ctx, built, fileId, stored)
    })
  } catch (err) {
    await dropUncommittedObject(deps, job)
    const code = safeCode(err)
    if (RETRYABLE.has(code)) {
      deps.logger.warn({ exportId: job.exportId, errCode: code }, "report export hit a database conflict; the sweep re-runs it after the lease") // nothing was written; the row stays `running`
      return
    }
    await markFailed(deps, job, code)
  }
}

/**
 * The requester as they are NOW: membership, role and report scope re-resolved inside the tx (lockActor: 403 forbidden when they are gone, suspended or lost reports:read). A scope NARROWER
 * than the one the export was requested with is `forbidden` too: the file would have held rows the requester can no longer see. Returns null when the export is no longer `running`.
 * Only ever called in a SHORT tx (never around the build): lockActor holds the membership and role rows FOR SHARE until that tx ends.
 */
async function lockRequester(tx: TenantTx, tenantId: string, exportId: string): Promise<{ row: Row; ctx: ReportCtx } | null> {
  const [peek] = await tx.select({ requestedBy: reportExports.requestedBy }).from(reportExports).where(and(eq(reportExports.id, exportId), eq(reportExports.tenantId, tenantId)))
  if (!peek) return null
  const role = await lockActor(tx, tenantId, peek.requestedBy, "reports", "read")
  const [row] = await tx.select().from(reportExports).where(and(eq(reportExports.id, exportId), eq(reportExports.tenantId, tenantId))).for("update")
  if (!row || row.status !== "running") return null
  const access = await peopleAccess(tx, tenantId, role, row.requestedBy)
  if (!access || RANK[access.kind] < RANK[asFilters(row).scope]) throw Forbidden("forbidden")
  const reports = access.kind === "team" ? await directReports(tx, row.requestedBy) : []
  const [t] = await tx.select({ tz: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId))
  // task: null (a report is read without the task scope); drive: false, ALWAYS: an export is a stored file, Drive links are withheld in it (F10)
  return { row, ctx: { tenantId, tz: t.tz, me: row.requestedBy, actorId: row.requestedBy, role, access, reports, task: null, drive: false, now: new Date(0) } }
}

/** Keeps a claimed export's lease alive while a long build runs (the sweep must not hand it to a second worker): one tiny tx on the export row only. */
async function renewLease(deps: Deps, job: { exportId: string; tenantId: string }): Promise<void> {
  const until = new Date(deps.clock.now().getTime() + LEASE_MS)
  await withTenant(deps.db, job.tenantId, (tx) => tx.update(reportExports).set({ claimedUntil: until }).where(and(eq(reportExports.id, job.exportId), eq(reportExports.tenantId, job.tenantId), eq(reportExports.status, "running"))))
}

type Built = { body: Buffer; stats: BuildStats; name: ExportName; kind: "single" | "range"; format: ExportFormat }

/** Phase 2: reads in short per-page txs under the requester's scope (resolved in phase 1) and encodes in memory. Writes nothing and holds no lock. */
async function build(deps: Deps, job: { exportId: string; tenantId: string }, row: Row, base: ReportCtx): Promise<Built> {
  const now = deps.clock.now()
  const ctx: ReportCtx = { ...base, now }
  const read = <T>(fn: (tx: TenantTx) => Promise<T>) => withTenant(deps.db, job.tenantId, fn)
  const format = row.format as ExportFormat
  const f = asFilters(row)
  const [tn] = await read((tx) => tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, ctx.tenantId)))
  const meta = { tenantName: tn.name, title: row.reportId ? "Shift report" : "Shift reports", generatedAt: epochToWall(now.getTime(), ctx.tz).replace("T", " "), tz: ctx.tz, at: now }
  let body: Buffer
  let stats: BuildStats
  let name: ExportName
  let kind: "single" | "range"
  if (row.reportId) {
    kind = "single"
    name = { kind: "single", reportId: row.reportId }
    const reportId = row.reportId
    const report = await read(async (tx) => {
      try {
        return await loadSingle(tx, ctx, reportId)
      } catch (e) {
        if (!(e instanceof AppError) || e.code !== ReportNotFound().code) throw e
        const [exists] = await tx.select({ id: shiftReports.id }).from(shiftReports).where(and(eq(shiftReports.id, reportId), eq(shiftReports.tenantId, ctx.tenantId)))
        throw exists ? Forbidden("forbidden") : e // it exists but is out of the requester's scope now: forbidden; gone: report_not_found
      }
    })
    const tables = [{ title: "Details", head: ["Field", "Value"], rows: reportMeta(report).map(([k, v]) => [k, v]) }, ...singleTables(report)]
    const sink = makeSink(format, { tables: tables.map((t) => ({ title: t.title!, head: t.head })), meta })
    for (const [i, t] of tables.entries()) await sink.add(i, t.rows)
    body = await sink.finish(`${report.shiftName} · ${report.date} ${windowLabel(report)}`)
    stats = { pages: 1, reports: 1, rows: report.items.length, maxPage: 1 }
  } else {
    kind = "range"
    name = { kind: "range", from: f.from, to: f.to, scope: ctx.access.kind }
    const sink = makeSink(format, { tables: rangeTables(), meta })
    stats = await pageThroughRange(read, ctx, { from: f.from, to: f.to, team: f.team, person: f.person, status: f.status }, format, async (reports) => {
      const r = rangeRows(reports)
      await sink.add(0, r.reports)
      await sink.add(1, r.items)
      await renewLease(deps, job) // a long build may outlast the 10 min lease: renew it after every page
    })
    body = await sink.finish(`${f.from === f.to ? f.from : `${f.from} to ${f.to}`} · ${stats.reports} ${stats.reports === 1 ? "report" : "reports"}`)
  }
  deps.logger.info({ exportId: row.id, format, pages: stats.pages, reports: stats.reports, rows: stats.rows, maxPage: stats.maxPage, bytes: body.length }, "report export built")
  return { body, stats, name, kind, format }
}

/** Phase 3 (inside the final tx, after lockActor and the export row lock): the files row for the object already written, `done`, the notification, the audit entry, then the event. */
async function complete(
  deps: Deps, tx: TenantTx, enqueue: (name: string, data: unknown, o?: { delayMs?: number; key?: string }) => void, row: Row, ctx: ReportCtx, built: Built, fileId: string, stored: { etag: string },
): Promise<void> {
  const { body, stats, name, kind, format } = built
  const f = asFilters(row)
  await insertGeneratedFileRow(deps, tx, { tenantId: ctx.tenantId, id: fileId, ownerUserId: row.requestedBy, name: exportFileName(name, format), mime: EXPORT_MIME[format], body, purpose: "report_export" }, stored)
  const done = deps.clock.now()
  await tx
    .update(reportExports)
    .set({ status: "done", fileId, rowCount: stats.reports, errorCode: null, claimedUntil: null, completedAt: done, expiresAt: new Date(done.getTime() + TTL_MS) })
    .where(and(eq(reportExports.id, row.id), eq(reportExports.tenantId, ctx.tenantId)))
  // history: none. notify (no names, no report text), then audit, then the event LAST (it takes the relay-hint lock)
  await notify(tx, ctx.tenantId, {
    userId: row.requestedBy, kind: "report", title: "Report export ready",
    body: `Your ${format.toUpperCase()} export of ${stats.reports} ${stats.reports === 1 ? "report" : "reports"} is ready. It stays available for ${EXPORT_LIMITS.ttlDays} days.`, link: `/v1/report-exports/${row.id}/download`,
  }, deps, enqueue)
  await recordAudit(tx, ctx.tenantId, {
    action: "report.exported", entity: "report_export", entityId: row.id, actorId: row.requestedBy, before: { status: "running" },
    after: { status: "done", format, kind, rowCount: stats.reports, ...(kind === "range" ? { range: { from: f.from, to: f.to } } : {}), sizeBytes: body.length },
  }, done)
  await publishReportEvent(tx, { tenantId: ctx.tenantId, actorId: "system:report-export", now: done }, { type: "report.export_completed", payload: { exportId: row.id } })
}

/** The object is written before its tx commits (the file row needs its size). If the tx then failed there is no files row, so the object holds report data nobody can reach: delete it. */
async function dropUncommittedObject(deps: Deps, job: { exportId: string; tenantId: string }): Promise<void> {
  const id = exportFileId(job.exportId)
  try {
    const [row] = await withTenant(deps.db, job.tenantId, (tx) => tx.select({ id: files.id }).from(files).where(and(eq(files.id, id), eq(files.tenantId, job.tenantId))))
    if (!row) await deps.storage.delete(fileKey(job.tenantId, id))
  } catch (e) {
    deps.logger.error({ exportId: job.exportId, errCode: safeCode(e) }, "could not remove an uncommitted export object")
  }
}

async function markFailed(deps: Deps, job: { exportId: string; tenantId: string }, code: string): Promise<void> {
  deps.logger.warn({ exportId: job.exportId, errCode: code }, "report export failed")
  try {
    await withTenant(deps.db, job.tenantId, async (tx) => {
      const [cur] = await tx.select().from(reportExports).where(and(eq(reportExports.id, job.exportId), eq(reportExports.tenantId, job.tenantId))).for("update")
      if (!cur || cur.status !== "running") return
      const now = deps.clock.now()
      await tx.update(reportExports).set({ status: "failed", errorCode: code, claimedUntil: null, completedAt: now }).where(and(eq(reportExports.id, cur.id), eq(reportExports.tenantId, job.tenantId)))
      await recordAudit(tx, job.tenantId, { action: "report.export_failed", entity: "report_export", entityId: cur.id, actorId: cur.requestedBy, before: { status: "running" }, after: { status: "failed", format: cur.format, errorCode: code } }, now)
    })
  } catch (e) {
    deps.logger.error({ exportId: job.exportId, errCode: safeCode(e) }, "could not record the export failure")
  }
}

// ---------------------------------------------------------------- the sweep

/**
 * Job `report.export-sweep` (every 10 min, `{}`). Per tenant (a failing tenant is logged and skipped):
 *  - for tenants that may run: `queued` exports older than 2 min (the enqueue was lost) and `running` ones past their lease (a crashed worker) are enqueued again with a NONCE job id
 *    (a duplicate is harmless: the claim lets one run);
 *  - for EVERY tenant, suspended or not (retention does not wait for billing): `done` exports whose 7 days are over lose their file (`expireFile`: soft delete + object removal job).
 */
export async function runExportSweep(_data: unknown, deps: Deps): Promise<void> {
  const rows = await deps.db.select({ id: tenants.id }).from(tenants)
  for (const { id: tenantId } of rows) {
    try {
      const now = deps.clock.now()
      if (await tenantMayRun(deps, tenantId)) {
        const lost = await withTenant(deps.db, tenantId, (tx) =>
          tx
            .select({ id: reportExports.id })
            .from(reportExports)
            .where(and(
              eq(reportExports.tenantId, tenantId),
              sql`((${reportExports.status} = 'queued' and ${reportExports.createdAt} < ${new Date(now.getTime() - SWEEP_QUEUED_MS).toISOString()}::timestamptz)
                or (${reportExports.status} = 'running' and (${reportExports.claimedUntil} is null or ${reportExports.claimedUntil} <= ${now.toISOString()}::timestamptz)))`,
            ))
            .orderBy(reportExports.createdAt, reportExports.id)
            .limit(200),
        )
        for (const r of lost) await enqueueExport(deps, tenantId, r.id, crypto.randomUUID())
      }
      await expireDue(deps, tenantId, now)
    } catch (err) {
      deps.logger.error({ tenantId, errCode: safeCode(err) }, "report export sweep failed for a tenant") // one tenant never stops the rest
    }
  }
}

async function expireDue(deps: Deps, tenantId: string, now: Date): Promise<void> {
  await withTenantAfterCommit(deps, tenantId, async (tx, enqueue) => {
    const due = await tx
      .select({ id: reportExports.id, fileId: reportExports.fileId, format: reportExports.format })
      .from(reportExports)
      .innerJoin(files, and(eq(files.tenantId, reportExports.tenantId), eq(files.id, reportExports.fileId)))
      .where(and(eq(reportExports.tenantId, tenantId), eq(reportExports.status, "done"), lt(reportExports.expiresAt, now), ne(files.status, "deleted")))
      .orderBy(reportExports.expiresAt, reportExports.id)
      .limit(200)
    for (const r of due) {
      if (await expireFile(tx, tenantId, r.fileId!, enqueue)) {
        await recordAudit(tx, tenantId, { action: "report.export_expired", entity: "report_export", entityId: r.id, actorId: null, before: { status: "available" }, after: { status: "deleted", format: r.format } }, now)
      }
    }
  })
}
