import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

// Bugs 2 and 3: the banner names the proposer (the proposal holds a user id) and dates read as "Sun 22 Nov, 6:22 PM", never raw ISO.
const src = readFileSync(join(process.cwd(), "features/tasks/components/task-detail.tsx"), "utf8")

describe("date-proposal banner", () => {
  it("shows the proposer's name, not task.proposal.by", () => {
    expect(src).toContain("{name(task.proposal.by)} proposes new dates")
    expect(src).not.toMatch(/\{task\.proposal\.by\}/)
  })
  it("formats the proposed dates with the shared date-time helper", () => {
    expect(src).toContain("formatDateTime(task.proposal.start)")
    expect(src).toContain("formatDateTime(task.proposal.due)")
    expect(src).not.toContain("task.proposal.due.slice")
  })
  it("passes the viewer id (not the name) as the proposer on the optimistic path", () => {
    expect(src).toContain("proposeDates(t, p, me, now, meId)")
  })
})
