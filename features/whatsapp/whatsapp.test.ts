import { readFileSync } from "node:fs"
import path from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import { MOCK_DATA_READERS, hideMockNav, isMockRoute, mockEnabled } from "@/lib/mock-registry"
import { toConnection, toPeople, toState } from "./adapters"
import {
  CODE_LENGTH, RESEND_SECONDS, canSendCode, canVerify, cleanCode, connectedCount, countdown, enabledKinds, filterMessages, filterPeople, maskLast3, maskPhone, nationalDigits,
  nextConnection, peopleCounts, tickResend, validNational, VIA_OPTIONS, resolveVia, viaHasEmail, viaHasWhatsApp, usageNote, usagePct, withStaged, PERSON_STATUS, e164, validE164,
} from "./logic"
import { effectiveStatus } from "@/lib/wa-status"
import type { WaConnection } from "./types"

const root = path.resolve(__dirname, "../..")
const seed = (f: string) => JSON.parse(readFileSync(path.join(root, "public/data/whatsapp", f), "utf8")) as unknown
const raw = () => ({ connection: seed("connection.json"), kinds: seed("kinds.json"), people: seed("people.json"), messages: seed("messages.json"), plan: seed("plan.json"), templates: seed("templates.json"), countries: seed("countries.json"), self: seed("self.json") })

afterEach(() => vi.unstubAllEnvs())

describe("adapters", () => {
  test("the seed maps to the screen types", () => {
    const s = toState(raw())
    expect(s.connection.status).toBe("not_connected")
    expect(s.kinds.map((k) => k.id)).toEqual(["task_assigned", "task_due", "report_due", "report_returned", "roster_changed", "leave_decided", "billing", "security"])
    expect(s.kinds.find((k) => k.id === "security")).toMatchObject({ locked: true, via: "both" })
    expect(s.people.length).toBeGreaterThan(8)
    expect(s.countries[0]).toMatchObject({ code: "IE", dial: "353" })
    expect(Object.keys(s.self.channels)).toEqual(s.kinds.map((k) => k.id))
  })
  test("an unknown status or a missing field is an error, not a half page", () => {
    expect(() => toConnection({ ...(seed("connection.json") as object), status: "on" })).toThrow(/connection.status/)
    expect(() => toConnection({ status: "active" })).toThrow()
    expect(() => toState({ ...raw(), kinds: { kinds: "nope" } })).toThrow(/defaultVia|kinds/)
  })
  test("a phone fragment longer than 3 digits is cut to the last 3 (no full number reaches the screen)", () => {
    const p = toPeople({ people: [{ id: "x", name: "A", email: "a@x.example", role: "r", scope: { kind: "own", label: "l" }, status: "verified", phoneLast3: "353871234567", lastMessageAt: null }] })
    expect(p[0]!.phoneLast3).toBe("567")
  })
  test("no message body or full number is in the log seed", () => {
    for (const m of toState(raw()).messages) {
      expect(Object.keys(m).sort()).toEqual(["at", "id", "phoneLast3", "reason", "recipient", "status", "template"])
      expect(m.phoneLast3).toMatch(/^\d{3}$/)
    }
  })
})

describe("connection steps: Not connected -> Connecting -> Active", () => {
  const off = toConnection(seed("connection.json")) as WaConnection
  test("start, ready, off in order", () => {
    const connecting = nextConnection(off, "start", "2026-10-20T09:00:00")
    expect(connecting.status).toBe("connecting")
    const active = nextConnection(connecting, "ready", "2026-10-20T09:00:02")
    expect(active).toMatchObject({ status: "active", lastEvent: "Connected", lastEventAt: "2026-10-20T09:00:02" })
    expect(nextConnection(active, "off", "2026-10-20T09:05:00")).toMatchObject({ status: "not_connected", lastEvent: "Turned off" })
  })
  test("a step that does not apply changes nothing (no skipping Connecting)", () => {
    expect(nextConnection(off, "ready", "t")).toBe(off)
    expect(nextConnection(off, "off", "t")).toBe(off)
    const active = { ...off, status: "active" as const }
    expect(nextConnection(active, "start", "t")).toBe(active)
  })
  test("turning off while Connecting cancels it", () => {
    expect(nextConnection({ ...off, status: "connecting" }, "off", "t").status).toBe("not_connected")
  })
  test("the integrations counter is the API's connected ones plus WhatsApp when Active", () => {
    expect(connectedCount(0, "not_connected")).toBe(0)
    expect(connectedCount(0, "connecting")).toBe(0)
    expect(connectedCount(0, "active")).toBe(1)
    expect(connectedCount(1, "active")).toBe(2)
  })
})

describe("consent gating and the phone", () => {
  test("Send code stays disabled until the consent box is ticked", () => {
    expect(canSendCode({ dial: "353", national: "87 123 4567", consent: false })).toBe(false)
    expect(canSendCode({ dial: "353", national: "87 123 4567", consent: true })).toBe(true)
  })
  test("and until the number is plausible", () => {
    expect(canSendCode({ dial: "353", national: "", consent: true })).toBe(false)
    expect(canSendCode({ dial: "353", national: "12345", consent: true })).toBe(false)
    expect(canSendCode({ dial: "353", national: "abc", consent: true })).toBe(false)
    expect(validNational(nationalDigits("087 123 4567"))).toBe(true)
  })
  test("digits only, one leading trunk 0 dropped", () => {
    expect(nationalDigits("087-123 4567")).toBe("871234567")
    expect(nationalDigits("(0)871234567")).toBe("871234567")
  })
  test("masking shows only the last 3 digits and never the length", () => {
    expect(maskPhone("353", "871234567")).toBe("+353 ••• ••• 567")
    expect(maskPhone("353", "87123456789")).toBe("+353 ••• ••• 789")
    expect(maskPhone("353", "871234567")).not.toMatch(/\d{4}/)
    expect(maskLast3("821")).toBe("••• 821")
    expect(maskLast3(null)).toBe("No number")
  })
  test("the code is 6 digits", () => {
    expect(CODE_LENGTH).toBe(6)
    expect(cleanCode("12a34-5678")).toBe("123456")
    expect(canVerify("12345")).toBe(false)
    expect(canVerify("123456")).toBe(true)
  })
  test("resend timer counts down to 0 and stops", () => {
    expect(RESEND_SECONDS).toBe(30)
    expect(tickResend(30)).toBe(29)
    expect(tickResend(1)).toBe(0)
    expect(tickResend(0)).toBe(0)
    expect(countdown(24)).toBe("0:24")
    expect(countdown(5)).toBe("0:05")
  })
})

describe("what a person can choose", () => {
  const s = toState(raw())
  test("only the kinds the owner sends on WhatsApp, and only while it is Active and in the plan", () => {
    expect(enabledKinds(s.kinds, "not_connected", s.defaultVia, s.plan)).toEqual([])
    expect(enabledKinds(s.kinds, "connecting", s.defaultVia, s.plan)).toEqual([])
    expect(enabledKinds(s.kinds, "active", s.defaultVia, s.plan).map((k) => k.id)).toEqual(["task_assigned", "task_due", "report_due", "report_returned", "security"])
    expect(enabledKinds(s.kinds, "active", s.defaultVia, { ...s.plan, whatsapp: false })).toEqual([])
  })
  test("Send via: a kind on Default follows the tenant default; Both is always allowed", () => {
    const billing = s.kinds.find((k) => k.id === "billing")!
    expect(billing.via).toBe("default")
    expect(resolveVia(billing, "email")).toBe("email")
    expect(resolveVia(billing, "both")).toBe("both")
    expect(enabledKinds(s.kinds, "active", "both", s.plan).map((k) => k.id)).toContain("billing")
    expect(VIA_OPTIONS.map((o) => o.value)).toEqual(["email", "whatsapp", "both", "whatsapp_then_email"])
    expect(viaHasWhatsApp("both") && viaHasEmail("both")).toBe(true)
    expect(viaHasEmail("whatsapp")).toBe(false)
    expect(viaHasWhatsApp("email")).toBe(false)
    expect(viaHasWhatsApp("whatsapp_then_email") && viaHasEmail("whatsapp_then_email")).toBe(true)
  })
  test("plan note and usage bar", () => {
    expect(usageNote(s.plan)).toBe("Plan: 1,000 WhatsApp messages per month, 312 used")
    expect(usagePct(s.plan)).toBe(31)
    expect(usagePct({ ...s.plan, used: 5000 })).toBe(100)
    expect(usageNote({ ...s.plan, whatsapp: false })).toBe("WhatsApp is not in your plan.")
  })
  test("a staged number is Pending confirmation until the person confirms; clearing gives No number; an invite adds a row", () => {
    const novak = s.people.find((p) => p.email === "lilianna.novak@demo.example")!
    expect(novak.status).toBe("verified")
    const out = withStaged(s.people, { "lilianna.novak@demo.example": { country: "IE", national: "871234567" }, "seun.adeyemi@demo.example": null, "new.hire@demo.example": { country: "IE", national: "851112222" } })
    expect(out.find((p) => p.id === novak.id)).toMatchObject({ status: "pending", phoneLast3: "567" })
    expect(out.find((p) => p.name === "Seun Adeyemi")?.status).toBe("no_number")
    expect(out.at(-1)).toMatchObject({ email: "new.hire@demo.example", status: "pending", phoneLast3: "222" })
    expect(withStaged(s.people, {})).toEqual(s.people)
    expect(effectiveStatus("verified", undefined)).toBe("verified")
    expect(PERSON_STATUS.pending.label).toBe("Pending confirmation")
  })
  test("E.164 validation", () => {
    expect(validE164("353", "87 123 4567")).toBe(true)
    expect(validE164("353", "12345")).toBe(false)
    expect(validE164("353", "1234567890123")).toBe(false)
    expect(e164("353", "087 123 4567")).toBe("+353871234567")
  })
  test("people filters by status tab and search, counts per tab", () => {
    expect(filterPeople(s.people, "verified", "").every((p) => p.status === "verified")).toBe(true)
    expect(filterPeople(s.people, "all", "novak").map((p) => p.name)).toEqual(["Lilianna Novak"])
    expect(filterPeople(s.people, "opted_out", "zzz")).toEqual([])
    const c = peopleCounts(s.people)
    expect(c.verified + c.pending + c.no_number + c.opted_out).toBe(c.all)
  })
  test("message log filters by status and by recipient or template", () => {
    expect(filterMessages(s.messages, "failed", "").every((m) => m.status === "failed")).toBe(true)
    expect(filterMessages(s.messages, "all", "report_returned").length).toBe(1)
  })
})

describe("flag off: nothing renders, no route or nav entry", () => {
  test("the registry lists the manage page as a mock route; nav keeps nothing of it without the flag", () => {
    expect(isMockRoute("/settings/integrations/whatsapp")).toBe(true)
    expect(isMockRoute("/settings/integrations")).toBe(false)
    const nav = [{ href: "/settings" }, { href: "/settings/integrations/whatsapp" }]
    vi.stubEnv("ENABLE_MOCK_MODULES", "")
    expect(hideMockNav(nav).map((n) => n.href)).toEqual(["/settings"])
    vi.stubEnv("ENABLE_MOCK_MODULES", "1")
    expect(hideMockNav(nav)).toHaveLength(2)
  })
  test("the JSON reader is registered as a mock reader", () => {
    expect(MOCK_DATA_READERS["features/whatsapp/api.ts"]?.kind).toBe("mock")
  })
  test("the settings and account pages only compose WhatsApp behind mockEnabled()", () => {
    const settings = readFileSync(path.join(root, "app/(app)/settings/[tab]/page.tsx"), "utf8")
    const account = readFileSync(path.join(root, "app/(app)/account/[tab]/page.tsx"), "utf8")
    for (const src of [settings, account]) {
      expect(src).toMatch(/mockEnabled\(\)/)
      expect(src).toMatch(/const wa = mockEnabled\(\) \? await getWhatsApp\(\)/)
    }
  })
  test("the manage page starts with the gate before any data call", () => {
    const src = readFileSync(path.join(root, "app/(app)/settings/integrations/whatsapp/page.tsx"), "utf8")
    const body = src.slice(src.indexOf("export default"))
    expect(body).toMatch(/const off = mockGate\("WhatsApp"\)\s*\n\s*if \(off\) return off/)
    expect(body.indexOf("mockGate(")).toBeLessThan(body.search(/\bawait\b/))
  })
  test("mockEnabled is false for anything but '1'", () => {
    for (const v of [undefined, "", "0", "true"]) {
      vi.stubEnv("ENABLE_MOCK_MODULES", v as string)
      expect(mockEnabled()).toBe(false)
    }
  })
})
