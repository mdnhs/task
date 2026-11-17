import type { TemplateSection } from "@opsdesk/domain/shift-report"
import type { TenantTx } from "../../db/tenant-tx"
import { defaultReportTemplate } from "../tenants"

/**
 * The report template of a shift's team (FR-M1-25). T5.2 reads the tenant-independent DEFAULT, which is data (onboarding-defaults.json `reportTemplate`, ruling F13), never
 * a literal in code. T5.3 adds the per-team store behind this one function (same signature), so submit and validation do not change.
 */
export async function reportTemplateFor(tx: TenantTx, tenantId: string, teamId: string): Promise<TemplateSection[]> {
  void tx; void tenantId; void teamId // the per-team store (T5.3) will read them
  return defaultReportTemplate()
}
