import { describe, expect, it } from "vitest"

import { byStage, changeStage, moveCandidate, newCandidate, nextId, recruitmentCounts } from "./mutations"
import type { Candidate, Stage } from "./types"

const cand = (stage: Stage, over: Partial<Candidate> = {}): Candidate => ({
  id: "CND-1", name: "A", role: "r", dept: "Security", stage, lastContact: null, nextAction: "n", owner: "o", applied: "2026-10-01", history: [], ...over,
})
const AT = "2026-10-20T09:00:00"

describe("changeStage", () => {
  it("moves the stage, stamps last contact and appends history", () => {
    const c = changeStage(cand("applied"), "reviewed", "Priya", AT)
    expect(c.stage).toBe("reviewed")
    expect(c.lastContact).toBe(AT)
    expect(c.history).toEqual([{ at: AT, by: "Priya", action: "Moved to Reviewed", note: "From Applied" }])
  })
  it("is a no-op for the same stage", () => {
    const c = cand("offer")
    expect(changeStage(c, "offer", "P", AT)).toBe(c)
  })
})

describe("newCandidate / nextId", () => {
  it("starts at applied with a history entry", () => {
    const c = newCandidate({ name: " Zed ", role: "Cleaner", dept: "Cleaning", owner: "Grace", email: "z@x.co", phone: "1", nextAction: "" }, "CND-9", "Priya", AT)
    expect(c).toMatchObject({ name: "Zed", stage: "applied", nextAction: "Review application", applied: "2026-10-20" })
    expect(c.history[0].action).toBe("Candidate added")
  })
  it("never collides with existing ids", () => expect(nextId([cand("applied", { id: "CND-2026" })])).toBe("CND-2027"))
})

describe("recruitmentCounts", () => {
  it("counts the report figures from the pipeline", () => {
    const list = (["applied", "reviewed", "contacted", "interview", "offer", "starter", "rejected"] as Stage[]).map((s) => cand(s))
    expect(recruitmentCounts(list)).toEqual({ reviewed: 6, contacted: 4, interviews: 3, starters: 1, outstanding: 5 })
  })
  it("groups by stage", () => expect(byStage([cand("offer"), cand("offer")]).offer).toHaveLength(2))
})

describe("moveCandidate", () => {
  const a = cand("applied", { id: "A" }), b = cand("applied", { id: "B" }), c = cand("reviewed", { id: "C" })
  it("drops into another column: stage change with history, placed before the card dropped on", () => {
    const out = moveCandidate([a, b, c], "A", "reviewed", "C", "Priya", AT)
    expect(out.map((x) => x.id)).toEqual(["B", "A", "C"])
    expect(out[1].stage).toBe("reviewed")
    expect(out[1].history[0].action).toBe("Moved to Reviewed")
  })
  it("drops on an empty column or its body: appended", () => {
    const out = moveCandidate([a, b, c], "A", "offer", null, "Priya", AT)
    expect(out.map((x) => x.id)).toEqual(["B", "C", "A"])
    expect(out[2].stage).toBe("offer")
  })
  it("same column only reorders, with no history", () => {
    const out = moveCandidate([a, b, c], "A", "applied", "B", "Priya", AT)
    expect(out.map((x) => x.id)).toEqual(["B", "A", "C"])
    expect(out[1].history).toEqual([])
  })
  it("ignores unknown ids", () => {
    const list = [a, b]
    expect(moveCandidate(list, "Z", "offer", null, "P", AT)).toBe(list)
  })
})
