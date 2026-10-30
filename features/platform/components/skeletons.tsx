import { PageHeadSkeleton } from "@/components/page-head"
import { PagerSkeleton } from "@/components/pager-skeleton"
import { Sk, SkGroup, SkMask } from "@/components/sk"
import { Icon } from "@/components/icons"
import { formatDue, nowInTz } from "@/lib/dates"
import { AUDIT_PAGE_SIZE, PLAN_EDIT_SUBTITLE, PLAN_NEW_SUBTITLE, SUPPORT_PAGE_SIZE } from "../constants"
import { effectiveStatus, formatLeft, isoSeconds, limitLabel, priceLabel } from "../logic"
import { TRIAL_LABEL } from "../plans"
import { LIMITS, REQUEST_STATUS } from "../types"
import type { SupportRequest } from "../types"
import type { SupportAuditLine } from "../support"
import type { OverviewData } from "../overview"
import { OverviewDashboard } from "./overview-dashboard"
import { PlansView } from "./plans-view"
import { TenantsView } from "./tenants-view"
import { BillingLedger } from "./billing-ledger"
import { DataRequestsView } from "./data-requests-view"
import { AuditLogView } from "./audit-log-view"
import { SettingsView } from "./settings-view"
import { TeamView } from "./team-view"

// Mirrors the platform views. `lh` values are the line boxes the dashboard/tasks skeletons already use for the same classes.

const CardHead = ({ title, sub }: { title: number; sub?: number }) => (
  <div className="card-head">
    <div>
      <Sk w={title} h={18} lh={28} />
      {sub && <Sk w={sub} h={11} lh={17} style={{ marginTop: 2 }} />}
    </div>
  </div>
)

// The billing ledger: the real ledger, masked (SkMask), from the same gate, view model and saved view as the page.
export function BillingSkeleton(props: React.ComponentProps<typeof BillingLedger>) {
  return (
    <SkMask label="Loading billing">
      <BillingLedger {...props} />
    </SkMask>
  )
}

// The data requests queue: the real view, masked (SkMask), from the same gate, view model and saved view as the page.
export function DataRequestsSkeleton(props: React.ComponentProps<typeof DataRequestsView>) {
  return (
    <SkMask label="Loading data requests">
      <DataRequestsView {...props} />
    </SkMask>
  )
}

// Task 9: the audit log, team and settings pages: the real views, masked (SkMask), from the same gate and view models.
export function AuditLogSkeleton(props: React.ComponentProps<typeof AuditLogView>) {
  return (
    <SkMask label="Loading audit log">
      <AuditLogView {...props} />
    </SkMask>
  )
}
export function TeamSkeleton(props: React.ComponentProps<typeof TeamView>) {
  return (
    <SkMask label="Loading team">
      <TeamView {...props} />
    </SkMask>
  )
}
export function SettingsSkeleton(props: React.ComponentProps<typeof SettingsView>) {
  return (
    <SkMask label="Loading settings">
      <SettingsView {...props} />
    </SkMask>
  )
}

// Tenant 360 (Task 5): the real header and tab, masked, from the same gate and view models as the routes. `[id]/loading.tsx`
// masks the header and the tab (or a long-form page); `[tab]/loading.tsx` masks only the tab, under the live header.
export function Tenant360Skeleton({ label = "Loading tenant", children }: { label?: string; children: React.ReactNode }) {
  return <SkMask label={label}>{children}</SkMask>
}

// The tenants list: the real view, masked (SkMask), from the same view model and saved view as the page.
export function TenantsSkeleton(props: React.ComponentProps<typeof TenantsView>) {
  return (
    <SkMask label="Loading tenants">
      <TenantsView {...props} />
    </SkMask>
  )
}

// The plans comparison: the real view, masked (SkMask), from the same gate and view model as the page.
export function PlansSkeleton(props: React.ComponentProps<typeof PlansView>) {
  return (
    <SkMask label="Loading plans">
      <PlansView {...props} />
    </SkMask>
  )
}

const ghost = (text: React.ReactNode) => <span className="sk-ghost">{text}</span>

// Mirrors PlanEditView (plan-form.tsx): same classes, real labels as ghost text; only the plan's name and values are blocks.
// `currency`: the plans' shared currency (unknown here when plans differ, then the price label is a block).
const PlanFieldSk = ({ label, req = true, hint }: { label?: string; req?: boolean; hint?: string }) => (
  <div className="od-field">
    {label ? <label>{ghost(label)}{req && <span className="od-req" aria-hidden="true"> *</span>}</label> : <Sk w={130} h={11} lh={18.1} />}
    <Sk h={44} r={14} />
    {hint && <div className="od-field-msg"><p className="od-field-hint">{ghost(hint)}</p></div>}
  </div>
)

export function PlanEditSkeleton({ modules, currency }: { modules: string[]; currency?: string }) {
  return (
    <SkGroup label="Loading plan" className="sk-page">
      <span className="pf-back">{ghost("← Plans")}</span>
      <div className="head">
        <div>
          <span className="sk-line sk-h1"><Sk w={300} h="var(--sk-h1,32px)" r={10} /></span>
          <p>{ghost(PLAN_EDIT_SUBTITLE)}</p>
        </div>
      </div>
      <div className="card pf-form od-form">
        <div className="od-form-cols">
          <div className="od-form-col">
            <PlanFieldSk label={currency ? priceLabel(currency) : undefined} />
            <div className="od-row2">
              {LIMITS.map((l) => <PlanFieldSk key={l.key} label={limitLabel(l)} />)}
            </div>
          </div>
          <div className="od-form-col">
            <fieldset className="pf-modset">
              <legend>{ghost("Modules")}</legend>
              {modules.map((m) => (
                <span key={m} className="pf-mod">
                  {ghost(m)}
                  <Sk w={40} h={24} r="pill" style={{ flex: "none" }} />
                </span>
              ))}
            </fieldset>
          </div>
        </div>
        <div className="od-form-foot">
          <span className="btn btn-outline sk-ghost-btn">Cancel</span>
          <span className="btn btn-primary sk-ghost-btn">Save plan</span>
        </div>
      </div>
    </SkGroup>
  )
}

// Mirrors PlanNewView / NewPlanForm (plan-form.tsx): every label is real text, nothing in the form is data.
export function PlanNewSkeleton({ modules, currency }: { modules: string[]; currency?: string }) {
  return (
    <SkGroup label="Loading new plan" className="sk-page">
      <span className="pf-back">{ghost("← Plans")}</span>
      <div className="head">
        <div>
          <h1><span className="sk-ghost">New plan</span></h1>
          <p>{ghost(PLAN_NEW_SUBTITLE)}</p>
        </div>
      </div>
      <div className="card pf-form od-form">
        <div className="od-form-cols">
          <div className="od-form-col">
            <div className="od-row2">
              <PlanFieldSk label="Plan ID" />
              <PlanFieldSk label="Name" />
            </div>
            <div className="od-row2">
              <PlanFieldSk label={currency ? priceLabel(currency) : undefined} />
              <PlanFieldSk label={TRIAL_LABEL} />
            </div>
            <div className="od-row2">
              {LIMITS.map((l) => <PlanFieldSk key={l.key} label={limitLabel(l)} />)}
            </div>
          </div>
          <div className="od-form-col">
            <fieldset className="pf-modset">
              <legend>{ghost("Modules")}</legend>
              {modules.map((m) => (
                <span key={m} className="pf-mod">
                  {ghost(m)}
                  <Sk w={40} h={24} r="pill" style={{ flex: "none" }} />
                </span>
              ))}
            </fieldset>
            <PlanFieldSk label="Reason" req={false} hint="Optional. Saved in the audit trail." />
          </div>
        </div>
        <div className="od-form-foot">
          <span className="btn btn-outline sk-ghost-btn">Cancel</span>
          <span className="btn btn-primary sk-ghost-btn">Create plan</span>
        </div>
      </div>
    </SkGroup>
  )
}

// Same markup as <When>: relative day or date, plus the timezone label (in its own span) when it carries a time.
const whenText = (iso: string, today: string, tzLabel: string) => {
  const text = formatDue(iso, today)
  return <time className="od-when">{text}{text.includes(":") && tzLabel ? <span className="od-tz"> {tzLabel}</span> : null}</time>
}

// Cell text renders as transparent `.sk-ghost` blocks (dashboard.css), so column widths, wraps and row heights match the
// loaded table at every width. Granted rows get the same two action buttons (ghosted).
export function SupportSkeleton({ requests = [], audit = [], tenants = [], today = "", tzLabel = "", tz = "" }: {
  requests?: SupportRequest[]
  /** null without audit.read: the page hides the audit card, so the skeleton does too. */
  audit?: SupportAuditLine[] | null
  tenants?: { id: string; name: string }[]
  today?: string
  tzLabel?: string
  /** Org timezone: with it, grants that have run out read as expired and countdowns have their real width. */
  tz?: string
}) {
  const now = tz ? isoSeconds(nowInTz(today, tz, new Date())) : null
  const names = new Map(tenants.map((t) => [t.id, t.name]))
  return (
    <SkGroup label="Loading support access" className="sk-page">
      <PageHeadSkeleton actions={1} wrap />
      <div className="card pf-card">
        <div className="od-filters">
          <Sk h={40} r="pill" className="sk-fsearch" />
          <Sk w={140} h={40} r="pill" />
        </div>
        <div className="table-wrap">
          <table className="rtable pf-table pf-support">
            <thead>
              <tr>
                {["Request", "Tenant", "Requester", "Reason", "Status", "Expires"].map((h) => <th key={h}>{ghost(h)}</th>)}
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {requests.slice(0, SUPPORT_PAGE_SIZE).map((r) => {
                const eff = now === null ? r.status : effectiveStatus(r, now)
                const left = now !== null && r.expiresAt ? formatLeft(isoSeconds(r.expiresAt) - now) : null
                return (
                <tr key={r.id}>
                  <td data-label="Request">
                    <div className="tt num">{ghost(r.id)}</div>
                    <div className="tm num">{ghost(whenText(r.requestedAt, today, tzLabel))}</div>
                  </td>
                  <td data-label="Tenant" className="tt">{ghost(names.get(r.tenantId) ?? r.tenantId)}</td>
                  <td data-label="Requester">{ghost(r.requester)}</td>
                  <td data-label="Reason" className="pf-reason">{ghost(r.reason)}</td>
                  <td data-label="Status"><span className="st sk-ghost">{REQUEST_STATUS[eff].label}</span></td>
                  <td data-label="Expires" className="num">{r.expiresAt ? ghost(whenText(r.expiresAt, today, tzLabel)) : "—"}</td>
                  <td className="pf-acts">
                    {eff === "granted" && r.expiresAt && (
                      <>
                        <span className="btn btn-primary pf-act sk-ghost-btn"><Icon name="badge" />View as support<span className="pf-count num">{left ? `${left} left` : "--:--:--"}</span></span>
                        <span className="btn btn-outline pf-act sk-ghost-btn">Revoke</span>
                      </>
                    )}
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {requests.length > SUPPORT_PAGE_SIZE && <PagerSkeleton rows={requests.length} size={SUPPORT_PAGE_SIZE} />}
      </div>
      {audit && <section className="card pf-card">
        <CardHead title={190} sub={260} />
        <ul className="pf-audit">
          {audit.slice(0, AUDIT_PAGE_SIZE).map((e) => (
            <li key={e.id}>
              <div className="pf-aud-main">
                <span className="tt">{ghost(e.target)}</span>
                <span className="pf-aud-act">{ghost(e.action)}</span>
              </div>
              <p>{ghost(e.detail)}</p>
              <div className="tm num">{ghost(<>{e.actor} · {whenText(e.at, today, tzLabel)}</>)}</div>
            </li>
          ))}
        </ul>
        {audit.length > AUDIT_PAGE_SIZE && <PagerSkeleton rows={audit.length} size={AUDIT_PAGE_SIZE} />}
      </section>}
    </SkGroup>
  )
}

// /platform overview: the real dashboard with its real view model, masked (SkMask), charts as plain blocks.
// The loading route builds the same view model as the page, so counts, wrapping and card heights match by construction.
export function OverviewDashboardSkeleton(props: { data: OverviewData; today: string; tzLabel: string }) {
  return (
    <SkMask label="Loading Overview">
      <OverviewDashboard {...props} skeleton />
    </SkMask>
  )
}

// A route whose gate will refuse the viewer: no data at all, just the page head.
export function DeniedSkeleton() {
  return (
    <SkGroup label="Loading">
      <PageHeadSkeleton />
    </SkGroup>
  )
}
