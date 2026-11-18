import { readFileSync } from "node:fs"
import path from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import { MOCK_DATA_READERS, hideMockNav, isMockRoute, mockEnabled } from "@/lib/mock-registry"
import { toConnection, toPeople, toState } from "./adapters"
import {
  CODE_LENGTH, RESEND_SECONDS, canSendCode, canVerify, cleanCode, connectedCount, countdown, enabledKinds, filterMessages, filterPeople, maskLast3, maskPhone, nationalDigits,
  nextConnection, peopleCounts, tickResend, validNational,
} from "./logic"
import type { WaConnection } from "./types"

const root = path.resolve(__dirname, "../..")
const seed = (f: string) => JSON.parse(readFileSync(path.join(root, "public/data/whatsapp", f), "utf8")) as unknown
const raw = () => ({ connection: seed("connection.json"), kinds: seed("kinds.json"), people: seed("people.json"), messages: seed("messages.json"), templates: seed("templates.json"), countries: seed("countries.json"), self: seed("self.json") })

afterEach(() => vi.unstubAllEnvs())

describe("adapters", () => {
  test("the seed maps to the screen types", () => {
    const s = toState(raw())
    expect(s.connection.status).toBe("not_connected")
    expect(s.kinds.map((k) => k.id)).toEqual(["task_assigned", "task_due", "report_due", "report_returned", "roster_changed", "leave_decided", "billing", "security"])
    expect(s.kinds.find((k) => k.id === "security")).toMatchObject({ locked: true, enabled: true, delivery: "instant" })
    expect(s.people.length).toBeGreaterThan(8)
    expect(s.countries[0]).toMatchObject({ code: "IE", dial: "353" })
    expect(Object.keys(s.self.channels)).toEqual(s.kinds.map((k) => k.id))
  })
  test("an unknown status or a missing field is an error, not a half page", () => {
    expect(() => toConnection({ ...(seed("connection.json") as object), status: "on" })).toThrow(/connection.status/)
    expect(() => toConnection({ status: "active" })).toThrow()
    expect(() => toState({ ...raw(), kinds: { kinds: "nope" } })).toThrow(/kinds/)
  })
  test("a phone fragment longer than 3 digits is cut to the last 3 (no full number reaches the screen)", () => {
    const p = toPeople({ people: [{ id: "x", name: "A", role: "r", scope: { kind: "own", label: "l" }, status: "verified", phoneLast3: "353871234567", lastMessageAt: null }] })
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
    expect(canSendCode({ national: "87 123 4567", consent: false })).toBe(false)
    expect(canSendCode({ national: "87 123 4567", consent: true })).toBe(true)
  })
  test("and until the number is plausible", () => {
    expect(canSendCode({ national: "", consent: true })).toBe(false)
    expect(canSendCode({ national: "12345", consent: true })).toBe(false)
    expect(canSendCode({ national: "abc", consent: true })).toBe(false)
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
  test("only the kinds the admin enabled, and only while WhatsApp is Active", () => {
    expect(enabledKinds(s.kinds, "not_connected")).toEqual([])
    expect(enabledKinds(s.kinds, "connecting")).toEqual([])
    expect(enabledKinds(s.kinds, "active").map((k) => k.id)).toEqual(["task_assigned", "task_due", "report_due", "report_returned", "security"])
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
