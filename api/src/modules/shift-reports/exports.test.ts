import { readFileSync } from "node:fs"
import { join } from "node:path"
import { sql } from "drizzle-orm"
import ExcelJS from "exceljs"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { EXPORT_OR_DOWNLOAD, routeDenied } from "../../core/middleware/deny-list"
import { ownerQuery } from "../../../test/db"
import { makeApiKey, makeStaff, makeTenant } from "../../../test/factories"
import { call, resetDb } from "../../../test/harness"
import { publish, relayOnce, resetSubscribers } from "../../core/events"
import { runJob } from "../../core/queue/queue"
import { fileKey } from "../../core/storage/storage"
import { withTenant } from "../../db/tenant-tx"
import type { Deps } from "../../deps"
import { registerFiles } from "../files"
import { registerGdpr } from "../gdpr"
import { registerNotifications } from "../notifications"
import { registerSearchIndexers } from "../search"
import { registerTasks } from "../tasks"
import { registerWebhooks } from "../webhooks-out"
import { makeSink, pdfText } from "./export-build"
import { EXPORT_JOB, EXPORT_SWEEP_JOB, exportFileId } from "./exports"
import { DAY, DRIVE, world, type Json, type Who, type W } from "./world"
import { registerShiftReports } from "."

// T5.5: shift-report exports (PDF, Excel, CSV) as jobs that write to Files. Rulings F5, F10, F16, F20, F21, C13, C14. Privacy-sensitive: exports hold other people's report data.
// The clock is fixed at 2026-10-26T12:34Z (Dublin = UTC+0 after the 25 Oct change): the 24 Oct night (22:00-06:00, due 25 Oct 07:00) is long past.

const NOW = "2026-10-26T12:34:00.000Z"
const RANGE = { from: DAY, to: DAY }

beforeEach(async () => {
  await resetDb()
  resetSubscribers()
  registerNotifications()
  registerFiles()
  registerSearchIndexers()
  registerTasks()
  registerShiftReports()
  registerGdpr()
  registerWebhooks()
})
afterEach(resetSubscribers)

const NAMES = { owner: "Olive Owner", manager: "Mina Manager", ops: "Oscar Ops", staff: "Sam Staffer", staff2: "Sue Second", staff3: "Tom Third" } as const

/** Distinct display names (every factory member is "Test Member"), so a leak of a name is visible. */
async function rename(w: W): Promise<void> {
  for (const k of Object.keys(NAMES) as (keyof typeof NAMES)[]) await ownerQuery('update "user" set name = $2 where id = $1', [w[k].userId, NAMES[k]])
}

/** The 24 Oct night: staff submitted (late, with injection payloads), staff2 only has a draft (missing), staff3 and the owner never opened one (virtual rows, missing). The manager manages staff only. */
async function scenario(w: W) {
  await rename(w)
  await w.manages(w.manager, w.staff)
  await w.task(w.staff, { title: "Check fire exits" })
  await w.task(w.staff, { title: "=cmd|' /C calc'!A0" })
  await w.task(w.staff2, { title: "Lift log" })
  const rep = await w.opened(w.staff)
  const filled = await w.filled(w.staff, rep, { summary: '=HYPERLINK("http://x","click")', blockers: `+1 see ${DRIVE}`, unplanned: [{ id: "u1", text: "@SUM(A1) helped next door", minutes: 20 }] })
  expect((await w.submit(w.staff, filled)).status).toBe(200)
  const rep2 = await w.opened(w.staff2)
  return { rep, rep2 }
}

const post = (w: W, as: Who | null, body: Json) => w.req("POST", "/v1/report-exports", as, body)
async function requested(w: W, as: Who, body: Json): Promise<string> {
  const r = await post(w, as, body)
  expect(r.status, await r.clone().text()).toBe(202)
  return (await w.json(r)).id as string
}
const runExport = (w: W, id: string, deps: Deps = w.deps) => runJob(EXPORT_JOB, { exportId: id, tenantId: w.tenant.id }, deps)
const rowOf = async (w: W, id: string) => (await w.q("select * from report_exports where id = $1", [id]))[0]
const code = async (r: Response) => ((await r.clone().json()) as Json).code as string
const iso = (d: unknown) => (d as Date).toISOString()
const setClock = (w: W, at: string) => w.clock.advance({ minutes: (Date.parse(at) - w.clock.now().getTime()) / 60_000 })

async function objectBytes(w: W, fileId: string): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const c of await w.deps.storage.getStream(fileKey(w.tenant.id, fileId))) chunks.push(Buffer.from(c as Buffer))
  return Buffer.concat(chunks)
}
/** The finished export's file: row, name and bytes. */
async function result(w: W, id: string) {
  const row = await rowOf(w, id)
  expect(row.status, JSON.stringify(row)).toBe("done")
  const [file] = await w.q("select * from files where id = $1", [row.file_id])
  return { row, file, bytes: await objectBytes(w, row.file_id as string) }
}
async function exported(w: W, as: Who, body: Json) {
  const id = await requested(w, as, body)
  await runExport(w, id)
  return { id, ...(await result(w, id)) }
}

/** RFC 4180 parser (quotes, doubled quotes, CRLF and line breaks inside a quoted cell). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ } else quoted = false
      } else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ",") { row.push(cell); cell = "" }
    else if (ch === "\r" && text[i + 1] === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++ }
    else cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}
/** A CSV export as `{ title, head, rows }` blocks (a blank line separates the tables). */
function csvTables(bytes: Buffer) {
  const text = bytes.toString("utf8")
  expect(text.charCodeAt(0)).toBe(0xfeff)
  const rows = parseCsv(text.slice(1))
  const blocks: string[][][] = [[]]
  for (const r of rows) {
    if (r.length === 1 && r[0] === "") blocks.push([])
    else blocks[blocks.length - 1].push(r)
  }
  return blocks.filter((b) => b.length > 0).map((b) => ({ title: b[0][0], head: b[1], rows: b.slice(2) }))
}
const reportsTable = (bytes: Buffer) => csvTables(bytes).find((t) => t.title === "Reports")!
const col = (t: { head: string[]; rows: string[][] }, name: string) => t.rows.map((r) => r[t.head.indexOf(name)])

/** A logger that records every line (ids and counts only are allowed). */
function spy() {
  const lines: Json[] = []
  const mk = (level: string) => (o: unknown, m?: string) => void lines.push({ level, ...(o && typeof o === "object" ? (o as Json) : {}), msg: m ?? (typeof o === "string" ? o : undefined) })
  const l = { error: mk("error"), warn: mk("warn"), info: mk("info"), debug: mk("debug"), trace: mk("trace"), fatal: mk("fatal"), level: "debug" } as Json
  l.child = () => l
  return { logger: l as unknown as Deps["logger"], lines }
}

/** Direct SQL seeding of many (archived-pattern) reports for one member, `items` task rows each: the bulk of the limit and memory tests. */
async function bulk(w: W, o: { users: Who[]; patterns: number; days: number; items: number; from?: string; tag?: string }) {
  const tag = o.tag ?? "Bulk"
  await w.q(
    `insert into shift_patterns (tenant_id, team_id, name, start_time, end_time, days, created_at, updated_at, archived_at)
     select $1, $2, $3 || ' ' || g, '22:00', '06:00', array[0,1,2,3,4,5,6]::smallint[], now(), now(), now() from generate_series(1, $4::int) g`,
    [w.tenant.id, w.team, tag, o.patterns],
  )
  const from = o.from ?? "2026-08-01"
  for (const u of o.users) {
    await w.q(
      `insert into shift_reports (tenant_id, user_id, pattern_id, shift_date, team_id, shift_name, start_at, end_at, due_at, status, summary, first_submitted_at, submitted_at, created_at, updated_at, version, submissions)
       select $1, $2, p.id, ($4::date + d), $3, p.name, ($4::date + d)::timestamptz + interval '22 hours', ($4::date + d)::timestamptz + interval '30 hours', ($4::date + d)::timestamptz + interval '31 hours',
              'submitted', 'Bulk summary', ($4::date + d)::timestamptz + interval '30 hours', ($4::date + d)::timestamptz + interval '30 hours', now(), now(), 2, 1
       from shift_patterns p cross join generate_series(0, $5::int - 1) d where p.name like $6 || ' %' and p.tenant_id = $1`,
      [w.tenant.id, u.userId, w.team, from, o.days, tag],
    )
  }
  if (o.items > 0) {
    await w.q(
      `insert into shift_report_items (tenant_id, report_id, position, task_id, task_ref, title, due_at, status, minutes, note)
       select r.tenant_id, r.id, p, null, p + 1, 'Bulk task ' || p, r.due_at, 'done', 5, 'note' from shift_reports r cross join generate_series(0, $2::int - 1) p where r.summary = 'Bulk summary' and r.tenant_id = $1`,
      [w.tenant.id, o.items],
    )
  }
}

describe("the request (POST /v1/report-exports)", () => {
  test("202 { id }; the row is queued with the filters and the requester's scope; the audit row 'report.export_requested' holds the format and the range, no names; the job is enqueued after commit with a sha256 job id (no ':')", async () => {
    const w = await world({ now: NOW })
    await scenario(w)
    const r = await post(w, w.ops, { format: "csv", ...RANGE })
    expect(r.status, await r.clone().text()).toBe(202)
    const created = await w.json(r)
    const { id } = created
    expect(Object.keys(created)).toEqual(["id"])
    const row = await rowOf(w, id)
    expect(row).toMatchObject({ requested_by: w.ops.userId, format: "csv", status: "queued", report_id: null, file_id: null, row_count: null, error_code: null, claimed_until: null })
    expect(iso(row.created_at)).toBe(NOW)
    expect(row.filters).toMatchObject({ from: DAY, to: DAY, status: "all", scope: "all" })
    const jobs = w.queue.jobs.filter((j) => j.name === EXPORT_JOB)
    expect(jobs).toHaveLength(1)
    expect(jobs[0].data).toEqual({ exportId: id, tenantId: w.tenant.id })
    expect(jobs[0].opts?.jobId).toMatch(/^[0-9a-f]{64}$/)
    const audit = await w.q("select actor_id, action, entity, entity_id, before, after from audit_events where action = 'report.export_requested'")
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ actor_id: w.ops.userId, entity: "report_export", entity_id: id })
    expect(audit[0].after).toMatchObject({ format: "csv", kind: "range", range: { from: DAY, to: DAY } })
    for (const n of Object.values(NAMES)) expect(JSON.stringify(audit)).not.toContain(n)
  })

  test("validation: unknown format 400; from after to 422 invalid_range; reportId with a range 400; a stranger's or unknown report id 404 report_not_found; nothing is queued", async () => {
    const w = await world({ now: NOW })
    const { rep } = await scenario(w)
    expect((await post(w, w.ops, { format: "docx", ...RANGE })).status).toBe(400)
    expect((await post(w, w.ops, {})).status).toBe(400)
    const back = await post(w, w.ops, { format: "csv", from: "2026-10-25", to: "2026-10-24" })
    expect([back.status, await code(back)]).toEqual([422, "invalid_range"])
    expect((await post(w, w.ops, { format: "csv", reportId: rep.id, from: DAY })).status).toBe(400)
    const ghost = await post(w, w.ops, { format: "csv", reportId: "00000000-0000-4000-8000-000000000000" })
    expect([ghost.status, await code(ghost)]).toEqual([404, "report_not_found"])
    // staff3 may not see staff's report: out of scope is the same 404
    const out = await post(w, w.staff3, { format: "csv", reportId: rep.id })
    expect([out.status, await code(out)]).toEqual([404, "report_not_found"])
    expect(await w.q("select count(*)::int n from report_exports")).toEqual([{ n: 0 }])
    expect(w.queue.jobs.filter((j) => j.name === EXPORT_JOB)).toHaveLength(0)
  })

  test("limits are checked BEFORE any job: range over 92 days 422 range_too_long; more than 5000 reports or 50000 task rows 422 export_too_large; a PDF over 500 reports (or 5000 rows) 422 pdf_too_large; 92 days exactly is fine", async () => {
    const w = await world({ now: NOW })
    await w.q("delete from shift_assignments") // only stored reports below
    const long = await post(w, w.ops, { format: "csv", from: "2026-07-01", to: "2026-10-01" }) // 93 days
    expect([long.status, await code(long)]).toEqual([422, "range_too_long"])
    expect((await post(w, w.ops, { format: "csv", from: "2026-07-02", to: "2026-10-01" })).status).toBe(202) // exactly 92 days, empty
    await w.q("delete from report_exports")
    w.queue.jobs.length = 0
    // 9200 reports (2 members x 50 patterns x 92 days) > 5000
    await bulk(w, { users: [w.staff, w.staff2], patterns: 50, days: 92, items: 0 })
    const big = await post(w, w.ops, { format: "csv", from: "2026-08-01", to: "2026-10-31" })
    expect([big.status, await code(big)]).toEqual([422, "export_too_large"])
    // a narrower range with 4000 reports (1 member x 50 patterns x 80 days is 4000 over 80 days) but 13 task rows each = 52000 > 50000 rows
    await w.q("delete from shift_report_items")
    await w.q("delete from shift_reports")
    await bulk(w, { users: [w.staff], patterns: 50, days: 80, items: 13, tag: "Rows" })
    const rows = await post(w, w.ops, { format: "xlsx", from: "2026-08-01", to: "2026-10-19" })
    expect([rows.status, await code(rows)]).toEqual([422, "export_too_large"])
    // PDF: 600 reports (10 patterns x 60 days) > 500; 4000 reports with 13 rows is also over the PDF's own caps, but the general cap answers first only when exceeded
    await w.q("delete from shift_report_items")
    await w.q("delete from shift_reports")
    await bulk(w, { users: [w.staff], patterns: 10, days: 60, items: 0, tag: "Pdf" })
    const pdf = await post(w, w.ops, { format: "pdf", from: "2026-08-01", to: "2026-09-29" })
    expect([pdf.status, await code(pdf)]).toEqual([422, "pdf_too_large"])
    expect((await post(w, w.ops, { format: "csv", from: "2026-08-01", to: "2026-09-29" })).status).toBe(202) // the same 600 reports are fine as CSV
    await w.q("delete from report_exports")
    await w.q("delete from shift_report_items")
    await w.q("delete from shift_reports")
    await bulk(w, { users: [w.staff], patterns: 4, days: 60, items: 25, tag: "PdfRows" }) // 240 reports, 6000 rows
    const pdfRows = await post(w, w.ops, { format: "pdf", from: "2026-08-01", to: "2026-09-29" })
    expect([pdfRows.status, await code(pdfRows)]).toEqual([422, "pdf_too_large"])
    expect(await w.q("select count(*)::int n from report_exports")).toEqual([{ n: 0 }])
  }, 120_000)

  test("export_limit: at most 3 queued or running exports per requester: the 4th is 409 export_limit (nothing created); another member is not affected; a finished one frees a slot", async () => {
    const w = await world({ now: NOW })
    await scenario(w)
    const ids: string[] = []
    for (let i = 0; i < 3; i++) ids.push(await requested(w, w.ops, { format: "csv", ...RANGE }))
    const fourth = await post(w, w.ops, { format: "csv", ...RANGE })
    expect([fourth.status, await code(fourth)]).toEqual([409, "export_limit"])
    expect((await w.q("select count(*)::int n from report_exports where requested_by = $1", [w.ops.userId]))[0].n).toBe(3)
    expect(await w.q("select 1 from audit_events where action = 'report.export_requested'")).toHaveLength(3)
    expect((await post(w, w.owner, { format: "csv", ...RANGE })).status).toBe(202)
    await runExport(w, ids[0])
    expect((await rowOf(w, ids[0])).status).toBe("done")
    expect((await post(w, w.ops, { format: "csv", ...RANGE })).status).toBe(202)
    // two requests at the same instant cannot both take the last slot
    const w2 = await world({ now: NOW, slug: "bravo" })
    const burst = await Promise.all(Array.from({ length: 6 }, () => post(w2, w2.ops, { format: "csv", ...RANGE })))
    const statuses = burst.map((r) => r.status).sort()
    expect(statuses.filter((s) => s === 202)).toHaveLength(3)
    expect(statuses.filter((s) => s === 409)).toHaveLength(3)
  })

  test("API keys cannot request, read or download exports; the key deny-list and EXPORT_OR_DOWNLOAD match every export route; a role without reports access is 403", async () => {
    const w = await world({ now: NOW })
    await scenario(w)
    const id = await requested(w, w.ops, { format: "csv", ...RANGE })
    for (const p of ["/v1/report-exports", `/v1/report-exports/${id}`, `/v1/report-exports/${id}/download`, "/v1/report-exports/:id/download", "/v1/report-exports/:id"]) expect(routeDenied([EXPORT_OR_DOWNLOAD], p, p), p).toBe(true)
    const key = await makeApiKey(w.deps, w.tenant.id, w.ops.userId, ["reports:read", "reports:write"])
    for (const [m, p, body] of [["POST", "/v1/report-exports", { format: "csv", ...RANGE }], ["GET", `/v1/report-exports/${id}`, undefined], ["GET", `/v1/report-exports/${id}/download`, undefined]] as [string, string, unknown][]) {
      const r = await call(w.app, m, p, { headers: { authorization: `Bearer ${key.key}` }, body })
      expect([m, p, r.status, await code(r)]).toEqual([m, p, 403, "api_key_forbidden_route"])
    }
    expect((await w.q("select count(*)::int n from report_exports"))[0].n).toBe(1) // the key created nothing
    // anonymous
    expect((await post(w, null, { format: "csv", ...RANGE })).status).toBe(401)
  })

  test("M1 gate: without the module the request is 403 module_not_entitled and nothing is created", async () => {
    const w = await world({ now: NOW })
    await scenario(w)
    expect((await w.req("GET", "/v1/shift-reports/template", w.ops)).status).toBe(200) // cached now
    await w.q("insert into module_overrides (tenant_id, module, mode, reason, set_by, set_at) values ($1, 'M1', 'revoke', 'test', 'p', now())", [w.tenant.id])
    w.clock.advance({ minutes: 1 })
    const r = await post(w, w.ops, { format: "csv", ...RANGE })
    expect([r.status, await code(r)]).toEqual([403, "module_not_entitled"])
    expect((await w.q("select count(*)::int n from report_exports"))[0].n).toBe(0)
  })
})

describe("the file (CSV, Excel, PDF)", () => {
  test("CSV formula injection end to end: '=HYPERLINK', '+1', '@SUM' and a '=cmd' task title all come out prefixed with ' and quoted; BOM present; RFC 4180 (CRLF); Drive links withheld; file name has no personal data", async () => {
    const w = await world({ now: NOW })
    const { rep } = await scenario(w)
    const { file, bytes, row } = await exported(w, w.ops, { format: "csv", ...RANGE })
    expect(file).toMatchObject({ purpose: "report_export", status: "clean", mime: "text/csv; charset=utf-8", owner_user_id: w.ops.userId, name: "shift-reports-2026-10-24-2026-10-24-all.csv", size_bytes: String(bytes.length) })
    expect(row.row_count).toBe(4)
    const text = bytes.toString("utf8")
    expect(text.startsWith("﻿")).toBe(true)
    expect(text).toContain(`"'=HYPERLINK(""http://x"",""click"")"`) // the summary
    expect(text).toContain(`"'=cmd|' /C calc'!A0"`) // a task title
    expect(text).toContain(`"'+1 see`) // blockers, Drive link withheld
    expect(text).not.toContain("drive.google.com")
    expect(text).toContain("Google Drive link")
    expect(text).not.toMatch(/\r?\n[=+\-@]/) // no line starts with a formula lead
    expect(text.split("\r\n").length).toBeGreaterThan(5)
    // every cell of every table: nothing starts with = + - @ tab or CR
    for (const t of csvTables(bytes)) for (const r of [t.head, ...t.rows]) for (const c of r) expect(c, c).not.toMatch(/^[=+\-@\t\r]/)
    const t = reportsTable(bytes)
    expect(col(t, "Summary")).toContain(`'=HYPERLINK("http://x","click")`)
    expect(rep.id).toBeTruthy()
  })

  test("file names hold no personal data: range 'shift-reports-<from>-<to>-<scope>.csv', single 'shift-report-<8 hex>.pdf'; the stored files.name, the download name and the download URL never contain a member's name or email", async () => {
    const w = await world({ now: NOW })
    const { rep } = await scenario(w)
    const range = await exported(w, w.manager, { format: "csv", ...RANGE })
    expect(range.file.name).toBe("shift-reports-2026-10-24-2026-10-24-team.csv")
    const single = await exported(w, w.staff, { format: "pdf", reportId: rep.id })
    expect(single.file.name).toBe(`shift-report-${(rep.id as string).slice(0, 8)}.pdf`)
    for (const e of [range, single]) {
      const dl = await w.req("GET", `/v1/report-exports/${e.id}/download`, e.row.requested_by === w.manager.userId ? w.manager : w.staff)
      expect(dl.status).toBe(302)
      const loc = decodeURIComponent(dl.headers.get("location")!)
      expect(loc).toMatch(/shift-report/)
      for (const bad of [...Object.values(NAMES), w.staff.email, w.manager.email, "Test Member", w.staff.userId.slice(0, 6)]) {
        expect(e.file.name).not.toContain(bad)
        expect(loc, bad).not.toContain(bad)
      }
    }
    expect(await w.q("select key from files where purpose = 'report_export'")).toEqual(expect.arrayContaining([expect.objectContaining({ key: expect.stringMatching(/^t\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/) })]))
  })

  test("Excel: one sheet per table with the same cells as the CSV; strings are written as strings (never a formula, no hyperlink); the injection payloads carry the leading quote", async () => {
    const w = await world({ now: NOW })
    await scenario(w)
    const csv = await exported(w, w.ops, { format: "csv", ...RANGE })
    const xlsx = await exported(w, w.ops, { format: "xlsx", ...RANGE })
    expect(xlsx.file.name).toBe("shift-reports-2026-10-24-2026-10-24-all.xlsx")
    expect(xlsx.file.mime).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(xlsx.bytes as unknown as ArrayBuffer)
    const tables = csvTables(csv.bytes)
    expect(wb.worksheets.map((s) => s.name)).toEqual(tables.map((t) => t.title))
    for (const [i, t] of tables.entries()) {
      const ws = wb.worksheets[i]
      const grid: string[][] = []
      for (let n = 1; n <= ws.rowCount; n++) grid.push(t.head.map((_, c) => { const v = ws.getRow(n).getCell(c + 1).value; return v === null || v === undefined ? "" : String(v) })) // (empty strings are not written, so read by position)
      expect(grid, t.title).toEqual([t.head, ...t.rows])
      expect(ws.rowCount, t.title).toBe(t.rows.length + 1)
      ws.eachRow((r) => r.eachCell((c) => {
        expect(c.type, `${t.title} ${c.address}`).not.toBe(ExcelJS.ValueType.Formula)
        expect(c.type).not.toBe(ExcelJS.ValueType.Hyperlink)
        expect(c.formula).toBeUndefined()
      }))
    }
    const summaries = wb.getWorksheet("Reports")!.getColumn(11).values as unknown[]
    expect(summaries).toContain(`'=HYPERLINK("http://x","click")`)
    expect(xlsx.bytes.subarray(0, 2).toString()).toBe("PK")
  })

  test("PDF: a header with the tenant name from settings and the tenant-time timestamp; the payload is drawn as inert text (no JavaScript, links, launch or open actions); single-report PDF has the report's sections", async () => {
    const w = await world({ now: NOW })
    const { rep } = await scenario(w)
    await ownerQuery("update tenants set name = $2 where id = $1", [w.tenant.id, "Acme Facilities Ltd"])
    const range = await exported(w, w.ops, { format: "pdf", ...RANGE })
    const text = range.bytes.toString("latin1")
    expect(text.startsWith("%PDF-")).toBe(true)
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true)
    expect(text).toContain("Acme Facilities Ltd")
    expect(text).toContain("2026-10-26 12:34") // generated at (tenant time)
    expect(text).toContain("Europe/Dublin")
    expect(text).toContain("Shift reports")
    expect(text).toContain("'=HYPERLINK") // neutralised like the other formats
    for (const bad of ["/JS", "/JavaScript", "/Launch", "/SubmitForm", "/URI", "/Subtype /Link", "/AA ", "/EmbeddedFile"]) expect(text, bad).not.toContain(bad)
    for (const m of text.matchAll(/\/OpenAction\s*(.)/g)) expect(m[1], "an open action must be a plain page destination, never an action dictionary").toBe("[")
    expect(text).not.toContain("drive.google.com")
    expect(range.file).toMatchObject({ name: "shift-reports-2026-10-24-2026-10-24-all.pdf", mime: "application/pdf" })
    const one = await exported(w, w.staff, { format: "pdf", reportId: rep.id })
    const t1 = one.bytes.toString("latin1")
    for (const s of ["Acme Facilities Ltd", "Tasks in the shift", "Unplanned work", "Notes", "Check fire exits", "TSK-"]) expect(t1, s).toContain(s)
  })

  test("a single report: CSV holds the details, tasks, unplanned work and notes of THAT report only; the row_count is 1", async () => {
    const w = await world({ now: NOW })
    const { rep, rep2 } = await scenario(w)
    const one = await exported(w, w.staff, { format: "csv", reportId: rep.id })
    expect(one.row.row_count).toBe(1)
    expect(one.row.report_id).toBe(rep.id)
    const tables = csvTables(one.bytes)
    expect(tables.map((t) => t.title)).toEqual(["Details", "Tasks in the shift", "Unplanned work", "Notes"])
    expect(tables[0].rows.map((r) => r[0])).toEqual(["Person", "Team", "Shift", "Status", "Due", "Submitted", "Time reported"])
    expect(tables[1].rows.map((r) => r[1]).sort()).toEqual(["'=cmd|' /C calc'!A0", "Check fire exits"].sort())
    expect(one.bytes.toString("utf8")).not.toContain("Lift log") // staff2's task
    expect(tables[2].rows).toEqual([["'@SUM(A1) helped next door", "20m"]]) // unplanned work text is neutralised too
    expect(rep2.id).not.toBe(rep.id)
  })
})

describe("the rows equal the inbox", () => {
  test("export rows equal the inbox rows for the same filters (date, person, status, due in tenant time, task counts); status derived with deps.clock; free text passes withholdDriveText", async () => {
    const w = await world({ now: NOW })
    await scenario(w)
    for (const status of ["all", "late", "missing"]) {
      const inbox: Json[] = []
      let cursor = ""
      for (let i = 0; i < 20; i++) {
        const r = await w.json(await w.req("GET", `/v1/shift-reports?from=${DAY}&to=${DAY}&status=${status}&limit=2${cursor}`, w.ops))
        inbox.push(...r.items)
        if (!r.nextCursor) break
        cursor = `&cursor=${r.nextCursor}`
      }
      const { bytes } = await exported(w, w.ops, { format: "csv", ...RANGE, status })
      const t = reportsTable(bytes)
      const label: Record<string, string> = { late: "Late", missing: "Missing", draft: "Draft", submitted: "Submitted", accepted: "Accepted", returned: "Returned" }
      expect(inbox.length, status).toBeGreaterThan(0)
      expect(t.rows.map((r) => [r[0], r[3], r[4], r[5]]), status).toEqual(inbox.map((i) => [i.date, i.person, label[i.state as string], (i.due as string).replace("T", " ")]))
      expect(col(t, "Tasks"), status).toEqual(inbox.map((i) => (i.id ? String(i.itemCount) : "")))
      expect(col(t, "Team"), status).toEqual(inbox.map((i) => i.team))
    }
    const all = (await exported(w, w.ops, { format: "csv", ...RANGE })).bytes
    expect(col(reportsTable(all), "Status").sort()).toEqual(["Late", "Missing", "Missing", "Missing"])
    expect(col(reportsTable(all), "Due")).toEqual(Array(4).fill("2026-10-25 07:00")) // tenant time (Dublin, UTC+0 after the change), not UTC strings with a zone suffix
    // a virtual row (nobody opened it) is exported like the inbox shows it: person and state, blanks elsewhere
    const staff3 = reportsTable(all).rows.find((r) => r[3] === NAMES.staff3)!
    expect(staff3.slice(6)).toEqual(["Not submitted", "", "", "", "", ""])
  })

  test("a team manager's export holds only the manager's own and direct reports' rows (F5); the same filters as the inbox for that manager", async () => {
    const w = await world({ now: NOW })
    await scenario(w)
    const { bytes } = await exported(w, w.manager, { format: "csv", ...RANGE })
    expect(col(reportsTable(bytes), "Person")).toEqual([NAMES.staff])
    const text = bytes.toString("utf8")
    for (const other of [NAMES.staff2, NAMES.staff3, NAMES.owner, "Lift log"]) expect(text, other).not.toContain(other)
    // an employee (own scope) and the person filter can only narrow, never widen
    const own = await exported(w, w.staff2, { format: "csv", ...RANGE, person: w.staff.userId })
    expect(col(reportsTable(own.bytes), "Person")).toEqual([])
    const narrowed = await exported(w, w.ops, { format: "csv", ...RANGE, person: w.staff.userId })
    expect(col(reportsTable(narrowed.bytes), "Person")).toEqual([NAMES.staff])
  })

  test("the export re-checks scope in the job: a role downgraded before the job runs fails the export with 'forbidden' and no file (no object, no files row, no notification, no 'report.exported' audit); a removed member too", async () => {
    const w = await world({ now: NOW })
    await scenario(w)
    const id = await requested(w, w.manager, { format: "csv", ...RANGE })
    expect((await rowOf(w, id)).filters).toMatchObject({ scope: "team" })
    await w.q("update memberships set role_id = (select id from roles where tenant_id = $1 and key = 'employee') where tenant_id = $1 and user_id = $2", [w.tenant.id, w.manager.userId])
    await runExport(w, id)
    expect(await rowOf(w, id)).toMatchObject({ status: "failed", error_code: "forbidden", file_id: null })
    expect(await w.q("select 1 from files where purpose = 'report_export'")).toEqual([])
    expect(await w.deps.storage.head(fileKey(w.tenant.id, exportFileId(id)))).toBeNull()
    expect(await w.q("select 1 from notifications where user_id = $1 and title = 'Report export ready'", [w.manager.userId])).toEqual([])
    expect(await w.q("select 1 from audit_events where action = 'report.exported'")).toEqual([])
    // narrowed from all to team: also forbidden (the file would have held rows the requester no longer sees)
    const id2 = await requested(w, w.ops, { format: "csv", ...RANGE })
    await w.q("update memberships set role_id = (select id from roles where tenant_id = $1 and key = 'manager') where tenant_id = $1 and user_id = $2", [w.tenant.id, w.ops.userId])
    await runExport(w, id2)
    expect(await rowOf(w, id2)).toMatchObject({ status: "failed", error_code: "forbidden" })
    // a member removed before the job runs
    const id3 = await requested(w, w.owner, { format: "csv", ...RANGE })
    await w.q("update memberships set status = 'suspended' where tenant_id = $1 and user_id = $2", [w.tenant.id, w.owner.userId])
    await runExport(w, id3)
    expect(await rowOf(w, id3)).toMatchObject({ status: "failed", error_code: "forbidden" })
  })

  test("a single report that fell out of scope before the job ran (the manager no longer manages its author) fails with 'forbidden' and writes no file", async () => {
    const w = await world({ now: NOW })
    const { rep } = await scenario(w)
    const id = await requested(w, w.manager, { format: "pdf", reportId: rep.id })
    await w.q("delete from reporting_lines where user_id = $1", [w.staff.userId])
    await runExport(w, id)
    expect(await rowOf(w, id)).toMatchObject({ status: "failed", error_code: "forbidden", file_id: null })
    expect(await w.q("select 1 from files where purpose = 'report_export'")).toEqual([])
    expect(await w.deps.storage.head(fileKey(w.tenant.id, exportFileId(id)))).toBeNull()
  })

  test("the failure is visible to the requester (GET status: failed + errorCode) and nobody else", async () => {
    const w = await world({ now: NOW })
    await scenario(w)
    const id = await requested(w, w.manager, { format: "csv", ...RANGE })
    await w.q("update memberships set role_id = (select id from roles where tenant_id = $1 and key = 'employee') where tenant_id = $1 and user_id = $2", [w.tenant.id, w.manager.userId])
    await runExport(w, id)
    const s = await w.json(await w.req("GET", `/v1/report-exports/${id}`, w.manager))
    expect(s).toEqual({ id, status: "failed", format: "csv", rowCount: null, expiresAt: null, errorCode: "forbidden" })
  })
})

describe("large exports (memory)", () => {
  test("4000 reports x 10 rows export as CSV and XLSX in pages of 200 without holding more than one page of DB rows (page count asserted) and under 25 MiB; the XLSX has the same row counts", async () => {
    const w = await world({ now: NOW })
    await w.q("delete from shift_assignments")
    await bulk(w, { users: [w.staff], patterns: 50, days: 80, items: 10 })
    expect((await w.q("select count(*)::int n from shift_reports"))[0].n).toBe(4000)
    expect((await w.q("select count(*)::int n from shift_report_items"))[0].n).toBe(40_000)
    const range = { from: "2026-08-01", to: "2026-10-19" }
    for (const format of ["csv", "xlsx"]) {
      const s = spy()
      const id = await requested(w, w.ops, { format, ...range })
      const t0 = Date.now()
      await runExport(w, id, { ...w.deps, logger: s.logger })
      const { row, bytes } = await result(w, id)
      expect(row.row_count, format).toBe(4000)
      expect(bytes.length, format).toBeLessThan(25 * 1024 * 1024)
      expect(bytes.length).toBeGreaterThan(100_000)
      const built = s.lines.find((l) => l.msg === "report export built")
      expect(built, format).toMatchObject({ exportId: id, pages: 20, reports: 4000, rows: 40_000, maxPage: 200, format })
      expect(s.lines.filter((l) => l.level === "error" || l.level === "warn")).toEqual([])
      expect(JSON.stringify(s.lines)).not.toContain("Bulk summary") // no report text in logs
      if (format === "csv") {
        const tables = csvTables(bytes)
        expect(tables.map((t) => [t.title, t.rows.length])).toEqual([["Reports", 4000], ["Task rows", 40_000]])
      } else {
        const wb = new ExcelJS.Workbook()
        await wb.xlsx.load(bytes as unknown as ArrayBuffer)
        expect(wb.worksheets.map((x) => [x.name, x.rowCount])).toEqual([["Reports", 4001], ["Task rows", 40_001]])
      }
      expect(Date.now() - t0).toBeLessThan(90_000)
    }
  }, 240_000)

  test("the output cap: every encoder stops with export_too_large as soon as the file would pass the cap (no unbounded buffer), before it is stored", async () => {
    for (const format of ["csv", "xlsx", "pdf"] as const) {
      const sink = makeSink(format, { tables: [{ title: "Reports", head: ["A", "B"] }], maxBytes: 3000, meta: { tenantName: "Acme", generatedAt: "2026-10-26 12:34", tz: "Europe/Dublin", title: "Shift reports", subtitle: "" } })
      const err = await (async () => {
        for (let i = 0; i < 2000; i++) await sink.add(0, [[`row ${i} ${"x".repeat(200)}`, "y"]])
        return sink.finish()
      })().then(() => null, (e) => e)
      expect(err, format).toMatchObject({ status: 422, code: "export_too_large" })
    }
  })
})

describe("who can read or download it (requester only)", () => {
  test("only the requester downloads: another member of the same scope, an owner, a manager, a support grant and an api key all get 404 / 403; the requester gets a 302 to a 60 s presigned URL that serves the file; the status is requester-only too", async () => {
    const w = await world({ now: NOW })
    await scenario(w)
    const id = await requested(w, w.ops, { format: "csv", ...RANGE })
    const early = await w.req("GET", `/v1/report-exports/${id}/download`, w.ops)
    expect([early.status, await code(early)]).toEqual([409, "export_not_ready"])
    await runExport(w, id)
    const { bytes } = await result(w, id)
    // the requester
    const dl = await w.req("GET", `/v1/report-exports/${id}/download`, w.ops)
    expect(dl.status).toBe(302)
    expect(dl.headers.get("cache-control")).toBe("no-store")
    const loc = dl.headers.get("location")!
    expect(new URL(loc).searchParams.get("X-Amz-Expires")).toBe("60")
    expect(Buffer.from(await (await fetch(loc)).arrayBuffer()).equals(bytes)).toBe(true)
    const st = await w.json(await w.req("GET", `/v1/report-exports/${id}`, w.ops))
    expect(st).toEqual({ id, status: "done", format: "csv", rowCount: 4, expiresAt: "2026-11-02T12:34:00.000Z", errorCode: null })
    // everybody else: 404 report_export_not_found (also for the status), owner and all-scope included
    for (const other of [w.owner, w.manager, w.staff, w.staff2]) {
      for (const p of [`/v1/report-exports/${id}`, `/v1/report-exports/${id}/download`]) {
        const r = await w.req("GET", p, other)
        expect([p, r.status, await code(r)]).toEqual([p, 404, "report_export_not_found"])
      }
    }
    // a support grant: the deny-list answers 403 (audited)
    const support = await makeStaff(w.deps, "support")
    expect((await call(w.app, "POST", `/v1/platform/tenants/${w.tenant.id}/support-grants`, { cookie: support.cookie, body: { reason: "Ticket 4411: report totals look wrong", hours: 2 } })).status).toBe(201)
    for (const p of [`/v1/report-exports/${id}`, `/v1/report-exports/${id}/download`]) {
      const r = await call(w.app, "GET", p, { cookie: support.cookie, tenant: w.tenant.slug })
      expect([p, r.status, await code(r)]).toEqual([p, 403, "support_forbidden_route"])
    }
    // an api key
    const key = await makeApiKey(w.deps, w.tenant.id, w.ops.userId, ["reports:read"])
    expect((await call(w.app, "GET", `/v1/report-exports/${id}/download`, { headers: { authorization: `Bearer ${key.key}` } })).status).toBe(403)
  })

  test("a report_export file is hidden from /v1/files (404 on every verb), not in search, and produces no webhook delivery for file.* events (fail closed); an ordinary file is announced (control)", async () => {
    const w = await world({ now: NOW })
    await scenario(w)
    expect((await w.req("POST", "/v1/webhooks", w.owner, { url: "https://hooks.example.com/opsdesk", events: ["file.uploaded", "file.scanned", "file.deleted"] })).status).toBe(201)
    const { row } = await exported(w, w.ops, { format: "csv", ...RANGE })
    const fid = row.file_id as string
    for (const [m, p] of [["GET", `/v1/files/${fid}`], ["GET", `/v1/files/${fid}/download`], ["POST", `/v1/files/${fid}/complete`], ["DELETE", `/v1/files/${fid}`]] as [string, string][]) {
      for (const as of [w.ops, w.owner]) {
        const r = await w.req(m, p, as)
        expect([m, p, r.status, await code(r)]).toEqual([m, p, 404, "file_not_found"])
      }
    }
    expect((await w.json(await w.req("GET", "/v1/files", w.owner))).items?.map((f: Json) => f.id) ?? []).not.toContain(fid)
    // announce it the way the files module would (file.* events): the fan-out drops it
    await withTenant(w.deps.db, w.tenant.id, (tx) => publish(tx, { tenantId: w.tenant.id, type: "file.scanned", payload: { fileId: fid }, actorId: null }, w.deps.clock.now()))
    await withTenant(w.deps.db, w.tenant.id, (tx) => publish(tx, { tenantId: w.tenant.id, type: "file.deleted", payload: { fileId: fid }, actorId: null }, w.deps.clock.now()))
    for (let i = 0; i < 5 && (await relayOnce(w.deps)) > 0; i++);
    expect((await w.q("select count(*)::int n from search_documents where entity = 'file'"))[0].n).toBe(0)
    expect((await w.q("select count(*)::int n from webhook_deliveries"))[0].n).toBe(0)
    const buf = Buffer.from("plain")
    const pi = await w.json(await w.req("POST", "/v1/files/uploads", w.owner, { name: "plain.pdf", mime: "application/pdf", sizeBytes: buf.length }))
    const { "Content-Length": _l, ...headers } = pi.upload.headers as Record<string, string>
    expect((await fetch(pi.upload.url, { method: "PUT", headers, body: buf })).status).toBe(200)
    expect((await w.req("POST", `/v1/files/${pi.fileId}/complete`, w.owner)).status).toBe(200)
    await w.drain()
    await w.relay()
    expect((await w.q("select count(*)::int n from webhook_deliveries"))[0].n).toBeGreaterThan(0)
  })

  test("the logo cannot point at an export file (isScopedPurpose, C6)", async () => {
    const w = await world({ now: NOW })
    await scenario(w)
    const { row } = await exported(w, w.ops, { format: "csv", ...RANGE })
    const r = await w.req("PATCH", "/v1/settings/organisation", w.owner, { logoFileId: row.file_id })
    expect(r.status).toBeGreaterThanOrEqual(400)
    expect(r.status).toBeLessThan(500)
  })
})

describe("the job: idempotent, crash safe, gated", () => {
  test("running it twice at once (two workers) and again later produces one file row, one object, one notification and one audit row; the notification and audit hold no names; the event is published once", async () => {
    const w = await world({ now: NOW })
    await scenario(w)
    const id = await requested(w, w.ops, { format: "csv", ...RANGE })
    await Promise.all([runExport(w, id), runExport(w, id)])
    await runExport(w, id)
    const row = await rowOf(w, id)
    expect(row).toMatchObject({ status: "done", row_count: 4, error_code: null })
    expect(iso(row.completed_at)).toBe(NOW)
    expect(iso(row.expires_at)).toBe("2026-11-02T12:34:00.000Z")
    expect(await w.q("select id from files where purpose = 'report_export'")).toHaveLength(1)
    expect((await w.q("select id from files where purpose = 'report_export'"))[0].id).toBe(exportFileId(id))
    const notes = await w.q("select user_id, kind, title, body, link from notifications where kind = 'report' and title = 'Report export ready'")
    expect(notes).toHaveLength(1)
    expect(notes[0].user_id).toBe(w.ops.userId)
    const audit = await w.q("select actor_id, action, entity_id, before, after from audit_events where action = 'report.exported'")
    expect(audit).toHaveLength(1)
    expect(audit[0].after).toMatchObject({ format: "csv", rowCount: 4, range: { from: DAY, to: DAY } })
    for (const n of Object.values(NAMES)) for (const blob of [JSON.stringify(notes), JSON.stringify(audit)]) expect(blob).not.toContain(n)
    expect(await w.q("select 1 from domain_events where type = 'report.export_completed'")).toHaveLength(1)
  })

  test("a failure after the object was written (the tx is rolled back) removes the object, leaves no files row, marks the export failed and is retryable by a new request; a crash (object written, job lost) is healed by the sweep re-run: same key, one file row, no orphan", async () => {
    const w = await world({ now: NOW })
    await scenario(w)
    // (1) fail after the put: the clock throws once, right after the storage write (storeGeneratedFile reads it for the row)
    const id = await requested(w, w.ops, { format: "csv", ...RANGE })
    let armed = false
    let thrown = false
    const storage = { ...w.deps.storage, put: async (k: string, b: Buffer, o: { contentType: string }) => { await w.deps.storage.put(k, b, o); armed = true } } as Deps["storage"]
    const clock = { now: () => { if (armed && !thrown) { thrown = true; throw new Error("boom after the object write") } return w.clock.now() } }
    await runExport(w, id, { ...w.deps, storage, clock } as Deps)
    expect(thrown).toBe(true)
    expect(await rowOf(w, id)).toMatchObject({ status: "failed", file_id: null })
    expect(await w.deps.storage.head(fileKey(w.tenant.id, exportFileId(id)))).toBeNull() // no orphan
    expect(await w.q("select 1 from files where purpose = 'report_export'")).toEqual([])
    expect(await w.q("select 1 from audit_events where action = 'report.exported'")).toEqual([])
    expect(await w.q("select 1 from notifications where kind = 'report' and title = 'Report export ready'")).toEqual([])
    // (2) crash: the object exists, the row is `running` with an expired lease (the worker died); the sweep re-enqueues it and the re-run overwrites the SAME key
    const id2 = await requested(w, w.ops, { format: "csv", ...RANGE })
    await w.deps.storage.put(fileKey(w.tenant.id, exportFileId(id2)), Buffer.from("half written"), { contentType: "text/csv" })
    await w.q("update report_exports set status = 'running', started_at = $2, claimed_until = $3 where id = $1", [id2, NOW, "2026-10-26T12:30:00.000Z"])
    w.queue.jobs.length = 0
    await runJob(EXPORT_SWEEP_JOB, {}, w.deps)
    const again = w.queue.jobs.filter((j) => j.name === EXPORT_JOB && (j.data as Json).exportId === id2)
    expect(again).toHaveLength(1)
    expect(again[0].opts?.jobId).toMatch(/^[0-9a-f]{64}$/)
    await runJob(again[0].name, again[0].data, w.deps)
    const done = await result(w, id2)
    expect(done.bytes.toString("utf8")).toContain("Reports")
    expect(done.bytes.toString("utf8")).not.toContain("half written")
    expect(await w.q("select id from files where purpose = 'report_export'")).toHaveLength(1)
  })

  test("a live lease blocks a second worker; a stale lease lets it take over; claim sets running + claimed_until", async () => {
    const w = await world({ now: NOW })
    await scenario(w)
    const id = await requested(w, w.ops, { format: "csv", ...RANGE })
    await w.q("update report_exports set status = 'running', started_at = $2, claimed_until = $3 where id = $1", [id, NOW, "2026-10-26T12:40:00.000Z"])
    await runExport(w, id)
    expect((await rowOf(w, id)).status).toBe("running") // another worker owns it: nothing done
    expect(await w.q("select 1 from files where purpose = 'report_export'")).toEqual([])
    setClock(w, "2026-10-26T12:41:00.000Z")
    await runExport(w, id)
    expect((await rowOf(w, id)).status).toBe("done")
  })

  test("jobs skip suspended, M1-less and billing-blocked tenants and keep their data; they run once the tenant is back", async () => {
    const w = await world({ now: NOW })
    await scenario(w)
    const id = await requested(w, w.ops, { format: "csv", ...RANGE })
    await ownerQuery("update tenants set status = 'suspended' where id = $1", [w.tenant.id])
    await runExport(w, id)
    expect(await rowOf(w, id)).toMatchObject({ status: "queued", file_id: null })
    await ownerQuery("update tenants set status = 'active' where id = $1", [w.tenant.id])
    await w.q("insert into module_overrides (tenant_id, module, mode, reason, set_by, set_at) values ($1, 'M1', 'revoke', 'test', 'p', now())", [w.tenant.id])
    await runExport(w, id)
    expect((await rowOf(w, id)).status).toBe("queued")
    await w.q("delete from module_overrides where tenant_id = $1", [w.tenant.id])
    await w.q("update subscriptions set status = 'canceled' where tenant_id = $1", [w.tenant.id])
    await runExport(w, id)
    expect((await rowOf(w, id)).status).toBe("queued")
    await w.q("update subscriptions set status = 'active' where tenant_id = $1", [w.tenant.id])
    await runExport(w, id)
    expect((await rowOf(w, id)).status).toBe("done")
  })

  test("bad job data is rejected without touching anything; an unknown export id is a no-op", async () => {
    const w = await world({ now: NOW })
    await expect(runJob(EXPORT_JOB, { exportId: "nope", tenantId: w.tenant.id }, w.deps)).rejects.toThrow()
    await expect(runJob(EXPORT_JOB, {}, w.deps)).rejects.toThrow()
    await runJob(EXPORT_JOB, { exportId: "00000000-0000-4000-8000-000000000000", tenantId: w.tenant.id }, w.deps)
  })
})

describe("the sweep and the 7 days", () => {
  test("the sweep re-enqueues a lost queued export (older than 2 min) with a nonce job id and expires a 7-day-old file; the expired download is 404; a fresh queued export is left alone", async () => {
    const w = await world({ now: NOW })
    await scenario(w)
    const lost = await requested(w, w.ops, { format: "csv", ...RANGE })
    w.queue.jobs.length = 0 // the enqueue was lost (Redis flushed)
    await runJob(EXPORT_SWEEP_JOB, {}, w.deps)
    expect(w.queue.jobs.filter((j) => j.name === EXPORT_JOB)).toEqual([]) // younger than 2 minutes: left alone
    w.clock.advance({ minutes: 3 })
    await runJob(EXPORT_SWEEP_JOB, {}, w.deps)
    const jobs = w.queue.jobs.filter((j) => j.name === EXPORT_JOB)
    expect(jobs).toHaveLength(1)
    expect(jobs[0].data).toEqual({ exportId: lost, tenantId: w.tenant.id })
    expect(jobs[0].opts?.jobId).toMatch(/^[0-9a-f]{64}$/)
    await runJob(jobs[0].name, jobs[0].data, w.deps)
    const done = await result(w, lost)
    // not yet expired at 6 days 23 h
    w.clock.advance({ days: 6, hours: 23 })
    await runJob(EXPORT_SWEEP_JOB, {}, w.deps)
    expect((await w.q("select status from files where id = $1", [done.row.file_id]))[0].status).toBe("clean")
    expect((await w.req("GET", `/v1/report-exports/${lost}/download`, w.ops)).status).toBe(302)
    // past 7 days after completion
    w.clock.advance({ hours: 2 })
    w.queue.jobs.length = 0
    await runJob(EXPORT_SWEEP_JOB, {}, w.deps)
    expect((await w.q("select status from files where id = $1", [done.row.file_id]))[0].status).toBe("deleted")
    expect(w.queue.jobs.filter((j) => j.name === "file.delete-object")).toHaveLength(1)
    const gone = await w.req("GET", `/v1/report-exports/${lost}/download`, w.ops)
    expect([gone.status, await code(gone)]).toEqual([404, "report_export_not_found"])
    await w.drain()
    expect(await w.deps.storage.head(fileKey(w.tenant.id, done.row.file_id as string))).toBeNull()
    // the sweep is idempotent
    await runJob(EXPORT_SWEEP_JOB, {}, w.deps)
    expect(await w.q("select 1 from audit_events where action = 'report.export_expired'")).toHaveLength(1)
  })

  test("expiry survives a Redis loss and a suspended tenant: the sweep expires from the table alone (data retention does not wait for billing)", async () => {
    const w = await world({ now: NOW })
    await scenario(w)
    const { row } = await exported(w, w.ops, { format: "csv", ...RANGE })
    await ownerQuery("update tenants set status = 'suspended' where id = $1", [w.tenant.id])
    w.clock.advance({ days: 8 })
    await runJob(EXPORT_SWEEP_JOB, {}, w.deps)
    expect((await w.q("select status from files where id = $1", [row.file_id]))[0].status).toBe("deleted")
  })
})

describe("DSR, isolation, database", () => {
  test("erasing the requester removes their exports' files (they hold other people's report data) and the export rows leave with the membership", async () => {
    const w = await world({ now: NOW })
    await scenario(w)
    const { row } = await exported(w, w.manager, { format: "csv", ...RANGE })
    const dr = await w.req("POST", "/v1/data-requests", w.owner, { subjectUserId: w.manager.userId, kind: "erase", reason: "asked" })
    expect(dr.status, await dr.clone().text()).toBe(201)
    await w.drain()
    expect((await w.q("select status from files where id = $1", [row.file_id]))[0].status).toBe("deleted")
    expect(await w.q("select 1 from report_exports where requested_by = $1", [w.manager.userId])).toEqual([])
  }, 60_000)

  test("every export route: tenant B's export or report id is 404 with the resource code, and nothing of B is created", async () => {
    const a = await world({ now: NOW })
    await scenario(a)
    const b = await world({ now: NOW, slug: "bravo" })
    const { rep: repB } = await scenario(b)
    const idB = await requested(b, b.ops, { format: "csv", ...RANGE })
    for (const p of [`/v1/report-exports/${idB}`, `/v1/report-exports/${idB}/download`]) {
      const r = await call(a.app, "GET", p, { cookie: a.ops.cookie, tenant: "acme" })
      expect([p, r.status, await code(r)]).toEqual([p, 404, "report_export_not_found"])
    }
    const cross = await call(a.app, "POST", "/v1/report-exports", { cookie: a.ops.cookie, tenant: "acme", body: { format: "csv", reportId: repB.id } })
    expect([cross.status, await code(cross)]).toEqual([404, "report_not_found"])
    expect((await a.q("select count(*)::int n from report_exports"))[0].n).toBe(0)
  })

  test("RLS and grants: a tenant-A tx cannot read or insert tenant-B report_exports (error on .cause); the table is FORCEd; the app role has SELECT + INSERT and UPDATE of exactly the job's columns, no DELETE; the FKs are composite; the indexes exist", async () => {
    const w = await world({ now: NOW })
    await scenario(w)
    const id = await requested(w, w.ops, { format: "csv", ...RANGE })
    const other = await makeTenant(w.deps, { slug: "other" })
    expect((await withTenant(w.deps.db, other.id, (tx) => tx.execute(sql`select 1 from report_exports`))).rows).toHaveLength(0)
    const ins = await withTenant(w.deps.db, other.id, (tx) =>
      tx.execute(sql`insert into report_exports (tenant_id, requested_by, format, filters, status, created_at) values (${w.tenant.id}, ${w.ops.userId}, 'csv', '{}'::jsonb, 'queued', ${new Date()})`),
    ).catch((e) => e)
    expect((ins as { cause?: { code?: string } }).cause?.code).toBe("42501")
    expect((await ownerQuery("select relforcerowsecurity f, relrowsecurity r from pg_class where relname = 'report_exports'"))[0]).toEqual({ f: true, r: true })
    expect((await ownerQuery("select privilege_type from information_schema.role_table_grants where grantee = 'app_user' and table_name = 'report_exports' order by 1")).map((r) => r.privilege_type)).toEqual(["INSERT", "SELECT"])
    expect((await ownerQuery("select column_name from information_schema.column_privileges where grantee = 'app_user' and table_name = 'report_exports' and privilege_type = 'UPDATE' order by 1")).map((r) => r.column_name)).toEqual(
      ["claimed_until", "completed_at", "error_code", "expires_at", "file_id", "row_count", "started_at", "status"],
    )
    const del = await withTenant(w.deps.db, w.tenant.id, (tx) => tx.execute(sql`delete from report_exports`)).catch((e) => e)
    expect((del as { cause?: { code?: string } }).cause?.code).toBe("42501")
    const badUpdate = await withTenant(w.deps.db, w.tenant.id, (tx) => tx.execute(sql`update report_exports set requested_by = 'x' where id = ${id}`)).catch((e) => e)
    expect((badUpdate as { cause?: { code?: string } }).cause?.code).toBe("42501")
    const fk = (await ownerQuery("select conname from pg_constraint where conrelid = 'report_exports'::regclass and contype = 'f' order by 1")).map((r) => r.conname)
    expect(fk).toEqual(expect.arrayContaining(["report_exports_requester_fk", "report_exports_file_fk", "report_exports_report_fk"]))
    const idx = (await ownerQuery("select indexname from pg_indexes where tablename = 'report_exports'")).map((r) => r.indexname)
    expect(idx).toEqual(expect.arrayContaining(["report_exports_user_idx", "report_exports_sweep_idx"]))
    // check constraints
    for (const [f, s] of [["txt", "queued"], ["csv", "weird"]]) {
      const bad = await w.q(`insert into report_exports (tenant_id, requested_by, format, filters, status, created_at) values ($1, $2, '${f}', '{}', '${s}', now())`, [w.tenant.id, w.ops.userId]).catch((e) => e)
      expect((bad as { code?: string }).code).toBe("23514")
    }
  })

  test("the export modules take time from deps.clock only (no new Date(), Date.now() or SQL now()), log ids and counts only, and the worker registers both jobs", () => {
    for (const f of ["exports.ts", "export-build.ts"]) {
      const src = readFileSync(join(__dirname, f), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")
      expect(src, f).not.toMatch(/new Date\(\)|Date\.now\(\)|\bnow\(\)\s*(,|\))?\s*`|sql`[^`]*\bnow\(\)/)
    }
    expect(readFileSync(join(__dirname, "../../worker.ts"), "utf8")).toContain("EXPORT_SWEEP_JOB")
  })
})

describe("T5.5 review carry-ins", () => {
  test("H3: the download re-checks the requester's CURRENT scope against filters.scope: an all-scope manager demoted to team scope gets 404 report_export_not_found for the earlier export (status stays readable); a same-or-wider scope still downloads", async () => {
    const w = await world({ now: NOW })
    await scenario(w)
    const id = await requested(w, w.ops, { format: "csv", ...RANGE })
    await runExport(w, id)
    expect((await rowOf(w, id)).filters).toMatchObject({ scope: "all" })
    expect((await w.req("GET", `/v1/report-exports/${id}/download`, w.ops)).status).toBe(302)
    await w.q("update memberships set role_id = (select id from roles where tenant_id = $1 and key = 'manager') where tenant_id = $1 and user_id = $2", [w.tenant.id, w.ops.userId])
    const dl = await w.req("GET", `/v1/report-exports/${id}/download`, w.ops)
    expect([dl.status, await code(dl)]).toEqual([404, "report_export_not_found"])
    expect((await w.req("GET", `/v1/report-exports/${id}`, w.ops)).status).toBe(200)
    // widening is fine: a team-scope export of an own-scope... downloaded by a manager who is now all-scope
    const mine = await requested(w, w.manager, { format: "csv", ...RANGE })
    await runExport(w, mine)
    expect((await rowOf(w, mine)).filters).toMatchObject({ scope: "team" })
    await w.q("update memberships set role_id = (select id from roles where tenant_id = $1 and key = 'owner') where tenant_id = $1 and user_id = $2", [w.tenant.id, w.manager.userId])
    expect((await w.req("GET", `/v1/report-exports/${mine}/download`, w.manager)).status).toBe(302)
  })

  test("M5: a team manager demoted to employee (own scope) is refused the team-scope export too", async () => {
    const w = await world({ now: NOW })
    await scenario(w)
    const id = await requested(w, w.manager, { format: "csv", ...RANGE })
    await runExport(w, id)
    await w.q("update memberships set role_id = (select id from roles where tenant_id = $1 and key = 'employee') where tenant_id = $1 and user_id = $2", [w.tenant.id, w.manager.userId])
    const dl = await w.req("GET", `/v1/report-exports/${id}/download`, w.manager)
    expect(dl.status).toBe(404)
  })

  test("expired status: a done export past expiresAt reads status 'expired' (deps.clock), the download stays 404, and before the deadline it is still 'done'", async () => {
    const w = await world({ now: NOW })
    await scenario(w)
    const id = await requested(w, w.ops, { format: "csv", ...RANGE })
    await runExport(w, id)
    expect((await w.json(await w.req("GET", `/v1/report-exports/${id}`, w.ops))).status).toBe("done")
    w.clock.advance({ days: 7, minutes: -1 })
    expect((await w.json(await w.req("GET", `/v1/report-exports/${id}`, w.ops))).status).toBe("done")
    w.clock.advance({ minutes: 2 })
    const st = await w.json(await w.req("GET", `/v1/report-exports/${id}`, w.ops))
    expect(st).toMatchObject({ id, status: "expired", expiresAt: "2026-11-02T12:34:00.000Z" })
    const dl = await w.req("GET", `/v1/report-exports/${id}/download`, w.ops)
    expect([dl.status, await code(dl)]).toEqual([404, "report_export_not_found"])
    // a failed one is never 'expired'
    await w.q("update report_exports set status = 'failed', error_code = 'x' where id = $1", [id])
    expect((await w.json(await w.req("GET", `/v1/report-exports/${id}`, w.ops))).status).toBe("failed")
  })

  test("OpenAPI: the export routes name api_key_forbidden_route (not human_required), and the status enum has 'expired'", async () => {
    const w = await world({ now: NOW })
    const doc = (await (await call(w.app, "GET", "/v1/openapi.json")).json()) as { paths: Record<string, Record<string, Json>> }
    const create = JSON.stringify(doc.paths["/v1/report-exports"].post)
    expect(create).toContain("api_key_forbidden_route")
    expect(create).not.toContain("human_required")
    const get = JSON.stringify(doc.paths["/v1/report-exports/{id}"].get)
    expect(get).toContain("expired")
  })

  test("PDF smart punctuation: curly quotes, en and em dashes, ellipsis and NBSP become ASCII instead of '?'; real non-Latin-1 text still becomes '?'; a smart-punctuation formula lead is still neutralised", () => {
    expect(pdfText("It\u2019s \u2018fine\u2019 \u201cquoted\u201d")).toBe("It's 'fine' \"quoted\"")
    expect(pdfText("9\u201310 \u2014 done\u2026")).toBe("9-10 - done...")
    expect(pdfText("a\u00a0b")).toBe("a b")
    expect(pdfText("caf\u00e9 \u4e2d")).toBe("caf\u00e9 ?")
    expect(pdfText("\u2013 1")).toBe("'- 1")
    expect(pdfText("\u00a0=1+1")).toBe("' =1+1")
    expect(pdfText(" =1+1")).toBe("' =1+1")
  })

  test("PDF smart punctuation end to end: a phone-typed summary reaches the PDF with ASCII quotes, no '?'", async () => {
    const w = await world({ now: NOW })
    await w.task(w.staff, { title: "Lock up" })
    const rep = await w.opened(w.staff)
    const filled = await w.filled(w.staff, rep, { summary: "Didn\u2019t finish \u2013 will \u201cretry\u201d\u2026", blockers: "" })
    expect((await w.submit(w.staff, filled)).status).toBe(200)
    const one = await exported(w, w.staff, { format: "pdf", reportId: rep.id })
    const t = one.bytes.toString("latin1")
    expect(t).toContain("Didn't finish - will \"retry\"...")
  })
})
