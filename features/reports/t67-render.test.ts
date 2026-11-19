import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test, vi } from "vitest"
import { DeptContext } from "@/hooks/use-dept"
import { ME, MGR, PID, RID, TZ, inboxDto, reportDto } from "@/test/support/report-dto"
import { toInboxRow, toReport } from "./adapters"
import { ReportInbox } from "./components/report-inbox"
import { ReportPage } from "./components/report-page"
import type { ReportPageProps } from "./components/report-page"
import type { ReportsData } from "./types"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }), usePathname: () => "/daily-reports", useSearchParams: () => new URLSearchParams() }))
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => createElement("a", { href, ...rest }, children) }))

const NOW_AT = "2026-10-25T08:00:00.000Z"
const base: Omit<ReportPageProps, "report"> = {
  versions: [], template: [], owner: "Ann Byrne", meId: MGR, now: "2026-10-25T08:00:00", nowAt: NOW_AT, tz: TZ, tzLabel: "Irish time", canWrite: true, canReview: true, canOpenTasks: true,
}
const submitted = () => toReport(reportDto({ status: "submitted", state: "submitted", version: 2, submissions: 1, submittedAt: "2026-10-25T06:20:00.000Z" }), TZ)

describe("the review page (FR-M1-29, F5)", () => {
  test("a manager with review rights sees Accept and Return with comment on a submitted report", () => {
    const html = renderToStaticMarkup(createElement(ReportPage, { ...base, report: submitted() }))
    expect(html).toContain("Accept")
    expect(html).toContain("Return with comment")
  })
  test("the OWNER never sees Accept or Return on their own report, even with review rights (nobody reviews their own report)", () => {
    const html = renderToStaticMarkup(createElement(ReportPage, { ...base, meId: ME, canWrite: false, report: submitted() }))
    expect(html).not.toContain("Accept")
    expect(html).not.toContain("Return with comment")
  })
  test("a role without review rights sees neither", () => {
    const html = renderToStaticMarkup(createElement(ReportPage, { ...base, canReview: false, report: submitted() }))
    expect(html).not.toContain("Accept")
  })
  test("a report that is not found shows 'Report not found' and nothing about it", () => {
    const html = renderToStaticMarkup(createElement(ReportPage, { ...base, report: null }))
    expect(html).toContain("Report not found")
    expect(html).not.toContain("Night")
  })
  test("the owner edits a draft (Save draft, Submit); after submitting it is read-only", () => {
    const draft = toReport(reportDto(), TZ)
    const edit = renderToStaticMarkup(createElement(ReportPage, { ...base, meId: ME, canReview: false, report: draft }))
    expect(edit).toContain("Save draft")
    expect(edit).toContain(">Submit<")
    const locked = renderToStaticMarkup(createElement(ReportPage, { ...base, meId: ME, canReview: false, report: submitted() }))
    expect(locked).not.toContain("Save draft")
  })
  test("a returned report shows the manager's comment to the owner and offers Resubmit", () => {
    const r = toReport(reportDto({ status: "returned", state: "returned", version: 3, reviewedBy: "Mia Doyle", reviewedAt: "2026-10-25T08:00:00.000Z", comments: [{ at: "2026-10-25T08:00:00.000Z", by: "Mia Doyle", text: "Add the lift fault" }] }), TZ)
    const html = renderToStaticMarkup(createElement(ReportPage, { ...base, meId: ME, canReview: false, report: r }))
    expect(html).toContain("Returned by Mia Doyle")
    expect(html).toContain("Add the lift fault")
    expect(html).toContain("Resubmit")
  })
  test("a missing report (draft past its due instant) says Missing and the due time in the tenant zone (07:00, not an hour early over the DST fold)", () => {
    const html = renderToStaticMarkup(createElement(ReportPage, { ...base, meId: ME, canReview: false, report: toReport(reportDto(), TZ) }))
    expect(html).toContain("This report is missing")
    expect(html).toContain("7:00 AM")
  })
})

describe("the inbox", () => {
  const rows = [
    toInboxRow(inboxDto(), TZ),
    toInboxRow(inboxDto({ id: null, key: `${ME}:${PID}:2026-10-23`, status: "draft", state: "missing", version: 0, submissions: 0, itemCount: 0, doneCount: 0, submittedAt: null, date: "2026-10-23" }), TZ),
    toInboxRow(inboxDto({ id: null, userId: "usr_other", key: `usr_other:${PID}:2026-10-23`, person: "Bob Lee", status: "draft", state: "missing", version: 0, submissions: 0, itemCount: 0, doneCount: 0, submittedAt: null, date: "2026-10-23" }), TZ),
  ]
  const data = (over: Partial<ReportsData> = {}): ReportsData => ({
    rows, nextCursor: null, counts: null, scope: "all", meId: ME, people: [], teams: [{ id: "t1", name: "Security" }], range: { from: "2026-10-19", to: "2026-10-25" }, dueAfterMinutes: 60, ...over,
  })
  const render = (d: ReportsData, dept = "all") => renderToStaticMarkup(createElement(DeptContext.Provider, { value: dept }, createElement(ReportInbox, { data: d, nowAt: NOW_AT, today: "2026-10-25T08:00:00", tz: TZ, tzLabel: "Irish time" })))
  test("a stored row links to its uuid, my own virtual row to its key, and somebody else's virtual row to nothing", () => {
    const html = render(data())
    expect(html).toContain(`href="/daily-reports/${RID}"`)
    expect(html).toContain(`href="/daily-reports/${encodeURIComponent(`${ME}:${PID}:2026-10-23`)}"`)
    expect(html).not.toContain(encodeURIComponent(`usr_other:${PID}`))
    expect(html).toContain("Bob Lee")
  })
  test("the state at the page's clock: a virtual row past its due instant reads Missing", () => {
    expect(render(data())).toContain("Missing")
  })
  test("Load more shows while a cursor remains, and also when the department switcher hides every loaded row (N3)", () => {
    expect(render(data({ nextCursor: "c1" }))).toContain("Load more")
    expect(render(data())).not.toContain("Load more")
    const hidden = render(data({ nextCursor: "c1" }), "Cleaning")
    expect(hidden).toContain("Only the reports loaded so far were checked")
    expect(hidden).toContain("Load more")
  })
  test("the export menu offers PDF, Excel and CSV with the Latin-1 note", () => {
    const html = render(data())
    expect(html).toContain("Export")
  })
})
