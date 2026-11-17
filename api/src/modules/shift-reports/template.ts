import { and, eq, inArray, isNull } from "drizzle-orm"
import { BUILT_IN_SECTIONS, templateFor, type TemplateData, type TemplateSection } from "@opsdesk/domain/shift-report"
import { AppError } from "../../core/errors"
import { shiftAssignments, shiftPatterns, teamMembers, teams } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import type { Deps } from "../../deps"
import { putReportTemplate, readReportTemplate } from "../settings"
import { defaultReportTemplate } from "../tenants"
import type { ReportCtx } from "./scope"

/**
 * The report template (FR-M1-25) is the tenant setting `report_template`: validated `TemplateData` (departments, each a list of sections, each a list of fields). A department is
 * matched to a team BY NAME (the FE rule, `templateFor`); a team without its own entry gets the first department. Nothing set → the default sections, which are DATA
 * (onboarding-defaults.json `reportTemplate`, ruling F13), never a literal in code. It applies to NEW submissions only: submit reads the template in force when it runs.
 */

/** The field ids the report itself knows per built-in section (what `validateReport` looks at). A field id outside this set on a built-in section could never be required by anything. */
const BUILT_IN_FIELDS: Record<(typeof BUILT_IN_SECTIONS)[number], readonly string[]> = {
  tasks: ["time", "note"], summary: ["summary"], blockers: ["blockers"], unplanned: ["unplanned"], attachments: ["attachments"],
}

const invalid = (errors: { key: string; message: string }[]) => new AppError(422, "invalid_template", "Unprocessable Entity", { errors })

/** Structure and limits are zod's (400); this is what zod cannot say: unique ids and a built-in section whose fields are the report's own. 422 invalid_template with errors[{key,message}]. */
export function validateTemplate(data: TemplateData): void {
  const errors: { key: string; message: string }[] = []
  const depts = new Set<string>()
  data.departments.forEach((d, di) => {
    const dk = d.dept.trim().toLowerCase()
    if (depts.has(dk)) errors.push({ key: `departments.${di}.dept`, message: "Each department appears once" })
    depts.add(dk)
    const sectionIds = new Set<string>()
    d.sections.forEach((s, si) => {
      if (sectionIds.has(s.id)) errors.push({ key: `departments.${di}.sections.${si}.id`, message: "Section ids are unique within a department" })
      sectionIds.add(s.id)
      const fieldIds = new Set<string>()
      const known = (BUILT_IN_FIELDS as Record<string, readonly string[]>)[s.id]
      s.fields.forEach((f, fi) => {
        if (fieldIds.has(f.id)) errors.push({ key: `departments.${di}.sections.${si}.fields.${fi}.id`, message: "Field ids are unique within a section" })
        fieldIds.add(f.id)
        if (known && !known.includes(f.id)) errors.push({ key: `departments.${di}.sections.${si}.fields.${fi}.id`, message: `The built-in section "${s.id}" has only the fields: ${known.join(", ")}` })
      })
    })
  })
  if (errors.length) throw invalid(errors)
}

/** The stored template, or null when none was ever set (or the stored value is not a template: treated as unset rather than crashing a submit). */
export async function loadTemplate(tx: TenantTx, tenantId: string): Promise<TemplateData | null> {
  const v = (await readReportTemplate(tx, tenantId)) as Partial<TemplateData> | undefined
  return v && Array.isArray(v.departments) && v.departments.length > 0 ? (v as TemplateData) : null
}

/** The sections a team's report is validated against (FR-M1-25). */
export async function reportTemplateFor(tx: TenantTx, tenantId: string, teamId: string): Promise<TemplateSection[]> {
  const data = await loadTemplate(tx, tenantId)
  if (!data) return defaultReportTemplate()
  const [team] = await tx.select({ name: teams.name }).from(teams).where(and(eq(teams.id, teamId), eq(teams.tenantId, tenantId)))
  return templateFor(team?.name ?? "", data)
}

/**
 * GET /template: the templates of the TEAMS IN THE CALLER'S SCOPE (own → the teams they work or belong to; team manager → the same for me and my direct reports; all → every team, plus any
 * stored department that matches no team yet, so the editor can round-trip what it saved). A team with no entry of its own shows the template it would be validated against.
 */
export async function templatesInScope(tx: TenantTx, ctx: Pick<ReportCtx, "tenantId" | "access" | "reports" | "me">): Promise<{ custom: boolean; departments: TemplateData["departments"] }> {
  const data = await loadTemplate(tx, ctx.tenantId)
  const base: TemplateData = data ?? { departments: [{ dept: "", sections: defaultReportTemplate() }] }
  let names: string[]
  if (ctx.access.kind === "all") {
    names = (await tx.select({ name: teams.name }).from(teams).where(eq(teams.tenantId, ctx.tenantId))).map((t) => t.name)
  } else {
    const people = ctx.access.kind === "own" ? [ctx.access.personId] : [ctx.access.managerId, ...ctx.reports]
    const viaMembers = await tx.select({ id: teamMembers.teamId }).from(teamMembers).where(and(eq(teamMembers.tenantId, ctx.tenantId), inArray(teamMembers.userId, people)))
    const viaShifts = await tx
      .select({ id: shiftPatterns.teamId })
      .from(shiftAssignments)
      .innerJoin(shiftPatterns, and(eq(shiftPatterns.tenantId, shiftAssignments.tenantId), eq(shiftPatterns.id, shiftAssignments.patternId), isNull(shiftPatterns.archivedAt)))
      .where(and(eq(shiftAssignments.tenantId, ctx.tenantId), inArray(shiftAssignments.userId, people)))
    const ids = [...new Set([...viaMembers, ...viaShifts].map((r) => r.id))]
    names = ids.length ? (await tx.select({ name: teams.name }).from(teams).where(and(eq(teams.tenantId, ctx.tenantId), inArray(teams.id, ids)))).map((t) => t.name) : []
  }
  const out = new Map<string, TemplateSection[]>()
  for (const n of names) out.set(n, structuredClone(templateFor(n, base)))
  if (data && ctx.access.kind === "all") for (const d of data.departments) if (!out.has(d.dept)) out.set(d.dept, structuredClone(d.sections))
  return { custom: data !== null, departments: [...out].map(([dept, sections]) => ({ dept, sections })).sort((a, b) => a.dept.localeCompare(b.dept)) }
}

/** PUT /template: validate, then the settings module takes its locks, writes and audits. */
export async function saveTemplate(deps: Deps, tenantId: string, actorId: string, data: TemplateData): Promise<void> {
  validateTemplate(data)
  await putReportTemplate(deps, tenantId, actorId, { departments: data.departments.map((d) => ({ dept: d.dept.trim(), sections: d.sections })) })
}
