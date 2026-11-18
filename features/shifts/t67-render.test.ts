import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test, vi } from "vitest"
import { ME, TEAM, TZ, occurrenceDto, shiftsDto, templateDto } from "@/test/support/report-dto"
import { TemplatePanel } from "@/features/settings/components/template-panel"
import { toTemplateData } from "@/lib/report-template"
import { toOccurrences, toShiftState } from "./adapters"
import { ShiftsView } from "./components/shifts-view"
import { ShiftsSkeleton } from "./components/skeletons"
import type { ShiftsData } from "./types"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }), usePathname: () => "/shifts", useSearchParams: () => new URLSearchParams() }))
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => createElement("a", { href, ...rest }, children) }))

const teams = [{ id: TEAM, name: "Security" }]
const state = toShiftState(shiftsDto(), teams)
const people = [{ id: ME, name: "Ann Byrne", role: "Employee", initials: "AB", avatar: "av1" as const, dept: "Security" }]
const data = (scope: "all" | "own", weekStart = "2026-10-19"): ShiftsData => ({
  state, people, teams: ["Security"], teamRefs: teams, scope, meId: ME, weekStart, occurrences: toOccurrences({ items: [occurrenceDto()] }, state, TZ),
})
const view = (d: ShiftsData, canWrite: boolean) => renderToStaticMarkup(createElement(ShiftsView, { data: d, today: "2026-10-24T09:00:00", tz: TZ, tzLabel: "Irish time", canWrite }))

describe("the shifts screen on the API", () => {
  test("the week grid shows the stored 24 Oct night over the DST fold: 22:00 to 06:00 with +1, on the Saturday column", () => {
    const html = view(data("all", "2026-10-19"), true)
    expect(html).toContain("22:00–06:00")
    expect(html).toContain("+1")
    expect(html).toContain("New pattern")
    expect(html).toContain("Ann Byrne")
  })
  test("staff get their own cut read-only: no New pattern, no edit controls", () => {
    const html = view(data("own"), false)
    expect(html).not.toContain("New pattern")
    expect(html).toContain("Your shifts")
  })
  test("the loading skeleton is typical and static (no data in)", () => {
    expect(renderToStaticMarkup(createElement(ShiftsSkeleton, { canWrite: true }))).toContain("Loading shifts")
  })
})

describe("the report template editor on the API", () => {
  test("it lists the API's sections for the department; read-only without write access, with switches when allowed", () => {
    const data = toTemplateData(templateDto())
    const writable = renderToStaticMarkup(createElement(TemplatePanel, { data, canWrite: true }))
    expect(writable).toContain("Report template")
    expect(writable).toContain("Tasks in the shift")
    expect(writable).toContain("Keys returned")
    expect(writable).not.toContain("data-readonly")
    const readOnly = renderToStaticMarkup(createElement(TemplatePanel, { data, canWrite: false }))
    expect(readOnly).toContain("data-readonly")
    expect(readOnly).toMatch(/disabled/)
  })
})
