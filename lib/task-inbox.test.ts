import { afterEach, describe, expect, it } from "vitest"

import { taskInbox, type IncomingTask } from "./task-inbox"

const t = (ref: string, tenantId: string): IncomingTask => ({
  tenantId, ref, title: ref, description: "", dept: "Cleaning", assignee: "A", due: "2026-10-22", creator: "B", at: "2026-10-20T09:00:00", source: "WhatsApp",
})

describe("taskInbox", () => {
  afterEach(() => taskInbox.reset())

  it("lists and tracks refs per tenant", () => {
    taskInbox.push(t("TSK-1", "t1"))
    taskInbox.push(t("TSK-2", "t2"))
    taskInbox.noteRefs("t1", ["TSK-9"])
    expect(taskInbox.list("t1").map((x) => x.ref)).toEqual(["TSK-1"])
    expect(taskInbox.list("t2").map((x) => x.ref)).toEqual(["TSK-2"])
    expect(taskInbox.knownRefs("t1").sort()).toEqual(["TSK-1", "TSK-9"])
    expect(taskInbox.knownRefs("t2")).toEqual(["TSK-2"])
    expect(taskInbox.knownRefs("t3")).toEqual([])
  })
})
