"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"

import { DataPagination } from "@/components/data-pagination"
import { EmptyState } from "@/components/empty-state"
import { FilterBar, FilterSearch, FilterSelect, FilterSeg } from "@/components/filter-bar"
import { Icon } from "@/components/icons"
import { PageHead } from "@/components/page-head"
import { useDept } from "@/hooks/use-dept"
import { paginate } from "@/lib/paginate"
import { newTaskHref } from "../new-task"
import { EMPTY_FILTERS, TASKS_PAGE_SIZE, matchesDue, matchesProject, matchesRepeat, matchesStatus } from "../filters"
import { isAssigned, liveTasks } from "../planning"
import { useTasksStore } from "../store"
import { STATUS, STATUS_ORDER } from "../types"
import type { Person, Project, Task, TasksFilters } from "../types"
import { TaskTable } from "./task-table"
import { TaskViewTabs } from "./task-view-tabs"

const PRIORITIES = [
  { value: "all", label: "All priorities" },
  { value: "3", label: "High" },
  { value: "2", label: "Medium" },
  { value: "1", label: "Low" },
]
const DUE = [
  { value: "all", label: "Any due" },
  { value: "today", label: "Today" },
  { value: "overdue", label: "Overdue" },
  { value: "week", label: "This week" },
]
const REPEAT = [
  { value: "all", label: "All tasks" },
  { value: "recurring", label: "Recurring" },
]
const STATUSES = [
  { value: "all", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "stuck", label: "Overdue or blocked" },
  ...STATUS_ORDER.map((s) => ({ value: s, label: STATUS[s].label })),
]
// Reviewers also get "Waiting for my review" (submitted, not their own): the Today card's review tile opens it.
const REVIEW_STATUS = { value: "review", label: "Waiting for my review" }

export function TasksView({
  tasks,
  people,
  today,
  tzLabel,
  canCreate,
  initialFilters = EMPTY_FILTERS,
  initialPage = 1,
  onlyAssignee,
  reviewerId,
  scopeKey,
  refFloor,
  projects = [],
}: {
  tasks: Task[]
  people: Person[]
  today: string
  tzLabel: string
  canCreate: boolean
  initialFilters?: TasksFilters
  /** ?page= from the URL. Filter and department changes reset it to 1. */
  initialPage?: number
  /** Staff roles only see their own tasks: the Person.id they are limited to. */
  onlyAssignee?: string
  /** Managers: the Person.id the "Waiting for my review" filter leaves out (their own submitted tasks). */
  reviewerId?: string
  /** Names what `tasks` was scoped for (tenant + role). When it changes, the in-memory store is reseeded. */
  scopeKey: string
  /** Highest task number in the full seed, so new refs never collide with tasks a staff user cannot see. */
  refFloor: number
  /** FR-M1-04 projects for the filter. */
  projects?: Project[]
}) {
  const dept = useDept()
  const [stored] = useTasksStore(tasks, scopeKey, people, { today, refFloor })
  const [filters, setFilters] = useState<TasksFilters>(initialFilters)
  const pathname = usePathname()
  const search = useSearchParams()
  const urlPage = Math.max(1, Number(search.get("page")) || 1)
  const [page, setPage] = useState(initialPage)
  const [seenPage, setSeenPage] = useState(urlPage)
  const [seenDept, setSeenDept] = useState(dept)
  // The URL is the source of truth for the page; a new ?page= (pager click, back button) lands here.
  if (seenPage !== urlPage) {
    setSeenPage(urlPage)
    setPage(urlPage)
  }
  if (seenDept !== dept) {
    setSeenDept(dept)
    setPage(1)
  }
  const set = <K extends keyof TasksFilters>(k: K, v: TasksFilters[K]) => {
    setFilters((f) => ({ ...f, [k]: v }))
    setPage(1)
  }
  const pageHref = (p: number) => {
    const q = new URLSearchParams(search.toString())
    if (p > 1) q.set("page", String(p))
    else q.delete("page")
    const qs = q.toString()
    return qs ? `${pathname}?${qs}` : pathname
  }
  // Shallow URL update: no server round-trip, so loading.tsx doesn't flash between pages.
  const goTo = (p: number) => {
    setPage(p)
    window.history.pushState(null, "", pageHref(p))
  }
  // Back on page 1 after a filter or department change: drop the stale ?page= from the URL.
  useEffect(() => {
    if (page === 1 && search.has("page")) window.history.replaceState(null, "", pageHref(1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  const scoped = useMemo(() => liveTasks(onlyAssignee ? stored.filter((t) => isAssigned(t, onlyAssignee)) : stored), [stored, onlyAssignee])
  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people])
  const rows = useMemo(() => {
    const q = filters.q.trim().toLowerCase()
    return scoped.filter(
      (t) =>
        (dept === "all" || t.dept === dept) &&
        matchesStatus(t, filters.status, today, reviewerId) &&
        matchesDue(t, filters.due, today) &&
        matchesRepeat(t, filters.repeat) &&
        matchesProject(t, filters.project) &&
        (filters.priority === "all" || String(t.priority) === filters.priority) &&
        (filters.assignee === "all" || isAssigned(t, filters.assignee)) &&
        (!q ||
          [t.title, t.ref, t.client ?? "", peopleById.get(t.assignee)?.name ?? "", ...t.tags].some((s) => s.toLowerCase().includes(q))),
    )
  }, [scoped, dept, filters, today, peopleById, reviewerId])

  const paged = paginate(rows, page, TASKS_PAGE_SIZE)

  const filtered = filters.status !== "all" || filters.due !== "all" || filters.priority !== "all" || filters.assignee !== "all" || filters.repeat !== "all" || filters.project !== "all" || !!filters.q || dept !== "all"

  return (
    <>
      <PageHead
        title="Tasks"
        subtitle={`${rows.length} of ${scoped.length} tasks`}
        actions={
          canCreate && (
            <Link href={newTaskHref({ from: pageHref(page) })} className="btn btn-primary">
              <Icon name="plus" />
              New task
            </Link>
          )
        }
      />
      <TaskViewTabs active="list" />
      <div className="card tasks-card">
        <FilterBar>
          <FilterSearch value={filters.q} onChange={(v) => set("q", v)} placeholder="Search tasks" />
          <FilterSelect label="Status" value={filters.status} options={onlyAssignee ? STATUSES : [...STATUSES.slice(0, 3), REVIEW_STATUS, ...STATUSES.slice(3)]} onChange={(v) => set("status", v)} />
          <FilterSelect label="Priority" value={filters.priority} options={PRIORITIES} onChange={(v) => set("priority", v)} />
          <FilterSelect label="Repeat" value={filters.repeat} options={REPEAT} onChange={(v) => set("repeat", v)} />
          {projects.length > 0 && (
            <FilterSelect label="Project" value={filters.project} options={[{ value: "all", label: "All projects" }, { value: "none", label: "No project" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} onChange={(v) => set("project", v)} />
          )}
          {!onlyAssignee && (
            <FilterSelect
              label="Assignee"
              value={filters.assignee}
              options={[{ value: "all", label: "All assignees" }, ...people.map((p) => ({ value: p.id, label: p.name }))]}
              onChange={(v) => set("assignee", v)}
            />
          )}
          <FilterSeg label="Due" value={filters.due} options={DUE} onChange={(v) => set("due", v)} />
        </FilterBar>
        {rows.length > 0 ? (
          <>
            <TaskTable tasks={paged.rows} page={paged.page} people={peopleById} today={today} tzLabel={tzLabel} />
            <DataPagination page={paged.page} pageCount={paged.pageCount} total={paged.total} from={paged.from} to={paged.to} label="Tasks pages" href={pageHref} onPageChange={goTo} />
          </>
        ) : (
          <EmptyState
            icon="task"
            title="No tasks match"
            text={filtered ? "Try a different search or clear the filters." : "There are no tasks yet."}
            action={
              filtered ? (
                <button type="button" className="btn btn-outline" onClick={() => {
                    setFilters(EMPTY_FILTERS)
                    setPage(1)
                  }}>
                  Clear filters
                </button>
              ) : undefined
            }
          />
        )}
      </div>
    </>
  )
}
