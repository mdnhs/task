"use client"

import { X } from "lucide-react"

import { PagedBody } from "@/components/data-pagination"
import { Switch } from "@/components/ui/switch"
import { formatDate } from "@/lib/dates"
import { managerOf, memberOf, reportsFor } from "@/lib/shifts"
import type { ShiftAssignment, ShiftPattern, ShiftState } from "@/lib/shifts"
import type { Person } from "@/lib/types"

/** Current and upcoming assignments of a person (ended ones are history and stay in the week view only). */
export function openAssignments(state: ShiftState, personId: string, today: string): { a: ShiftAssignment; p: ShiftPattern }[] {
  const byId = new Map(state.patterns.map((p) => [p.id, p]))
  return state.assignments
    .filter((a) => a.personId === personId && (!a.until || a.until >= today) && byId.has(a.patternId))
    .sort((x, y) => x.from.localeCompare(y.from))
    .map((a) => ({ a, p: byId.get(a.patternId)! }))
}

// People tab: teams, primary manager (FR-M0-07), assigned shifts and the "members you want" reporting control (FR-M1-21).
// Reporting shows the effective state and where it comes from (team default or a personal override).
export function PeopleTable({
  people,
  state,
  today,
  page,
  canWrite,
  nameOf,
  onToggle,
  onReset,
  onAssign,
  onUnassign,
}: {
  people: Person[]
  state: ShiftState
  today: string
  page: number
  canWrite: boolean
  nameOf(id: string): string
  onToggle(p: Person, on: boolean): void
  onReset(p: Person): void
  onAssign(p: Person): void
  onUnassign(p: Person, pattern: ShiftPattern): void
}) {
  return (
    <div className="table-wrap">
      <table className="rtable sh-people">
        <thead>
          <tr>
            <th>Person</th>
            <th>Teams</th>
            <th>Manager</th>
            <th>Shifts</th>
            <th>Shift reporting</th>
            {canWrite && <th><span className="sr-only">Actions</span></th>}
          </tr>
        </thead>
        <PagedBody page={page}>
          {people.map((p) => {
            const rep = reportsFor(p.id, state.members, state.reporting)
            const mgr = managerOf(p.id, state.members)
            const open = openAssignments(state, p.id, today)
            return (
              <tr key={p.id}>
                <td data-label="Person">
                  <div>
                    <div className="tt">{p.name}</div>
                    <div className="tm">{p.role}</div>
                  </div>
                </td>
                <td data-label="Teams">{memberOf(p.id, state.members)?.teams.join(", ") || <span className="sr-none">None</span>}</td>
                <td data-label="Manager">{mgr ? nameOf(mgr) : <span className="sr-none">None</span>}</td>
                <td data-label="Shifts">
                  {open.length ? (
                    <span className="sh-tags">
                      {open.map(({ a, p: pat }) => (
                        <span key={`${a.patternId}-${a.from}`} className="sh-tag">
                          {pat.name}
                          {a.from > today && <span className="sh-tag-note"> from {formatDate(a.from)}</span>}
                          {canWrite && (
                            <button type="button" className="sh-tag-x" aria-label={`Remove ${p.name} from ${pat.name}`} onClick={() => onUnassign(p, pat)}>
                              <X aria-hidden="true" />
                            </button>
                          )}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="sr-none">No shifts</span>
                  )}
                </td>
                <td data-label="Shift reporting">
                  <span className="sh-rep">
                    {canWrite ? (
                      <Switch checked={rep.on} onCheckedChange={(v) => onToggle(p, v)} aria-label={`End-of-shift reporting for ${p.name}`} />
                    ) : (
                      <span className="sh-rep-state" data-on={rep.on || undefined}>{rep.on ? "On" : "Off"}</span>
                    )}
                    <span className="sh-rep-src">
                      {canWrite && <span className="sh-rep-on">{rep.on ? "On" : "Off"}</span>}
                      {rep.source === "override" ? "Override" : "Team default"}
                    </span>
                    {canWrite && rep.source === "override" && (
                      <button type="button" className="sh-link" onClick={() => onReset(p)}>
                        Use team default
                      </button>
                    )}
                  </span>
                </td>
                {canWrite && (
                  <td className="sh-act">
                    <button type="button" className="btn btn-outline sh-sm" onClick={() => onAssign(p)}>
                      Assign
                    </button>
                  </td>
                )}
              </tr>
            )
          })}
        </PagedBody>
      </table>
    </div>
  )
}

// Team defaults (Q5): the reporting value members of a team get unless they have an override.
export function TeamDefaults({
  teams,
  defaults,
  canWrite,
  onChange,
}: {
  teams: string[]
  defaults: Record<string, boolean>
  canWrite: boolean
  onChange(team: string, on: boolean): void
}) {
  return (
    <ul className="sh-teams" aria-label="Team defaults for shift reporting">
      {teams.map((t) => {
        const on = defaults[t] === true
        return (
          <li key={t} className="sh-team">
            <span className="sh-team-main">
              <span className="sh-team-name">{t}</span>
              <span className="sh-team-sub">Team default: reporting {on ? "on" : "off"}</span>
            </span>
            {canWrite ? (
              <Switch checked={on} onCheckedChange={(v) => onChange(t, v)} aria-label={`Shift reporting default for ${t}`} />
            ) : (
              <span className="sh-rep-state" data-on={on || undefined}>{on ? "On" : "Off"}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
