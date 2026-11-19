import { describe, expect, it } from "vitest"
import { canClaim, exchangeActions, openExchanges } from "./exchange"
import type { ApiExchange, ExchangeStatus, WeekAccess } from "./types"

const act = (level: WeekAccess["level"], weekStatus: "draft" | "published", delegated = false, status: ExchangeStatus = "requested", expired = false) => exchangeActions({ level, weekStatus, delegated, status, expired })

describe("approver matrix (R8-11): the buttons the roster page offers", () => {
  it("office decides everywhere, drafts and published, delegated or not; it never needs to recommend", () => {
    for (const weekStatus of ["draft", "published"] as const) expect(act("office", weekStatus)).toEqual({ approve: true, reject: true, recommend: false })
  })
  it("a supervisor decides on a draft week; on a published week only where the location delegates; otherwise they recommend", () => {
    expect(act("supervisor", "draft")).toEqual({ approve: true, reject: true, recommend: false })
    expect(act("supervisor", "published", false)).toEqual({ approve: false, reject: false, recommend: true })
    expect(act("supervisor", "published", true)).toEqual({ approve: true, reject: true, recommend: false })
  })
  it("a recommended exchange is not recommended again; staff and no-level get no buttons", () => {
    expect(act("supervisor", "published", false, "recommended")).toEqual({ approve: false, reject: false, recommend: false })
    expect(act("office", "published", false, "recommended").approve).toBe(true)
    expect(act(null, "draft")).toEqual({ approve: false, reject: false, recommend: false })
    expect(act(null, "published", true)).toEqual({ approve: false, reject: false, recommend: false })
  })
  it("I1: a party to the exchange is offered nothing, whatever their level (403 self_decision)", () => {
    for (const level of ["office", "supervisor"] as const) for (const weekStatus of ["draft", "published"] as const) expect(exchangeActions({ level, weekStatus, delegated: true, status: "requested", expired: false, party: true })).toEqual({ approve: false, reject: false, recommend: false })
    expect(exchangeActions({ level: "supervisor", weekStatus: "published", delegated: false, status: "requested", expired: false, party: true }).recommend).toBe(false)
  })
  it("decided or cancelled offer nothing; an expired one can be rejected, not approved", () => {
    for (const s of ["approved", "rejected", "cancelled"] as const) expect(act("office", "draft", false, s)).toEqual({ approve: false, reject: false, recommend: false })
    expect(act("office", "published", false, "requested", true)).toEqual({ approve: false, reject: true, recommend: false })
  })
  it("an open shift is claimable on a published week, still to come", () => {
    expect(canClaim("published", null, "2026-11-10", "2026-11-04T09:00:00")).toBe(true)
    expect(canClaim("draft", null, "2026-11-10", "2026-11-04T09:00:00")).toBe(false)
    expect(canClaim("published", "u1", "2026-11-10", "2026-11-04T09:00:00")).toBe(false)
    expect(canClaim("published", null, "2026-11-03", "2026-11-04T09:00:00")).toBe(false)
  })
  it("picks the open claims or swaps of one shift", () => {
    const ex = (id: string, kind: "claim" | "swap", status: ExchangeStatus, shiftId = "s1"): ApiExchange => ({ id, kind, shiftId, weekId: "w", locationId: "l", date: "2026-11-10", start: "08:00", end: "16:00", fromUserId: "u", toUserId: null, status, note: "", decidedBy: null, decidedAt: null, createdAt: "", expired: false })
    const list = [ex("a", "claim", "requested"), ex("b", "claim", "approved"), ex("c", "swap", "recommended"), ex("d", "claim", "requested", "s2")]
    expect(openExchanges(list, "s1", "claim").map((x) => x.id)).toEqual(["a"])
    expect(openExchanges(list, "s1", "swap").map((x) => x.id)).toEqual(["c"])
  })
})
