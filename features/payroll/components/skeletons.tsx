import { PageHeadSkeleton } from "@/components/page-head"
import { PagerSkeleton } from "@/components/pager-skeleton"
import { Sk, SkGroup } from "@/components/sk"
import { formatDate } from "@/lib/dates"
import { PAYROLL_PAGE_SIZE, STATUS, TYPE } from "../types"
import type { PayrollIssue } from "../types"

// Mirrors PayrollView: PageHead, the tracking banner, 4 stat cards and .card.pay-card (filters + .rtable rows).
// First page of issues (same order as the view), with a pager row when the seed has more; `canWrite` adds the Log issue button.
// Cell text renders as transparent `.sk-ghost` blocks (dashboard.css), so column widths and wraps match the loaded table.
export function PayrollSkeleton({ issues = [], canWrite = true }: { issues?: PayrollIssue[]; canWrite?: boolean }) {
  const g = (text: string) => <span className="sk-ghost">{text}</span>
  const sorted = [...issues].sort((a, b) => Number(a.status === "resolved") - Number(b.status === "resolved") || a.target.localeCompare(b.target) || a.ref.localeCompare(b.ref))
  return (
    <SkGroup label="Loading payroll issues" className="sk-page">
      <PageHeadSkeleton actions={canWrite ? [133] : 0} />
      <div className="pay-banner">
        <Sk w={20} h={20} r="circle" />
        <span>
          <Sk w={300} h={13} lh={19} />
          {/* the notice wraps to a second line on phones */}
          <Sk w={160} h={13} lh={19} className="sk-wrap" />
        </span>
      </div>
      <section className="stats">
        {Array.from({ length: 4 }, (_, i) => (
          <article key={i} className="stat pay-stat">
            <div className="stat-top"><Sk w="55%" h={14} lh={22} /></div>
            <Sk w={60} h={40} r={10} lh={46} className="sk-val" style={{ marginTop: "auto" }} />
            <Sk w="70%" h={11} lh={17} />
          </article>
        ))}
      </section>
      <div className="card pay-card">
        <div className="od-filters">
          <Sk h={40} r="pill" className="sk-fsearch" />
          <Sk w={140} h={40} r="pill" />
          <Sk w={140} h={40} r="pill" />
        </div>
        <div className="table-wrap">
          <table className="rtable pay-table">
            <thead>
              <tr>
                {[44, 36, 34, 40, 40, 44].map((w, i) => (
                  <th key={i}><Sk w={w} h={10} lh={15.94} /></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, PAYROLL_PAGE_SIZE).map((i) => (
                <tr key={i.ref}>
                  <td data-label="Issue">
                    <span className="tt pay-link">{g(i.description)}</span>
                    <div className="tm num">{g(i.ref)}</div>
                  </td>
                  <td data-label="Staff">
                    <div className="tt">{g(i.staff)}</div>
                    <div className="tm">{g(i.dept)}</div>
                  </td>
                  <td data-label="Type">{g(TYPE[i.type])}</td>
                  <td data-label="Owner">{g(i.owner)}</td>
                  <td data-label="Target" className="num">{g(formatDate(i.target))}</td>
                  <td data-label="Status"><span className="st sk-ghost">{STATUS[i.status].label}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {issues.length > PAYROLL_PAGE_SIZE && <PagerSkeleton rows={issues.length} size={PAYROLL_PAGE_SIZE} />}
      </div>
    </SkGroup>
  )
}
