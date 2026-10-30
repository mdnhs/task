"use client"

import { useMemo, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { DataPagination, useSlideDir } from "@/components/data-pagination"
import { EmptyState } from "@/components/empty-state"
import { FilterBar, FilterSearch, FilterSeg } from "@/components/filter-bar"
import { Icon } from "@/components/icons"
import { PageHead } from "@/components/page-head"
import { useDept } from "@/hooks/use-dept"
import { useShifts } from "@/hooks/use-shifts"
import { formatDate } from "@/lib/dates"
import { paginate } from "@/lib/paginate"
import {
  addDays,
  assign,
  deletePattern,
  isAssignedOn,
  memberOf,
  nextPatternId,
  setOverride,
  setTeamDefault,
  toggleReporting,
  unassign,
  upsertPattern,
  weekDates,
  weekStart,
} from "@/lib/shifts"
import type { ShiftPattern } from "@/lib/shifts"
import type { Person } from "@/lib/types"
import { rosterPeople, shiftsSubtitle, weekGrid, weekLabel } from "../grid"
import { SHIFTS_PAGE_SIZE } from "../types"
import type { ShiftsData, ShiftsTab } from "../types"
import { AssignDialog } from "./assign-dialog"
import { PatternDialog } from "./pattern-dialog"
import { PatternsTable } from "./patterns-table"
import { PeopleTable, TeamDefaults } from "./people-table"
import { WeekGrid } from "./week-grid"

const TABS: { value: ShiftsTab; label: string }[] = [
  { value: "week", label: "Week" },
  { value: "people", label: "People" },
  { value: "patterns", label: "Patterns" },
]
const has = (q: string, ...fields: (string | undefined)[]) => fields.some((f) => (f ?? "").toLowerCase().includes(q))

export function ShiftsView({
  data,
  today: todayIso,
  tz,
  tzLabel,
  canWrite,
  scopeKey,
}: {
  data: ShiftsData
  /** org.today (tenant wall time). */
  today: string
  /** Tenant IANA zone (org.timezone). */
  tz: string
  tzLabel: string
  /** Edit controls (shifts write access and an active tenant). */
  canWrite: boolean
  /** Tenant + role; a change reseeds the shared store. */
  scopeKey: string
}) {
  const { people, teams, scope } = data
  const today = todayIso.slice(0, 10)
  const dept = useDept()
  const [state, setState] = useShifts(data.state, scopeKey)
  const [tab, setTab] = useState<ShiftsTab>("week")
  const [q, setQ] = useState("")
  const [offset, setOffset] = useState(0)
  const [pages, setPages] = useState<Record<ShiftsTab, number>>({ week: 1, people: 1, patterns: 1 })
  const [seenDept, setSeenDept] = useState(dept)
  const [editing, setEditing] = useState<ShiftPattern | undefined>()
  const [patternOpen, setPatternOpen] = useState(false)
  const [deleting, setDeleting] = useState<ShiftPattern | undefined>()
  const [assignTo, setAssignTo] = useState<Person | undefined>()
  const [assignOpen, setAssignOpen] = useState(false)
  const [removing, setRemoving] = useState<{ person: Person; pattern: ShiftPattern } | undefined>()
  // Confirm dialogs keep their subject while closing, so the text doesn't blank during the exit animation.
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)

  const resetPage = () => setPages({ week: 1, people: 1, patterns: 1 })
  if (seenDept !== dept) {
    setSeenDept(dept)
    resetPage()
  }
  // The topbar department filter is a team filter here (departments map to teams, SRS A.5); unknown teams show everyone.
  const team = teams.includes(dept) ? dept : "all"
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? "Unknown"
  const teamsOf = (id: string) => memberOf(id, state.members)?.teams ?? []

  const start = weekStart(addDays(today, offset * 7))
  const days = weekDates(start)
  const s = q.trim().toLowerCase()
  const roster = useMemo(() => rosterPeople(people, state, team).filter((p) => !s || has(s, p.name, p.role)), [people, state, team, s])
  const grid = useMemo(() => weekGrid(roster.map((p) => p.id), state, start, tz, team), [roster, state, start, tz, team])
  const patterns = useMemo(
    () =>
      state.patterns
        .filter((p) => (team === "all" || p.team === team) && (!s || has(s, p.name, p.team)))
        .sort((a, b) => a.team.localeCompare(b.team) || a.start.localeCompare(b.start) || a.name.localeCompare(b.name)),
    [state.patterns, team, s],
  )
  const peopleOn = (patternId: string) => new Set(state.assignments.filter((a) => a.patternId === patternId && isAssignedOn(a, today)).map((a) => a.personId)).size

  const pagedPeople = paginate(roster, tab === "week" ? pages.week : pages.people, SHIFTS_PAGE_SIZE)
  const pagedPatterns = paginate(patterns, pages.patterns, SHIFTS_PAGE_SIZE)
  const pager = tab === "patterns" ? pagedPatterns : pagedPeople
  const tabDir = useSlideDir(TABS.findIndex((t) => t.value === tab))
  const visibleTeams = team === "all" ? teams : [team]

  // ----- edits (in-memory store; toasts confirm) -----
  function savePattern(v: Omit<ShiftPattern, "id">, id?: string) {
    setState((prev) => upsertPattern(prev, { ...v, id: id ?? nextPatternId(prev.patterns) }))
    toast.success(id ? `${v.name} updated` : `${v.name} created`)
  }
  function removePattern(p: ShiftPattern) {
    setState((prev) => deletePattern(prev, p.id))
    toast.success(`${p.name} deleted`)
  }
  function doAssign(person: Person, p: ShiftPattern, from: string) {
    setState((prev) => assign(prev, person.id, p.id, from))
    toast.success(`${person.name} assigned to ${p.name} from ${formatDate(from)}`)
  }
  function doUnassign(person: Person, p: ShiftPattern) {
    setState((prev) => unassign(prev, person.id, p.id, today))
    toast.success(`${person.name} removed from ${p.name}`)
  }
  function toggle(person: Person, on: boolean) {
    setState((prev) => toggleReporting(prev, person.id, on))
    toast.success(`Shift reporting ${on ? "on" : "off"} for ${person.name}`)
  }
  function reset(person: Person) {
    setState((prev) => setOverride(prev, person.id, null))
    const team = teamsOf(person.id)[0]
    toast.success(`${person.name} follows the ${team ?? "team"} default`)
  }
  function teamDefault(t: string, on: boolean) {
    setState((prev) => setTeamDefault(prev, t, on))
    toast.success(`${t}: shift reporting ${on ? "on" : "off"} by default`)
  }

  const me = people.find((p) => p.id === data.meId)
  const subtitle = shiftsSubtitle(people, state, scope, data.meId, team)

  const local = !!s
  const emptyTitle = tab === "patterns" ? "No shift patterns match" : "No people match"
  const emptyText = local
    ? "Try a different search."
    : team !== "all"
      ? "Nothing in this team. Change the department filter to see more."
      : tab === "patterns"
        ? "Create a pattern to start building the rota."
        : scope === "own" && !me
          ? "You have no shifts yet."
          : "Nobody has a reporting line yet."

  return (
    <>
      <PageHead
        title="Shifts"
        subtitle={subtitle}
        actions={
          canWrite && (
            <button type="button" className="btn btn-primary" onClick={() => { setEditing(undefined); setPatternOpen(true) }}>
              <Icon name="plus" />
              New pattern
            </button>
          )
        }
      />
      <div className="card sh-card">
        <FilterBar>
          <FilterSeg label="View" value={tab} options={TABS} onChange={(v) => { setTab(v); resetPage() }} />
          <FilterSearch value={q} onChange={(v) => { setQ(v); resetPage() }} placeholder={tab === "patterns" ? "Search patterns" : "Search people"} />
          {tab === "week" && (
            <div className="sh-weeknav" role="group" aria-label="Week">
              <button type="button" className="sh-nav-btn" aria-label="Previous week" onClick={() => setOffset((o) => o - 1)}>
                <ChevronLeft aria-hidden="true" />
              </button>
              <button type="button" className="sh-nav-label num" onClick={() => setOffset(0)} disabled={offset === 0} title={offset === 0 ? "This week" : "Back to this week"}>
                {offset === 0 ? "This week" : weekLabel(start)}
              </button>
              <button type="button" className="sh-nav-btn" aria-label="Next week" onClick={() => setOffset((o) => o + 1)}>
                <ChevronRight aria-hidden="true" />
              </button>
            </div>
          )}
        </FilterBar>
        {tab === "people" && visibleTeams.length > 0 && (
          <TeamDefaults teams={visibleTeams} defaults={state.reporting.teamDefaults} canWrite={canWrite && scope === "all"} onChange={teamDefault} />
        )}
        {pager.total > 0 ? (
          <>
            <div key={tab} className="od-slide" data-slide={tabDir}>
              {tab === "week" ? (
                <>
                  <WeekGrid people={pagedPeople.rows} grid={grid} days={days} today={today} page={pagedPeople.page} teamsOf={(id) => teamsOf(id).join(", ")} />
                  <p className="sh-foot">
                    Week of {weekLabel(start)} · Times in {tzLabel} · <b>+1</b> ends the next day
                  </p>
                </>
              ) : tab === "people" ? (
                <PeopleTable
                  people={pagedPeople.rows}
                  state={state}
                  today={today}
                  page={pagedPeople.page}
                  canWrite={canWrite && scope === "all"}
                  nameOf={nameOf}
                  onToggle={toggle}
                  onReset={reset}
                  onAssign={(p) => { setAssignTo(p); setAssignOpen(true) }}
                  onUnassign={(person, pattern) => { setRemoving({ person, pattern }); setRemoveOpen(true) }}
                />
              ) : (
                <PatternsTable
                  patterns={pagedPatterns.rows}
                  page={pagedPatterns.page}
                  tz={tz}
                  canWrite={canWrite && scope === "all"}
                  peopleOn={peopleOn}
                  onEdit={(p) => { setEditing(p); setPatternOpen(true) }}
                  onDelete={(p) => { setDeleting(p); setDeleteOpen(true) }}
                />
              )}
            </div>
            <DataPagination
              page={pager.page}
              pageCount={pager.pageCount}
              total={pager.total}
              from={pager.from}
              to={pager.to}
              label={tab === "patterns" ? "Pattern pages" : "People pages"}
              onPageChange={(p) => setPages((x) => ({ ...x, [tab]: p }))}
            />
          </>
        ) : (
          <EmptyState
            icon="roster"
            title={emptyTitle}
            text={emptyText}
            action={local ? <button type="button" className="btn btn-outline" onClick={() => { setQ(""); resetPage() }}>Clear search</button> : undefined}
          />
        )}
      </div>

      {canWrite && scope === "all" && (
        <>
          <PatternDialog
            pattern={editing}
            open={patternOpen}
            onOpenChange={setPatternOpen}
            teams={teams}
            patterns={state.patterns}
            tz={tz}
            defaultTeam={team === "all" ? teams[0] ?? "" : team}
            onSave={savePattern}
          />
          <AssignDialog person={assignTo} open={assignOpen} onOpenChange={setAssignOpen} state={state} teamsOf={teamsOf} today={today} onAssign={doAssign} />
          <ConfirmDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            title={`Delete ${deleting?.name ?? "pattern"}?`}
            text={`${deleting ? peopleOn(deleting.id) : 0} people work this pattern now. Deleting it removes the pattern and all its assignments, past ones too.`}
            confirmLabel="Delete pattern"
            destructive
            onConfirm={() => deleting && removePattern(deleting)}
          />
          <ConfirmDialog
            open={removeOpen}
            onOpenChange={setRemoveOpen}
            title={`Remove ${removing?.person.name ?? ""} from ${removing?.pattern.name ?? ""}?`}
            text={`Shifts from ${formatDate(today)} on are removed. Past shifts stay in the week view.`}
            confirmLabel="Remove"
            destructive
            onConfirm={() => removing && doUnassign(removing.person, removing.pattern)}
          />
        </>
      )}
    </>
  )
}
