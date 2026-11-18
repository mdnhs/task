import { PageHeadSkeleton } from "@/components/page-head"
import { Sk, SkGroup, SkMask } from "@/components/sk"
import type { Live360, LiveAuditLine, LiveDataRequests, LiveMetrics, LiveStaff, LiveTenantList } from "../adapters"
import { Live360Header, LiveOverviewTab } from "./live-360"
import { LiveAudit } from "./live-audit"
import { LiveDataRequests as DataRequestsView } from "./live-data-requests"
import { LiveOverview } from "./live-overview"
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
  id: "00000000-0000-0000-0000-000000000000", slug: "company-name", name: "Company name", status: "active", suspended: false, timezone: "Europe/Dublin", currency: "EUR", locale: "en-IE", createdAt: at,
  planId: "business", plan: "Business", subscriptionStatus: "active", seats: 25, seatsUsed: 12, memberCount: 14, trialEndsAt: null, currentPeriodEnd: at, cancelAtPeriodEnd: false, hasProviderSubscription: true,
  overrides: [], lastActivityDate: "2026-01-01", openDataRequests: 0,
}
const AUDIT: LiveAuditLine[] = Array.from({ length: 5 }, (_, i) => ({ seq: i, at, actor: "usr_000000", action: "tenant.suspended", entity: "tenant", entityId: "00000000", tenantId: null, before: null, after: null }))
const REQUESTS: LiveDataRequests = { rows: Array.from({ length: 6 }, (_, i) => ({ id: `d${i}`, tenantId: "t", tenant: "Company name", kind: "export", kindLabel: "Export", status: "pending", createdAt: at, dueAt: at, overdue: false })), page: 1, pageSize: 100, total: 6 }
const STAFF: LiveStaff[] = Array.from({ length: 3 }, (_, i) => ({ id: `u${i}`, name: "Staff member", email: "staff@company.example", role: "support", mfa: true, lastSignInAt: null, status: "active", addedAt: at }))
const ALL = { suspend: true, support: true }

export const LiveTenantsSkeleton = () => <SkMask label="Loading tenants"><LiveTenants data={TENANTS} view="all" q="" can={ALL} /></SkMask>
export const LiveOverviewSkeleton = () => <SkMask label="Loading overview"><LiveOverview metrics={METRICS} tenants={8} canRevenue mock={false} /></SkMask>
export const Live360Skeleton = () => (
  <SkMask label="Loading tenant">
    <Live360Header t={T360} can={ALL} tabs={["overview", "modules", "support", "audit"]} />
    <LiveOverviewTab t={T360} />
  </SkMask>
)
/** Under the header only: the tab bodies' loading state (the header and tabs stay mounted). */
export const Live360TabSkeleton = () => <SkMask label="Loading"><LiveOverviewTab t={T360} /></SkMask>
export const LiveAuditSkeleton = () => <SkMask label="Loading audit log"><LiveAudit lines={AUDIT} /></SkMask>
export const LiveDataRequestsSkeleton = () => <SkMask label="Loading data requests"><DataRequestsView data={REQUESTS} /></SkMask>
export const LiveTeamSkeleton = () => <SkMask label="Loading team"><LiveTeam staff={STAFF} meId="" /></SkMask>
export const LiveSupportSkeleton = () => (
  <SkMask label="Loading support access">
    <div className="head"><div><h1>Support access</h1><p>Time-limited, read-only access to a tenant, with a reason</p></div></div>
    <GrantForm tenants={[{ id: "t", name: "Company name" }]} />
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
