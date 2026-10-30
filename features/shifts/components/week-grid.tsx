"use client"

import { PagedBody } from "@/components/data-pagination"
import type { ShiftOccurrence } from "@/lib/shifts"
import type { Person } from "@/lib/types"
import { dayLabel } from "../grid"
import { ShiftChip } from "./shift-chip"

// Week view (FR-M1-20): one row per person, one column per day; a cell lists the shifts that start that day.
// On phones .rtable stacks each person into a card with one line per day.
export function WeekGrid({
  people,
  grid,
  days,
  today,
  page,
  teamsOf,
}: {
  people: Person[]
  grid: Map<string, ShiftOccurrence[][]>
  days: string[]
  /** Tenant date "YYYY-MM-DD"; its column is highlighted. */
  today: string
  page: number
  teamsOf(personId: string): string
}) {
  return (
    <div className="table-wrap">
      <table className="rtable sh-week">
        <thead>
          <tr>
            <th>Person</th>
            {days.map((d) => (
              <th key={d} className={d === today ? "sh-today" : undefined} aria-current={d === today ? "date" : undefined}>
                {dayLabel(d)}
              </th>
            ))}
          </tr>
        </thead>
        <PagedBody page={page}>
          {people.map((p) => {
            const row = grid.get(p.id) ?? []
            return (
              <tr key={p.id}>
                <td data-label="Person" className="sh-person">
                  <div>
                    <div className="tt">{p.name}</div>
                    <div className="tm">{teamsOf(p.id)}</div>
                  </div>
                </td>
                {days.map((d, i) => (
                  <td key={d} data-label={dayLabel(d)} className={d === today ? "sh-day sh-today" : "sh-day"}>
                    {row[i]?.length ? (
                      <span className="sh-chips">
                        {row[i].map((o) => (
                          <ShiftChip key={o.pattern.id} occ={o} />
                        ))}
                      </span>
                    ) : (
                      <span className="sh-off">Off</span>
                    )}
                  </td>
                ))}
              </tr>
            )
          })}
        </PagedBody>
      </table>
    </div>
  )
}
