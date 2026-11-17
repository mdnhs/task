// FR-M1-31: pure row building and text rules for the shift-report exports (PDF, Excel, CSV). No I/O and no library code here: the API's `export-build.ts` turns these tables into files.
// One cell rule for every format (`exportText`): a text that starts with = + - @ tab or CR (also after leading white space or line breaks) gets a leading quote, so no spreadsheet reads it as a formula, and control characters are dropped.
import { csvEscape } from "./csv"
import { ITEM_STATUS, REPORT_STATE, minutesText, windowLabel, type ItemStatus, type ReportState } from "./shift-report"

export const EXPORT_FORMATS = ["pdf", "xlsx", "csv"] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

/** Ruling F20 (limits checked before a job is queued) and the lifecycle constants. */
export const EXPORT_LIMITS = {
  /** A range is at most this many days (422 range_too_long). */
  rangeDays: 92,
  /** At most this many reports (422 export_too_large). */
  reports: 5000,
  /** At most this many task rows (422 export_too_large). */
  rows: 50_000,
  /** A PDF holds at most this many reports (422 pdf_too_large: use Excel or CSV). */
  pdfReports: 500,
  /** A PDF holds at most this many task rows (a page-heavy layout: 422 pdf_too_large). */
  pdfRows: 5000,
  /** Reports read per page by the job, so memory stays bounded. */
  page: 200,
  /** The file is at most this large. */
  maxBytes: 25 * 1024 * 1024,
  /** Queued or running exports per requester (409 export_limit). */
  active: 3,
  /** A finished file is kept this long. */
  ttlDays: 7,
} as const

export const EXPORT_MIME: Record<ExportFormat, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
}

/** Excel reads a UTF-8 CSV only with a byte order mark. */
export const CSV_BOM = "﻿"

// Control characters that break XML (the XLSX parts) or a terminal; tab, line feed and carriage return stay.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g
// A formula lead is = + - @ at the start, or after any run of white space, line breaks, NBSP, zero-width characters or a byte order mark (a spreadsheet skips those); a tab or CR at the start is neutralised on its own.
const FORMULA_LEAD = /^(?:[\t\r]|[\s\u00a0\u200b-\u200d\u2060\ufeff]*[=+\-@])/

/** The one text rule of every format: control characters dropped, then a leading quote on anything a spreadsheet would read as a formula. Markup is never interpreted (CSV, string cells and drawn PDF text). */
export const exportText = (v: string): string => {
  const t = v.replace(CONTROL, "")
  return FORMULA_LEAD.test(t) ? `'${t}` : t
}

/** One CSV cell (RFC 4180): a neutralised formula-lead is ALWAYS quoted; otherwise quoted only when it holds a comma, quote, line break or edge space. */
export function exportCsvCell(v: string): string {
  const t = v.replace(CONTROL, "")
  return FORMULA_LEAD.test(t) ? `"'${t.replace(/"/g, '""')}"` : csvEscape(t)
}

export type ExportTable = { title?: string; head: string[]; rows: string[][] }

/** One CSV row (no line break). */
export const csvRow = (cells: string[]): string => cells.map(exportCsvCell).join(",")

/** The lines (no BOM, no trailing line break) of one table: an optional title row, the head, then the rows. */
export function tableLines(t: Pick<ExportTable, "head" | "rows"> & { title?: string }, withTitle = false): string[] {
  return [...(withTitle && t.title ? [exportCsvCell(t.title)] : []), csvRow(t.head), ...t.rows.map(csvRow)]
}

/** One table as a CSV document: BOM, CRLF line ends. */
export const tableToCsv = (t: Pick<ExportTable, "head" | "rows">): string => CSV_BOM + tableLines(t).join("\r\n") + "\r\n"

/** What the file name says: a range (dates and the requester's scope kind) or one report (8 hex of its id). Never a person's name. */
export type ExportName = { kind: "range"; from: string; to: string; scope: "all" | "team" | "own" } | { kind: "single"; reportId: string }
export const exportFileName = (n: ExportName, format: ExportFormat): string =>
  n.kind === "range" ? `shift-reports-${n.from}-${n.to}-${n.scope}.${format}` : `shift-report-${n.reportId.replace(/-/g, "").slice(0, 8).toLowerCase()}.${format}`

/** One report (or a shift nobody reported on: `hasReport` false) with every text already withheld of Drive links and every time in tenant time. */
export type ExportReport = {
  date: string
  shiftName: string
  team: string
  person: string
  state: ReportState
  /** Wall times in the tenant zone (`YYYY-MM-DDTHH:mm`). */
  start: string
  end: string
  due: string
  submittedAt: string | null
  hasReport: boolean
  summary: string
  blockers: string
  unplanned: { text: string; minutes: number }[]
  /** `[label, answer]` of the template's extra fields. */
  extra: [string, string][]
  items: { ref: string; title: string; status: ItemStatus; minutes: number; note: string }[]
}

const stamp = (wall: string): string => wall.replace("T", " ")
const minutesOf = (r: ExportReport): number => r.items.reduce((n, i) => n + i.minutes, 0) + r.unplanned.reduce((n, u) => n + u.minutes, 0)
const submitted = (r: ExportReport): string => (r.submittedAt ? `${stamp(r.submittedAt)}${r.state === "late" ? " (late)" : ""}` : "Not submitted")

/** Column heads. */
export const rangeDocHead = {
  reports: ["Date", "Shift", "Team", "Person", "Status", "Due", "Submitted", "Tasks", "Done", "Time", "Summary", "Blockers"],
  items: ["Date", "Person", "Task", "Title", "Status", "Minutes", "Note"],
}

/** The row of one inbox entry in the "Reports" table: exactly the inbox's date, person, state and due time; the counts and texts are blank for a shift with no report yet. */
export const inboxRowCells = (r: ExportReport): string[] => [
  r.date, `${r.shiftName} ${windowLabel(r)}`, r.team, r.person, REPORT_STATE[r.state].label, stamp(r.due), submitted(r),
  r.hasReport ? String(r.items.length) : "", r.hasReport ? String(r.items.filter((i) => i.status === "done").length) : "", r.hasReport ? minutesText(minutesOf(r)) : "", r.summary, r.blockers,
]

/** The rows of one report in the "Task rows" table. */
export const itemRowCells = (r: ExportReport): string[][] => r.items.map((i) => [r.date, r.person, i.ref, i.title, ITEM_STATUS[i.status].label, String(i.minutes), i.note])

/** The tables of ONE report: its tasks, unplanned work and the free-text sections. */
export function reportDocTables(r: ExportReport): ExportTable[] {
  const extras = r.extra.filter(([, v]) => v.trim())
  return [
    { title: "Tasks in the shift", head: ["Task", "Title", "Status", "Time", "Note"], rows: r.items.map((i) => [i.ref, i.title, ITEM_STATUS[i.status].label, minutesText(i.minutes), i.note]) },
    ...(r.unplanned.length ? [{ title: "Unplanned work", head: ["Work", "Time"], rows: r.unplanned.map((u) => [u.text, minutesText(u.minutes)]) }] : []),
    { title: "Notes", head: ["Section", "Answer"], rows: [["Summary", r.summary], ["Blockers", r.blockers], ...extras] },
  ]
}

/** The details block of one report (label / value pairs under the title). */
export const reportMeta = (r: ExportReport): [string, string][] => [
  ["Person", r.person], ["Team", r.team], ["Shift", `${r.shiftName}, ${r.date} ${windowLabel(r)}`], ["Status", REPORT_STATE[r.state].label], ["Due", stamp(r.due)], ["Submitted", submitted(r)], ["Time reported", minutesText(minutesOf(r))],
]
