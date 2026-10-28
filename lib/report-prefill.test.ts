import { describe, expect, it } from "vitest"
import { buildPrefill } from "./report-prefill"

const today = "2026-10-20T09:00:00"
const people = [{ id: "p1", name: "Daniel Okafor" }]
const task = (o: Partial<Parameters<typeof buildPrefill>[0]["tasks"] extends (infer T)[] | undefined ? T : never>) => ({
  title: "T", dept: "Security", assignee: "p1", due: "2026-10-19T17:00:00", status: "in_progress", ...o,
})

describe("buildPrefill", () => {
  it("returns nothing without sources", () => {
    expect(buildPrefill({ dept: "Security", today })).toEqual({ sources: [], fields: {} })
  })

  it("lists open tasks due today or earlier for the department", () => {
    const p = buildPrefill({
      dept: "Security",
      today,
      people,
      tasks: [
        task({ title: "Overdue", overdue: { reason: "No access", nextAction: "Call client" } }),
        task({ title: "Due today", due: "2026-10-20T17:00:00" }),
        task({ title: "Later", due: "2026-10-25T17:00:00" }),
        task({ title: "Done", status: "completed" }),
        task({ title: "Other dept", dept: "Cleaning" }),
      ],
    })
    const f = p.fields["outstanding.tasks-not-completed"]
    expect(f.entries.map((e) => e.cells?.Task)).toEqual(["Overdue", "Due today"])
    expect(f.entries[0].cells?.Owner).toBe("Daniel Okafor")
    expect(p.fields["outstanding.reason"].entries[0].text).toBe("Overdue: No access")
    expect(p.fields["outstanding.action-required"].state).toBe("action_required")
    expect(p.sources).toEqual(["Today's tasks"])
  })

  it("suggests no issues when nothing is open", () => {
    const p = buildPrefill({ dept: "Security", today, tasks: [task({ status: "completed" })] })
    expect(p.fields["outstanding.tasks-not-completed"]).toMatchObject({ state: "no_issues", entries: [] })
  })

  it("maps today's incidents and roster gaps", () => {
    const inc = (o: object) => ({ type: "callout", staff: "A", dept: "Security", shift: "18:00", cover: null, status: "open", action: "x", reportedAt: "2026-10-20T13:00:00", ...o })
    const p = buildPrefill({
      dept: "Security",
      today,
      incidents: [inc({ cover: "B" }), inc({ type: "noshow" }), inc({ reportedAt: "2026-10-19T10:00:00" }), inc({ dept: "Cleaning" })],
      gaps: [
        { when: "today", time: "07:00", site: "S", role: "R", dept: "Security", coverage: "uncovered" },
        { when: "today", time: "08:00", site: "S", role: "R", dept: "Security", coverage: "covered" },
        { when: "tomorrow", time: "09:00", site: "S", role: "R", dept: "Security", coverage: "partial" },
      ],
    })
    expect(p.fields["staff.call-outs"].entries).toHaveLength(1)
    expect(p.fields["staff.no-shows"].entries).toHaveLength(1)
    expect(p.fields["staff.cover-arranged"].entries[0].text).toContain("B covering")
    expect(p.fields["rosters.todays-issues"].entries).toHaveLength(1)
    expect(p.fields["rosters.tomorrows-cover"].entries[0].text).toContain("partly covered")
    expect(p.fields["rosters.next-weeks-gaps"].state).toBe("no_issues")
    expect(p.sources).toEqual(["Staff and rosters"])
  })

  it("counts recruitment events of the day", () => {
    const h = (action: string, at = "2026-10-20T10:00:00") => ({ at, action })
    const p = buildPrefill({
      dept: "Security",
      today,
      candidates: [
        { dept: "Security", history: [h("Moved to Reviewed"), h("Moved to Contacted")] },
        { dept: "Security", history: [h("Moved to Reviewed"), h("Moved to Reviewed", "2026-10-19T10:00:00")] },
        { dept: "Cleaning", history: [h("Moved to Reviewed")] },
      ],
    })
    expect(p.fields["recruitment.applications-reviewed"].entries[0].text).toBe("2")
    expect(p.fields["recruitment.candidates-contacted"].entries[0].text).toBe("1")
    expect(p.fields["recruitment.new-starters"].state).toBe("no_issues")
  })
})
