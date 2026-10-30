"use client"

import { PagedBody } from "@/components/data-pagination"
import { daysLabel, durationLabel, hmMinutes, patternTimeLabel } from "@/lib/shifts"
import type { ShiftPattern } from "@/lib/shifts"

/** Nominal length from the pattern's own clock (the week view shows real lengths on DST nights). */
export const nominalMinutes = (p: Pick<ShiftPattern, "start" | "end">) => {
  const m = hmMinutes(p.end) - hmMinutes(p.start)
  return m > 0 ? m : m + 1440
}

// Patterns tab (FR-M1-20): name, team, hours, days, time zone and how many people work it now.
export function PatternsTable({
  patterns,
  page,
  tz,
  canWrite,
  peopleOn,
  onEdit,
  onDelete,
}: {
  patterns: ShiftPattern[]
  page: number
  /** Tenant zone; a pattern without its own zone uses it. */
  tz: string
  canWrite: boolean
  peopleOn(patternId: string): number
  onEdit(p: ShiftPattern): void
  onDelete(p: ShiftPattern): void
}) {
  return (
    <div className="table-wrap">
      <table className="rtable sh-patterns">
        <thead>
          <tr>
            <th>Pattern</th>
            <th>Team</th>
            <th>Hours</th>
            <th>Days</th>
            <th>Time zone</th>
            <th>People</th>
            {canWrite && <th><span className="sr-only">Actions</span></th>}
          </tr>
        </thead>
        <PagedBody page={page}>
          {patterns.map((p) => (
            <tr key={p.id}>
              <td data-label="Pattern"><div className="tt">{p.name}</div></td>
              <td data-label="Team">{p.team}</td>
              <td data-label="Hours">
                <div>
                  <div className="num">{patternTimeLabel(p)}</div>
                  <div className="tm">{durationLabel(nominalMinutes(p))}</div>
                </div>
              </td>
              <td data-label="Days">{daysLabel(p.days)}</td>
              <td data-label="Time zone">{p.timeZone && p.timeZone !== tz ? p.timeZone : <span className="sr-none">Workspace ({tz})</span>}</td>
              <td data-label="People" className="num">{peopleOn(p.id)}</td>
              {canWrite && (
                <td className="sh-act">
                  <span className="sh-acts">
                    <button type="button" className="btn btn-outline sh-sm" onClick={() => onEdit(p)} aria-label={`Edit ${p.name}`}>Edit</button>
                    <button type="button" className="btn btn-outline sh-sm sh-danger" onClick={() => onDelete(p)} aria-label={`Delete ${p.name}`}>Delete</button>
                  </span>
                </td>
              )}
            </tr>
          ))}
        </PagedBody>
      </table>
    </div>
  )
}
