import { getData } from "./data"
import type { Org } from "./org"
import { addDays } from "./shifts"
import { getShiftState } from "./shifts-data"
import { activeTasks } from "./task-scope"
import { reportRows, type ShiftReport, type ShiftTask, type StoredReport, type TemplateData } from "./shift-report"
import type { ShiftState } from "./shifts"

// Server only (reads the mock JSON). The pure model is lib/shift-report.ts.
// Rows cover the last REPORT_HISTORY_DAYS days up to the tenant's today: stored reports from public/data/reports/reports.json
// on top of fresh drafts built from the shift model and the tasks. Scope them (scopeReports) before sending to a client.

/** How many days back the inbox lists shifts (today included). Not a tenant value: the mock seed covers this window. */
export const REPORT_HISTORY_DAYS = 7

export type ShiftReportData = { rows: ShiftReport[]; template: TemplateData; shifts: ShiftState; range: { from: string; to: string } }

export async function getShiftReportData(org: Pick<Org, "today" | "timezone">): Promise<ShiftReportData> {
  const [shifts, { reports }, { tasks }, template] = await Promise.all([
    getShiftState(),
    getData<{ reports: StoredReport[] }>("reports/reports.json"),
    getData<{ tasks: ShiftTask[] }>("tasks/tasks.json"),
    getData<TemplateData>("settings/template.json"),
  ])
  const to = org.today.slice(0, 10)
  const range = { from: addDays(to, -(REPORT_HISTORY_DAYS - 1)), to }
  return { rows: reportRows(shifts, activeTasks(tasks), reports, range, org.today, org.timezone), template, shifts, range }
}
