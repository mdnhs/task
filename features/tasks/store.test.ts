import { describe, expect, it } from "vitest"

import type { IncomingTask } from "@/lib/task-inbox"
import { mergeIncoming } from "./store"
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
