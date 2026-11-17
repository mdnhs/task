import { registerDsrHandler } from "../gdpr/registry"
import { shiftReportsDsrHandler } from "./dsr"

export { shiftReportRoutes } from "./routes"
export { shiftReportsDsrHandler } from "./dsr"
export { getReport, loadReportCtx, reportScopeWhere, ReportNotFound, type ReportCtx, type ReportRow } from "./scope"
export { reportDtos, stateOf, versionDtos } from "./view"
export { openReport, saveDraft, currentItem } from "./draft"
export { submitReport } from "./submit"
export type { ReportDto, ReportItemDto } from "./dto"

/** Registers the shift-reports DSR handler (worker.ts, tests; FR-M0-18, ruling F22). Safe to call again. */
export function registerShiftReports(): void {
  registerDsrHandler("shift-reports", shiftReportsDsrHandler)
}
