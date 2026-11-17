import { registerJob } from "../../core/queue/queue"
import { registerDsrHandler } from "../gdpr/registry"
import { DEADLINE_JOB, runDeadlineJob } from "./alerts"
import { shiftReportsDsrHandler } from "./dsr"

export { shiftReportRoutes } from "./routes"
export { shiftReportsDsrHandler } from "./dsr"
export { getReport, loadReportCtx, reportScopeWhere, ReportNotFound, type ReportCtx, type ReportRow } from "./scope"
export { reportDtos, stateOf, versionDtos } from "./view"
export { openReport, saveDraft, currentItem } from "./draft"
export { submitReport } from "./submit"
export { reviewReport } from "./review"
export { DEADLINE_JOB, runDeadlineJob } from "./alerts"
export { inboxPage, buildInboxQuery } from "./inbox"
export { reportTemplateFor, templatesInScope, loadTemplate } from "./template"
export type { ReportDto, ReportItemDto } from "./dto"

/** Registers the shift-reports DSR handler (FR-M0-18, ruling F22) and the `shift-reports.deadline` job (worker.ts, tests). Safe to call again. */
export function registerShiftReports(): void {
  registerDsrHandler("shift-reports", shiftReportsDsrHandler)
  registerJob(DEADLINE_JOB, runDeadlineJob)
}
