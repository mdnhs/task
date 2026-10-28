import { getData } from "@/lib/data"
import type { Session } from "@/lib/session"
import { ME_ID, getPeople } from "@/lib/people"
import type { Person, Task, TaskTemplate } from "./types"

export { ME_ID }

export async function getTasks() {
  const [{ tasks }, people] = await Promise.all([getData<{ tasks: Task[] }>("tasks/tasks.json"), getPeople()])
  return { tasks, people }
}

/**
 * The one place that decides what the tasks store is seeded with. Both /tasks and /tasks/[ref] use it, so the same
 * seed + scopeKey means navigating between list and detail keeps local edits. Staff roles only get their own tasks.
 */
export async function getTaskSeed(session: Session) {
  const { tasks, people } = await getTasks()
  const staff = session.role.home === "staff"
  return {
    all: tasks,
    people,
    staff,
    seed: staff ? tasks.filter((t) => t.assignee === ME_ID) : tasks,
    // Highest task number in the full seed, so new refs never collide with tasks a staff user cannot see.
    refFloor: tasks.reduce((m, t) => Math.max(m, parseInt(t.ref.replace(/\D/g, ""), 10) || 0), 0),
    scopeKey: `${session.tenant.id}:${staff ? ME_ID : "all"}`,
  }
}

/** Who a new task is "created by": staff roles act as "me" (mock); managers as the signed-in user from the shell. */
export function taskCreator(people: Person[], staff: boolean, userName: string) {
  const me = people.find((p) => p.id === ME_ID)
  const name = staff && me ? me.name : userName
  return { id: people.find((p) => p.name === name)?.id ?? name, name }
}

export async function getTemplates() {
  const { templates } = await getData<{ templates: TaskTemplate[] }>("tasks/templates.json")
  return templates
}
