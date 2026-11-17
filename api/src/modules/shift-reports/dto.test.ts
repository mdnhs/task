import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { resetDb } from "../../../test/harness"
import { resetSubscribers } from "../../core/events"
import { registerFiles } from "../files"
import { registerNotifications } from "../notifications"
import { registerSearchIndexers } from "../search"
import { registerTasks } from "../tasks"
import { registerShiftReports } from "."
import { ReportSchema, VersionsOut } from "./dto"
import { world, type Json } from "./world"

beforeEach(async () => {
  await resetDb()
  resetSubscribers()
  registerNotifications()
  registerFiles()
  registerSearchIndexers()
  registerTasks()
  registerShiftReports()
})
afterEach(resetSubscribers)

const FULL = (): Json => ({
  id: "9b1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8", key: "usr_a:p:2026-10-24", userId: "usr_a", patternId: "p", shiftName: "Night", team: "Security", date: "2026-10-24",
  start: "2026-10-24T22:00", end: "2026-10-25T06:00", due: "2026-10-25T07:00", startAt: "2026-10-24T21:00:00.000Z", endAt: "2026-10-25T06:00:00.000Z", dueAt: "2026-10-25T07:00:00.000Z",
  status: "returned", state: "returned", version: 4, submissions: 2,
  items: [{ position: 0, taskId: null, ref: "TSK-1", title: "T", due: "2026-10-25T03:00", dueAt: "2026-10-25T03:00:00.000Z", status: "done", minutes: 30, note: "", taskStatus: null, evidenceState: "verified", outcome: "applied" }],
  summary: "s", blockers: "", unplanned: [{ id: "u1", text: "x", minutes: 5 }], extra: { "handover.keys": "yes" },
  attachments: [{ id: "f1", name: "a.jpg", kind: "image", size: 10, status: "clean" }],
  submittedAt: "2026-10-25T06:20:00.000Z", reviewedAt: "2026-10-25T08:00:00.000Z", reviewedBy: "Ann", comments: [{ at: "2026-10-25T08:00:00.000Z", by: "Ann", text: "More detail" }],
})

describe("ReportSchema is strict (B6 T6.1, Review Focus 4)", () => {
  test("a real report from the harness parses, and so does the saved draft with extra answers", async () => {
    const w = await world()
    await w.task(w.staff, { title: "Check fire exits" })
    const rep = await w.opened(w.staff)
    expect(ReportSchema.safeParse(rep).success, JSON.stringify(ReportSchema.safeParse(rep).error?.issues)).toBe(true)
    const saved = await w.saved(w.staff, rep, { extra: { "handover.keys": "back in the box" }, unplanned: [{ id: "u1", text: "Helped next door", minutes: 20 }] })
    const parsed = ReportSchema.parse(saved)
    expect(parsed.extra).toEqual({ "handover.keys": "back in the box" })
    expect(parsed.items.length).toBeGreaterThan(0)
  })

  test("a fully filled report (attachments, comments, outcome, review) parses", () => {
    expect(ReportSchema.safeParse(FULL()).success).toBe(true)
  })

  test("an unknown key fails (no catchall)", () => {
    expect(ReportSchema.safeParse({ ...FULL(), surprise: 1 }).success).toBe(false)
  })

  test("a missing required key fails (the FE would otherwise show undefined)", () => {
    for (const k of ["summary", "items", "attachments", "comments", "extra", "state", "version", "dueAt"]) {
      const r = FULL()
      delete r[k]
      expect(ReportSchema.safeParse(r).success, k).toBe(false)
    }
  })

  test("items, attachments, comments and extra are typed", () => {
    const bad = [
      { items: [{ ...FULL().items[0], status: "finished" }] },
      { items: [{ ...FULL().items[0], minutes: "30" }] },
      { items: [{ ...FULL().items[0], outcome: "lost" }] },
      { attachments: [{ id: "f1", name: "a", kind: "video", size: 1, status: "clean" }] },
      { attachments: [{ id: "f1", name: "a", kind: "file", size: 1, status: "deleted" }] },
      { comments: [{ at: "x", by: "y" }] },
      { extra: { k: 5 } },
      { unplanned: [{ id: "u", text: "t" }] },
      { state: "overdue" },
    ]
    for (const patch of bad) expect(ReportSchema.safeParse({ ...FULL(), ...patch }).success, JSON.stringify(patch)).toBe(false)
  })

  test("a version snapshot is typed too (no z.any)", () => {
    const ok = { v: 1, at: "x", by: "Ann", note: "Submitted", snapshot: { summary: "", blockers: "", unplanned: [], extra: {}, attachmentFileIds: [], items: [] } }
    expect(VersionsOut.safeParse({ items: [ok] }).success).toBe(true)
    expect(VersionsOut.safeParse({ items: [{ ...ok, snapshot: "nope" }] }).success).toBe(false)
  })
})
