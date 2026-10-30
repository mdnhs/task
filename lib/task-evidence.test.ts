import { describe, expect, it } from "vitest"

import {
  NO_EVIDENCE,
  canVerify,
  completeTarget,
  describeRule,
  evidenceState,
  fileType,
  isTypeAllowed,
  legacyRule,
  missingEvidence,
  normaliseRule,
  ruleError,
  uploadError,
  type EvidenceRule,
} from "./task-evidence"

const req = (min = 2, extra: Partial<EvidenceRule> = {}): EvidenceRule => ({ mode: "required", types: ["pdf"], min, instruction: "", review: "manager", ...extra })
const ev = (review: "pending" | "accepted" | "rejected" | "info_requested", kind = "pdf") => ({ kind, review })

describe("legacy migration", () => {
  it("maps the old flag", () => {
    expect(legacyRule(false)).toEqual(NO_EVIDENCE)
    expect(legacyRule(true)).toMatchObject({ mode: "required", min: 1, review: "manager" })
  })
})

describe("rule validation", () => {
  it("needs types and a minimum for Required", () => {
    expect(ruleError(NO_EVIDENCE)).toBeNull()
    expect(ruleError(req(1, { types: [] }))).toMatch(/type/)
    expect(ruleError(req(0))).toMatch(/at least 1/)
    expect(ruleError(req(21))).toMatch(/at most/)
    expect(ruleError(req(1, { review: "named" }))).toMatch(/reviewer/)
    expect(ruleError(req(1, { review: "named", reviewer: "p1" }))).toBeNull()
  })
  it("normalises", () => {
    expect(normaliseRule({ ...req(3), mode: "none" })).toEqual(NO_EVIDENCE)
    expect(normaliseRule({ ...req(3), mode: "optional" }).min).toBe(0)
    expect(normaliseRule(req(1, { types: ["note", "photo"], instruction: "  x " }))).toMatchObject({ types: ["photo", "note"], instruction: "x" })
  })
})

describe("complete (FR-M1-43, AC-M1-08)", () => {
  it("Not needed closes with one tap", () => expect(completeTarget(NO_EVIDENCE, [])).toBe("completed"))
  it("needs at least 2 PDFs: 1 is not enough", () => {
    expect(completeTarget(req(2), [ev("pending")])).toBe("blocked")
    expect(missingEvidence(req(2), [ev("pending")])).toBe(1)
    expect(completeTarget(req(2), [ev("pending"), ev("pending")])).toBe("submitted")
  })
  it("rejected items don't count", () => expect(completeTarget(req(1), [ev("rejected")])).toBe("blocked"))
  it("auto-accept completes", () => expect(completeTarget(req(1, { review: "auto" }), [ev("accepted")])).toBe("completed"))
  it("optional with nothing attached completes", () => expect(completeTarget({ ...req(0), mode: "optional" }, [])).toBe("completed"))
  it("already accepted evidence completes", () => expect(completeTarget(req(1), [ev("accepted")])).toBe("completed"))
})

describe("evidence state (FR-M1-48)", () => {
  it("covers the states", () => {
    expect(evidenceState(NO_EVIDENCE, [], "in_progress")).toBeNull()
    expect(evidenceState(req(1), [], "in_progress")).toBe("missing")
    expect(evidenceState(req(1), [ev("pending")], "submitted")).toBe("awaiting")
    expect(evidenceState(req(1), [ev("rejected")], "changes_requested")).toBe("rejected")
    expect(evidenceState(req(1), [ev("accepted")], "completed")).toBe("verified")
    expect(evidenceState(req(1), [ev("pending")], "in_progress")).toBe("attached")
    expect(evidenceState(req(1), [], "cancelled")).toBeNull()
  })
})

describe("files and links", () => {
  it("classifies files", () => {
    expect(fileType("a.jpg", "image/jpeg", true)).toBe("photo")
    expect(fileType("a.jpg", "image/jpeg")).toBe("image")
    expect(fileType("a.pdf", "")).toBe("pdf")
    expect(fileType("a.docx", "")).toBe("office")
    expect(fileType("a.mp4", "video/mp4")).toBe("video")
    expect(fileType("a.zip", "application/zip")).toBeNull()
  })
  it("checks type and size", () => {
    expect(uploadError(req(1), "pdf", 10)).toBeNull()
    expect(uploadError(req(1), "office", 10)).toMatch(/isn't allowed/)
    expect(uploadError(req(1), null, 10)).toMatch(/type/)
    expect(uploadError(req(1, { types: ["pdf"] }), "pdf", 30 * 1024 * 1024)).toMatch(/25 MB/)
    expect(isTypeAllowed(req(1, { types: ["image"] }), "photo")).toBe(true)
  })
})

describe("who verifies", () => {
  const task = { creator: "p-c", assignee: "p-a" }
  it("managers always, assignee never", () => {
    expect(canVerify(req(1), { id: "x", manager: true }, task)).toBe(true)
    expect(canVerify(req(1, { review: "creator" }), { id: "p-a", manager: false }, task)).toBe(false)
    expect(canVerify(req(1, { review: "creator" }), { id: "p-c", manager: false }, task)).toBe(true)
    expect(canVerify(req(1, { review: "named", reviewer: "p-r" }), { id: "p-r", manager: false }, task)).toBe(true)
    expect(canVerify(NO_EVIDENCE, { id: "x", manager: true }, task)).toBe(false)
  })
  it("describes", () => expect(describeRule(req(2, { types: ["photo", "pdf"] }))).toBe("Required · at least 2 · Photo, PDF"))
})
