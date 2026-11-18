import { PageHeadSkeleton } from "@/components/page-head"
import { Sk, SkGroup, SkMask } from "@/components/sk"
import { mockEnabled } from "@/lib/mock-registry"
import type { Live360, LiveAuditLine, LiveDataRequests, LiveMetrics, LiveStaff, LiveTenantList } from "../adapters"
import { Live360Header, LiveOverviewTab } from "./live-360"
import { LiveAudit } from "./live-audit"
import { LiveDataRequests as DataRequestsView } from "./live-data-requests"
import type { TenantTab } from "../types"
import { LiveOverview } from "./live-overview"
import { OverviewDashboard } from "./overview-dashboard"
import type { OverviewData } from "../overview"
import { LiveSettings } from "./live-settings"
import { GrantForm } from "./live-support"
import { LiveTeam } from "./live-team"
import { LiveTenants } from "./live-tenants"

// Exact-by-construction loading states (B6 T6.8, K1): each one renders the REAL view, masked (SkMask: text transparent, blocks tinted, inert), with typical static sample rows, so the
// layout, wraps and card structure are the loaded page's. No data layer is imported: a loading.tsx never asks the API anything. The row counts are the typical case (a page of
// 8 tenants, 5 audit lines); a smaller real page changes the height only below the last row.

const at = "2026-01-01T00:00:00.000Z"
const tenantRows = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, slug: "company-name", name: "Company name", status: "active" as const, planId: "business", plan: "Business", subscriptionStatus: "active", seats: 25, createdAt: at }))
const TENANTS: LiveTenantList = { rows: tenantRows, page: 1, pageSize: 100, total: 8 }
const METRICS: LiveMetrics = { mrr: [{ currency: "EUR", minor: 1000000 }], arr: [{ currency: "EUR", minor: 12000000 }], trials: 0, pastDue: 0, churn: 0 }
const T360: Live360 = {
  id: "00000000-0000-0000-0000-000000000000", slug: "company", name: "Company name", status: "active", suspended: false, timezone: "Europe/Dublin", currency: "EUR", locale: "en-IE", createdAt: at,
  planId: "business", plan: "Business", subscriptionStatus: "active", seats: 25, seatsUsed: 12, memberCount: 14, trialEndsAt: null, currentPeriodEnd: at, cancelAtPeriodEnd: false, hasProviderSubscription: true,
  overrides: [], lastActivityDate: "2026-01-01", openDataRequests: 0,
}
const AUDIT: LiveAuditLine[] = Array.from({ length: 5 }, (_, i) => ({ seq: i, at, actor: "usr_000000", action: "tenant.suspended", entity: "tenant", entityId: "00000000", tenantId: null, before: null, after: null }))
const REQUESTS: LiveDataRequests = { rows: Array.from({ length: 6 }, (_, i) => ({ id: `d${i}`, tenantId: "t", tenant: "Company name", kind: "export", kindLabel: "Export", status: "pending", createdAt: at, dueAt: at, overdue: false })), page: 1, pageSize: 100, total: 6 }
const STAFF: LiveStaff[] = Array.from({ length: 3 }, (_, i) => ({ id: `u${i}`, name: "Staff member", email: "staff@company.example", role: "support", mfa: true, lastSignInAt: null, status: "active", addedAt: at }))
// The owner's tabs: billing, usage and settings have no API yet and show only on a demo deployment (liveTabsFor).
const ALL_TABS: TenantTab[] = ["overview", "billing", "usage", "modules", "support", "audit", "settings"]
const LIVE_ONLY_TABS: TenantTab[] = ["overview", "modules", "support", "audit"]
const ALL = { suspend: true, support: true }

export const LiveTenantsSkeleton = () => <SkMask label="Loading tenants"><LiveTenants data={TENANTS} view="all" q="" can={ALL} /></SkMask>
// The sample sections of a demo deployment (ENABLE_MOCK_MODULES=1): the same grid as the loaded page, with the typical row counts (3 plans, 7 attention items, 8 activity lines).
const SAMPLE_MONTHS = Array.from({ length: 12 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, "0")}`, label: "Jan", mrr: 100000, new: 0, expansion: 0, contraction: 0, churn: 0 }))
const SAMPLE: OverviewData = {
  monthLabel: "Jan 2026", kpis: [], revenue: { currency: "EUR", series: SAMPLE_MONTHS },
  planMix: ["starter", "business", "enterprise"].map((id) => ({ id, name: "Plan name", paying: 1, trials: 0, total: "€100", share: 30, shareLabel: "30% of MRR" })),
  attention: Array.from({ length: 7 }, (_, i) => ({ id: `a${i}`, kind: "past_due" as const, tenantId: "t", tenant: "Company name", detail: "€100 overdue", due: at, when: "In 5 days", href: "/platform/tenants" })),
  activity: Array.from({ length: 8 }, (_, i) => ({ id: `e${i}`, at, actor: "Staff name", action: "tenant.suspended", target: "Company name", detail: "Support access requested" })),
}
export const LiveOverviewSkeleton = () => (
  <SkMask label="Loading overview">
    <LiveOverview metrics={METRICS} tenants={8} canRevenue mock={mockEnabled()}>
      <section className="pf-sample" aria-label="Sample data">
        <p className="pf-note pf-note-info">Sample data: MRR history, plan mix and activity have no API yet.</p>
        <OverviewDashboard sample skeleton data={SAMPLE} today="2026-01-01" tzLabel="Irish time" />
      </section>
    </LiveOverview>
  </SkMask>
)
export const Live360Skeleton = () => (
  <SkMask label="Loading tenant">
    <Live360Header t={T360} can={ALL} tabs={mockEnabled() ? ALL_TABS : LIVE_ONLY_TABS} />
    <LiveOverviewTab t={T360} />
  </SkMask>
)
/** Under the header only: the tab bodies' loading state (the header and tabs stay mounted). */
export const Live360TabSkeleton = () => <SkMask label="Loading"><LiveOverviewTab t={T360} /></SkMask>
export const LiveAuditSkeleton = () => <SkMask label="Loading audit log"><LiveAudit lines={AUDIT} /></SkMask>
export const LiveDataRequestsSkeleton = () => <SkMask label="Loading data requests"><DataRequestsView data={REQUESTS} /></SkMask>
export const LiveTeamSkeleton = () => <SkMask label="Loading team"><LiveTeam staff={STAFF} meId="" /></SkMask>
const SAMPLE_GRANTS = [1, 2, 3].map((i) => ({ id: `g${i}`, tenantId: "t", tenantName: "Company name", staffName: "Staff name", status: "active" as const, canRevoke: true, expiresAt: "2026-11-17T11:00:00.000Z", revokedAt: null }))
export const LiveSupportSkeleton = () => (
  <SkMask label="Loading support access">
    <div className="head"><div><h1>Support access</h1><p>Time-limited, read-only access to a tenant, with a reason</p></div></div>
    <GrantForm tenants={[{ id: "t", name: "Company name" }]} grants={SAMPLE_GRANTS} />
  </SkMask>
)
export const LiveSettingsSkeleton = () => <SkMask label="Loading settings"><LiveSettings email={{ configured: false }} storage={{ configured: false }} billing={{ configured: false }} canWrite /></SkMask>

/** The unbacked (mock) pages show their data only on a demo deployment, and a loading file cannot know which page it is for: a plain page-and-table shape. */
export function MockPageSkeleton() {
  return (
    <SkGroup label="Loading" className="sk-page">
      <PageHeadSkeleton actions={1} wrap />
      <div className="card pf-card">
        <div className="od-filters"><Sk w={140} h={48} r="pill" /><Sk h={48} r="pill" className="sk-fsearch" /></div>
        {Array.from({ length: 6 }, (_, i) => <Sk key={i} h={48} r={12} style={{ marginTop: 8 }} />)}
      </div>
    </SkGroup>
  )
}
