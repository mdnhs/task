import { describe, expect, it } from "vitest"

import { legacyRule } from "@/lib/task-evidence"
import type { IncomingTask, TaskUpdate } from "@/lib/task-inbox"
import { applyTaskUpdates, mergeIncoming } from "./store"
import type { Person, Task } from "./types"

const people = [{ id: "p1", name: "Daniel Okafor" }, { id: "p2", name: "Grace Lee" }] as Person[]
const wa = (ref: string, assignee: string, tenantId = "t1"): IncomingTask => ({
  tenantId, ref, title: `Task ${ref}`, description: "", dept: "Cleaning", assignee, due: "2026-10-22",
  creator: "Grace Lee", at: "2026-10-20T09:00:00", source: "WhatsApp",
})

describe("mergeIncoming", () => {
  it("adds WhatsApp tasks once, newest first, mapping names to person ids", () => {
    const out = mergeIncoming([], [wa("TSK-50", "Daniel Okafor"), wa("TSK-51", "Grace Lee")], people, "t1:all")
    expect(out.map((t) => t.ref)).toEqual(["TSK-51", "TSK-50"])
    expect(out[1]).toMatchObject({ assignee: "p1", creator: "p2", status: "not_started", due: "2026-10-22T17:00:00" })
    expect(mergeIncoming(out, [wa("TSK-50", "Daniel Okafor")], people, "t1:all")).toBe(out)
  })

  it("a staff scope only takes tasks assigned to that person", () => {
    const out = mergeIncoming([] as Task[], [wa("TSK-50", "Daniel Okafor"), wa("TSK-51", "Grace Lee")], people, "t1:p1")
    expect(out.map((t) => t.ref)).toEqual(["TSK-50"])
  })

  it("only takes the scope's tenant tasks", () => {
    const out = mergeIncoming([] as Task[], [wa("TSK-50", "Daniel Okafor", "t1"), wa("TSK-51", "Grace Lee", "t2")], people, "t2:all")
    expect(out.map((t) => t.ref)).toEqual(["TSK-51"])
    expect(mergeIncoming([] as Task[], [wa("TSK-50", "Daniel Okafor", "t1")], people, "t2:all")).toEqual([])
  })
})

const task = (ref: string, status: Task["status"], evidenceRequired = false): Task => ({
  ref, title: ref, description: "", dept: "Security", assignee: "p1", creator: "p2", priority: 2, start: "2026-10-19T09:00:00", due: "2026-10-21T12:00:00",
  status, evidenceRule: legacyRule(evidenceRequired), tags: [], notes: [], evidence: [], timeline: [],
})
const up = (ref: string, itemStatus: TaskUpdate["itemStatus"], minutes = 30, id = `r1:v1:${ref}`, tenantId = "t1"): TaskUpdate => ({
  id, tenantId, ref, itemStatus, minutes, note: "", at: "2026-10-20T16:10", by: "Daniel Okafor", source: "shift report Day patrol, 2026-10-20",
})

describe("applyTaskUpdates (FR-M1-26)", () => {
  it("sets status, logs time and a timeline line once", () => {
    const list = [task("T1", "in_progress"), task("T2", "not_started", true), task("T3", "in_progress")]
    const out = applyTaskUpdates(list, [up("T1", "done"), up("T2", "done", 15), up("T3", "blocked", 0)], "t1:all")
    expect(out.map((t) => t.status)).toEqual(["completed", "submitted", "blocked"])
    expect(out[0].completedAt).toBe("2026-10-20T16:10:00")
    expect(out[1].submittedAt).toBe("2026-10-20T16:10:00")
    expect(out[0].timeEntries).toEqual([{ id: "r1:v1:T1", at: "2026-10-20T16:10", by: "Daniel Okafor", minutes: 30, note: "", source: "shift report Day patrol, 2026-10-20" }])
    expect(out[0].timeline.at(-1)?.text).toBe("Status set to Completed, 30 min logged from the shift report Day patrol, 2026-10-20")
    expect(out[2].timeline.at(-1)?.text).toBe("Status set to Blocked from the shift report Day patrol, 2026-10-20")
    // idempotent
    expect(applyTaskUpdates(out, [up("T1", "done"), up("T2", "done", 15), up("T3", "blocked", 0)], "t1:all")).toBe(out)
  })

  it("never moves a finished task backwards and ignores other tenants", () => {
    const list = [task("T1", "completed")]
    const out = applyTaskUpdates(list, [up("T1", "in_progress", 20)], "t1:p1")
    expect(out[0].status).toBe("completed")
    expect(out[0].timeEntries?.[0].minutes).toBe(20)
    expect(applyTaskUpdates(list, [up("T1", "done", 20, "x", "t2")], "t1:all")).toBe(list)
  })

  it("Today card: done completes without a time entry, snooze only logs a line; both once", () => {
    const list = [task("T1", "in_progress"), task("T2", "not_started")]
    const ups: TaskUpdate[] = [
      { ...up("T1", "done", 0, "today:2026-10-20:T1:done"), source: "Today card" },
      { ...up("T2", "done", 0, "today:2026-10-20:T2:snooze"), source: "Today card", snooze: true },
    ]
    const out = applyTaskUpdates(list, ups, "t1:p1")
    expect(out.map((t) => t.status)).toEqual(["completed", "not_started"])
    expect(out[0].timeEntries).toBeUndefined()
    expect(out[0].timeline.at(-1)).toMatchObject({ text: "Status set to Completed from the Today card", updateId: "today:2026-10-20:T1:done" })
    expect(out[1].timeline.at(-1)?.text).toBe("Snoozed for today from the Today card")
    expect(applyTaskUpdates(out, ups, "t1:p1")).toBe(out)
  })
})
