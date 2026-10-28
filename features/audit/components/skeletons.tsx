import { PageHeadSkeleton } from "@/components/page-head"
import { PagerSkeleton, needsPager, pageRows } from "@/components/pager-skeleton"
import { Sk, SkGroup } from "@/components/sk"
import { AUDIT_PAGE_SIZE } from "../filters"

// Mirrors AuditView: PageHead (Export CSV), .au-card with the note, the filter bar and the .rtable rows (same classes, same counts).
export function AuditSkeleton({ rows = 60 }: { rows?: number }) {
  return (
    <SkGroup label="Loading audit log" className="sk-page">
      <PageHeadSkeleton actions={[123]} btn={48} />
      <div className="card au-card">
        <p className="au-note">
          <Sk w={16} h={16} r={4} style={{ marginTop: 2 }} />
          {/* the note wraps to 2 lines at ≤900 and 3 on phones */}
          <span>
            <Sk w={420} h={12} lh={19} />
            <Sk w={300} h={12} lh={19} className="sk-wrap-md" />
            <Sk w={200} h={12} lh={19} className="sk-wrap" />
          </span>
        </p>
        <div className="od-filters">
          <Sk h={40} r="pill" className="sk-fsearch" />
          {[140, 140, 140].map((w, i) => (
            <span key={i} style={{ display: "contents" }}>
              <Sk w={w} h={40} r="pill" />
            </span>
          ))}
          {/* From / To date pickers: 44px controls, browser-measured widths at 1440 */}
          <Sk w={90} h={44} r={14} />
          <Sk w={71} h={44} r={14} />
        </div>
        <div className="table-wrap">
          <table className="rtable au-table">
            <thead>
              <tr>
                {[36, 40, 44, 48, 48].map((w, i) => (
                  <th key={i}><Sk w={w} h={10} lh={15.94} /></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: pageRows(rows, AUDIT_PAGE_SIZE) }, (_, i) => (
                <tr key={i}>
                  <td data-label="Time">
                    <Sk w={64} h={12} lh={18.84} />
                    <Sk w={84} h={10} lh={15.94} />
                  </td>
                  <td data-label="Actor">
                    <Sk w={96} h={12} lh={18.84} />
                    <Sk w={110} h={10} lh={15.94} />
                  </td>
                  <td data-label="Action"><Sk w={96} h={29.4} r={8} /></td>
                  <td data-label="Record">
                    <Sk w={70} h={12} lh={18.84} />
                    <Sk w={80} h={10} lh={15.94} />
                  </td>
                  <td data-label="Details"><Sk w={40} h={14} lh={20} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {needsPager(rows, AUDIT_PAGE_SIZE) && <PagerSkeleton rows={rows} size={AUDIT_PAGE_SIZE} />}
      </div>
    </SkGroup>
  )
}
