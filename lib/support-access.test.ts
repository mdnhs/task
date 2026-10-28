import { describe, expect, it } from "vitest"

import { mergeSupport, supportRows, type SupportAccess } from "./support-access"

const row = (id: string, over: Partial<SupportAccess> = {}): SupportAccess => ({
  id, tenantId: "t1", requester: "Support", reason: "r", status: "granted",
  requestedAt: "2026-10-19T09:00:00", expiresAt: "2026-10-21T09:00:00", grantedBy: "Owner", ...over,
})

describe("support access", () => {
  it("merges seed rows by id and keeps local edits", () => {
    const edited = [row("SUP-1", { status: "revoked" })]
    const out = mergeSupport(edited, [row("SUP-1"), row("SUP-2")])
    expect(out.map((r) => [r.id, r.status])).toEqual([["SUP-1", "revoked"], ["SUP-2", "granted"]])
    expect(mergeSupport(out, [row("SUP-2")])).toBe(out)
  })

  it("sorts requests first, then open grants, then history; past expiry reads expired", () => {
    const rows = supportRows(
      [row("old", { expiresAt: "2026-10-20T08:00:00" }), row("open"), row("ask", { status: "requested", expiresAt: null, grantedBy: null })],
      "2026-10-20T09:00:00",
    )
    expect(rows.map((r) => [r.row.id, r.status])).toEqual([["ask", "requested"], ["open", "granted"], ["old", "expired"]])
  })
})
