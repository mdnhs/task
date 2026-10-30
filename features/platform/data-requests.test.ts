import { describe, expect, it } from "vitest"

import {
  DR_VIEWS, completeBlock, dataRequestsData, dataViewCounts, dueIn, dueLabel, filterRequests, isDataView, isOpen, nextStatuses, sortRequests, transition, transitionAudit,
} from "./data-requests"
import type { DataRequest, PlatformSeed } from "./types"

const req = (over: Partial<DataRequest> = {}): DataRequest => ({
  id: "DSR-1", tenantId: "t1", kind: "export", subject: "tenant", requestedBy: "Ann Lee", requestedAt: "2026-10-01T09:00:00", dueAt: "2026-10-31T09:00:00",
  status: "received", note: "", ...over,
})
const TODAY = "2026-10-30T09:00:00"

describe("dueIn", () => {
  it("counts whole calendar days to the due date, negative once overdue", () => {
    expect(dueIn(req({ dueAt: "2026-11-06T23:30:00" }), TODAY)).toBe(7)
    expect(dueIn(req({ dueAt: "2026-10-30T23:59:00" }), TODAY)).toBe(0)
    expect(dueIn(req({ dueAt: "2026-10-25T10:00:00" }), TODAY)).toBe(-5)
  })
  it("labels the countdown and turns urgent under 7 days", () => {
    expect(dueLabel(req({ dueAt: "2026-11-06T09:00:00" }), TODAY)).toEqual({ text: "7 days left", urgent: false })
    expect(dueLabel(req({ dueAt: "2026-11-05T09:00:00" }), TODAY)).toEqual({ text: "6 days left", urgent: true })
    expect(dueLabel(req({ dueAt: "2026-10-31T09:00:00" }), TODAY)).toEqual({ text: "1 day left", urgent: true })
    expect(dueLabel(req({ dueAt: "2026-10-30T09:00:00" }), TODAY)).toEqual({ text: "Due today", urgent: true })
    expect(dueLabel(req({ dueAt: "2026-10-29T09:00:00" }), TODAY)).toEqual({ text: "1 day overdue", urgent: true })
    expect(dueLabel(req({ dueAt: "2026-10-25T09:00:00" }), TODAY)).toEqual({ text: "5 days overdue", urgent: true })
  })
  it("shows no countdown on a closed request", () => {
    expect(dueLabel(req({ status: "completed", dueAt: "2026-10-01T09:00:00" }), TODAY)).toBeNull()
    expect(dueLabel(req({ status: "rejected" }), TODAY)).toBeNull()
  })
})

describe("transitions", () => {
  it("allows received to in progress, and either open state to completed or rejected, nothing else", () => {
    expect(nextStatuses("received")).toEqual(["in_progress", "rejected"])
    expect(nextStatuses("in_progress")).toEqual(["completed", "rejected"])
    expect(nextStatuses("completed")).toEqual([])
    expect(nextStatuses("rejected")).toEqual([])
  })
  it("starts a request", () => {
    expect(transition(req(), "in_progress", { at: TODAY, by: "Sam" })).toMatchObject({ status: "in_progress" })
  })
  it("refuses to skip start, to reopen or to repeat", () => {
    expect(() => transition(req(), "completed", { at: TODAY, by: "Sam", text: "Export is ready to send" })).toThrow(/received/)
    expect(() => transition(req({ status: "completed" }), "in_progress", { at: TODAY, by: "Sam" })).toThrow()
    expect(() => transition(req({ status: "rejected" }), "rejected", { at: TODAY, by: "Sam", text: "Legal hold in place" })).toThrow()
    expect(() => transition(req({ status: "in_progress" }), "received", { at: TODAY, by: "Sam" })).toThrow()
  })
  it("completes with a note and rejects with a reason, both required (10+ characters)", () => {
    const done = transition(req({ status: "in_progress" }), "completed", { at: TODAY, by: "Sam", text: "  Export ready, link sent to the admin  " })
    expect(done).toMatchObject({ status: "completed", resolution: "Export ready, link sent to the admin", closedAt: TODAY, closedBy: "Sam" })
    const no = transition(req(), "rejected", { at: TODAY, by: "Sam", text: "Records are under a legal hold" })
    expect(no).toMatchObject({ status: "rejected", resolution: "Records are under a legal hold" })
    expect(() => transition(req({ status: "in_progress" }), "completed", { at: TODAY, by: "Sam", text: "ok" })).toThrow(/at least/)
    expect(() => transition(req(), "rejected", { at: TODAY, by: "Sam" })).toThrow(/at least/)
  })
})

describe("deletion completion", () => {
  const del = req({ kind: "deletion", subject: "tenant", status: "in_progress" })
  it("is blocked until the tenant's deletion date has passed", () => {
    expect(completeBlock(del, undefined, TODAY)).toMatch(/schedule/i)
    expect(completeBlock(del, "2026-11-20", TODAY)).toMatch(/20 Nov/)
    expect(completeBlock(del, "2026-10-30", TODAY)).toBeNull()
    expect(completeBlock(del, "2026-10-01", TODAY)).toBeNull()
  })
  it("does not apply to exports, corrections or a single person's deletion", () => {
    expect(completeBlock(req({ status: "in_progress" }), undefined, TODAY)).toBeNull()
    expect(completeBlock(req({ kind: "correction", subject: "person", status: "in_progress" }), undefined, TODAY)).toBeNull()
    expect(completeBlock(req({ kind: "deletion", subject: "person", status: "in_progress" }), undefined, TODAY)).toBeNull()
  })
  it("refuses the completion in transition when blocked", () => {
    expect(() => transition(del, "completed", { at: TODAY, by: "Sam", text: "Workspace data erased", deletionAt: "2026-11-20" })).toThrow(/Deletion is scheduled/)
    expect(transition(del, "completed", { at: TODAY, by: "Sam", text: "Workspace data erased", deletionAt: "2026-10-29" }).status).toBe("completed")
  })
})

describe("queue", () => {
  const rows = [
    req({ id: "A", status: "received", dueAt: "2026-11-20T09:00:00" }),
    req({ id: "B", status: "in_progress", dueAt: "2026-11-02T09:00:00" }),
    req({ id: "C", status: "in_progress", dueAt: "2026-10-25T09:00:00" }),
    req({ id: "D", status: "completed", dueAt: "2026-10-01T09:00:00" }),
    req({ id: "E", status: "rejected", dueAt: "2026-10-02T09:00:00" }),
  ]
  it("has the saved views open, due soon, completed (closed requests are never due soon)", () => {
    expect(DR_VIEWS.map((v) => v.value)).toEqual(["open", "due_soon", "completed", "rejected", "all"])
    expect(isDataView("due_soon")).toBe(true)
    expect(isDataView("x")).toBe(false)
    expect(isOpen(rows[0])).toBe(true)
    expect(dataViewCounts(rows, TODAY)).toEqual({ open: 3, due_soon: 2, completed: 1, rejected: 1, all: 5 })
    expect(filterRequests(rows, { view: "due_soon", q: "" }, TODAY).map((r) => r.id)).toEqual(["B", "C"])
  })
  it("searches the id, requester, tenant name and kind", () => {
    const names = new Map([["t1", "Acme Care"]])
    expect(filterRequests(rows, { view: "all", q: "acme" }, TODAY, names)).toHaveLength(5)
    expect(filterRequests(rows, { view: "all", q: "dsr-x" }, TODAY, names)).toHaveLength(0)
    expect(filterRequests(rows, { view: "all", q: "ann" }, TODAY, names)).toHaveLength(5)
  })
  it("sorts by due date, soonest first by default, with the id breaking ties", () => {
    expect(sortRequests(rows, { key: "due", dir: "asc" }, new Map()).map((r) => r.id)).toEqual(["D", "E", "C", "B", "A"])
    expect(sortRequests(rows, { key: "due", dir: "desc" }, new Map()).map((r) => r.id)).toEqual(["A", "B", "C", "E", "D"])
  })
})

describe("view model", () => {
  const seed = {
    tenants: [{ id: "t1", name: "Acme", deletionAt: "2026-11-01" }, { id: "t2", name: "Beta", contacts: [{ name: "x" }], billing: {} }],
    dataRequests: [req(), req({ id: "DSR-2", tenantId: "t2" })],
  } as unknown as PlatformSeed
  it("carries tenant names and deletion dates only, none of the tenant record", () => {
    const d = dataRequestsData(seed)
    expect(d.tenants).toEqual([{ id: "t1", name: "Acme", deletionAt: "2026-11-01" }, { id: "t2", name: "Beta" }])
    expect(d.requests).toHaveLength(2)
  })
})

describe("transitionAudit", () => {
  it("records a start as a plain line with the note in the detail", () => {
    const r = req()
    const a = transitionAudit(r, { ...r, status: "in_progress" }, "in_progress", "Pulling the export")
    expect(a).toEqual({
      action: "data_request.started", detail: "Export request DSR-1 started: Pulling the export", sensitive: false,
      before: { status: "received" }, after: { status: "in_progress" },
    })
    expect(transitionAudit(r, { ...r, status: "in_progress" }, "in_progress").detail).toBe("Export request DSR-1 started")
  })
  it("records a close as sensitive, with the text only as the reason (not repeated in the detail)", () => {
    const r = req({ status: "in_progress", kind: "deletion" })
    const a = transitionAudit(r, { ...r, status: "rejected", resolution: "Not the account owner" }, "rejected", "Not the account owner")
    expect(a).toEqual({
      action: "data_request.rejected", detail: "Deletion request DSR-1 rejected", sensitive: true, reason: "Not the account owner",
      before: { status: "in_progress" }, after: { status: "rejected", resolution: "Not the account owner" },
    })
    expect(transitionAudit(r, { ...r, status: "completed" }, "completed", "Done").action).toBe("data_request.completed")
  })
})
