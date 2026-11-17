import type { TaskTemplate } from "./types"

// Pure template helpers (FR-TASK-10): applyTemplate and templateFromForm live in @opsdesk/domain/task-templates (shared with the API).
export { applyTemplate, templateFromForm, type TemplateForm } from "@opsdesk/domain/task-templates"

export const nextTemplateId = (list: TaskTemplate[]) =>
  `TPL-${list.reduce((m, t) => Math.max(m, parseInt(t.id.replace(/\D/g, ""), 10) || 0), 0) + 1}`

/** "Same day 17:00", "+2 days 12:00". */
export const describeOffset = (t: Pick<TaskTemplate, "dueOffset" | "dueTime">) =>
  `${t.dueOffset === 0 ? "Same day" : `+${t.dueOffset} day${t.dueOffset === 1 ? "" : "s"}`} ${t.dueTime}`
