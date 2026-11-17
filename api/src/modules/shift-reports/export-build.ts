import { Writable } from "node:stream"
import { and, eq, inArray } from "drizzle-orm"
import ExcelJS from "exceljs"
import { jsPDF } from "jspdf"
import { autoTable } from "jspdf-autotable"
import { EXPORT_LIMITS, exportText, inboxRowCells, itemRowCells, rangeDocHead, reportDocTables, reportMeta, tableLines, csvRow, CSV_BOM, type ExportFormat, type ExportReport, type ExportTable } from "@opsdesk/domain/report-export"
import type { ItemStatus } from "@opsdesk/domain/shift-report"
import { epochToWall } from "@opsdesk/domain/shifts"
import { AppError } from "../../core/errors"
import { shiftReports } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { namesOf } from "../tasks"
import { decodeInboxCursor, inboxPage, type InboxFilter } from "./inbox"
import { getReport, reportScopeWhere, type ReportCtx } from "./scope"
import { reportTemplateFor } from "./template"
import { reportDtos } from "./view"
import type { ReportDto } from "./dto"

// The report-export builder (T5.5, FR-M1-31, ruling F20). Two halves:
//   1. the PAGER reads the inbox in pages of 200 (the SAME query as GET /v1/shift-reports, so the rows equal the inbox rows) and turns each page into `ExportReport`s; one page of database rows is
//      alive at a time, and a page is dropped as soon as its rows are in the encoder;
//   2. a SINK per format takes the rows of each table as they come. CSV keeps the encoded lines, XLSX uses exceljs' streaming WorkbookWriter (rows are committed and zipped as they come; the two
//      sheets are written side by side), PDF keeps the (already neutralised) cell strings and draws the document once at the end (a PDF is capped at 500 reports / 5000 rows). All three stop with
//      422 export_too_large as soon as the output would pass `maxBytes`, so nothing grows without bound.
// Every cell of every format goes through `exportText` (leading quote on = + - @ tab CR, control characters dropped): a payload is inert in a spreadsheet and in the PDF, and the XLSX cells are
// written as STRINGS (never a formula, never a hyperlink). Drive links are withheld in every text: the pager runs with `drive: false` (F10).

export type SinkMeta = { tenantName: string; title: string; subtitle?: string; generatedAt: string; tz: string; at?: Date }
export type SinkTable = { title: string; head: string[] }
export type Sink = {
  add(table: number, rows: string[][]): Promise<void>
  finish(subtitle?: string): Promise<Buffer>
}
const tooLarge = () => new AppError(422, "export_too_large", "Unprocessable Entity")

function csvSink(o: { tables: SinkTable[]; maxBytes: number }): Sink {
  const lines: string[][] = []
  let bytes = CSV_BOM.length
  for (const t of o.tables) {
    const head = tableLines({ title: t.title, head: t.head, rows: [] }, true)
    lines.push(head)
    for (const l of head) bytes += Buffer.byteLength(l) + 2
  }
  return {
    async add(table, rows) {
      for (const r of rows) {
        const l = csvRow(r)
        lines[table].push(l)
        bytes += Buffer.byteLength(l) + 2
        if (bytes > o.maxBytes) throw tooLarge()
      }
    },
    async finish() {
      const out: string[] = []
      lines.forEach((t, i) => {
        if (i > 0) out.push("")
        out.push(...t)
      })
      return Buffer.from(CSV_BOM + out.join("\r\n") + "\r\n", "utf8")
    },
  }
}

function xlsxSink(o: { tables: SinkTable[]; maxBytes: number; meta: SinkMeta }): Sink {
  const chunks: Buffer[] = []
  let bytes = 0
  let failure: Error | null = null
  const out = new Writable({
    write(chunk: Buffer, _enc, cb) {
      bytes += chunk.length
      if (bytes > o.maxBytes) {
        failure = tooLarge()
        return cb(failure)
      }
      chunks.push(chunk)
      cb()
    },
  })
  out.on("error", () => {}) // surfaced through `failure` on the next add / finish
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true, useSharedStrings: false })
  const at = o.meta.at ?? new Date(0)
  wb.creator = ""
  wb.lastModifiedBy = ""
  wb.created = at
  wb.modified = at
  wb.title = exportText(o.meta.title)
  const sheets = o.tables.map((t) => {
    const ws = wb.addWorksheet(t.title.slice(0, 31))
    const head = ws.addRow(t.head.map(exportText))
    head.font = { bold: true }
    head.commit()
    return ws
  })
  return {
    async add(table, rows) {
      if (failure) throw failure
      for (const r of rows) sheets[table].addRow(r.map(exportText)).commit() // strings: exceljs writes a string value as a string cell, never as a formula
    },
    async finish() {
      if (failure) throw failure
      for (const ws of sheets) ws.commit()
      await wb.commit()
      if (failure) throw failure
      return Buffer.concat(chunks)
    },
  }
}

/** Latin-1 text for the PDF's standard font: control characters out, anything the font has no glyph for becomes "?". */
const pdfText = (s: string): string => exportText(s).replace(/[\t\r]/g, " ").replace(/[^\n -~ -ÿ]/g, "?")

function pdfSink(o: { tables: SinkTable[]; maxBytes: number; meta: SinkMeta }): Sink {
  const data: string[][][] = o.tables.map(() => [])
  let bytes = 0
  return {
    async add(table, rows) {
      for (const r of rows) {
        const cells = r.map(pdfText)
        for (const c of cells) bytes += c.length
        if (bytes > o.maxBytes) throw tooLarge()
        data[table].push(cells)
      }
    },
    async finish(subtitle) {
      const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" })
      const at = o.meta.at ?? new Date(0)
      doc.setCreationDate(at)
      doc.setProperties({ title: pdfText(o.meta.title), subject: "", author: "", keywords: "", creator: "" })
      const W = doc.internal.pageSize.getWidth()
      const H = doc.internal.pageSize.getHeight()
      const header = () => {
        doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(20)
        doc.text(pdfText(o.meta.tenantName), 30, 28)
        doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(90)
        doc.text(pdfText(`Generated ${o.meta.generatedAt} (${o.meta.tz})`), W - 30, 28, { align: "right" })
        doc.setDrawColor(200).line(30, 36, W - 30, 36)
      }
      header()
      doc.setFont("helvetica", "bold").setFontSize(15).setTextColor(20)
      doc.text(pdfText(o.meta.title), 30, 62)
      const sub = subtitle ?? o.meta.subtitle ?? ""
      if (sub) doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(90).text(pdfText(sub), 30, 77)
      let y = 92
      const last = () => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y
      o.tables.forEach((t, i) => {
        if (y > H - 110) {
          doc.addPage()
          y = 56
        }
        doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(20).text(pdfText(t.title), 30, y)
        autoTable(doc, {
          startY: y + 8,
          head: [t.head.map(pdfText)],
          body: data[i],
          theme: "striped",
          margin: { top: 50, bottom: 34, left: 30, right: 30 },
          styles: { font: "helvetica", fontSize: 7, cellPadding: 3, overflow: "linebreak", valign: "top" },
          headStyles: { fillColor: [31, 41, 55], textColor: 255, fontStyle: "bold" },
          columnStyles: Object.fromEntries(t.head.flatMap((h, c) => (["Summary", "Blockers", "Note", "Answer", "Title"].includes(h) ? [[c, { cellWidth: h === "Title" ? 120 : 150 }]] : []))),
          didDrawPage: header,
        })
        y = last() + 22
      })
      const pages = doc.getNumberOfPages()
      for (let p = 1; p <= pages; p++) {
        doc.setPage(p)
        doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(120)
        doc.text(`Page ${p} of ${pages}`, W / 2, H - 16, { align: "center" })
      }
      const buf = Buffer.from(doc.output("arraybuffer"))
      if (buf.length > o.maxBytes) throw tooLarge()
      return buf
    },
  }
}

/** The encoder of a format. `tables` are the table titles and heads, in order; rows are added later, page by page. */
export function makeSink(format: ExportFormat, o: { tables: SinkTable[]; meta: SinkMeta; maxBytes?: number }): Sink {
  const maxBytes = o.maxBytes ?? EXPORT_LIMITS.maxBytes
  if (format === "csv") return csvSink({ tables: o.tables, maxBytes })
  if (format === "xlsx") return xlsxSink({ tables: o.tables, maxBytes, meta: o.meta })
  return pdfSink({ tables: o.tables, maxBytes, meta: o.meta })
}

// ---------------------------------------------------------------- the pager

export type BuildStats = { pages: number; reports: number; rows: number; maxPage: number }

const wallOf = (iso: string | null, tz: string): string | null => (iso ? epochToWall(Date.parse(iso), tz) : null)

function toExportReport(base: { date: string; shiftName: string; team: string; person: string; state: ExportReport["state"]; start: string; end: string; due: string; submittedAt: string | null }, dto: ReportDto | undefined, tz: string, extraLabels: Record<string, string> = {}): ExportReport {
  return {
    ...base,
    submittedAt: wallOf(base.submittedAt, tz),
    hasReport: Boolean(dto),
    summary: dto?.summary ?? "",
    blockers: dto?.blockers ?? "",
    unplanned: dto?.unplanned.map((u) => ({ text: u.text, minutes: u.minutes })) ?? [],
    extra: dto ? Object.entries(dto.extra).map(([k, v]): [string, string] => [extraLabels[k] ?? k, v]) : [],
    items: dto?.items.map((i) => ({ ref: i.ref, title: i.title, status: i.status as ItemStatus, minutes: i.minutes, note: i.note })) ?? [],
  }
}

/**
 * The range export: inbox pages of 200, in the inbox's own order (newest shift date first, then member, then pattern), each page turned into rows and handed to `onPage` before the next
 * page is read. `ctx` is the requester's scope as it is NOW (the caller re-resolved it) with `drive: false`. Stops with 422 export_too_large / pdf_too_large if the data grew past a cap since the request.
 */
export async function pageThroughRange(
  tx: TenantTx, ctx: ReportCtx, f: Omit<InboxFilter, "after">, format: ExportFormat, onPage: (reports: ExportReport[]) => Promise<void>,
): Promise<BuildStats> {
  const stats: BuildStats = { pages: 0, reports: 0, rows: 0, maxPage: 0 }
  let after: InboxFilter["after"]
  for (;;) {
    const page = await inboxPage(tx, ctx, { ...f, after }, EXPORT_LIMITS.page)
    const ids = page.items.flatMap((i) => (i.id ? [i.id] : []))
    const rows = ids.length ? await tx.select().from(shiftReports).where(and(eq(shiftReports.tenantId, ctx.tenantId), inArray(shiftReports.id, ids), reportScopeWhere(ctx))) : []
    const dtos = new Map((await reportDtos(tx, ctx, rows)).map((d) => [d.id, d]))
    const reports = page.items.map((i) =>
      toExportReport({ date: i.date, shiftName: i.shiftName, team: i.team, person: i.person, state: i.state, start: i.start, end: i.end, due: i.due, submittedAt: i.submittedAt }, i.id ? dtos.get(i.id) : undefined, ctx.tz),
    )
    stats.pages++
    stats.maxPage = Math.max(stats.maxPage, reports.length)
    stats.reports += reports.length
    for (const r of reports) stats.rows += r.items.length
    if (stats.reports > EXPORT_LIMITS.reports || stats.rows > EXPORT_LIMITS.rows) throw tooLarge()
    if (format === "pdf" && (stats.reports > EXPORT_LIMITS.pdfReports || stats.rows > EXPORT_LIMITS.pdfRows)) throw new AppError(422, "pdf_too_large", "Unprocessable Entity")
    await onPage(reports)
    if (!page.nextCursor) return stats
    after = decodeInboxCursor(page.nextCursor)
  }
}

/** One report (the requester's scope decides, 404 report_not_found otherwise) as an ExportReport with the template's labels for its extra answers. */
export async function loadSingle(tx: TenantTx, ctx: ReportCtx, reportId: string): Promise<ExportReport> {
  const row = await getReport(tx, ctx, reportId)
  const [dto] = await reportDtos(tx, ctx, [row])
  const nameOf = await namesOf(tx, row.userId ? [row.userId] : [])
  const sections = await reportTemplateFor(tx, ctx.tenantId, row.teamId)
  const labels: Record<string, string> = {}
  for (const s of sections) for (const fl of s.fields) labels[`${s.id}.${fl.id}`] = `${s.title} / ${fl.label}`
  return toExportReport(
    { date: dto.date, shiftName: dto.shiftName, team: dto.team, person: row.userId ? nameOf(row.userId) : "Former member", state: dto.state, start: dto.start, end: dto.end, due: dto.due, submittedAt: dto.submittedAt },
    dto, ctx.tz, labels,
  )
}

/** The tables of a range export (heads only; rows follow page by page). */
export const rangeTables = (): SinkTable[] => [{ title: "Reports", head: rangeDocHead.reports }, { title: "Task rows", head: rangeDocHead.items }]

/** The rows of a page for the two range tables. */
export const rangeRows = (reports: ExportReport[]): { reports: string[][]; items: string[][] } => ({ reports: reports.map(inboxRowCells), items: reports.flatMap(itemRowCells) })

/** The tables (with all their rows) of one report. */
export const singleTables = (r: ExportReport): ExportTable[] => reportDocTables(r)
export { reportMeta }
