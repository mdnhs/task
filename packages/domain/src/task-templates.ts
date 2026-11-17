import { normaliseRule, type EvidenceRule } from "./task-evidence"
import type { Task, TaskTemplate } from "./task-model"
import { addDays } from "./task-recurrence"

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
  evidenceRule: EvidenceRule
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
    evidenceRule: { ...t.evidenceRule, types: [...t.evidenceRule.types] },
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
    evidenceRule: normaliseRule(f.evidenceRule),
    dueOffset: Math.max(0, gap),
    dueTime: f.dueTime || "17:00",
  }
}
