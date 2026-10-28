import { describe, expect, it } from "vitest"
import { expiryLabel } from "./expiry"

const today = "2026-10-20T09:00:00"
describe("expiryLabel", () => {
  it("counts days ahead", () => {
    expect(expiryLabel("2026-11-01", today)).toBe("in 12 days")
    expect(expiryLabel("2026-10-21", today)).toBe("in 1 day")
  })
  it("handles today, past and none", () => {
    expect(expiryLabel("2026-10-20", today)).toBe("today")
    expect(expiryLabel("2026-10-09", today)).toBe("11 days ago")
    expect(expiryLabel(null, today)).toBe("No expiry")
  })
})

import { statusAfterConfirm } from "./expiry"
describe("statusAfterConfirm", () => {
  it("maps expiry to a status", () => {
    expect(statusAfterConfirm("2027-05-20", today)).toBe("valid")
    expect(statusAfterConfirm("2026-12-02", today)).toBe("expiring")
    expect(statusAfterConfirm("2026-10-01", today)).toBe("expired")
  })
})
