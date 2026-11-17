import { TaskBoard, loadBoard, loadProjects, taskScreenData, viewerOf } from "@/features/tasks"
import { AccessRestricted } from "@/features/shell"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { canWrite, requireMfaOk } from "@/lib/session"

// The board is the API's (GET /v1/tasks/board): one page per column with its own cursor, scope applied by the server.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireMfaOk()
  if (!can(session.role, "tasks")) return <AccessRestricted moduleLabel="Tasks" />
  const sp = await searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ""
  const [{ api, people }, org] = await Promise.all([taskScreenData(), getOrg()])
  const projects = await loadProjects(api)
  const project = projects.some((p) => p.id === one(sp.project)) ? one(sp.project) : "all"
  const assignee = people.some((p) => p.id === one(sp.assignee)) ? one(sp.assignee) : "all"
  const q = one(sp.q).slice(0, 100)
  const columns = await loadBoard(api, { ...(project !== "all" ? { project } : {}), ...(assignee !== "all" ? { assignee } : {}), ...(q.trim() ? { q: q.trim() } : {}) })
  const canEdit = canWrite(session, "tasks")
  const v = viewerOf(session)
  return (
    <TaskBoard
      key={`${project}|${assignee}|${q}`}
      columns={columns}
      people={people}
      projects={projects}
      today={org.today}
      nowAt={org.nowAt}
      tzLabel={org.tzLabel}
      staff={session.role.home === "staff"}
      canEdit={canEdit}
      actor={canEdit && v.manager ? "reviewer" : "assignee"}
      me={v.name}
      initialFilters={{ q, project, assignee }}
    />
  )
}
