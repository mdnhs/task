import { and, eq } from "drizzle-orm"
import { shiftReportingPeople, shiftReportingTeams } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"

/**
 * End-of-shift reporting (FR-M1-21, Q5): effective reporting for a member on a shift = THEIR OWN override when one exists, else the default of the
 * SHIFT'S team, else off. The override is per person and applies to every shift whichever team it belongs to; the team default is read with the
 * team of the shift (a member on two teams follows each shift's own team). No row anywhere = off.
 */
export type ReportingMaps = { teams: Map<string, boolean>; people: Map<string, boolean> }

export async function loadReportingMaps(tx: TenantTx, tenantId: string): Promise<ReportingMaps> {
  const teams = await tx.select({ teamId: shiftReportingTeams.teamId, on: shiftReportingTeams.on }).from(shiftReportingTeams).where(eq(shiftReportingTeams.tenantId, tenantId))
  const people = await tx.select({ userId: shiftReportingPeople.userId, on: shiftReportingPeople.on }).from(shiftReportingPeople).where(eq(shiftReportingPeople.tenantId, tenantId))
  return { teams: new Map(teams.map((r) => [r.teamId, r.on])), people: new Map(people.map((r) => [r.userId, r.on])) }
}

/** The precedence, in memory (a batch of occurrences): override ?? team default ?? false. */
export const reportingFrom = (m: ReportingMaps, userId: string, teamId: string): boolean => m.people.get(userId) ?? m.teams.get(teamId) ?? false

/** override ?? team default ?? false, read from the database at this moment (one member, one shift team). */
export async function effectiveReporting(tx: TenantTx, tenantId: string, userId: string, teamId: string): Promise<boolean> {
  const [o] = await tx.select({ on: shiftReportingPeople.on }).from(shiftReportingPeople).where(and(eq(shiftReportingPeople.tenantId, tenantId), eq(shiftReportingPeople.userId, userId)))
  if (o) return o.on
  const [t] = await tx.select({ on: shiftReportingTeams.on }).from(shiftReportingTeams).where(and(eq(shiftReportingTeams.tenantId, tenantId), eq(shiftReportingTeams.teamId, teamId)))
  return t?.on ?? false
}
