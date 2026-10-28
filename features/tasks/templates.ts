import { addDays } from "./recurrence"
import type { Task, TaskTemplate } from "./types"

// Pure template helpers (FR-TASK-10). Templates never hold tenant names in code: departments and people come from data.

export type TemplateForm = {
  title: string
  description: string
  dept: string
  assignee: string
  priority: string
  start: string
  dueDate: string
  dueTime: string
  evidenceRequired: boolean
  tags: string
}

/** The form fields a template fills. Dates: due = start + dueOffset days. */
export function applyTemplate(t: TaskTemplate, start: string): Partial<TemplateForm> {
  return {
    title: t.title,
    description: t.description,
    dept: t.dept,
    assignee: t.assignee ?? "",
    priority: String(t.priority),
    dueDate: addDays(start, t.dueOffset),
    dueTime: t.dueTime,
    evidenceRequired: t.evidenceRequired,
    tags: t.tags.join(", "),
  }
}

/** A template saved from the form. Offset is the gap between start and due date, never negative. */
export function templateFromForm(name: string, f: TemplateForm, id: string): TaskTemplate {
  const gap = f.start && f.dueDate ? Math.round((Date.parse(f.dueDate) - Date.parse(f.start)) / 86_400_000) : 0
  return {
    id,
    name: name.trim(),
    title: f.title.trim(),
    description: f.description.trim(),
    dept: f.dept,
    ...(f.assignee ? { assignee: f.assignee } : {}),
    priority: Number(f.priority) as Task["priority"],
    tags: f.tags.split(",").map((s) => s.trim()).filter(Boolean),
    evidenceRequired: f.evidenceRequired,
    dueOffset: Math.max(0, gap),
    dueTime: f.dueTime || "17:00",
  }
}

export const nextTemplateId = (list: TaskTemplate[]) =>
  `TPL-${list.reduce((m, t) => Math.max(m, parseInt(t.id.replace(/\D/g, ""), 10) || 0), 0) + 1}`

/** "Same day 17:00", "+2 days 12:00". */
export const describeOffset = (t: Pick<TaskTemplate, "dueOffset" | "dueTime">) =>
  `${t.dueOffset === 0 ? "Same day" : `+${t.dueOffset} day${t.dueOffset === 1 ? "" : "s"}`} ${t.dueTime}`
