import { Icon } from "@/components/icons"
import { PagerSkeleton, needsPager } from "@/components/pager-skeleton"
import { Sk, SkGroup } from "@/components/sk"
import { memberOf, weekDates, weekStart } from "@/lib/shifts"
import { dayLabel, rosterPeople, shiftsSubtitle, weekGrid, weekLabel } from "../grid"
import { SHIFTS_PAGE_SIZE } from "../types"
import type { ShiftsData } from "../types"

// Mirrors ShiftsView on its default Week tab for the "all departments" filter: PageHead, the .sh-card filter bar (view seg,
// search, week nav) and the week grid of page 1. Text is ghost text (.sk-ghost) built from the same seed the page renders,
// so names, chips and the subtitle wrap exactly like the loaded page. `canWrite` adds the New pattern button.
export function ShiftsSkeleton({ data, today: todayIso, tz, tzLabel, canWrite }: { data: ShiftsData; today: string; tz: string; tzLabel: string; canWrite: boolean }) {
  const today = todayIso.slice(0, 10)
  const start = weekStart(today)
  const days = weekDates(start)
  const all = rosterPeople(data.people, data.state, "all")
  const rows = all.slice(0, SHIFTS_PAGE_SIZE)
  const grid = weekGrid(rows.map((p) => p.id), data.state, start, tz, "all")
  const g = (t: string) => <span className="sk-ghost">{t}</span>
  return (
    <SkGroup label="Loading shifts" className="sk-page">
      <div className="head">
        <div>
          <h1>{g("Shifts")}</h1>
          <p>{g(shiftsSubtitle(data.people, data.state, data.scope, data.meId, "all"))}</p>
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
          <Sk w={229} h={50} r="pill" />
          <Sk h={40} r="pill" className="sk-fsearch" />
          <Sk w={192} h={40} r="pill" className="sk-sh-nav" />
        </div>
        {rows.length > 0 ? (
          <>
            <div className="table-wrap">
              <table className="rtable sh-week">
                <thead>
                  <tr>
                    <th>{g("Person")}</th>
                    {days.map((d) => (
                      <th key={d}>{g(dayLabel(d))}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const row = grid.get(p.id) ?? []
                    return (
                      <tr key={p.id}>
                        <td data-label="Person" className="sh-person">
                          <div>
                            <div className="tt">{g(p.name)}</div>
                            <div className="tm">{g((memberOf(p.id, data.state.members)?.teams ?? []).join(", "))}</div>
                          </div>
                        </td>
                        {days.map((d, i) => (
                          <td key={d} data-label={dayLabel(d)} className="sh-day">
                            {row[i]?.length ? (
                              <span className="sh-chips">
                                {row[i].map((o) => (
                                  <span key={o.pattern.id} className="sh-chip sk-ghost">
                                    <span className="sh-chip-name">{o.pattern.name}</span>
                                    <span className="sh-chip-time num">
                                      {o.window.start.slice(11, 16)}–{o.window.end.slice(11, 16)}
                                      {o.window.endsNextDay && (
                                        <>
                                          {" "}
                                          <b className="sh-next">+1</b>
                                        </>
                                      )}
                                    </span>
                                  </span>
                                ))}
                              </span>
                            ) : (
                              <span className="sh-off">{g("Off")}</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="sh-foot">
              {g(`Week of ${weekLabel(start)} · Times in ${tzLabel} · +1 ends the next day`)}
            </p>
            {needsPager(all.length, SHIFTS_PAGE_SIZE) && <PagerSkeleton rows={all.length} size={SHIFTS_PAGE_SIZE} />}
          </>
        ) : (
          <Sk h={220} r={20} />
        )}
      </div>
    </SkGroup>
  )
}
