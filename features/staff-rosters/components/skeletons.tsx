import { PageHeadSkeleton } from "@/components/page-head"
import {
  PagerSkeleton,
  needsPager,
  pageRows,
} from "@/components/pager-skeleton"
import { Sk, SkGroup } from "@/components/sk"
import { STAFF_PAGE_SIZE, WHEN_ORDER } from "../types"
import type { RosterGap } from "../types"

/** Group sizes (Today / Tomorrow / Next week) of the first gaps page, in the view's default order; empty groups are dropped. */
export function gapGroups(gaps: Pick<RosterGap, "when">[]) {
  const first = [...gaps]
    .sort((a, b) => WHEN_ORDER.indexOf(a.when) - WHEN_ORDER.indexOf(b.when))
    .slice(0, STAFF_PAGE_SIZE)
  return WHEN_ORDER.map((w) => first.filter((g) => g.when === w).length).filter(
    Boolean
  )
}

// Mirrors StaffRostersView on its default Attendance tab: PageHead, the 4 stat cards, and .sr-card with the filter bar
// (view seg, search, type + status selects) and the .rtable rows. Rows are capped at the page size, with a pager row when
// the seed has more. `canWrite` adds the Log incident button.
export function StaffRostersSkeleton({
  canWrite = true,
  rows = 12,
  tab = "attendance",
  groups,
}: {
  canWrite?: boolean
  rows?: number
  tab?: "attendance" | "gaps"
  /** gaps tab: first-page group sizes from gapGroups() */
  groups?: number[]
}) {
  return (
    <SkGroup label="Loading staff and rosters" className="sk-page">
      <PageHeadSkeleton actions={canWrite ? [154] : 0} />
      <section className="stats">
        {Array.from({ length: 4 }, (_, i) => (
          <article key={i} className="stat">
            <div className="stat-top">
              <Sk w="55%" h={14} lh={22} />
            </div>
            <Sk
              w={90}
              h={40}
              r={10}
              lh={46}
              className="sk-val"
              style={{ marginTop: "auto" }}
            />
            <Sk w="70%" h={11} lh={17} />
          </article>
        ))}
      </section>
      <div className="card sr-card">
        {tab === "gaps" ? (
          <GapsBodySkeleton
            rows={rows}
            groups={groups ?? [pageRows(rows, STAFF_PAGE_SIZE)]}
          />
        ) : (
          <>
            <div className="od-filters">
              <Sk w={232} h={50} r="pill" />
              <Sk h={40} r="pill" className="sk-fsearch" />
              <Sk w={140} h={40} r="pill" />
              <Sk w={140} h={40} r="pill" />
            </div>
            <div className="table-wrap">
              <table className="rtable sr-table">
                <thead>
                  <tr>
                    {[56, 36, 30, 36, 40, 44].map((w, i) => (
                      <th key={i}>
                        <Sk w={w} h={10} lh={16} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from(
                    { length: pageRows(rows, STAFF_PAGE_SIZE) },
                    (_, i) => (
                      <tr key={i}>
                        <td data-label="Incident">
                          <Sk w={150} h={12} lh={18.84} className="sk-2l" />
                          <Sk w={120} h={10} lh={15.94} className="sk-2s" />
                        </td>
                        <td data-label="Staff">
                          <Sk w={90} h={12} lh={18.84} />
                          <Sk w={56} h={10} lh={15.94} />
                        </td>
                        <td data-label="Site">
                          <Sk w={96} h={12} lh={18.84} />
                          <Sk w={110} h={10} lh={15.94} />
                        </td>
                        <td data-label="Cover">
                          <Sk w={90} h={12} lh={18.84} />
                        </td>
                        <td data-label="Owner">
                          <Sk w={90} h={12} lh={18.84} />
                        </td>
                        <td data-label="Status">
                          <Sk w={72} h={29.4} r={8} />
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
            {needsPager(rows, STAFF_PAGE_SIZE) && (
              <PagerSkeleton rows={rows} size={STAFF_PAGE_SIZE} />
            )}
          </>
        )}
      </div>
    </SkGroup>
  )
}

// Roster gaps tab body (`rows` = gap count): filter bar (view seg, search, coverage select), one grouped list of .sr-row
// items (title + two summary lines on the left, pill + assigned + owner on the right) and the pager.
function GapsBodySkeleton({
  rows,
  groups,
}: {
  rows: number
  groups: number[]
}) {
  return (
    <>
      <div className="od-filters">
        <Sk w={232} h={50} r="pill" />
        <Sk h={40} r="pill" className="sk-fsearch" />
        <Sk w={140} h={40} r="pill" />
      </div>
      <div className="sr-groups">
        {groups.map((n, g) => (
          <section key={g} className="sr-group">
            <div className="sr-group-h">
              <Sk w={64} h={13} lh={20} />
            </div>
            <ul className="sr-list">
              {Array.from({ length: n }, (_, i) => (
                <li key={i}>
                  <div className="sr-row">
                    <span className="sr-main">
                      <Sk w={200} h={14} lh={20} />
                      <Sk w={260} h={11} lh={19} className="sk-sum2" />
                      <Sk w={180} h={11} lh={19} />
                    </span>
                    {/* browser-measured: the pill is 31px here (19px line), widths are the seed's typical ones so the ≤760 row wraps the same */}
                    <span className="sr-meta">
                      <Sk w={88} h={31} r={8} />
                      <Sk w={79} h={12} lh={19} />
                      <Sk w={127} h={12} lh={19} />
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {needsPager(rows, STAFF_PAGE_SIZE) && (
        <PagerSkeleton rows={rows} size={STAFF_PAGE_SIZE} />
      )}
    </>
  )
}

// /staff-rosters/gaps/[id] for an id loading.tsx cannot look up (known ids render the real GapPage under SkMask):
// back link, PageHead (title, coverage pill + ref, Update cover), and the card with the 8-row detail list and one history entry.
export function GapPageSkeleton({ canWrite = true }: { canWrite?: boolean }) {
  return (
    <SkGroup label="Loading roster gap" className="sk-page">
      <Sk w={110} h={12} lh={20} className="sr-back" />
      <PageHeadSkeleton actions={canWrite ? [133] : 0} sub={150} />
      <div className="card sr-page-card">
        <dl className="sr-dl">
          {[70, 200, 180, 150, 110, 110, 220, 160].map((w, i) => (
            <div key={i}>
              <dt><Sk w={70} h={10} lh={20} /></dt>
              <dd><Sk w={w} h={12} lh={21} /></dd>
            </div>
          ))}
        </dl>
        <Sk w={56} h={10} lh={20} />
        <ol className="sr-history">
          <li>
            <Sk w={180} h={11} lh={19} />
            <Sk w={120} h={10} lh={18} />
          </li>
        </ol>
      </div>
    </SkGroup>
  )
}
