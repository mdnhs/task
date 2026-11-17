"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { AnimatePresence, motion } from "motion/react"
import { toast } from "sonner"

import { EmptyState } from "@/components/empty-state"
import { FilterBar, FilterSearch, FilterSelect } from "@/components/filter-bar"
import { PageHead } from "@/components/page-head"
import { When } from "@/components/when"
import { useDept } from "@/hooks/use-dept"
import { apiBrowser } from "@/lib/api/browser"
import { userMessage } from "@/lib/api/problem"
import { EVIDENCE_STATE } from "@/lib/task-evidence"
import { layoutTransition } from "@/lib/motion"
import { toCard } from "../adapters"
import type { BoardColumn } from "../api"
import { evState } from "../evidence-view"
import { boardMove } from "../lifecycle"
import { changeStatus, completeTask, nowIso } from "../mutations"
import { assigneesOf, checklistProgress } from "../planning"
import { isLateAt } from "../time"
import { useTaskWrites } from "../use-task-writes"
import { useUrlFilters } from "../use-url-filters"
import { STATUS } from "../types"
import type { Person, Project, Task, TaskStatus } from "../types"
import { TaskViewTabs } from "./task-view-tabs"

/** Board columns: every status but Cancelled (closed work that never happened is in the list). */
export const BOARD_COLUMNS: TaskStatus[] = ["not_started", "in_progress", "blocked", "submitted", "changes_requested", "completed"]

export type BoardFilterValues = { q: string; project: string; assignee: string }
export const NO_BOARD_FILTERS: BoardFilterValues = { q: "", project: "all", assignee: "all" }

export type BoardProps = {
  /** One page of every column, from the API (cursor per column). */
  columns: BoardColumn[]
  people: Person[]
  projects: Project[]
  today: string
  nowAt?: string
  tzLabel: string
  /** Staff only get their own tasks from the API: no assignee filter. */
  staff: boolean
  canEdit: boolean
  actor: "assignee" | "reviewer"
  me: string
  initialFilters?: BoardFilterValues
}

export function BoardFilters({ q, project, assignee, set, people, projects, staff, children }: {
  q: string
  project: string
  assignee: string
  set(k: "q" | "project" | "assignee", v: string): void
  people: Person[]
  projects: Project[]
  staff: boolean
  children?: React.ReactNode
}) {
  return (
    <FilterBar>
      {projects.length > 0 && (
        <FilterSelect label="Project" value={project} options={[{ value: "all", label: "All projects" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} onChange={(v) => set("project", v)} />
      )}
      {!staff && (
        <FilterSelect label="Assignee" value={assignee} options={[{ value: "all", label: "All assignees" }, ...people.map((p) => ({ value: p.id, label: p.name }))]} onChange={(v) => set("assignee", v)} />
      )}
      {children}
      <FilterSearch value={q} onChange={(v) => set("q", v)} placeholder="Search tasks" />
    </FilterBar>
  )
}

function BoardCard({ t, people, today, nowAt, tzLabel, moves, onMove, onDragStart }: {
  t: Task
  people: Map<string, Person>
  today: string
  nowAt?: string
  tzLabel: string
  moves: TaskStatus[]
  onMove(to: TaskStatus): void
  onDragStart(): void
}) {
  const a = people.get(t.assignee)
  const more = assigneesOf(t).length - 1
  const ev = evState(t)
  const cl = checklistProgress(t)
  const late = isLateAt(t, today, nowAt)
  return (
    <motion.li
      layout="position"
      transition={layoutTransition}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="kb-card"
      draggable={moves.length > 0}
      onDragStartCapture={(e: React.DragEvent) => {
        e.dataTransfer.setData("text/plain", t.ref)
        e.dataTransfer.effectAllowed = "move"
        onDragStart()
      }}
    >
      <Link href={`/tasks/${t.ref}`} className="kb-title">{t.title}</Link>
      <div className="kb-meta">
        <span className="num">{t.ref}</span>
        <span className={`num ${late ? "due-late" : ""}`}><When iso={t.due} today={today} tzLabel={tzLabel} mode="date" /></span>
      </div>
      <div className="kb-foot">
        {a && <span className={`avatar ${a.avatar}`} title={a.name}>{a.initials}</span>}
        {more > 0 && <span className="kb-more num">+{more}</span>}
        <span className={`prio p${t.priority}`} aria-hidden="true"><i /><i /><i /></span>
        {cl && <span className="kb-chip num">☑ {cl.done}/{cl.total}</span>}
        {ev && <span className={`ev-tag ${EVIDENCE_STATE[ev].tone}`}>{EVIDENCE_STATE[ev].label}</span>}
      </div>
      {moves.length > 0 && (
        <div className="kb-move">
          <FilterSelect label={`Move ${t.ref} to`} value="" options={[{ value: "", label: "Move to…" }, ...moves.map((s) => ({ value: s, label: STATUS[s].label }))]} onChange={(v) => v && onMove(v as TaskStatus)} />
        </div>
      )}
    </motion.li>
  )
}

/** Kanban board (FR-M1-05): drag a card to another status column, or use "Move to" (keyboard and touch). Each column is the API's page (cursor), the move is a versioned write. */
export function TaskBoard(props: BoardProps) {
  const { people, projects, today, nowAt, tzLabel, staff, canEdit, actor, me, columns } = props
  const dept = useDept()
  const { filters: f, set, pending } = useUrlFilters<BoardFilterValues>(props.initialFilters ?? NO_BOARD_FILTERS, NO_BOARD_FILTERS)
  const server = useMemo(() => columns.flatMap((c) => c.tasks), [columns])
  const { tasks, write } = useTaskWrites(server)
  // "Load more" pages of a column come from the API with that column's cursor; a new server answer starts over.
  const [more, setMore] = useState<{ base: BoardColumn[]; add: Partial<Record<TaskStatus, { tasks: Task[]; cursor: string | null }>> }>({ base: columns, add: {} })
  const extra = useMemo(() => (more.base === columns ? more.add : {}), [more, columns])
  const byId = useMemo(() => new Map(people.map((x) => [x.id, x])), [people])
  const [dragRef, setDragRef] = useState<string | null>(null)
  const [over, setOver] = useState<TaskStatus | null>(null)
  const now = nowIso(today)
  const shown = (t: Task) => dept === "all" || t.dept === dept // the department switcher is the shell's; the API has no department filter
  const all = useMemo(() => [...tasks, ...Object.values(extra).flatMap((x) => x?.tasks ?? [])], [tasks, extra])
  const total = columns.reduce((n, c) => n + c.count, 0)

  const targets = (t: Task): TaskStatus[] => (canEdit ? BOARD_COLUMNS.filter((c) => c !== t.status && boardMove(t, c, actor).ok) : [])
  async function move(ref: string, to: TaskStatus) {
    const t = all.find((x) => x.ref === ref)
    if (!t) return
    const m = boardMove(t, to, actor)
    if (!m.ok) {
      if (m.reason) toast.error(m.reason)
      return
    }
    const ok = await write(t, m.action === "complete" ? "complete" : `status:${to}`, {
      predict: (x) => (m.action === "complete" ? completeTask(x, me, now) : changeStatus(x, to, me, now)),
      request: (c) => (m.action === "complete" ? c.complete(t) : c.setStatus(t, to)),
    })
    if (ok) toast.success(`${ref}: ${STATUS[to].label}`)
  }
  async function loadMore(col: TaskStatus, cursor: string) {
    try {
      const q = { column: col, cursor, ...(f.project !== "all" ? { project: f.project } : {}), ...(f.assignee !== "all" ? { assignee: f.assignee } : {}), ...(f.q.trim() ? { q: f.q.trim() } : {}) }
      const b = await apiBrowser.get("/v1/tasks/board", { query: q as never })
      const c = b.columns[0]
      if (!c) return
      setMore((m) => ({ base: columns, add: { ...(m.base === columns ? m.add : {}), [col]: { tasks: [...((m.base === columns ? m.add : {})[col]?.tasks ?? []), ...c.items.map(toCard)], cursor: c.nextCursor } } }))
    } catch (e) {
      toast.error(userMessage(e).text)
    }
  }

  const visible = all.filter(shown)
  return (
    <>
      <PageHead title="Tasks" subtitle={`${total} tasks on the board`} />
      <TaskViewTabs active="board" />
      <div className="card tasks-card" aria-busy={pending || undefined}>
        <BoardFilters {...f} set={set} people={people} projects={projects} staff={staff} />
        {visible.length === 0 ? (
          <EmptyState icon="task" title="No tasks match" text="Try a different search or clear the filters." />
        ) : (
          <div className="kb-scroll">
            <div className="kb-cols">
              {BOARD_COLUMNS.map((col) => {
                const apiCol = columns.find((c) => c.status === col)
                const list = all.filter((t) => t.status === col && shown(t))
                // The count is the API's; a predicted move shifts it by what the overlay changed in this column.
                const was = new Set(server.filter((t) => t.status === col).map((t) => t.id))
                const is = new Set(tasks.filter((t) => t.status === col).map((t) => t.id))
                const delta = [...is].filter((id) => !was.has(id)).length - [...was].filter((id) => !is.has(id)).length
                const cursor = (extra[col] ? extra[col]!.cursor : apiCol?.nextCursor) ?? null
                const dragged = dragRef ? all.find((t) => t.ref === dragRef) : undefined
                const allowed = !!dragged && dragged.status !== col && boardMove(dragged, col, actor).ok
                return (
                  <section
                    key={col}
                    className="kb-col"
                    aria-label={STATUS[col].label}
                    data-over={over === col ? (allowed ? "ok" : "no") : undefined}
                    onDragOver={(e) => {
                      if (!dragRef) return
                      e.preventDefault()
                      setOver(col)
                    }}
                    onDragLeave={() => setOver((o) => (o === col ? null : o))}
                    onDrop={(e) => {
                      e.preventDefault()
                      const ref = e.dataTransfer.getData("text/plain") || dragRef
                      setOver(null)
                      setDragRef(null)
                      if (ref) void move(ref, col)
                    }}
                  >
                    <header className="kb-head">
                      <span className={`kb-dot ${STATUS[col].tone}`} aria-hidden="true" />
                      <span className="kb-name">{STATUS[col].label}</span>
                      <span className="kb-count num">{Math.max(0, (apiCol?.count ?? list.length) + delta)}</span>
                    </header>
                    <ul className="kb-list" onDragEnd={() => { setDragRef(null); setOver(null) }}>
                      <AnimatePresence initial={false}>
                        {list.map((t) => (
                          <BoardCard key={t.id} t={t} people={byId} today={today} nowAt={nowAt} tzLabel={tzLabel} moves={targets(t)} onMove={(to) => void move(t.ref, to)} onDragStart={() => setDragRef(t.ref)} />
                        ))}
                      </AnimatePresence>
                    </ul>
                    {cursor && <button type="button" className="kb-more-btn tpl-link" onClick={() => void loadMore(col, cursor)}>Load more</button>}
                  </section>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
