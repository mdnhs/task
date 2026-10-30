import { describe, expect, it } from "vitest"

import { legacyRule } from "@/lib/task-evidence"
import { matchesDue, matchesStatus, parseFilters } from "./filters"
import type { Task } from "./types"

const TODAY = "2026-10-20T09:00:00"
const task = (ref: string, over: Partial<Task> = {}): Task => ({
  ref, title: ref, description: "", dept: "Security", assignee: "p1", creator: "p2", priority: 2, start: "2026-10-19T09:00:00", due: "2026-10-20T17:00:00",
  status: "in_progress", evidenceRule: legacyRule(false), tags: [], notes: [], evidence: [], timeline: [], ...over,
})

describe("tasks list filters", () => {
  it("open + due today leaves done tasks out, so the list matches the Today card count", () => {
    const list = [task("A"), task("B", { status: "completed" }), task("C", { due: "2026-10-21T17:00:00" })]
    expect(list.filter((t) => matchesStatus(t, "open", TODAY) && matchesDue(t, "today", TODAY)).map((t) => t.ref)).toEqual(["A"])
  })
  it("review = submitted and not the reviewer's own task", () => {
    const list = [task("A", { status: "submitted" }), task("B", { status: "submitted", assignee: "p9" }), task("C", { status: "submitted", assignee: "p8", assignees: ["p9"] }), task("D")]
    expect(list.filter((t) => matchesStatus(t, "review", TODAY, "p9")).map((t) => t.ref)).toEqual(["A"])
    expect(list.filter((t) => matchesStatus(t, "review", TODAY)).map((t) => t.ref)).toEqual(["A", "B", "C"])
  })
  it("reads ?status=review", () => {
    expect(parseFilters({ status: "review" }).status).toBe("review")
    expect(parseFilters({ status: "bogus" }).status).toBe("all")
  })
})
