"use client"

import { useCallback, useMemo, useState } from "react"
import Link from "next/link"

import { EmptyState } from "@/components/empty-state"
import { PageHead } from "@/components/page-head"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import { isOverdue } from "@/lib/dates"
import { isLate, isOpen } from "../lifecycle"
import { describeRepeat, materialiseRecurring } from "../recurrence"
import { addEvidence, addNote, changeDeadline, changeStatus, nowIso, reviewEvidence, setOverdue, setRepeat } from "../mutations"
import { useTasksStore } from "../store"
import { STATUS } from "../types"
import type { Evidence, Person, Task, TaskStatus } from "../types"
import { EvidencePanel } from "./evidence-panel"
import { OverdueForm } from "./overdue-form"
import { RepeatDialog } from "./repeat-dialog"
import { TaskActions } from "./task-actions"
import { TaskNotes } from "./task-notes"
import { TaskTimeline } from "./task-timeline"

const PRIO = ["", "Low", "Medium", "High"]

export function TaskDetail({
  taskRef,
  seed,
  scopeKey,
  people,
  today,
  tzLabel,
  actor,
  canEdit,
  me,
  refFloor = 0,
}: {
  taskRef: string
  /** Same seed + scopeKey as /tasks, so edits made here show in the list and the other way round. */
  seed: Task[]
  scopeKey: string
  people: Person[]
  today: string
  tzLabel: string
  actor: "assignee" | "reviewer"
  canEdit: boolean
  /** Name written on timeline entries: Daniel for staff roles, the signed-in user for managers. */
  me: string
  refFloor?: number
}) {
  const [tasks, setTasks] = useTasksStore(seed, scopeKey, people, { today, refFloor })
  const task = tasks.find((t) => t.ref === taskRef)
  const now = nowIso(today)
  const [editingRepeat, setEditingRepeat] = useState(false)
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people])

  const apply = useCallback(
    (fn: (t: Task) => Task) => setTasks((prev) => prev.map((t) => (t.ref === taskRef ? fn(t) : t))),
    [setTasks, taskRef],
  )
  const onAddEvidence = useCallback((item: { kind: Evidence["kind"]; name: string }) => apply((t) => addEvidence(t, item, me, now)), [apply, me, now])

  if (!task) {
    return (
      <div className="card">
        <EmptyState
          icon="task"
          title="Task not found"
          text={`There is no task ${taskRef} that you can open.`}
          action={<Link href="/tasks" className="btn btn-outline">Back to tasks</Link>}
        />
      </div>
    )
  }

  const assignee = byId.get(task.assignee)
  const creator = byId.get(task.creator)?.name ?? task.creator
  const open = isOpen(task)
  const late = isLate(task, now)
  const overdue = open && isOverdue(task.due, now)
  const done = task.status === "submitted" || task.status === "completed"
  const lateLabel = late ? (done ? "Delivered late" : "Late") : "On time"

  return (
    <>
      <Link href="/tasks" className="td-back">← All tasks</Link>
      <PageHead title={task.title} subtitle={<span className="num">{task.ref}</span>} />
      <div className="td-grid">
        <div className="td-col">
          <section className="card td-main" aria-label="Task details">
            <div className="td-badges">
              <StatusPill status={STATUS[task.status]} />
              <span className="td-prio">
                <span className={`prio p${task.priority}`} aria-hidden="true"><i /><i /><i /></span>
                {PRIO[task.priority]} priority
              </span>
              {task.status !== "cancelled" && <span className={`st ${late ? "bad" : "ok"}`}>{lateLabel}</span>}
            </div>
            <p className="td-desc">{task.description}</p>
            <dl className="td-meta">
              <div>
                <dt>Assignee</dt>
                <dd>
                  {assignee ? (
                    <span className="td-person"><span className={`avatar ${assignee.avatar}`}>{assignee.initials}</span>{assignee.name}</span>
                  ) : (
                    task.assignee
                  )}
                </dd>
              </div>
              <div><dt>Created by</dt><dd>{creator}</dd></div>
              <div><dt>Department</dt><dd><span className="dep-tag">{task.dept}</span></dd></div>
              <div><dt>Start</dt><dd><When iso={task.start} today={today} tzLabel={tzLabel} mode="date" /></dd></div>
              <div><dt>Due</dt><dd className={late ? "due-late" : undefined}><When iso={task.due} today={today} tzLabel={tzLabel} /></dd></div>
              {(task.repeat || task.seriesId) && (
                <div>
                  <dt>Repeat</dt>
                  <dd>
                    {task.repeat ? describeRepeat(task.repeat) : <>Part of series <Link href={`/tasks/${task.seriesId}`} className="tpl-link">{task.seriesId}</Link></>}
                    {task.repeat && canEdit && actor === "reviewer" && (
                      <> · <button type="button" className="tpl-link" onClick={() => setEditingRepeat(true)}>Change</button></>
                    )}
                  </dd>
                </div>
              )}
              {!task.repeat && !task.seriesId && canEdit && actor === "reviewer" && open && (
                <div><dt>Repeat</dt><dd>Does not repeat · <button type="button" className="tpl-link" onClick={() => setEditingRepeat(true)}>Set repeat</button></dd></div>
              )}
              {task.client && <div><dt>Client</dt><dd>{task.client}</dd></div>}
              {task.tags.length > 0 && (
                <div><dt>Tags</dt><dd className="td-tags">{task.tags.map((g) => <span key={g} className="dep-tag">{g}</span>)}</dd></div>
              )}
            </dl>
          </section>
          <EvidencePanel
            evidence={task.evidence}
            required={task.evidenceRequired}
            canAdd={canEdit && open}
            canReview={canEdit && actor === "reviewer" && open}
            today={today}
            tzLabel={tzLabel}
            onAdd={onAddEvidence}
            onReview={(id, review, reason) => apply((t) => reviewEvidence(t, id, review, reason, me, now))}
          />
          <TaskNotes notes={task.notes} canAdd={canEdit && open} today={today} tzLabel={tzLabel} onAdd={(text) => apply((t) => addNote(t, text, me, now))} />
        </div>
        <div className="td-col">
          <TaskActions
            task={task}
            today={today}
            actor={actor}
            canEdit={canEdit}
            onStatus={(to: TaskStatus) => apply((t) => changeStatus(t, to, me, now))}
            onDeadline={(due) => apply((t) => changeDeadline(t, due, me, now))}
          />
          {(overdue || task.overdue) && (
            <OverdueForm
              overdue={task.overdue}
              people={people}
              defaultOwner={assignee?.name ?? ""}
              now={now}
              canEdit={canEdit && overdue}
              onSave={(o) => apply((t) => setOverdue(t, o, me, now))}
            />
          )}
          <TaskTimeline events={task.timeline} today={today} tzLabel={tzLabel} />
        </div>
      </div>
      {!task.seriesId && (
        <RepeatDialog
          open={editingRepeat}
          onOpenChange={setEditingRepeat}
          rule={task.repeat}
          due={task.due}
          today={today}
          onSave={(rule) => setTasks((prev) => materialiseRecurring(prev.map((t) => (t.ref === taskRef ? setRepeat(t, rule, me, now) : t)), today, refFloor))}
        />
      )}
    </>
  )
}
