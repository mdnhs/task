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
import { EVIDENCE_STATE, evidenceState } from "@/lib/task-evidence"
import { layoutTransition } from "@/lib/motion"
import { boardMove, isLate } from "../lifecycle"
import { changeStatus, completeTask, nowIso } from "../mutations"
import { assigneesOf, checklistProgress, isAssigned, liveTasks } from "../planning"
import { useTasksStore } from "../store"
import { STATUS } from "../types"
import type { Person, Project, Task, TaskStatus } from "../types"
import { TaskViewTabs } from "./task-view-tabs"

/** Board columns: every status but Cancelled (closed work that never happened is in the list). */
export const BOARD_COLUMNS: TaskStatus[] = ["not_started", "in_progress", "blocked", "submitted", "changes_requested", "completed"]

export type BoardProps = {
  tasks: Task[]
  people: Person[]
  projects: Project[]
  today: string
  tzLabel: string
  scopeKey: string
  refFloor: number
  onlyAssignee?: string
  canEdit: boolean
  actor: "assignee" | "reviewer"
  me: string
}

/** Shared filtering for the board and the calendar: department, search, project, assignee, not archived. */
export function useBoardRows(p: Pick<BoardProps, "tasks" | "people" | "scopeKey" | "today" | "refFloor" | "onlyAssignee">, f: { q: string; project: string; assignee: string }) {
  const dept = useDept()
  const [stored, setTasks] = useTasksStore(p.tasks, p.scopeKey, p.people, { today: p.today, refFloor: p.refFloor })
  const all = useMemo(() => liveTasks(p.onlyAssignee ? stored.filter((t) => isAssigned(t, p.onlyAssignee!)) : stored), [stored, p.onlyAssignee])
  const byId = useMemo(() => new Map(p.people.map((x) => [x.id, x])), [p.people])
  const rows = useMemo(() => {
    const q = f.q.trim().toLowerCase()
    return all.filter(
      (t) =>
        (dept === "all" || t.dept === dept) &&
        (f.project === "all" || t.projectId === f.project) &&
        (f.assignee === "all" || isAssigned(t, f.assignee)) &&
        (!q || [t.title, t.ref, byId.get(t.assignee)?.name ?? "", ...t.tags].some((s) => s.toLowerCase().includes(q))),
    )
  }, [all, dept, f.q, f.project, f.assignee, byId])
  return { all, rows, byId, setTasks, stored }
}

export function BoardFilters({ q, project, assignee, set, people, projects, onlyAssignee, children }: {
  q: string
  project: string
  assignee: string
  set(k: "q" | "project" | "assignee", v: string): void
  people: Person[]
  projects: Project[]
  onlyAssignee?: string
  children?: React.ReactNode
}) {
  return (
    <FilterBar>
      <FilterSearch value={q} onChange={(v) => set("q", v)} placeholder="Search tasks" />
      {projects.length > 0 && (
        <FilterSelect label="Project" value={project} options={[{ value: "all", label: "All projects" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} onChange={(v) => set("project", v)} />
      )}
      {!onlyAssignee && (
        <FilterSelect label="Assignee" value={assignee} options={[{ value: "all", label: "All assignees" }, ...people.map((p) => ({ value: p.id, label: p.name }))]} onChange={(v) => set("assignee", v)} />
      )}
      {children}
    </FilterBar>
  )
}

function BoardCard({ t, people, today, tzLabel, moves, onMove, onDragStart }: {
  t: Task
  people: Map<string, Person>
  today: string
  tzLabel: string
  moves: TaskStatus[]
  onMove(to: TaskStatus): void
  onDragStart(): void
}) {
  const a = people.get(t.assignee)
  const more = assigneesOf(t).length - 1
  const ev = evidenceState(t.evidenceRule, t.evidence, t.status)
  const cl = checklistProgress(t)
  const late = isLate(t, today)
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

/** Kanban board (FR-M1-05): drag a card to another status column, or use "Move to" (keyboard and touch). */
export function TaskBoard(props: BoardProps) {
  const { people, projects, today, tzLabel, onlyAssignee, canEdit, actor, me } = props
  const [f, setF] = useState({ q: "", project: "all", assignee: "all" })
  const { rows, byId, setTasks } = useBoardRows(props, f)
  const [dragRef, setDragRef] = useState<string | null>(null)
  const [over, setOver] = useState<TaskStatus | null>(null)
  const now = nowIso(today)

  const targets = (t: Task): TaskStatus[] => (canEdit ? BOARD_COLUMNS.filter((c) => c !== t.status && boardMove(t, c, actor).ok) : [])
  function move(ref: string, to: TaskStatus) {
    const t = rows.find((x) => x.ref === ref)
    if (!t) return
    const m = boardMove(t, to, actor)
    if (!m.ok) {
      if (m.reason) toast.error(m.reason)
      return
    }
    const next = m.action === "complete" ? completeTask(t, me, now) : changeStatus(t, to, me, now)
    setTasks((prev) => prev.map((x) => (x.ref === ref ? next : x)))
    toast.success(`${ref}: ${STATUS[next.status].label}`)
  }

  return (
    <>
      <PageHead title="Tasks" subtitle={`${rows.length} tasks on the board`} />
      <TaskViewTabs active="board" />
      <div className="card tasks-card">
        <BoardFilters {...f} set={(k, v) => setF((x) => ({ ...x, [k]: v }))} people={people} projects={projects} onlyAssignee={onlyAssignee} />
        {rows.length === 0 ? (
          <EmptyState icon="task" title="No tasks match" text="Try a different search or clear the filters." />
        ) : (
          <div className="kb-scroll">
            <div className="kb-cols">
              {BOARD_COLUMNS.map((col) => {
                const list = rows.filter((t) => t.status === col)
                const dragged = dragRef ? rows.find((t) => t.ref === dragRef) : undefined
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
                      if (ref) move(ref, col)
                    }}
                  >
                    <header className="kb-head">
                      <span className={`kb-dot ${STATUS[col].tone}`} aria-hidden="true" />
                      <span className="kb-name">{STATUS[col].label}</span>
                      <span className="kb-count num">{list.length}</span>
                    </header>
                    <ul className="kb-list" onDragEnd={() => { setDragRef(null); setOver(null) }}>
                      <AnimatePresence initial={false}>
                        {list.map((t) => (
                          <BoardCard key={t.ref} t={t} people={byId} today={today} tzLabel={tzLabel} moves={targets(t)} onMove={(to) => move(t.ref, to)} onDragStart={() => setDragRef(t.ref)} />
                        ))}
                      </AnimatePresence>
                    </ul>
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

