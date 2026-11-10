import { Fragment } from "react"

import { formatDate } from "@/lib/dates"
import type { PersonRow } from "../view"
import { ShiftLine } from "./day-board"

// By person and by role (FR-RS-10): one row per person, one column per day; on phones .rtable stacks each person into a card.
// By role puts a heading row above each role's people.
export function PersonGrid({ groups, dates, today, place }: { groups: { label: string; rows: PersonRow[] }[]; dates: string[]; today: string; place: boolean }) {
  if (groups.every((g) => g.rows.length === 0)) return <p className="ros-empty">No shifts in this range.</p>
  return (
    <div className="table-wrap">
      <table className="rtable ros-grid" style={{ minWidth: 170 + dates.length * 128 }}>
        <thead>
          <tr>
            <th>Person</th>
            {dates.map((d) => (
              <th key={d} className={d === today ? "ros-today" : undefined} aria-current={d === today ? "date" : undefined}>{formatDate(d)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.label || "all"}>
              {g.label && (
                <tr className="ros-group">
                  <td colSpan={dates.length + 1}>{g.label}</td>
                </tr>
              )}
              {g.rows.map((r) => (
                <tr key={`${g.label}:${r.key}`}>
                  <td data-label="Person" className="ros-person">
                    <div>
                      <div className="tt">{r.name}</div>
                      {r.sub && <div className="tm">{r.sub}</div>}
                    </div>
                  </td>
                  {dates.map((d, i) => (
                    <td key={d} data-label={formatDate(d)} className={d === today ? "ros-today" : undefined}>
                      {r.cells[i].length ? (
                        <ul className="ros-shifts">{r.cells[i].map((s) => <ShiftLine key={s.id} s={{ ...s, person: "" }} place={place} />)}</ul>
                      ) : (
                        <span className="ros-none">Off</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
