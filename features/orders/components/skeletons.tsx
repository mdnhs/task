import { PageHeadSkeleton } from "@/components/page-head"
import { PagerSkeleton, needsPager, pageRows } from "@/components/pager-skeleton"
import { Sk, SkGroup } from "@/components/sk"
import { ORDERS_PAGE_SIZE } from "../filters"

// Mirrors OrdersView: PageHead, the four .stat cards, then .card.ord-card with the filter bar and the .rtable rows.
// `rows` is the first tab's (Waiting approval) row count; `canWrite` adds the New request button.
export function OrdersSkeleton({ canWrite = true, rows = 4 }: { canWrite?: boolean; rows?: number }) {
  return (
    <SkGroup label="Loading orders and stock" className="sk-page">
      <PageHeadSkeleton actions={canWrite ? [156] : 0} />
      <section className="stats">
        {Array.from({ length: 4 }, (_, i) => (
          <article key={i} className="stat">
            <div className="stat-top">
              <Sk w="55%" h={14} lh={22} />
            </div>
            <Sk w={90} h={40} r={10} lh={46} className="sk-val" style={{ marginTop: "auto" }} />
            <Sk w="70%" h={11} lh={17} />
          </article>
        ))}
      </section>
      <div className="card ord-card">
        <div className="od-filters">
          <Sk h={40} r="pill" className="sk-fsearch" />
          {/* tab seg with count badges: 42px buttons + 4px padding */}
          <Sk w={307} h={50} r="pill" />
        </div>
        <div className="table-wrap">
          <table className="rtable ord-table">
            <thead>
              <tr>
                {[32, 52, 78, 52, 56, 52, 56].map((w, i) => (
                  <th key={i}><Sk w={w} h={10} lh={15.94} /></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: pageRows(rows, ORDERS_PAGE_SIZE) }, (_, i) => (
                <tr key={i}>
                  <td data-label="Item">
                    <Sk w={120} h={12} lh={18.84} />
                    <Sk w={86} h={10} lh={15.94} />
                  </td>
                  <td data-label="Supplier"><Sk w={64} h={12} lh={18.8} /></td>
                  <td data-label="Requested by">
                    <div>
                      <Sk w={96} h={12} lh={18.84} />
                      <Sk w={56} h={10} lh={15.94} />
                    </div>
                  </td>
                  <td data-label="Amount"><Sk w={44} h={12} lh={18.8} /></td>
                  <td data-label="Approval"><Sk w={120} h={29.4} r={8} /></td>
                  <td data-label="Delivery"><Sk w={92} h={29.4} r={8} /></td>
                  <td data-label="Expected"><Sk w={64} h={12} lh={18.8} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {needsPager(rows, ORDERS_PAGE_SIZE) && <PagerSkeleton rows={rows} size={ORDERS_PAGE_SIZE} />}
      </div>
    </SkGroup>
  )
}
