import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test, vi } from "vitest"
import { DeptContext } from "@/hooks/use-dept"
import { EMPTY_REPORT_FILTERS } from "@/lib/shift-report"
import { ME, PID, TZ, inboxDto } from "@/test/support/report-dto"
import { toInboxCounts, toInboxRow } from "./adapters"
import { loadInbox } from "./api"
import { ReportInbox } from "./components/report-inbox"
import { lateText } from "./time"
import type { ReportsData } from "./types"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }), usePathname: () => "/daily-reports", useSearchParams: () => new URLSearchParams() }))
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => createElement("a", { href, ...rest }, children) }))

// B8 Task 24: the inbox header counts are the API's (`counts`, first page only, AG2) and "late" reads the API's real minutes (`minutesLate`).
const NOW_AT = "2026-10-25T08:00:00.000Z"
const COUNTS = { all: 9, open: 2, missing: 3, late: 1, returned: 2, accepted: 1 }
const late = toInboxRow(inboxDto({ state: "late", submittedAt: "2026-10-25T08:35:00.000Z", minutesLate: 95 }), TZ)
const missing = toInboxRow(inboxDto({ id: null, key: `${ME}:${PID}:2026-10-23`, status: "draft", state: "missing", version: 0, submissions: 0, itemCount: 0, doneCount: 0, submittedAt: null, date: "2026-10-23", minutesLate: 30 }), TZ)
const data = (over: Partial<ReportsData> = {}): ReportsData => ({
  rows: [late], nextCursor: null, counts: COUNTS, scope: "all", meId: ME, people: [], teams: [{ id: "t1", name: "Security" }], range: { from: "2026-10-19", to: "2026-10-25" }, dueAfterMinutes: 60, ...over,
})
const render = (d: ReportsData, status = "all", dept = "all") =>
  renderToStaticMarkup(createElement(DeptContext.Provider, { value: dept }, createElement(ReportInbox, { data: d, nowAt: NOW_AT, today: "2026-10-25T08:00:00", tz: TZ, tzLabel: "Irish time", initialFilters: { ...EMPTY_REPORT_FILTERS, status } })))
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")

describe("B8 Task 24: inbox counts and minutes from the API", () => {
  test("inbox status chips show API counts and match the list length under the same filter; minutes late formatted from API minutes", () => {
    const t = text(render(data(), "late"))
    for (const chip of ["All 9", "Late 1", "Missing 3", "Accepted 1", "Returned 2"]) expect(t, chip).toContain(chip)
    // under the Late filter the list holds exactly what the Late chip says, and the header total is the API's
    expect(t).toContain("1 report ·")
    expect(data().rows).toHaveLength(COUNTS.late)
    expect(t).toContain("1 h 35 min late")
    // a report nobody submitted yet is late by the API's minutes up to now
    expect(text(render(data({ rows: [missing], counts: { ...COUNTS, missing: 1 } }), "missing"))).toContain("Not submitted · 30 min late")
  })

  test("the header total is the API's count for the filter (not the loaded rows with a '+'), and the open figure is the API's", () => {
    const t = text(render(data({ rows: [late, missing], nextCursor: "c1" })))
    expect(t).toContain("9 reports ·")
    expect(t).not.toContain("2+ reports")
    expect(t).toContain("2 open")
  })

  test("without counts (a page after a cursor) or under the department switcher the header falls back to the loaded rows", () => {
    expect(text(render(data({ counts: null, rows: [late, missing], nextCursor: "c1" })))).toContain("2+ reports")
    const d = text(render(data({ rows: [late, missing] }), "all", "Cleaning"))
    expect(d).not.toContain("All 9") // the API's counts are not cut by the topbar department: no numbers then
  })

  test("lateText: real minutes, compact (0 = nothing)", () => {
    expect(lateText(0)).toBe("")
    expect(lateText(1)).toBe("1 min late")
    expect(lateText(60)).toBe("1 h late")
    expect(lateText(95)).toBe("1 h 35 min late")
    expect(lateText(60 * 24 * 2 + 180)).toBe("2 d 3 h late")
  })

  test("loadInbox keeps the API's counts of the first page; a page after a cursor answers null", async () => {
    const api = { get: vi.fn(async (_p: string, o: { query: { cursor?: string } }) => ({ items: [inboxDto()], nextCursor: null, counts: o.query.cursor ? null : COUNTS })) }
    expect((await loadInbox(api as never, TZ, {}, [])).counts).toEqual(COUNTS)
    expect((await loadInbox(api as never, TZ, {}, [], { cursor: "c1" })).counts).toBeNull()
    expect(() => toInboxCounts({ all: 1, open: 1 })).toThrow()
  })
})
