import { registerJob } from "../../core/queue/queue"
import { registerDsrHandler } from "../gdpr/registry"
import { DEADLINE_JOB, runDeadlineJob } from "./alerts"
import { EXPORT_JOB, EXPORT_SWEEP_JOB, runExportJob, runExportSweep } from "./exports"
import { shiftReportsDsrHandler } from "./dsr"

export { shiftReportRoutes } from "./routes"
export { shiftReportsDsrHandler } from "./dsr"
export { getReport, loadReportCtx, reportScopeWhere, ReportNotFound, type ReportCtx, type ReportRow } from "./scope"
export { reportDtos, stateOf, versionDtos } from "./view"
export { openReport, saveDraft, currentItem } from "./draft"
export { submitReport } from "./submit"
export { reviewReport } from "./review"
export { DEADLINE_JOB, runDeadlineJob } from "./alerts"
export { EXPORT_JOB, EXPORT_SWEEP_JOB, exportFileId, runExportJob, runExportSweep } from "./exports"
export { inboxPage, buildInboxQuery, inboxRange, virtualRows, type InboxFilter } from "./inbox"
export { reportTemplateFor, templatesInScope, loadTemplate } from "./template"
export type { ReportDto, ReportItemDto } from "./dto"

/** Registers the shift-reports DSR handler (FR-M0-18, ruling F22) and the `shift-reports.deadline`, `report.export` and `report.export-sweep` jobs (worker.ts, tests). Safe to call again. */
export function registerShiftReports(): void {
  registerDsrHandler("shift-reports", shiftReportsDsrHandler)
  registerJob(DEADLINE_JOB, runDeadlineJob)
  registerJob(EXPORT_JOB, runExportJob) // report exports (T5.5)
  registerJob(EXPORT_SWEEP_JOB, runExportSweep)
}
