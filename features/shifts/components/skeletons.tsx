import { Icon } from "@/components/icon"
import { PagerSkeleton } from "@/components/pager-skeleton"
import { Sk, SkGroup } from "@/components/sk"
import { WEEKDAY_SHORT } from "@/lib/shifts"
import { SHIFTS_PAGE_SIZE } from "../types"

// Mirrors ShiftsView on its default Week tab for the "all departments" filter: PageHead, the .sh-card filter bar (view seg, search, week nav) and the week grid of page 1.
// Static (K1, ruling I9): loading.tsx knows no data, so the text is TYPICAL placeholder ghost text (.sk-ghost): a person with one team, a night chip and an Off day. The real page replaces it;
// names and chips that wrap differently are a small layout change. `canWrite` adds the New pattern button. T6.9: measure the row height against a real first page (10 people).
const DAYS = [1, 2, 3, 4, 5, 6, 0] as const

export function ShiftsSkeleton({ canWrite, rows = SHIFTS_PAGE_SIZE, total = 25 }: { canWrite: boolean; rows?: number; total?: number }) {
  const g = (t: string) => <span className="sk-ghost">{t}</span>
  return (
    <SkGroup label="Loading shifts" className="sk-page">
      <div className="head">
        <div>
          <h1>{g("Shifts")}</h1>
          <p>{g("25 people · 3 patterns · Reports due 60 min after shift end")}</p>
        </div>
        {canWrite && (
          <div className="head-actions">
            <span className="btn btn-primary sk-ghost-btn">
              <Icon name="plus" />
              New pattern
            </span>
          </div>
        )}
      </div>
      <div className="card sh-card">
        <div className="od-filters">
          <Sk w={229} h={48} r="pill" />
          <Sk w={192} h={48} r="pill" className="sk-sh-nav" />
          <Sk h={48} r="pill" className="sk-fsearch" />
        </div>
        <div>{/* the real page wraps the table and its footnote in one slide element: one flex child, one gap */}
        <div className="table-wrap">
          <table className="rtable sh-week">
            <thead>
              <tr>
                <th>{g("Person")}</th>
                {DAYS.map((d, i) => (
                  <th key={d}>{g(`${WEEKDAY_SHORT[d]} ${19 + i}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: rows }, (_, n) => (
                <tr key={n}>
                  <td data-label="Person" className="sh-person">
                    <div>
                      <div className="tt">{g("Ann Byrne")}</div>
                      {!(n % 4 === 1 && n < 8) && <div className="tm">{g("Security")}</div>}
                    </div>
                  </td>
                  {DAYS.map((d, i) => (
                    <td key={d} data-label={`${WEEKDAY_SHORT[d]} ${19 + i}`} className="sh-day">
                      {i % 4 === 3 || (n % 4 === 1 && n < 8) || n === rows - 1 ? ( // a typical week: some people have no shift at all (a one-line row, 51px)
                        <span className="sh-off">{g("Off")}</span>
                      ) : (
                        <span className="sh-chips">
                          {(n % 4 === 0 && n > 7 ? [0, 1] : [0]).map((k) => (
                            <span key={k} className="sh-chip sk-ghost">
                              <span className="sh-chip-name">Night</span>
                              <span className="sh-chip-time num">
                                22:00–06:00{" "}
                                <b className="sh-next">+1</b>
                              </span>
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="sh-foot">{g("Week of 19–25 Oct · Times in Irish Time · +1 ends the next day")}</p>
        </div>
        {total > SHIFTS_PAGE_SIZE && <PagerSkeleton rows={total} size={SHIFTS_PAGE_SIZE} />}
      </div>
    </SkGroup>
  )
}
