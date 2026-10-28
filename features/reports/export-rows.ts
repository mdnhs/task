// FR-REP-12: pure row building for the PDF and Excel exports. No browser or library code here, so it is unit-tested.
// features/reports/export.ts turns an ExportDoc into a file.
import { formatDate, formatTime } from "@/lib/dates"
import type { Person } from "@/lib/types"
import { isLateSubmission, sectionProgress } from "./lifecycle"
import { FIELD_STATE, REPORT_STATUS } from "./types"
import type { Report, ReportEntry, TemplateField, TemplateSection } from "./types"

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

/** `daily-report-<dept>-<YYYY-MM-DD>` (extension added by the caller). */
export const exportFileBase = (dept: string, date: string) => `daily-report-${slug(dept) || "all"}-${date.slice(0, 10)}`

const entryText = (f: TemplateField, e: ReportEntry) =>
  f.entry === "structured" && e.cells
    ? (f.columns ?? Object.keys(e.cells)).map((c) => `${c}: ${e.cells?.[c] ?? ""}`).join("; ")
    : e.text

const submittedText = (r: Report, deadline: string) =>
  r.submittedAt ? `${formatTime(r.submittedAt)}${isLateSubmission(r, deadline) ? " (late)" : ""}` : "Not submitted"

/** One report: a details table, then one table per section (Field / Answer / Details). `skip` = sections the role may not read. */
export function buildReportDoc({
  report,
  template,
  owner,
  skip = [],
  deadline,
  tzLabel,
}: {
  report: Report
  template: TemplateSection[]
  owner: string
  skip?: string[]
  deadline: string
  tzLabel: string
}): ExportDoc {
  const sections = template.filter((s) => !skip.includes(s.id))
  return {
    title: `${report.dept} daily report`,
    subtitle: `${formatDate(report.date)} · due ${formatTime(`${report.date}T${deadline}:00`)} ${tzLabel}`,
    meta: [
      ["Date", report.date],
      ["Department", report.dept],
      ["Owner", owner],
      ["Status", REPORT_STATUS[report.status].label],
      ["Submitted", submittedText(report, deadline)],
      ...(report.nil ? [["Report type", "Nil report"] as [string, string]] : []),
    ],
    tables: sections.map((s) => ({
      title: `${s.n}. ${s.title}`,
      head: ["Field", "Answer", "Details"],
      rows: s.fields.map((f) => {
        const v = report.fields[`${s.id}.${f.id}`]
        return [f.label, v?.state ? FIELD_STATE[v.state] : "Not answered", (v?.entries ?? []).map((e) => entryText(f, e)).filter(Boolean).join("\n")]
      }),
    })),
    fileBase: exportFileBase(report.dept, report.date),
  }
}

/** The day's submission board: one row per department (who submitted, status, time). */
export function buildBoardDoc({
  reports,
  people,
  template,
  departments,
  today,
  tzLabel,
  deadline,
}: {
  reports: Report[]
  people: Map<string, Person>
  template: TemplateSection[]
  departments: string[]
  today: string
  tzLabel: string
  deadline: string
}): ExportDoc {
  const day = today.slice(0, 10)
  return {
    title: "Daily report submissions",
    subtitle: `${formatDate(day)} · due ${formatTime(`${day}T${deadline}:00`)} ${tzLabel}`,
    meta: [["Date", day]],
    tables: [
      {
        head: ["Department", "Owner", "Status", "Submitted", "Sections complete"],
        rows: departments.map((d) => {
          const r = reports.find((x) => x.date === day && x.dept === d)
          const { done, total } = r ? sectionProgress(r, template) : { done: 0, total: template.length }
          return [
            d,
            (r && people.get(r.owner)?.name) || "Unassigned",
            r ? REPORT_STATUS[r.status].label : "Not started",
            r ? submittedText(r, deadline) : "Not started",
            `${done} of ${total}`,
          ]
        }),
      },
    ],
    fileBase: `daily-report-submissions-${day}`,
  }
}

/** The history list as shown (after filters). */
export function buildHistoryDoc({
  reports,
  people,
  today,
  deadline,
  showOwner,
}: {
  reports: Report[]
  people: Map<string, Person>
  today: string
  deadline: string
  showOwner: boolean
}): ExportDoc {
  const day = today.slice(0, 10)
  return {
    title: showOwner ? "Daily report history" : "My daily report history",
    subtitle: `${reports.length} ${reports.length === 1 ? "report" : "reports"} · up to ${formatDate(day)}`,
    meta: [["Generated for", day]],
    tables: [
      {
        head: ["Report", "Date", "Department", ...(showOwner ? ["Owner"] : []), "Status", "Submitted"],
        rows: reports.map((r) => [
          r.id,
          r.date,
          r.dept,
          ...(showOwner ? [people.get(r.owner)?.name ?? r.owner] : []),
          REPORT_STATUS[r.status].label,
          submittedText(r, deadline),
        ]),
      },
    ],
    fileBase: `daily-report-history-${day}`,
  }
}
