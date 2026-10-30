import { describe, expect, it } from "vitest"

import { NO_EVIDENCE } from "@/lib/task-evidence"
import { archiveDaysLeft, archivedTasks, assigneesOf, isArchiveExpired, knockOn, liveTasks, milestoneState, projectProgress, waitingOn, wouldCycle } from "./planning"
import type { Project, Task } from "./types"

const t = (ref: string, over: Partial<Task> = {}): Task => ({
  ref, title: ref, description: "", dept: "Security", assignee: "p", creator: "c", priority: 2,
  start: "2026-10-20T09:00:00", due: "2026-10-21T17:00:00", status: "not_started", evidenceRule: NO_EVIDENCE, tags: [],
  notes: [], evidence: [], timeline: [], ...over,
})

describe("dependencies (FR-M1-14)", () => {
  const a = t("A")
  const b = t("B", { dependsOn: ["A"], start: "2026-10-22T09:00:00", due: "2026-10-23T12:00:00" })
  const c = t("C", { dependsOn: ["B"], start: "2026-10-24T09:00:00", due: "2026-10-24T17:00:00" })
  it("pushes dependants down the chain by whole days", () => {
    const moves = knockOn([a, b, c], "A", { start: "2026-10-20T09:00:00", due: "2026-10-23T17:00:00" })
    expect(moves.map((m) => [m.ref, m.to.start, m.to.due])).toEqual([
      ["B", "2026-10-24T09:00:00", "2026-10-25T12:00:00"],
      ["C", "2026-10-26T09:00:00", "2026-10-26T17:00:00"],
    ])
  })
  it("moves nothing when there is room, and skips closed dependants", () => {
    expect(knockOn([a, b, c], "A", { start: "2026-10-20T09:00:00", due: "2026-10-21T12:00:00" })).toEqual([])
    expect(knockOn([a, { ...b, status: "completed" }], "A", { start: a.start, due: "2026-10-30T09:00:00" })).toEqual([])
  })
  it("detects loops and open dependencies", () => {
    expect(wouldCycle([a, b, c], "A", "C")).toBe(true)
    expect(wouldCycle([a, b, c], "C", "A")).toBe(false)
    expect(wouldCycle([a], "A", "A")).toBe(true)
    expect(waitingOn([a, b], b).map((x) => x.ref)).toEqual(["A"])
    expect(waitingOn([{ ...a, status: "completed" }, b], b)).toEqual([])
  })
  it("lists every assignee once", () => expect(assigneesOf({ assignee: "p", assignees: ["q", "p"] })).toEqual(["p", "q"]))
})

describe("archive (FR-M1-13)", () => {
  it("counts down 30 days", () => {
    expect(archiveDaysLeft("2026-10-12T11:00:00", "2026-10-20T09:00:00")).toBe(23)
    expect(isArchiveExpired("2026-09-01T09:00:00", "2026-10-20T09:00:00")).toBe(true)
    expect(isArchiveExpired("2026-10-12T11:00:00", "2026-10-20T09:00:00")).toBe(false)
  })
  it("splits live and archived, hiding expired ones", () => {
    const list = [t("A"), t("B", { archivedAt: "2026-10-12T11:00:00" }), t("C", { archivedAt: "2026-09-01T09:00:00" })]
    expect(liveTasks(list).map((x) => x.ref)).toEqual(["A"])
    expect(archivedTasks(list, "2026-10-20T09:00:00").map((x) => x.ref)).toEqual(["B"])
  })
})

describe("projects (FR-M1-04)", () => {
  const p: Project = { id: "P", name: "P", dept: "Security", lead: "p", description: "", due: "2026-11-30", milestones: [{ id: "M", name: "M", due: "2026-10-19" }] }
  it("measures progress and milestone state", () => {
    const list = [t("A", { projectId: "P", milestoneId: "M", status: "completed" }), t("B", { projectId: "P", milestoneId: "M" }), t("X", { projectId: "P", status: "cancelled" })]
    expect(projectProgress(p, list)).toEqual({ done: 1, total: 2, pct: 50 })
    expect(milestoneState(p.milestones[0], list, "2026-10-20T09:00:00").state).toBe("late")
    expect(milestoneState(p.milestones[0], list.slice(0, 1), "2026-10-20T09:00:00").state).toBe("done")
  })
})
