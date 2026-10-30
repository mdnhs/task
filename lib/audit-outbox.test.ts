import { beforeEach, describe, expect, it } from "vitest"

import { auditOutbox } from "./audit-outbox"

describe("audit outbox", () => {
  beforeEach(() => auditOutbox.reset())
  it("keeps events per tenant, once per key", () => {
    const e = { key: "k1", tenantId: "t1", at: "2026-10-20T09:00:00", actor: "A", actorRole: "Owner", action: "purge", recordType: "Task", recordRef: "TSK-1", sensitive: true, meta: {} }
    auditOutbox.push(e)
    auditOutbox.push(e)
    auditOutbox.push({ ...e, key: "k2", tenantId: "t2" })
    expect(auditOutbox.list("t1")).toHaveLength(1)
    expect(auditOutbox.list("t2").map((x) => x.key)).toEqual(["k2"])
  })
})
