import { Sk } from "@/components/sk"
import { pageList } from "@/lib/paginate"

// Mirrors DataPagination on page 1 (same .od-pager row, 36px items). Rendered only when rows > size, like the real pager.
// Previous is disabled-looking but present; Previous/Next shrink to 36px circles at <=640px (.od-pager-sk-step).
export function PagerSkeleton({ rows, size }: { rows: number; size: number }) {
  const pageCount = Math.ceil(rows / size)
  return (
    <div className="od-pager">
      <Sk w={120} h={13} lh={19} className="od-pager-sk-sum" />
      <div className="od-pager-nav">
        <ul className="od-pager-sk-list">
          <li><Sk w={100} h={36} r="pill" className="od-pager-sk-step" /></li>
          {pageList(1, pageCount).map((n, i) => (
            <li key={i}><Sk w={36} h={36} r="pill" /></li>
          ))}
          <li><Sk w={76} h={36} r="pill" className="od-pager-sk-step" /></li>
        </ul>
      </div>
    </div>
  )
}

/** Rows a skeleton table shows: the first page at most, like the real table. */
export const pageRows = (rows: number, size: number) => Math.min(rows, size)
export const needsPager = (rows: number, size: number) => rows > size
