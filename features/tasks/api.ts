import { getData } from "@/lib/data"
import { getDeviceContext } from "@/lib/device-session"
import { withholdDriveLinks } from "@/lib/devices"
import type { Session } from "@/lib/session"
import { ME_ID, getPeople } from "@/lib/people"
import { isAssigned } from "./planning"
import type { Person, Project, Task, TaskTemplate } from "./types"

export { ME_ID }

export async function getTasks() {
  const [{ tasks }, people] = await Promise.all([getData<{ tasks: Task[] }>("tasks/tasks.json"), getPeople()])
  return { tasks, people }
}

/**
 * The one place that decides what the tasks store is seeded with. Both /tasks and /tasks/[ref] use it, so the same
 * seed + scopeKey means navigating between list and detail keeps local edits. Staff roles only get their own tasks.
 * On a device without Drive access the Drive URLs are removed here, so they never reach the browser (FR-M1-52); the scope
 * key says so, which reseeds the store when the device changes.
 */
export async function getTaskSeed(session: Session) {
  const [{ tasks: raw, people }, { canDrive }] = await Promise.all([getTasks(), getDeviceContext(session)])
  const tasks = canDrive ? raw : withholdDriveLinks(raw)
  const staff = session.role.home === "staff"
  return {
    people,
    staff,
    seed: staff ? tasks.filter((t) => isAssigned(t, ME_ID)) : tasks,
    // Highest task number in the full seed, so new refs never collide with tasks a staff user cannot see.
    refFloor: tasks.reduce((m, t) => Math.max(m, parseInt(t.ref.replace(/\D/g, ""), 10) || 0), 0),
    scopeKey: `${session.tenant.id}:${staff ? ME_ID : "all"}${canDrive ? "" : ":nodrive"}`,
  }
}

/** Who a new task is "created by": staff roles act as "me" (mock); managers as the signed-in user from the shell. */
export function taskCreator(people: Person[], staff: boolean, userName: string) {
  const me = people.find((p) => p.id === ME_ID)
  const name = staff && me ? me.name : userName
  return { id: people.find((p) => p.name === name)?.id ?? name, name }
}

/** Projects with milestones (FR-M1-04). */
export async function getProjects() {
  const { projects } = await getData<{ projects: Project[] }>("tasks/projects.json")
  return projects
}

export async function getTemplates() {
  const { templates } = await getData<{ templates: TaskTemplate[] }>("tasks/templates.json")
  return templates
}

/**
 * Everything /tasks/new needs except its search params, so page.tsx and loading.tsx (which renders the page masked) load
 * the same thing. Staff roles can only assign to themselves; managers can save and delete templates.
 */
export async function getNewTaskData(session: Session, userName: string, departments: string[], today: string) {
  const [{ people, staff, seed, scopeKey, refFloor }, templates, projects] = await Promise.all([getTaskSeed(session), getTemplates(), getProjects()])
  return {
    seed,
    scopeKey,
    people,
    departments,
    today,
    refFloor,
    creator: taskCreator(people, staff, userName),
    templates,
    projects,
    onlyAssignee: staff ? ME_ID : undefined,
    canManageTemplates: session.role.home === "manager",
  }
}
