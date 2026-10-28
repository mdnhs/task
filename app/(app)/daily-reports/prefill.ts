import { getCandidates } from "@/features/recruitment"
import type { Report } from "@/features/reports"
import { getRosters } from "@/features/staff-rosters"
import { getTasks } from "@/features/tasks"
import type { Org } from "@/lib/org"
import { can } from "@/lib/permissions"
import { buildPrefill, type Prefill } from "@/lib/report-prefill"
import type { Session } from "@/lib/session"

// FR-REP-13. Features never import each other, so this route-level loader reads the linked records through each feature's
// barrel, only for modules the role may read, and maps them with the pure buildPrefill. Returns nothing unless the owner
// is about to fill in today's draft: other reports are never suggested into.
export async function loadPrefill(session: Session, org: Org, report: Report | undefined, meId: string): Promise<Prefill | undefined> {
  if (!report || report.owner !== meId || report.status !== "draft" || report.date !== org.today.slice(0, 10)) return undefined
  const role = session.role
  const [tasks, rosters, recruit] = await Promise.all([
    can(role, "tasks") ? getTasks() : undefined,
    can(role, "staff") ? getRosters(false) : undefined,
    can(role, "recruitment") ? getCandidates() : undefined,
  ])
  const prefill = buildPrefill({
    dept: report.dept,
    today: org.today,
    people: tasks?.people,
    tasks: tasks?.tasks,
    incidents: rosters?.incidents,
    gaps: rosters?.gaps,
    candidates: recruit?.candidates,
  })
  return prefill.sources.length ? prefill : undefined
}
