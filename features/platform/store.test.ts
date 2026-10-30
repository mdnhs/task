import { describe, expect, it } from "vitest"

import { auditOutbox, auditStore, dataRequestOutbox, dataRequestsStore, foldPending, subEventOutbox, subscriptionsStore, tenantPatchStore, tenantsStore } from "./store"
import type { AuditEntry, DataRequest, PlatformTenant, SubEvent } from "./types"

const line = (id: string, detail: string): AuditEntry => ({ id, at: "2026-10-30T10:00:00", actor: "Ana", action: "tenant.suspended", target: "Acme", detail })
const event: SubEvent = { id: "SUB-99", tenantId: "t1", at: "2026-10-30T10:00:00", kind: "upgrade", plan: "business", mrrDelta: 100 }
const request = { id: "DSR-99", tenantId: "t1", kind: "export", subject: "tenant", requestedBy: "Ana", requestedAt: "2026-10-30T10:00:00", dueAt: "2026-11-29T10:00:00", status: "received", note: "Export" } as DataRequest

// React StrictMode runs usePlatform's mount effect twice with the same closure; the fold must not add anything the second time.
describe("foldPending", () => {
  it("folds each outbox once, even when called twice", () => {
    auditStore.seed([line("PAU-1", "old")])
    subscriptionsStore.seed([])
    dataRequestsStore.seed([])
    tenantsStore.seed([{ id: "t1", status: "active" } as PlatformTenant])
    auditOutbox.set(() => [line("", "suspended")])
    subEventOutbox.set(() => [event])
    dataRequestOutbox.set(() => [request])
    tenantPatchStore.set(() => ({ t1: { status: "suspended" } }))

    foldPending()
    foldPending()

    expect(auditStore.get()!.map((e) => e.detail)).toEqual(["suspended", "old"])
    expect(new Set(auditStore.get()!.map((e) => e.id)).size).toBe(2)
    expect(subscriptionsStore.get()!.map((e) => e.id)).toEqual(["SUB-99"])
    expect(dataRequestsStore.get()!.map((r) => r.id)).toEqual(["DSR-99"])
    expect(tenantsStore.get()![0].status).toBe("suspended")
    expect(auditOutbox.get()).toEqual([])
    expect(subEventOutbox.get()).toEqual([])
    expect(dataRequestOutbox.get()).toEqual([])
    expect(tenantPatchStore.get()).toEqual({})
  })
})
