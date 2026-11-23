import { describe, expect, it } from "vitest"
import { readableProposalText } from "./proposal-text"

describe("proposal history text", () => {
  it("rewrites legacy raw ISO dates into readable ones", () => {
    expect(readableProposalText("Proposed new dates 2026-11-21T09:00:00 to 2026-11-22T18:22: Parts late")).toBe("Proposed new dates Sat 21 Nov, 9:00 AM to Sun 22 Nov, 6:22 PM: Parts late")
  })
  it("leaves already readable and unrelated text alone", () => {
    const ok = "Proposed new dates Sat 21 Nov, 9:00 AM to Sun 22 Nov, 5:00 PM: x"
    expect(readableProposalText(ok)).toBe(ok)
    expect(readableProposalText("Rescheduled")).toBe("Rescheduled")
  })
})
