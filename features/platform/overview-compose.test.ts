import { readFileSync } from "node:fs"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { LiveOverview } from "./components/live-overview"
import { OverviewDashboard } from "./components/overview-dashboard"
import { overviewData } from "./overview"
import type { AuditEntry, DataRequest, Invoice, Plan, PlatformSeed, PlatformTenant, StaffMember, SubEvent, SupportRequest } from "./types"

// UI-fix regression: /platform rendered the API overview AND, under it, the whole mock overview (second header + old mock KPI row with numbers contradicting the API ones).
const read = <T,>(f: string): T => JSON.parse(readFileSync(`public/data/${f}`, "utf8"))
const seed = {
  tenants: read<{ tenants: PlatformTenant[] }>("platform/tenants.json").tenants,
  plans: read<Plan[]>("billing/plans.json"),
  invoices: read<{ invoices: Invoice[] }>("platform/invoices.json").invoices,
  requests: read<{ requests: SupportRequest[] }>("support/requests.json").requests,
  dataRequests: read<{ requests: DataRequest[] }>("platform/data-requests.json").requests,
  subscriptions: read<{ events: SubEvent[] }>("platform/subscriptions.json").events,
  audit: read<{ entries: AuditEntry[] }>("platform/audit.json").entries,
} as unknown as PlatformSeed
const today = read<{ today: string }>("shell/org.json").today
const owner: StaffMember = { id: "s", name: "S", email: "s@x", role: "owner", mfa: true, lastSignInAt: null, status: "active" }
const metrics = { mrr: [{ currency: "EUR", minor: 14900 }], arr: [{ currency: "EUR", minor: 178800 }], trials: 1, pastDue: 1, churn: 0 }

const sample = () => createElement(OverviewDashboard, { sample: true, data: overviewData(seed, today, owner), today, tzLabel: "UTC" })
const page = (mock: boolean) => renderToStaticMarkup(createElement(LiveOverview, { metrics, tenants: 3, canRevenue: true, mock }, sample()))

describe("platform overview composition", () => {
  const html = page(true)
  it("has exactly one Overview header", () => {
    expect(html.match(/<h1[^>]*>/g)).toHaveLength(1)
    expect(html.match(/>Overview</g)).toHaveLength(1)
  })
  it("shows the API KPI figures and none of the old mock KPI cards", () => {
    expect(html).toContain("€149")
    expect(html).toContain("€1,788")
    expect(html).not.toContain("Active tenants")
    expect(html).not.toContain("Net revenue retention")
    expect(html.match(/aria-label="Platform numbers"/g)).toHaveLength(1)
  })
  it("still shows the sample sections (MRR history, plan mix)", () => {
    expect(html).toContain("Monthly recurring revenue")
    expect(html).toContain("Plan mix")
  })
  it("renders no sample section when the mock flag is off", () => {
    const off = page(false)
    expect(off).not.toContain("Monthly recurring revenue")
    expect(off).not.toContain("Plan mix")
    expect(off).toContain("€149")
  })
})
