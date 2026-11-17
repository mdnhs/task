import { describe, expect, test } from "vitest"
import { world } from "@/test/support/session-world"
import { resolveSession } from "./session-core"
import { can, canWrite } from "./permissions"
import { bannerOf, canWhileBlocked, isReadOnly } from "./billing-state"
import { wallInTz } from "./tz"

describe("T6.4 billingState blocked: read-only, but reading, billing and data export keep working", () => {
  const blocked = { status: "canceled", billingState: "blocked", trialEndsAt: null, graceEndsAt: null }

  test("the session is read-only for writes (canWrite false) while every module still reads (can true); billing and export stay usable", async () => {
    const w = world({ ent: blocked })
    const r = await resolveSession(w.deps)
    if (r.kind !== "ok") throw new Error("expected a session")
    const s = r.session
    expect(s.billingState).toBe("blocked")
    expect(isReadOnly(s)).toBe(true)
    expect(canWrite(s, "tasks")).toBe(false)
    expect(canWrite(s, "settings")).toBe(false)
    expect(can(s.role, "tasks")).toBe(true) // GET pages keep working
    expect(canWhileBlocked(s, "billing")).toBe(true)
    expect(canWhileBlocked(s, "export")).toBe(true)
  })

  test("billing and export need the owner-level settings write; a read-only role gets neither, blocked or not", async () => {
    const w = world({ ent: blocked, tenants: { alpha: { roleKey: "manager" } } })
    const r = await resolveSession(w.deps)
    if (r.kind !== "ok") throw new Error("expected a session")
    const readOnlyRole = { ...r.session, role: { ...r.session.role, access: { ...r.session.role.access, settings: "read" as const } } }
    expect(canWhileBlocked(readOnlyRole, "billing")).toBe(false)
    expect(canWhileBlocked(readOnlyRole, "export")).toBe(false)
  })

  test("a paying tenant is not read-only", async () => {
    const r = await resolveSession(world().deps)
    if (r.kind !== "ok") throw new Error("expected a session")
    expect(isReadOnly(r.session)).toBe(false)
    expect(canWrite(r.session, "tasks")).toBe(true)
  })

  test("the session carries the ISO trial and grace instants (the banner formats them in the tenant zone)", async () => {
    const w = world({ ent: { status: "trialing", billingState: "grace", trialEndsAt: "2026-11-17T09:00:00.000Z", graceEndsAt: "2026-11-24T09:00:00.000Z" } })
    const r = await resolveSession(w.deps)
    if (r.kind !== "ok") throw new Error("expected a session")
    expect(r.session).toMatchObject({ billingState: "grace", trialEndsAt: "2026-11-17T09:00:00.000Z", graceEndsAt: "2026-11-24T09:00:00.000Z" })
  })
})

describe("T6.4 the banner", () => {
  const base = { status: "active" as const, billingState: "ok" as const, trialEndsAt: null, graceEndsAt: null, timezone: "Europe/Dublin", tzLabel: "Ireland Time" }

  test("blocked: the read-only banner, in the danger tone, pointing at billing (export still possible)", () => {
    expect(bannerOf({ ...base, status: "suspended", billingState: "blocked" })).toEqual({ tone: "danger", text: "Read-only: subscription inactive. You can still export data.", action: { href: "/settings/billing", label: "Reactivate" } })
  })

  test("grace: a warning with the grace end date in the TENANT zone (the same instant is two different days)", () => {
    const g = { ...base, status: "trial" as const, billingState: "grace" as const, trialEndsAt: "2026-11-17T09:00:00.000Z", graceEndsAt: "2026-11-24T23:30:00.000Z" }
    const dublin = bannerOf({ ...g, timezone: "Europe/Dublin", tzLabel: "Ireland Time" })!
    const auckland = bannerOf({ ...g, timezone: "Pacific/Auckland", tzLabel: "New Zealand Time" })!
    expect(dublin.tone).toBe("warn")
    expect(dublin.text).toBe("Trial ended. Choose a plan by Tue 24 Nov (Ireland Time) to keep editing.")
    expect(auckland.text).toBe("Trial ended. Choose a plan by Wed 25 Nov (New Zealand Time) to keep editing.")
    expect(dublin.action).toEqual({ href: "/settings/billing", label: "Choose a plan" })
  })

  test("trial in progress: info with the trial end in the tenant zone", () => {
    expect(bannerOf({ ...base, status: "trial", trialEndsAt: "2026-12-01T23:30:00.000Z", timezone: "Pacific/Auckland", tzLabel: "New Zealand Time" })!.text).toBe("Trial ends Wed 2 Dec (New Zealand Time)")
  })

  test("past due (still writable): a warning, no invented date", () => {
    expect(bannerOf({ ...base, status: "past_due" })).toEqual({ tone: "warn", text: "Payment failed. Update billing to keep full access.", action: { href: "/settings/billing", label: "Update billing" } })
  })

  test("a healthy active tenant shows no banner", () => {
    expect(bannerOf(base)).toBeNull()
  })

  test("a 402 seen by the browser flips an ok tenant to the blocked banner", () => {
    expect(bannerOf({ ...base, forceBlocked: true })!.tone).toBe("danger")
  })
})

describe("T6.4 wallInTz", () => {
  test("formats an instant as the tenant's local wall time", () => {
    expect(wallInTz(new Date("2026-11-18T22:00:00Z"), "Pacific/Auckland")).toBe("2026-11-19T11:00:00")
    expect(wallInTz("2026-06-30T23:30:00.000Z", "Europe/Dublin")).toBe("2026-07-01T00:30:00")
    expect(wallInTz("2026-11-18T00:00:00Z", "UTC")).toBe("2026-11-18T00:00:00") // hour 24 never appears
  })
})
