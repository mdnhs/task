import { beforeEach, describe, expect, it } from "vitest"

import { reactivateTenant, suspendTenant } from "../../logic"
import { applyPatch } from "../../patches"
import { auditOutbox, auditStore, dataRequestOutbox, subEventOutbox, tenantPatchStore } from "../../store"
import type { PlatformTenant, TenantStatus } from "../../types"
import { commitTenant, type T360Ctx } from "./live"

// Review Focus 5 through the real write path (SuspendDialog → commitTenant): the patch store, the audit outbox and
// the subscription-event outbox, not data the test builds itself.

const ctx: T360Ctx = { operator: { name: "Aoife Brennan", role: "owner" }, today: "2026-10-20T09:00:00", tzLabel: "Irish time" }
const WHY_S = "Repeated failed payments"
const WHY_R = "Customer paid by transfer"

const tenant = (status: TenantStatus): PlatformTenant => ({
  id: "t3", name: "Millbrook", slug: "millbrook", subdomain: "millbrook.example.app", plan: "business", status, users: 3, storageGb: 1, messages: 1,
  transcriptionMinutes: 1, createdAt: "2026-01-01T10:00:00", contacts: [],
  billing: status === "trial" ? { paymentMethod: "None on file", trialEndsOn: "2026-11-01" } : { paymentMethod: "Card", renewsOn: "2026-11-01", graceEndsOn: "2026-10-27" },
})

function resetStores() {
  for (const s of [tenantPatchStore, auditOutbox, subEventOutbox, dataRequestOutbox, auditStore]) s.reset()
  tenantPatchStore.seed({})
  auditOutbox.seed([])
  subEventOutbox.seed([])
  dataRequestOutbox.seed([])
}

/** What SuspendDialog's confirm does, twice: suspend, then reactivate the live (patched) tenant. */
function roundTrip(start: PlatformTenant) {
  commitTenant(ctx, start, suspendTenant(start, "2026-10-20T09:00:00", WHY_S), { action: "tenant.suspended", detail: `Suspended: ${WHY_S}`, reason: WHY_S })
  const live = applyPatch(start, tenantPatchStore.get()![start.id])
  expect(live.status).toBe("suspended")
  commitTenant(ctx, live, reactivateTenant(live), { action: "tenant.reactivated", detail: `Reactivated: ${WHY_R}`, reason: WHY_R })
}

describe("Review Focus 5: suspend → reactivate through commitTenant", () => {
  beforeEach(resetStores)

  it.each(["active", "trial", "past_due"] as const)("restores %s exactly, with two audit lines and no SubEvent", (status) => {
    const start = tenant(status)
    roundTrip(start)
    expect(applyPatch(start, tenantPatchStore.get()![start.id])).toEqual(start)
    const lines = auditOutbox.get()!
    expect(lines.map((e) => e.action)).toEqual(["tenant.reactivated", "tenant.suspended"])
    expect(lines.map((e) => e.reason)).toEqual([WHY_R, WHY_S])
    expect(lines.every((e) => e.tenantId === "t3" && e.staffRole === "owner")).toBe(true)
    expect(lines[1].before).toMatchObject({ status })
    expect(lines[0].after).toMatchObject({ status, suspendedAt: null, suspendReason: null })
    expect(subEventOutbox.get()).toEqual([])
    expect(dataRequestOutbox.get()).toEqual([])
  })
})
