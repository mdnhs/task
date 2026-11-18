import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import { LiveSettings } from "./components/live-settings"
import { fakeApi } from "@/test/support/fake-api"
import { nextSection, parseSection, sectionHref, SETTINGS_SECTIONS } from "./settings-sections"
import { vi } from "vitest"

vi.mock("./components/use-platform", () => ({ usePlatform: () => ({ client: fakeApi, act: async () => ({ ok: false }) }) }))
vi.mock("@/components/data-pagination", () => ({ useSlideDir: () => undefined }))

describe("settings sections (vertical tabs)", () => {
  test("parseSection: valid ids pass, anything else falls back to email", () => {
    expect(parseSection("billing")).toBe("billing")
    expect(parseSection("storage")).toBe("storage")
    expect(parseSection(["storage", "billing"])).toBe("storage")
    expect(parseSection("nope")).toBe("email")
    expect(parseSection(undefined)).toBe("email")
    expect(parseSection(null)).toBe("email")
  })
  test("sectionHref keeps the default URL clean", () => {
    expect(sectionHref("/platform/settings", "email")).toBe("/platform/settings")
    expect(sectionHref("/platform/settings", "billing")).toBe("/platform/settings?section=billing")
  })
  test("keyboard: arrows wrap, Home/End jump, other keys ignored", () => {
    expect(nextSection("email", "ArrowDown")).toBe("storage")
    expect(nextSection("billing", "ArrowDown")).toBe("email")
    expect(nextSection("email", "ArrowUp")).toBe("billing")
    expect(nextSection("storage", "ArrowRight")).toBe("billing")
    expect(nextSection("storage", "ArrowLeft")).toBe("email")
    expect(nextSection("storage", "Home")).toBe("email")
    expect(nextSection("storage", "End")).toBe("billing")
    expect(nextSection("storage", "a")).toBeNull()
    expect(SETTINGS_SECTIONS.map((s) => s.id)).toEqual(["email", "storage", "billing"])
  })
  test("server markup: the URL section is the visible panel on first paint, roles and ids line up, no secret is rendered", () => {
    const html = renderToStaticMarkup(
      createElement(LiveSettings, {
        email: { configured: true, fromAddress: "a@b.test", fromName: "N", keyHint: "••••abcd", updatedAt: "2026-01-01T00:00:00.000Z" },
        storage: { configured: false },
        billing: { configured: false },
        canWrite: true,
        section: "billing",
      }),
    )
    expect(html).toContain('role="tablist"')
    expect(html.match(/role="tab"/g)).toHaveLength(3)
    expect(html).toMatch(/id="pf-tab-billing"[^>]*aria-selected="true"/)
    expect(html).toMatch(/id="pf-tab-email"[^>]*aria-selected="false"/)
    expect(html).toContain('aria-controls="pf-panel-billing"')
    expect(html).toMatch(/id="pf-panel-email"[^>]*hidden/)
    expect(html).not.toMatch(/id="pf-panel-billing"[^>]*hidden/)
    // secrets stay write-only: password inputs render empty, only the last-4 hint is shown
    expect(html).not.toMatch(/type="password"[^>]*value="[^"]+"/)
    expect(html).toContain("Stored: ••••abcd")
  })
})
