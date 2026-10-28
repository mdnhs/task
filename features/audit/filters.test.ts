import { describe, expect, it } from "vitest"
import { EMPTY_FILTERS, exportEvent, filterEvents, toCsv } from "./filters"
import type { AuditEvent } from "./types"

const ev = (o: Partial<AuditEvent>): AuditEvent => ({
  id: "AUD-1", at: "2026-10-20T09:00:00", actor: "Daniel Okafor", actorRole: "Security Supervisor", action: "sign_in",
  recordType: "Session", recordRef: "SES-1", ip: "1.1.1.1", device: "Chrome", sensitive: false, meta: {}, ...o,
})

describe("audit filters", () => {
  const list = [ev({}), ev({ id: "AUD-2", action: "failed_sign_in", actor: "Grace Mensah", at: "2026-10-18T10:00:00" })]
  it("filters by action, actor and date range", () => {
    expect(filterEvents(list, { ...EMPTY_FILTERS, action: "failed_sign_in" })).toHaveLength(1)
    expect(filterEvents(list, { ...EMPTY_FILTERS, actor: "Daniel Okafor" })).toHaveLength(1)
    expect(filterEvents(list, { ...EMPTY_FILTERS, from: "2026-10-19" })).toHaveLength(1)
    expect(filterEvents(list, { ...EMPTY_FILTERS, to: "2026-10-18" })).toHaveLength(1)
  })
  it("searches text", () => {
    expect(filterEvents(list, { ...EMPTY_FILTERS, q: "failed" })).toHaveLength(1)
  })
  it("searches id and ip, and combines filters", () => {
    const l = [ev({ ip: "10.0.0.7" }), ev({ id: "AUD-2", ip: "2.2.2.2", actor: "Grace Mensah" })]
    expect(filterEvents(l, { ...EMPTY_FILTERS, q: "10.0.0" })).toHaveLength(1)
    expect(filterEvents(l, { ...EMPTY_FILTERS, q: "aud-2" })).toHaveLength(1)
    expect(filterEvents(l, { ...EMPTY_FILTERS, q: "2.2.2", actor: "Daniel Okafor" })).toHaveLength(0)
  })
  it("quotes csv cells", () => {
    expect(toCsv([ev({ device: 'Chrome, "x"' })])).toContain('"Chrome, ""x"""')
  })
  it("exportEvent builds a sensitive export event with the next id", () => {
    const e = exportEvent(list, { actor: "Me", role: "Admin" }, "2026-10-28T09:00:00", 2, "audit-log-2026-10-28.csv")
    expect(e).toMatchObject({ id: "AUD-3", action: "export", actor: "Me", sensitive: true, recordRef: "audit-log-2026-10-28.csv", meta: { Rows: "2" } })
  })
})
