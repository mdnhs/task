import { describe, expect, test } from "vitest"
import { fakeApi } from "@/test/support/fake-api"
import { composeOrg, loadOrg, neutralOrg } from "./org-core"
import { zoneLabel } from "./tz"

const ctx = (over: Record<string, unknown> = {}) => ({
  tenant: { id: "t1", slug: "kiwi", name: "Kiwi Co", timezone: "Pacific/Auckland", currency: "NZD", locale: "en-NZ", sessionIdleHours: 12, mfaPolicy: { mode: "off", roles: [] }, ...over },
  member: { userId: "u1", roleId: "r1", roleKey: "employee", role: { label: "Employee", description: "", home: "staff", access: {} } },
  brand: { primaryColor: null }, reportDeadline: "18:15", reportDueAfterMinutes: 60,
  device: { id: null, type: "browser", label: "Unregistered browser", trusted: false }, features: { drive: false },
})
const teams = [
  { id: "d1", name: "Front of house", kind: "department", memberIds: [] },
  { id: "d2", name: "Kitchen", kind: "department", memberIds: [] },
]
const NOW = new Date("2026-11-18T22:00:00Z") // 19 Nov 11:00 in Auckland (NZDT), 18 Nov 22:00 in Dublin

describe("T6.4 getOrg: the tenant's own values, never a hard-coded zone", () => {
  test("a Pacific/Auckland tenant shows Auckland's today, its own currency and locale (no Europe/Dublin, no EUR)", async () => {
    const { client } = fakeApi({ "GET /v1/me/tenant": ctx(), "GET /v1/teams": teams })
    const org = await loadOrg(client, NOW)
    expect(org.timezone).toBe("Pacific/Auckland")
    expect(org.today).toBe("2026-11-19T11:00:00")
    expect(org.tzLabel).toBe("New Zealand Time")
    expect(org.currency).toBe("NZD")
    expect(org.locale).toBe("en-NZ")
    expect(JSON.stringify(org)).not.toMatch(/Dublin|EUR|en-IE|Irish/)
  })

  test("the report deadline comes from me/tenant and the departments from the teams endpoint, in the API's order", async () => {
    const { client, calls } = fakeApi({ "GET /v1/me/tenant": ctx(), "GET /v1/teams": teams })
    const org = await loadOrg(client, NOW)
    expect(org.deadline).toBe("18:15")
    expect(org.departments).toEqual(["Front of house", "Kitchen"])
    expect(calls.find((c) => c.path === "/v1/teams")?.query).toEqual({ kind: "department" })
  })

  test("the same instant is a different today in another zone (the clock is formatted in the tenant zone, not the server's)", async () => {
    const { client } = fakeApi({ "GET /v1/me/tenant": ctx({ timezone: "Europe/Dublin", currency: "EUR", locale: "en-IE" }), "GET /v1/teams": [] })
    const org = await loadOrg(client, NOW)
    expect(org.today).toBe("2026-11-18T22:00:00")
    expect(org.departments).toEqual([])
  })

  test("a plain staff member loads the org with no call that needs settings:read, audit or roles (no 403 path)", async () => {
    const { client, paths } = fakeApi({ "GET /v1/me/tenant": ctx(), "GET /v1/teams": teams })
    await loadOrg(client, NOW)
    expect(paths().sort()).toEqual(["GET /v1/me/tenant", "GET /v1/teams"])
  })

  test("Org has no reminders field (nothing consumed it)", async () => {
    const { client } = fakeApi({ "GET /v1/me/tenant": ctx(), "GET /v1/teams": teams })
    expect(Object.keys(await loadOrg(client, NOW)).sort()).toEqual(["currency", "deadline", "departments", "locale", "nowAt", "reportDueAfterMinutes", "timezone", "today", "tzLabel"]) // nowAt: the same clock as a UTC instant (T6.6, I12); reportDueAfterMinutes: the dashboard's "shift end + N min" (T6.7)
  })

  test("an unknown zone is a data error, never silently shown as another zone; its label falls back to the zone's own name", () => {
    expect(zoneLabel("Not/AZone", NOW)).toBe("Not/AZone")
    expect(() => composeOrg({ timezone: "Not/AZone", currency: "EUR", locale: "en", reportDeadline: "17:00", departments: [] }, NOW)).toThrow()
  })

  test("neutralOrg (the MFA gate, no tenant data readable) is UTC and empty", () => {
    expect(neutralOrg(NOW)).toMatchObject({ timezone: "UTC", departments: [], today: "2026-11-18T22:00:00" })
  })
})
