import { PageHeadSkeleton } from "@/components/page-head"
import { PagerSkeleton, needsPager, pageRows } from "@/components/pager-skeleton"
import { Sk, SkGroup } from "@/components/sk"
import { Icon } from "@/components/icons"
import { formatDue, nowInTz } from "@/lib/dates"
import { AUDIT_PAGE_SIZE, SUPPORT_PAGE_SIZE, TENANTS_PAGE_SIZE } from "../constants"
import { effectiveStatus, formatLeft, isoSeconds } from "../logic"
import { REQUEST_STATUS } from "../types"
import type { AuditEntry, SupportRequest } from "../types"

// Mirrors the platform views. `lh` values are the line boxes the dashboard/tasks skeletons already use for the same classes.

function Th({ widths }: { widths: number[] }) {
  return (
    <thead>
      <tr>{widths.map((w, i) => <th key={i}><Sk w={w} h={10} lh={16} /></th>)}</tr>
    </thead>
  )
}

const CardHead = ({ title, sub }: { title: number; sub?: number }) => (
  <div className="card-head">
    <div>
      <Sk w={title} h={18} lh={28} />
      {sub && <Sk w={sub} h={11} lh={17} style={{ marginTop: 2 }} />}
    </div>
  </div>
)

export function OverviewSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <SkGroup label="Loading tenants" className="sk-page">
      <PageHeadSkeleton />
      <section className="stats">
        {Array.from({ length: 4 }, (_, i) => (
          <article key={i} className="stat">
            <div className="stat-top">
              <Sk w="55%" h={14} lh={22} />
              <Sk w={38} h={38} r="circle" />
            </div>
            <Sk w={90} h={40} r={10} lh={46} className="sk-val" style={{ marginTop: "auto" }} />
            <Sk w="70%" h={11} lh={17} />
          </article>
        ))}
      </section>
      <div className="card pf-card">
        <div className="od-filters">
          <Sk h={40} r="pill" className="sk-fsearch" />
          <Sk w={140} h={40} r="pill" />
          <Sk w={140} h={40} r="pill" />
        </div>
        <div className="table-wrap">
          <table className="rtable pf-table">
            <Th widths={[48, 70, 34, 44, 36, 48, 50, 34]} />
            <tbody>
              {Array.from({ length: pageRows(rows, TENANTS_PAGE_SIZE) }, (_, i) => (
                <tr key={i}>
                  <td data-label="Tenant"><Sk w={170} h={12} lh={19} /></td>
                  <td data-label="Subdomain"><Sk w={130} h={12} lh={19} /></td>
                  <td data-label="Plan"><Sk w={64} h={12} lh={19} /></td>
                  <td data-label="Status"><Sk w={84} h={29.4} r={8} /></td>
                  <td data-label="Users"><Sk w={24} h={12} lh={19} /></td>
                  <td data-label="Storage"><Sk w={52} h={12} lh={19} /></td>
                  <td data-label="Created"><Sk w={96} h={12} lh={19} /></td>
                  <td data-label="MRR"><Sk w={44} h={12} lh={19} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {needsPager(rows, TENANTS_PAGE_SIZE) && <PagerSkeleton rows={rows} size={TENANTS_PAGE_SIZE} />}
      </div>
    </SkGroup>
  )
}

const MetaSk = ({ n }: { n: number }) => (
  <dl className="pf-meta">
    {Array.from({ length: n }, (_, i) => (
      <div key={i}>
        <Sk w={56} h={10} lh={16} />
        <Sk w={110} h={13} lh={22} style={{ marginTop: 4 }} />
      </div>
    ))}
  </dl>
)

export function TenantDetailSkeleton() {
  return (
    <SkGroup label="Loading tenant" className="sk-page">
      <span className="pf-back"><Sk w={80} h={13} lh={20} /></span>
      <PageHeadSkeleton actions={[130]} />
      <div className="pf-grid">
        <div className="pf-col">
          <section className="card">
            <div className="card-head">
              <div>
                <Sk w={130} h={18} lh={28} />
                <Sk w={90} h={11} lh={17} style={{ marginTop: 2 }} />
              </div>
              <Sk w={84} h={29.4} r={8} />
            </div>
            <MetaSk n={5} />
          </section>
          <section className="card">
            <CardHead title={180} sub={80} />
            <ul className="pf-meters">
              {Array.from({ length: 4 }, (_, i) => (
                <li key={i}>
                  <div className="pf-meter-top">
                    <Sk w={90} h={12} lh={20} />
                    <Sk w={110} h={12} lh={20} />
                  </div>
                  <Sk h={8} r="pill" />
                </li>
              ))}
            </ul>
          </section>
        </div>
        <div className="pf-col">
          <section className="card pf-hidden">
            <Sk w={48} h={48} r="circle" />
            <Sk w={200} h={18} lh={28} />
            <Sk w="90%" h={12} lh={20} />
            <Sk w="75%" h={12} lh={20} />
            <Sk w={150} h={46} r={14} />
          </section>
          <section className="card">
            <CardHead title={90} />
            <ul className="pf-contacts">
              {Array.from({ length: 2 }, (_, i) => (
                <li key={i}>
                  <Sk w={60} h={10} lh={16} />
                  <Sk w={120} h={13} lh={20} />
                  <Sk w={190} h={12} lh={20} />
                </li>
              ))}
            </ul>
          </section>
          <section className="card">
            <CardHead title={120} />
            <MetaSk n={2} />
          </section>
        </div>
      </div>
    </SkGroup>
  )
}

export function PlansSkeleton({ plans = 3, modules = [4, 9, 11] }: { plans?: number; modules?: number[] }) {
  return (
    <SkGroup label="Loading plans" className="sk-page">
      <PageHeadSkeleton />
      <section className="pf-plans">
        {Array.from({ length: plans }, (_, i) => (
          <article key={i} className="card pf-plan">
            <div className="card-head">
              <div>
                <Sk w={110} h={18} lh={28} />
                <Sk w={150} h={11} lh={17} style={{ marginTop: 2 }} />
              </div>
              <Sk w={84} h={42.3} r={14} />
            </div>
            <Sk w={130} h={26} lh={39} />
            <dl className="pf-limits">
              {Array.from({ length: 4 }, (_, j) => (
                <div key={j}>
                  <Sk w={70} h={10} lh={16} />
                  <Sk w={60} h={13} lh={22} style={{ marginTop: 2 }} />
                </div>
              ))}
            </dl>
            <div>
              <Sk w={60} h={11} lh={18} />
              <ul className="pf-chips">
                {Array.from({ length: modules[i % modules.length] }, (_, k) => <li key={k}><Sk w={60 + ((k * 13) % 40)} h={19} r={6} /></li>)}
              </ul>
            </div>
          </article>
        ))}
      </section>
    </SkGroup>
  )
}

const ghost = (text: React.ReactNode) => <span className="sk-ghost">{text}</span>

// Same markup as <When>: relative day or date, plus the timezone label (in its own span) when it carries a time.
const whenText = (iso: string, today: string, tzLabel: string) => {
  const text = formatDue(iso, today)
  return <time className="od-when">{text}{text.includes(":") && tzLabel ? <span className="od-tz"> {tzLabel}</span> : null}</time>
}

// Cell text renders as transparent `.sk-ghost` blocks (dashboard.css), so column widths, wraps and row heights match the
// loaded table at every width. Granted rows get the same two action buttons (ghosted).
export function SupportSkeleton({ requests = [], audit = [], tenants = [], today = "", tzLabel = "", tz = "" }: {
  requests?: SupportRequest[]
  audit?: AuditEntry[]
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
      <section className="card pf-card">
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
      </section>
    </SkGroup>
  )
}
