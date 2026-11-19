import { readFileSync } from "node:fs"
import path from "node:path"
import { createElement as h, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import { toState } from "./adapters"
import type { WaRaw } from "./adapters"
import type { WaState } from "./types"
import { WhatsAppAccountSection } from "./components/account-section"
import { WhatsAppCard, WhatsAppCount } from "./components/integration-card"
import { WhatsAppManageView } from "./components/manage-view"

const root = path.resolve(__dirname, "../..")
const seed = (f: string) => JSON.parse(readFileSync(path.join(root, "public/data/whatsapp", f), "utf8")) as unknown
const base = (): WaState => toState({ connection: seed("connection.json"), kinds: seed("kinds.json"), plan: seed("plan.json"), people: seed("people.json"), messages: seed("messages.json"), templates: seed("templates.json"), countries: seed("countries.json"), self: seed("self.json") } satisfies WaRaw)
const on = (s: WaState): WaState => ({ ...s, connection: { ...s.connection, status: "active" } })
const html = (n: ReactElement) => renderToStaticMarkup(n)
const card = (s: WaState, canWrite = true) => html(h("ul", null, h(WhatsAppCard, { initial: s, scope: "t-markup", today: "2026-10-20T09:00:00", tzLabel: "Irish time", canWrite })))

describe("Settings -> Integrations card", () => {
  test("not connected: same card structure as Google Drive, a Turn on button, no counts", () => {
    const h = card(base())
    expect(h).toContain("set-int wa-int")
    expect(h).toContain("Not connected")
    expect(h).toContain("Turn on")
    expect(h).toContain("Sends notifications to people&#x27;s WhatsApp, only what is in their scope.")
    expect(h).toContain("<b>Last event:</b> Never connected")
    expect(h).not.toContain("Manage")
    expect(h).not.toContain("wa-counts")
  })
  test("a read-only member sees no button", () => {
    expect(card(base(), false)).not.toContain("Turn on")
  })
  test("active: sending number, today's counts and a Manage link", () => {
    const h = card(on(base()))
    expect(h).toContain("Active")
    expect(h).toContain("+353 1 555 0142")
    expect(h).toMatch(/Sent<\/dt><dd class="num">42/)
    expect(h).toMatch(/Failed<\/dt><dd class="num">2/)
    expect(h).toContain('href="/settings/integrations/whatsapp"')
  })
  test("a plan without WhatsApp: Turn on is disabled and the upgrade hint shows", () => {
    const s = base()
    const h = card({ ...s, plan: { ...s.plan, whatsapp: false } })
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Turn on/)
    expect(h).toContain("Upgrade to turn it on")
  })
  test("the header counter becomes N of 2 connected", () => {
    expect(html(h(WhatsAppCount, { initial: base(), scope: "t-markup", base: 0, total: 2 }))).toBe("0 of 2 connected")
    expect(html(h(WhatsAppCount, { initial: on(base()), scope: "t-markup2", base: 0, total: 2 }))).toBe("1 of 2 connected")
  })
})

describe("Account -> Notifications section", () => {
  const sec = (s: WaState) => html(h(WhatsAppAccountSection, { initial: s, scope: "t-acc", email: "amara.bello@demo.example" }))
  test("admin has not turned it on: explanation, no form, STOP note still visible", () => {
    const h = sec(base())
    expect(h).toContain("Your admin has not turned WhatsApp on yet")
    expect(h).not.toContain("Send code")
    expect(h).toContain("Reply STOP to opt out anytime.")
  })
  test("plan without WhatsApp: its own explanation", () => {
    const s = base()
    expect(sec({ ...s, plan: { ...s.plan, whatsapp: false } })).toContain("WhatsApp is not in your workspace plan.")
  })
  test("on: opt-in sentence, phone input attributes, Send code disabled until consent", () => {
    const h = sec(on(base()))
    expect(h).toContain("I agree to get OpsDesk notifications on this WhatsApp number. I can reply STOP at any time to opt out.")
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Send code/)
    expect(h).toContain('inputMode="tel"')
    expect(h).toContain('autoComplete="tel-national"')
    expect(h).toContain("Ireland +353")
    expect(h).toContain("Reply STOP to opt out anytime.")
  })
  test("only the kinds the owner sends on WhatsApp are listed, the WhatsApp switches locked until verified", () => {
    const h = sec(on(base()))
    expect(h).toContain("Task assigned")
    expect(h).not.toContain("Roster published or changed")
    expect(h).not.toContain("Leave decided")
    expect(h).toContain("Verify your number to turn on WhatsApp.")
  })
  test("verified: the number is masked and can be removed", () => {
    const s = on(base())
    const h = sec({ ...s, self: { ...s.self, phase: "verified", national: "871234567" } })
    expect(h).toContain("+353 ••• ••• 567")
    expect(h).not.toContain("871234567")
    expect(h).toContain("Remove number")
    expect(h).toContain("Verified")
  })
})

describe("Management page", () => {
  const page = (s: WaState, canWrite = true) => html(h(WhatsAppManageView, { initial: s, scope: "t-man", today: "2026-10-20T09:00:00", tzLabel: "Irish time", canWrite }))
  test("off: an empty state, no tables", () => {
    const h = page(base())
    expect(h).toContain("WhatsApp is off")
    expect(h).not.toContain("<table")
  })
  test("on: Send via per kind, the plan note with a usage bar, default selector; never a message body", () => {
    const h = page(on(base()))
    expect(h).toContain("Send via")
    expect(h).toContain("Plan: 1,000 WhatsApp messages per month, 312 used")
    expect(h).toContain('role="progressbar"')
    expect(h).toContain("Default for all kinds")
    expect(h).toContain("Always both")
  })
  test("plan without WhatsApp: the upgrade hint and the controls are inert", () => {
    const s = on(base())
    const h = page({ ...s, plan: { ...s.plan, whatsapp: false } })
    expect(h).toContain("WhatsApp is not in your plan. Upgrade to send notifications on WhatsApp.")
    expect(h).toContain("inert")
  })
})
