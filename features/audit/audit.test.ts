import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { fakeApi } from "@/test/support/fake-api"
import { AUDIT_ACTIONS, actionInfo } from "./actions-catalogue"
import { auditQuery, exportUrl, loadAudit, toAuditEvent } from "./adapters"
import { EMPTY_FILTERS, filterEvents } from "./filters"

const DTO = { seq: 42, at: "2026-11-18T09:30:00.000Z", actorId: "u1", action: "invite.created", entity: "invite", entityId: "inv-1", before: null, after: { roleKey: "employee", expiresAt: "2026-11-25T09:30:00.000Z", emailHmac: "abc" }, hash: "h" }

describe("T6.5 audit: entries map through the adapter", () => {
  test("a row becomes an event with the tenant's wall time, the actor's name, a catalogue label and flat metadata", () => {
    const e = toAuditEvent(DTO, "Europe/Dublin", (id) => (id === "u1" ? "Ada Byrne" : id))
    expect(e).toMatchObject({ id: "AUD-42", seq: 42, at: "2026-11-18T09:30:00", actor: "Ada Byrne", action: "invite.created", recordType: "invite", recordRef: "inv-1" })
    expect(e.meta).toEqual({ roleKey: "employee", expiresAt: "2026-11-25T09:30:00.000Z", emailHmac: "abc" })
    expect(actionInfo(e.action).label).toBe("Invite sent")
  })
  test("no actor means the system; a missing required field throws; metadata is flat, short and never holds a nested dump", () => {
    expect(toAuditEvent({ ...DTO, actorId: null }, "UTC", (id) => id).actor).toBe("System")
    const { seq: _s, ...bad } = DTO
    expect(() => toAuditEvent(bad, "UTC", (id) => id)).toThrow(/seq/)
    const e = toAuditEvent({ ...DTO, before: { a: { deep: [1, 2, 3] }, long: "x".repeat(500) }, after: { n: 1, ok: true, none: null } }, "UTC", (id) => id)
    expect(Object.values(e.meta).every((v) => v.length <= 200)).toBe(true)
    expect(e.meta["a"]).toBeUndefined() // nested objects are not flattened into text
    expect(e.meta["n"]).toBe("1")
    expect(e.meta["ok"]).toBe("true")
  })
  test("sensitive actions (access, exports, devices, keys, support, erasure) are flagged", () => {
    for (const a of ["role.updated", "audit.exported", "device.retired", "api_key.created", "support.granted", "dsr.requested", "invite.revoked", "member.role_changed"]) expect(actionInfo(a).sensitive, a).toBe(true)
    expect(actionInfo("task.created").sensitive).toBe(false)
  })
  test("an action the catalogue does not know still reads (humanised), and is not sensitive", () => {
    expect(actionInfo("widget.frobbed")).toMatchObject({ label: "Widget frobbed", sensitive: false })
  })
})

describe("T6.5 audit: filters go through the query, the rest filter the loaded page", () => {
  test("auditQuery turns the tenant's calendar days into instants (DST: 25 Oct 2026 in Dublin is 25 hours long) and passes the record type", () => {
    const q = auditQuery({ ...EMPTY_FILTERS, recordType: "invite", from: "2026-10-25", to: "2026-10-25" }, "Europe/Dublin")
    expect(q).toEqual({ entity: "invite", from: "2026-10-24T23:00:00.000Z", to: "2026-10-25T23:59:59.999Z", limit: 1000 })
    expect(auditQuery(EMPTY_FILTERS, "UTC")).toEqual({ limit: 1000 })
  })
  test("loadAudit reads GET /v1/audit with that query and maps every row", async () => {
    const { client, calls } = fakeApi({ "GET /v1/audit": [DTO] })
    const rows = await loadAudit(client, { ...EMPTY_FILTERS, recordType: "invite" }, "UTC", (id) => id)
    expect(calls[0]).toMatchObject({ method: "get", path: "/v1/audit", query: { entity: "invite", limit: 1000 } })
    expect(rows).toHaveLength(1)
  })
  test("actor, action, record type, date and text filters still work on events", () => {
    const a = toAuditEvent(DTO, "UTC", () => "Ada Byrne")
    const b = toAuditEvent({ ...DTO, seq: 41, actorId: "u2", action: "device.retired", entity: "device", at: "2026-11-10T09:00:00.000Z" }, "UTC", () => "Grace Mensah")
    expect(filterEvents([a, b], { ...EMPTY_FILTERS, actor: "Ada Byrne" })).toEqual([a])
    expect(filterEvents([a, b], { ...EMPTY_FILTERS, action: "device.retired" })).toEqual([b])
    expect(filterEvents([a, b], { ...EMPTY_FILTERS, from: "2026-11-15" })).toEqual([a])
    expect(filterEvents([a, b], { ...EMPTY_FILTERS, q: "retired" })).toEqual([b])
  })
  test("the CSV export is the API's download (BFF route) with only the filters it accepts", () => {
    expect(exportUrl({ ...EMPTY_FILTERS, recordType: "invite", from: "2026-11-01", to: "2026-11-30" }, "UTC")).toBe("/v1/audit/export?format=csv&entity=invite&from=2026-11-01T00%3A00%3A00.000Z&to=2026-11-30T23%3A59%3A59.999Z")
    expect(exportUrl(EMPTY_FILTERS, "UTC")).toBe("/v1/audit/export?format=csv")
  })
})

describe("T6.5 audit: the actions catalogue holds every action the API records", () => {
  const apiRoot = path.resolve(__dirname, "../../api/src")
  const walk = (d: string, out: string[] = []): string[] => {
    for (const e of readdirSync(d)) {
      const p = path.join(d, e)
      if (statSync(p).isDirectory()) walk(p, out)
      else if (p.endsWith(".ts") && !p.endsWith(".test.ts") && !p.includes("/migrations/")) out.push(p)
    }
    return out
  }
  test("every tenant-chain action literal in api/src (recordAudit / audit helpers) is in AUDIT_ACTIONS", () => {
    const found = new Set<string>()
    for (const f of walk(apiRoot)) {
      for (const line of readFileSync(f, "utf8").split("\n")) {
        if (!/\baction\b|audit/i.test(line)) continue
        for (const m of line.matchAll(/["'`]([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+)["'`]/g)) {
          const a = m[1]!
          if (a.startsWith("platform.") || /\.(ts|json|sql|js|com|example|ie)$/.test(a) || a.includes("@")) continue
          if (/(^|\b)(action|tenantAction)\b/.test(line) && /(recordAudit|action:|tenantAction)/.test(line)) found.add(a)
        }
      }
    }
    expect(found.size).toBeGreaterThan(50) // the scan is not vacuous
    const missing = [...found].filter((a) => !(a in AUDIT_ACTIONS)).sort()
    expect(missing).toEqual([])
  })
  test("the catalogue has no stale entries for actions the API never records (typos)", () => {
    const all = walk(apiRoot).map((f) => readFileSync(f, "utf8")).join("\n")
    const stale = Object.keys(AUDIT_ACTIONS).filter((a) => !all.includes(`"${a}"`) && !all.includes(`'${a}'`) && !all.includes(`\`${a}\``))
    expect(stale).toEqual([])
  })
})

describe("T6.5 fix: audit labels", () => {
  test("an unknown actor reads as Unknown member, never a raw id", async () => {
    const { nameFrom } = await import("./adapters")
    expect(nameFrom({ u1: "Ada Byrne" })("u1")).toBe("Ada Byrne")
    expect(nameFrom({})("usr_8Kq2mZ4tW1xyz")).toBe("Unknown member")
  })
  test("the export says it uses type and dates only, and the truncation notice says the other filters apply to loaded rows", () => {
    const src = readFileSync(path.resolve(__dirname, "components/audit-view.tsx"), "utf8")
    expect(src).toMatch(/Export CSV/)
    expect(src).toMatch(/type and dates/i)
    expect(src).toMatch(/apply to the loaded rows/i)
    expect(src).not.toMatch(/\bids\[|\?\? id\b/)
  })
})
