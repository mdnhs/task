import { describe, expect, it } from "vitest"

import { applyTemplate, describeOffset, nextTemplateId, templateFromForm } from "./templates"
import { NO_EVIDENCE, legacyRule } from "@/lib/task-evidence"
import type { TaskTemplate } from "./types"

const t: TaskTemplate = { id: "TPL-2", name: "N", title: "T", description: "D", dept: "Cleaning", priority: 3, tags: ["a", "b"], evidenceRule: legacyRule(true), dueOffset: 2, dueTime: "12:00" }

describe("templates", () => {
  it("fills the form, due = start + offset", () => {
    expect(applyTemplate(t, "2026-10-30")).toMatchObject({ title: "T", dept: "Cleaning", assignee: "", priority: "3", dueDate: "2026-11-01", dueTime: "12:00", tags: "a, b", evidenceRule: legacyRule(true) })
  })
  it("saves a form as a template with the start-to-due gap", () => {
    const f = { title: " Check ", description: "d", dept: "Security", assignee: "p1", priority: "1", start: "2026-10-20", dueDate: "2026-10-23", dueTime: "", evidenceRule: NO_EVIDENCE, tags: "x, ,y" }
    expect(templateFromForm(" Name ", f, "TPL-4")).toEqual({ id: "TPL-4", name: "Name", title: "Check", description: "d", dept: "Security", assignee: "p1", priority: 1, tags: ["x", "y"], evidenceRule: NO_EVIDENCE, dueOffset: 3, dueTime: "17:00" })
  })
  it("numbers ids and describes offsets", () => {
    expect(nextTemplateId([t, { ...t, id: "TPL-7" }])).toBe("TPL-8")
    expect(nextTemplateId([])).toBe("TPL-1")
    expect(describeOffset({ dueOffset: 0, dueTime: "17:00" })).toBe("Same day 17:00")
    expect(describeOffset({ dueOffset: 1, dueTime: "09:00" })).toBe("+1 day 09:00")
  })
})
