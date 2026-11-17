import { beforeEach, describe, expect, it, vi } from "vitest"

const session = vi.hoisted(() => ({ allowed: [] as string[] }))
// B6 T6.3 (K1): getShiftState takes the session's entitlements as an argument (it never asks the API itself)
const ent = () => ({ entitlements: { planId: "p", allowed: session.allowed, modules: {}, assistant: "M2" } })

import { getBaseShiftState, getShiftState } from "./shifts-data"

describe("getShiftState entitlement guard", () => {
  beforeEach(() => {
    session.allowed = []
  })
  it("returns the stored state when the tenant lacks M1A", async () => {
    expect(await getShiftState(ent())).toEqual(await getBaseShiftState())
  })
  it("overlays published roster shifts when the tenant has M1A", async () => {
    session.allowed = ["M1A"]
    const base = await getBaseShiftState()
    const out = await getShiftState(ent())
    expect(out.patterns.length).toBeGreaterThan(base.patterns.length)
    expect(out.patterns.some((p) => p.id.startsWith("rs-"))).toBe(true)
  })
})
