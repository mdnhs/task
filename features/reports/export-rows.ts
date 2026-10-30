// FR-M1-31: pure row building for the PDF, Excel and CSV exports. No browser or library code here, so it is unit-tested.
// features/reports/export.ts turns an ExportDoc into a file.
import { csvEscape, csvSafe } from "@/lib/csv"
import { formatDate, formatTime } from "@/lib/dates"
import { ITEM_STATUS, REPORT_STATE, isLate, minutesText, totalMinutes, windowLabel, type ReportState, type ShiftReport } from "@/lib/shift-report"

export type ExportTable = { title?: string; head: string[]; rows: string[][] }
export type ExportDoc = {
  title: string
  subtitle: string
  /** Label / value pairs shown under the title. */
  meta: [string, string][]
  tables: ExportTable[]
  /** File name without extension. */
  fileBase: string
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
const stamp = (wall: string) => `${formatDate(wall)} ${formatTime(wall)}`
const submitted = (r: ShiftReport, tz: string) => (r.submittedAt ? `${stamp(r.submittedAt)}${isLate(r, tz) ? " (late)" : ""}` : "Not submitted")

/** One shift report: details, the task rows, unplanned work, and the free-text sections. */
export function buildReportDoc({ report: r, owner, state, tz, tzLabel, extraLabels = {} }: {
  report: ShiftReport
  owner: string
  state: ReportState
  tz: string
  tzLabel: string
  /** "sectionId.fieldId" → label, for the template's extra fields. */
  extraLabels?: Record<string, string>
}): ExportDoc {
  const extras = Object.entries(r.extra).filter(([, v]) => v.trim())
  return {
    title: `Shift report: ${owner}`,
    subtitle: `${r.shiftName} · ${formatDate(r.date)} ${windowLabel(r)} · ${tzLabel}`,
    meta: [
      ["Person", owner],
      ["Team", r.team],
      ["Shift", `${r.shiftName}, ${formatDate(r.date)} ${windowLabel(r)}`],
      ["Status", REPORT_STATE[state].label],
      ["Due", stamp(r.due)],
      ["Submitted", submitted(r, tz)],
      ["Time reported", minutesText(totalMinutes(r))],
      ...(r.reviewedBy && r.reviewedAt ? [["Reviewed", `${r.reviewedBy}, ${stamp(r.reviewedAt)}`] as [string, string]] : []),
    ],
    tables: [
      { title: "Tasks in the shift", head: ["Task", "Title", "Status", "Time", "Note"], rows: r.items.map((i) => [i.taskRef, i.title, ITEM_STATUS[i.status].label, minutesText(i.minutes), i.note]) },
      ...(r.unplanned.length ? [{ title: "Unplanned work", head: ["Work", "Time"], rows: r.unplanned.map((u) => [u.text, minutesText(u.minutes)]) }] : []),
      {
        title: "Notes",
        head: ["Section", "Answer"],
        rows: [
          ["Summary", r.summary],
          ["Blockers", r.blockers],
          ...extras.map(([k, v]) => [extraLabels[k] ?? k, v]),
          ...(r.attachments.length ? [["Attachments", r.attachments.map((a) => a.name).join(", ")]] : []),
        ],
      },
    ],
    fileBase: `shift-report-${slug(owner)}-${r.date}`,
  }
}

/** Every report in a date range (the inbox after filters): a summary table plus all task rows. */
export function buildRangeDoc({ rows, people, states, from, to, tz }: {
  rows: ShiftReport[]
  people: Map<string, { name: string }>
  states: Map<string, ReportState>
  from: string
  to: string
  tz: string
}): ExportDoc {
  const name = (id: string) => people.get(id)?.name ?? id
  const range = from && to ? (from === to ? formatDate(from) : `${formatDate(from)} to ${formatDate(to)}`) : "All dates"
  const sorted = [...rows].sort((a, b) => a.start.localeCompare(b.start) || name(a.personId).localeCompare(name(b.personId)))
  return {
    title: "Shift reports",
    subtitle: `${range} · ${rows.length} ${rows.length === 1 ? "report" : "reports"}`,
    meta: [["Dates", from && to ? `${from} to ${to}` : "All"]],
    tables: [
      {
        title: "Reports",
        head: ["Date", "Shift", "Team", "Person", "Status", "Due", "Submitted", "Tasks", "Time", "Summary", "Blockers"],
        rows: sorted.map((r) => [
          r.date, `${r.shiftName} ${windowLabel(r)}`, r.team, name(r.personId), REPORT_STATE[states.get(r.id) ?? "draft"].label,
          stamp(r.due), submitted(r, tz), String(r.items.length), minutesText(totalMinutes(r)), r.summary, r.blockers,
        ]),
      },
      {
        title: "Task rows",
        head: ["Date", "Person", "Task", "Title", "Status", "Minutes", "Note"],
        rows: sorted.flatMap((r) => r.items.map((i) => [r.date, name(r.personId), i.taskRef, i.title, ITEM_STATUS[i.status].label, String(i.minutes), i.note])),
      },
    ],
    fileBase: `shift-reports-${from || "all"}${to && to !== from ? `-to-${to}` : ""}`,
  }
}

// Cell quoting and the formula-injection guard are the shared CSV rules (lib/csv.ts).
const cell = csvEscape
const safe = csvSafe

/** RFC 4180 CSV (CRLF). Each table is written as its title row, head and rows, with a blank line between tables. */
export function toCsv(doc: ExportDoc): string {
  const lines: string[] = []
  doc.tables.forEach((t, i) => {
    if (i > 0) lines.push("")
    if (doc.tables.length > 1 && t.title) lines.push(cell(t.title))
    lines.push(t.head.map((c) => cell(safe(c))).join(","))
    for (const row of t.rows) lines.push(row.map((c) => cell(safe(c))).join(","))
  })
  return lines.join("\r\n") + "\r\n"
}
