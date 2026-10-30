// /tasks/new (the New task page, formerly a dialog). Pure helpers for its search params, shared by the route and the triggers.

export const TASKS_HOME = "/tasks"

/** `?from=` back target: an internal path only (starts with "/", not "//" or "/\"), else the tasks list. */
export function safeFrom(v: unknown, fallback = TASKS_HOME): string {
  if (typeof v !== "string" || !v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return fallback
  if (v === "/tasks/new" || v.startsWith("/tasks/new?")) return fallback
  return v
}

export type NewTaskParams = {
  /** Where Cancel and (unless `openCreated`) Save return to. */
  from: string
  /** Preset assignee (a Person.id that is in the picker), or "" for none. */
  assignee: string
  /** After Save open the new task instead of returning to `from` (the dashboard trigger did this). */
  openCreated: boolean
}

type SP = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export function parseNewTaskParams(sp: SP, peopleIds: string[]): NewTaskParams {
  const assignee = one(sp.assignee) ?? ""
  return {
    from: safeFrom(one(sp.from)),
    assignee: peopleIds.includes(assignee) ? assignee : "",
    openCreated: one(sp.then) === "task",
  }
}

/** Link to the New task page. `from` defaults to the tasks list (then it is left out of the URL). */
export function newTaskHref(opts: { from?: string; assignee?: string; openCreated?: boolean } = {}): string {
  const q = new URLSearchParams()
  const from = safeFrom(opts.from)
  if (from !== TASKS_HOME) q.set("from", from)
  if (opts.assignee) q.set("assignee", opts.assignee)
  if (opts.openCreated) q.set("then", "task")
  const qs = q.toString()
  return qs ? `/tasks/new?${qs}` : "/tasks/new"
}
