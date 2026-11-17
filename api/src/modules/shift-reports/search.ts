import { and, eq } from "drizzle-orm"
import type { Context } from "hono"
import { subscribe } from "../../core/events"
import type { AppEnv } from "../../core/context"
import { loadRole } from "../../core/middleware/permission"
import { subjectUserId } from "../../core/middleware/principal"
import { shiftReports } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { indexDocument, removeDocument, type SearchScopes } from "../search/service"
import { directReports, peopleAccess } from "../teams"
import { searchText } from "../tasks/search"

/**
 * Reports in search (ruling D12/E4 audience tags, F21). A report is found by its SHIFT NAME and DATE, never by anything the member wrote: `{ entity: "report", module: "reports", title: "<shift name> <date>",
 * body: "", audience: ["u:<member>"] }`. The title is cleaned of Drive links (searchText) BEFORE it is stored, so a hit never carries one, whoever reads it. The audience is the report's member only, and the search
 * scope below turns the caller's report scope into the audience they may match: own → themself; a team manager → themself and their DIRECT reports; all → no row filter. So search can never show
 * a report the inbox would not (D5, one level). Indexed when a report is submitted, accepted or returned (a draft is virtual until then and nobody but its owner can open it); a report
 * whose member was erased drops out. Search never returns the id of a report outside the caller's scope.
 */
export async function indexReport(tx: TenantTx, tenantId: string, reportId: string, now: Date): Promise<void> {
  const [r] = await tx.select({ userId: shiftReports.userId, shiftName: shiftReports.shiftName, date: shiftReports.shiftDate }).from(shiftReports).where(and(eq(shiftReports.id, reportId), eq(shiftReports.tenantId, tenantId)))
  if (!r || !r.userId) return removeDocument(tx, tenantId, "report", reportId)
  await indexDocument(tx, { tenantId, entity: "report", entityId: reportId, module: "reports", title: searchText(`${r.shiftName} ${r.date}`), body: "", audience: [`u:${r.userId}`] }, now)
}

/** Registers the report indexers on the event bus (called from registerSearchIndexers). */
export function registerReportSearchIndexers(): void {
  for (const type of ["shift.report.submitted", "shift.report.accepted", "shift.report.returned"] as const) {
    try {
      subscribe(type, `search.${type.replace(/\./g, "-")}`, async (e, { tx }) => {
        const id = typeof e.payload.reportId === "string" ? e.payload.reportId : null
        if (id) await indexReport(tx, e.tenantId, id, e.occurredAt)
      })
    } catch (err) {
      if (!(err instanceof Error) || !err.message.startsWith("Duplicate event subscriber")) throw err
    }
  }
}

/** The audience a caller may match for the `reports` module (null = no row filter). "Me" is subjectUserId (the creator for an API key). No report access → an empty audience (no hit). */
export async function reportSearchScope(c: Context<AppEnv>, tx: TenantTx): Promise<SearchScopes> {
  const role = await loadRole(c)
  const me = subjectUserId(c)
  const access = await peopleAccess(tx, c.get("tenant")!.id, role, me)
  if (!access) return { reports: { audience: [] } }
  if (access.kind === "all") return { reports: null }
  if (access.kind === "own") return { reports: { audience: [`u:${access.personId}`] } }
  return { reports: { audience: [`u:${access.managerId}`, ...(await directReports(tx, access.managerId)).map((r) => `u:${r}`)] } }
}
