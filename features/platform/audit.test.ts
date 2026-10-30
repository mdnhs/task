import { describe, expect, it } from "vitest"

import { auditChanges, auditCsvRows, auditLogData, auditOptions, sortAudit } from "./audit"
import type { AuditEntry } from "./types"

const e = (id: string, over: Partial<AuditEntry> = {}): AuditEntry => ({ id, at: "2026-10-20T09:00:00", actor: "Aoife", action: "a", target: "T", detail: "d", ...over })

describe("platform audit log", () => {
  it("sorts newest first, same minute by the later id", () => {
    const rows = [e("PAU-2", { at: "2026-10-19T09:00:00" }), e("PAU-9"), e("PAU-10")]
    expect(sortAudit(rows).map((x) => x.id)).toEqual(["PAU-10", "PAU-9", "PAU-2"])
  })
  it("lists distinct actors and actions A-Z", () => {
    expect(auditOptions([e("1", { actor: "Priya", action: "z.b" }), e("2", { action: "a.c" }), e("3", { actor: "Priya", action: "z.b" })])).toEqual({ actors: ["Aoife", "Priya"], actions: ["a.c", "z.b"] })
  })
  it("shows every changed key before → after, and nothing for an old line", () => {
    expect(auditChanges(e("1", { before: { status: "active" }, after: { status: "past_due", plan: "pro" } }))).toEqual([
      { key: "status", before: "active", after: "past due" },
      { key: "plan", before: "none", after: "pro" },
    ])
    expect(auditChanges(e("1"))).toEqual([])
  })
  it("exports the change, role, tenant name and reason", () => {
    const [row] = auditCsvRows([e("PAU-1", { staffRole: "owner", tenantId: "t1", before: { a: 1 }, after: { a: 2 }, reason: "Because of x" })], new Map([["t1", "Acme"]]))
    expect(row).toMatchObject({ id: "PAU-1", role: "Owner", tenant: "Acme", change: "a: 1 -> 2", reason: "Because of x" })
  })
  it("ships tenant names only, A-Z", () => {
    const d = auditLogData({ audit: [], tenants: [{ id: "t2", name: "Zed" }, { id: "t1", name: "acme" }] as never })
    expect(d.tenants).toEqual([{ id: "t1", name: "acme" }, { id: "t2", name: "Zed" }])
  })
})
