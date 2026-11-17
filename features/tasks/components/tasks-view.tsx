"use client"

import { useMemo, useState } from "react"
import Link from "next/link"

import { EmptyState } from "@/components/empty-state"
import { FilterBar, FilterSearch, FilterSelect, FilterSeg } from "@/components/filter-bar"
import { Icon } from "@/components/icons"
import { PageHead } from "@/components/page-head"
import { useDept } from "@/hooks/use-dept"
import { apiBrowser } from "@/lib/api/browser"
import { userMessage } from "@/lib/api/problem"
import { toast } from "sonner"
import { toTask } from "../adapters"
import { newTaskHref } from "../new-task"
import { EMPTY_FILTERS, TASKS_PAGE_SIZE, listQuery } from "../filters"
import { useUrlFilters } from "../use-url-filters"
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
// Reviewers also get "Waiting for my review" (submitted, not their own): the API answers it (status=review), the Today card's review tile opens it.
const REVIEW_STATUS = { value: "review", label: "Waiting for my review" }

export function TasksView({
  tasks,
  nextCursor,
  people,
  today,
  nowAt,
  tzLabel,
  canCreate,
  initialFilters = EMPTY_FILTERS,
  staff,
  projects = [],
}: {
  /** The first page the API returned for these filters. */
  tasks: Task[]
  nextCursor: string | null
  people: Person[]
  today: string
  nowAt?: string
  tzLabel: string
  canCreate: boolean
  initialFilters?: TasksFilters
  /** Staff roles only get their own tasks from the API: no assignee filter. */
  staff: boolean
  /** FR-M1-04 projects for the filter. */
  projects?: Project[]
}) {
  const dept = useDept()
  const { filters, set, reset, pending } = useUrlFilters<TasksFilters>(initialFilters, EMPTY_FILTERS)
  // Pages after the first come from the API with the cursor; a new server page (filters changed) starts over.
  const [more, setMore] = useState<{ base: Task[]; rows: Task[]; cursor: string | null }>({ base: tasks, rows: [], cursor: nextCursor })
  const [loading, setLoading] = useState(false)
  const fresh = more.base === tasks
  const loaded = useMemo(() => (fresh ? [...tasks, ...more.rows] : tasks), [fresh, tasks, more.rows])
  const cursor = fresh ? more.cursor : nextCursor
  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people])
  // The department switcher is the shell's, and the API has no department filter: it narrows the loaded rows only.
  const rows = dept === "all" ? loaded : loaded.filter((t) => t.dept === dept)

  async function loadMore() {
    if (!cursor || loading) return
    setLoading(true)
    try {
      const page = await apiBrowser.get("/v1/tasks", { query: { ...listQuery(filters), limit: TASKS_PAGE_SIZE, cursor } as never })
      setMore({ base: tasks, rows: [...(fresh ? more.rows : []), ...page.items.map((d) => toTask(d))], cursor: page.nextCursor })
    } catch (e) {
      toast.error(userMessage(e).text)
    } finally {
      setLoading(false)
    }
  }

  const filtered = filters.status !== "all" || filters.due !== "all" || filters.priority !== "all" || filters.assignee !== "all" || filters.repeat !== "all" || filters.project !== "all" || !!filters.q || dept !== "all"

  return (
    <>
      <PageHead
        title="Tasks"
        subtitle={`${rows.length}${cursor ? "+" : ""} tasks`}
        actions={
          canCreate && (
            <Link href={newTaskHref({ from: "/tasks" })} className="btn btn-primary">
              <Icon name="plus" />
              New task
            </Link>
          )
        }
      />
      <TaskViewTabs active="list" />
      <div className="card tasks-card" aria-busy={pending || undefined}>
        <FilterBar>
          <FilterSelect label="Status" value={filters.status} options={staff ? STATUSES : [...STATUSES.slice(0, 3), REVIEW_STATUS, ...STATUSES.slice(3)]} onChange={(v) => set("status", v)} />
          <FilterSelect label="Priority" value={filters.priority} options={PRIORITIES} onChange={(v) => set("priority", v)} />
          <FilterSelect label="Repeat" value={filters.repeat} options={REPEAT} onChange={(v) => set("repeat", v)} />
          {projects.length > 0 && (
            <FilterSelect label="Project" value={filters.project} options={[{ value: "all", label: "All projects" }, { value: "none", label: "No project" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} onChange={(v) => set("project", v)} />
          )}
          {!staff && (
            <FilterSelect
              label="Assignee"
              value={filters.assignee}
              options={[{ value: "all", label: "All assignees" }, ...people.map((p) => ({ value: p.id, label: p.name }))]}
              onChange={(v) => set("assignee", v)}
            />
          )}
          <FilterSeg label="Due" value={filters.due} options={DUE} onChange={(v) => set("due", v)} />
          <FilterSearch value={filters.q} onChange={(v) => set("q", v)} placeholder="Search tasks" />
        </FilterBar>
        {rows.length > 0 ? (
          <>
            <TaskTable tasks={rows} page={1} people={peopleById} today={today} nowAt={nowAt} tzLabel={tzLabel} />
            {cursor && (
              <div className="tasks-more">
                <button type="button" className="btn btn-outline" disabled={loading} onClick={() => void loadMore()}>{loading ? "Loading…" : "Load more"}</button>
              </div>
            )}
          </>
        ) : (
          <EmptyState
            icon="task"
            title="No tasks match"
            text={filtered ? "Try a different search or clear the filters." : "There are no tasks yet."}
            action={
              filtered ? (
                <button type="button" className="btn btn-outline" onClick={reset}>
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
