import { getData } from "@/lib/data"
import type { Session } from "@/lib/session"
import { ME_ID, getPeople } from "@/lib/people"
import type { Report, TemplateSection } from "./types"

export async function getReports() {
  const [{ sections }, { reports }, people] = await Promise.all([
    getData<{ sections: TemplateSection[] }>("reports/template.json"),
    getData<{ reports: Report[] }>("reports/reports.json"),
    getPeople(),
  ])
  return { template: sections, reports, people }
}

/**
 * The one place that decides what the reports store is seeded with (Task 10's /daily-reports/[id] reuses it, so the same
 * seed + scopeKey keeps local edits). Staff roles only get the reports they own; they act as "me" (mock).
 */
export async function getReportSeed(session: Session) {
  const { template, reports, people } = await getReports()
  const staff = session.role.home === "staff"
  return {
    template,
    people,
    staff,
    seed: staff ? reports.filter((r) => r.owner === ME_ID) : reports,
    scopeKey: `${session.tenant.id}:${staff ? ME_ID : "all"}`,
  }
}
