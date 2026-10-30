"use client"

import { useCallback, useMemo, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"

import { EmptyState } from "@/components/empty-state"
import { PageHead } from "@/components/page-head"
import { StatusPill } from "@/components/status-pill"
import { VoiceNotePlayer } from "@/components/voice-note"
import { When } from "@/components/when"
import { formatDate, isOverdue } from "@/lib/dates"
import { EVIDENCE_STATE, canVerify as mayVerify, evidenceState, reviewerText } from "@/lib/task-evidence"
import { noticeTitle, taskNotices } from "@/lib/task-notices"
import { isLate, isOpen } from "../lifecycle"
import {
  addChecklistItem,
  addEvidence,
  addNote,
  archiveTask,
  changeStatus,
  completeTask,
  declineProposal,
  makeSubtask,
  noteSubtask,
  nowIso,
  proposeDates,
  reassign,
  rejectTask,
  removeChecklistItem,
  removeEvidence,
  reschedule,
  restoreTask,
  reviewEvidence,
  setDependencies,
  setEvidenceRule,
  setOverdue,
  setRepeat,
  toggleChecklistItem,
  verifyTask,
  type NewEvidence,
} from "../mutations"
import { archiveDaysLeft, assigneesOf, dependantsOf, waitingOn, type DateMove } from "../planning"
import { describeRepeat, materialiseRecurring } from "../recurrence"
import { useTasksStore } from "../store"
import { STATUS } from "../types"
import type { Person, Project, Task, TaskStatus } from "../types"
import { EvidencePanel, EvidenceStepDialog } from "./evidence-panel"
import { nextRef } from "./new-task-form"
import { OverdueForm } from "./overdue-form"
import { RepeatDialog } from "./repeat-dialog"
import { ProposeDialog, ReassignDialog, RescheduleDialog } from "./schedule-dialogs"
import { TaskActions } from "./task-actions"
import { TaskNotes } from "./task-notes"
import { ChecklistCard, DependenciesDialog, SubtasksCard } from "./task-plan-cards"
import { TaskTimeline } from "./task-timeline"

const PRIO = ["", "Low", "Medium", "High"]
export const formatEstimate = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`)

export function TaskDetail({
  taskRef,
  seed,
  scopeKey,
  people,
  projects = [],
  today,
  tzLabel,
  actor,
  canEdit,
  me,
  refFloor = 0,
  driveAllowed,
}: {
  taskRef: string
  /** Same seed + scopeKey as /tasks, so edits made here show in the list and the other way round. */
  seed: Task[]
  scopeKey: string
  people: Person[]
  projects?: Project[]
  today: string
  tzLabel: string
  actor: "assignee" | "reviewer"
  canEdit: boolean
  /** Name written on timeline entries: Daniel for staff roles, the signed-in user for managers. */
  me: string
  refFloor?: number
  /** Device policy decision for Google Drive (computed on the server). */
  driveAllowed: boolean
}) {
  const [tasks, setTasks] = useTasksStore(seed, scopeKey, people, { today, refFloor })
  const task = tasks.find((t) => t.ref === taskRef)
  const now = nowIso(today)
  const [dialog, setDialog] = useState<null | "repeat" | "reschedule" | "approve" | "reassign" | "propose" | "deps" | "evidence">(null)
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people])
  const name = useCallback((id: string) => byId.get(id)?.name ?? id, [byId])
  const meId = people.find((p) => p.name === me)?.id ?? me
  const manager = actor === "reviewer"
  const tenantId = scopeKey.split(":")[0] ?? ""

  /**
   * A change to someone else's task tells the people on it (FR-M1-12, AC-M1-04): the history entry lists who was
   * notified, and a notice goes to lib/task-notices for their bell.
   */
  const withNotice = useCallback(
    (before: Task, after: Task, what: string): Task => {
      if (after === before) return after
      const to = [...new Set([...assigneesOf(before), ...assigneesOf(after)])].filter((id) => id !== meId)
      const last = after.timeline.at(-1)
      if (!to.length || !last) return after
      to.forEach((id) =>
        taskNotices.push({ id: `${after.ref}:${after.timeline.length}:${last.at}:${id}`, tenantId, to: id, title: noticeTitle(me, after.ref, what, last.changes), href: `/tasks/${after.ref}`, at: last.at }),
      )
      return { ...after, timeline: [...after.timeline.slice(0, -1), { ...last, notified: to.map(name) }] }
    },
    [meId, me, name, tenantId],
  )
  const apply = useCallback((fn: (t: Task) => Task) => setTasks((prev) => prev.map((t) => (t.ref === taskRef ? fn(t) : t))), [setTasks, taskRef])
  /** Manager edits notify; the member's own edits don't. */
  const applyManaged = useCallback((fn: (t: Task) => Task, what: string) => apply((t) => (manager ? withNotice(t, fn(t), what) : fn(t))), [apply, manager, withNotice])
  const onAddEvidence = useCallback((item: NewEvidence) => apply((t) => addEvidence(t, item, me, now)), [apply, me, now])

  if (!task) {
    return (
      <div className="card">
        <EmptyState icon="task" title="Task not found" text={`There is no task ${taskRef} that you can open.`} action={<Link href="/tasks" className="btn btn-outline">Back to tasks</Link>} />
      </div>
    )
  }

  const people$ = assigneesOf(task).map((id) => byId.get(id) ?? { id, name: id, initials: "?", avatar: "av1" as const, role: "", dept: "" })
  const creator = name(task.creator)
  const open = isOpen(task) && !task.archivedAt
  const late = isLate(task, now)
  const overdue = open && isOverdue(task.due, now)
  const done = task.status === "submitted" || task.status === "completed"
  const lateLabel = late ? (done ? "Delivered late" : "Late") : "On time"
  const evState = evidenceState(task.evidenceRule, task.evidence, task.status)
  const viewer = { id: meId, manager }
  const canVerify = canEdit && mayVerify(task.evidenceRule, viewer, task)
  // Members work their own tasks; managers may also act for the assignee (add evidence). Nothing changes while it is under review.
  const canWork = canEdit && open && task.status !== "submitted"
  const project = projects.find((p) => p.id === task.projectId)
  const milestone = project?.milestones.find((m) => m.id === task.milestoneId)
  const waiting = waitingOn(tasks, task)
  const blocks = dependantsOf(tasks, task.ref)
  const subtasks = tasks.filter((t) => t.parentRef === task.ref && !t.archivedAt)
  const parent = task.parentRef ? tasks.find((t) => t.ref === task.parentRef) : undefined

  function saveDates(to: { start: string; due: string }, moves: DateMove[], why?: string) {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.ref === taskRef) return withNotice(t, reschedule(t, to, me, now, why), "rescheduled")
        const m = moves.find((x) => x.ref === t.ref)
        return m ? withNotice(t, reschedule(t, m.to, me, now, `Moved because ${taskRef} moved (depends on it)`), "rescheduled") : t
      }),
    )
  }

  return (
    <>
      <Link href="/tasks" className="td-back">← All tasks</Link>
      <PageHead title={task.title} subtitle={<span className="num">{task.ref}</span>} />
      {task.archivedAt && (
        <div className="td-state mute td-banner" role="status">
          <strong>Archived {formatDate(task.archivedAt)} by {task.archivedBy}</strong>
          <span>
            Restorable for {archiveDaysLeft(task.archivedAt, today)} more days.{" "}
            {canEdit && manager && (
              <button type="button" className="tpl-link" onClick={() => { apply((t) => restoreTask(t, me, now)); toast.success(`${task.ref} restored`) }}>Restore</button>
            )}
          </span>
        </div>
      )}
      {task.proposal && manager && canEdit && open && (
        <div className="td-state info td-banner" role="status">
          <strong>{task.proposal.by} proposes new dates</strong>
          <span>
            Start {formatDate(task.proposal.start)}, due {formatDate(task.proposal.due)} {task.proposal.due.slice(11, 16)}. “{task.proposal.reason}”
          </span>
          <span className="td-banner-btns">
            <button type="button" className="btn btn-primary" onClick={() => setDialog("approve")}>Review and approve</button>
            <button type="button" className="btn btn-outline" onClick={() => { applyManaged((t) => declineProposal(t, me, now), "declined the date change on"); toast.success("Proposal declined") }}>Decline</button>
          </span>
        </div>
      )}
      <div className="td-grid">
        <div className="td-col">
          <section className="card td-main" aria-label="Task details">
            <div className="td-badges">
              <StatusPill status={STATUS[task.status]} />
              {evState && <StatusPill status={EVIDENCE_STATE[evState]} />}
              <span className="td-prio">
                <span className={`prio p${task.priority}`} aria-hidden="true"><i /><i /><i /></span>
                {PRIO[task.priority]} priority
              </span>
              {task.status !== "cancelled" && <span className={`st ${late ? "bad" : "ok"}`}>{lateLabel}</span>}
            </div>
            <p className="td-desc">{task.description}</p>
            {task.voiceNote && (
              <div className="td-voice" role="group" aria-labelledby="td-voice-h">
                <div className="td-voice-h">
                  <span id="td-voice-h">Voice instructions</span>
                  <span className="td-voice-m">Recorded by {task.voiceNote.recordedBy} · {formatDate(task.voiceNote.recordedAt)}</span>
                </div>
                <VoiceNotePlayer url={task.voiceNote.url} durationSec={task.voiceNote.durationSec} label="voice instructions" />
              </div>
            )}
            <dl className="td-meta">
              <div>
                <dt>{people$.length > 1 ? "Assignees" : "Assignee"}</dt>
                <dd className="td-people">
                  {people$.map((a) => (
                    <span key={a.id} className="td-person"><span className={`avatar ${a.avatar}`}>{a.initials}</span>{a.name}</span>
                  ))}
                </dd>
              </div>
              <div><dt>Created by</dt><dd>{creator}</dd></div>
              <div><dt>Department</dt><dd><span className="dep-tag">{task.dept}</span></dd></div>
              <div><dt>Start</dt><dd><When iso={task.start} today={today} tzLabel={tzLabel} mode="date" /></dd></div>
              <div><dt>Due</dt><dd className={late ? "due-late" : undefined}><When iso={task.due} today={today} tzLabel={tzLabel} /></dd></div>
              {task.estimate ? <div><dt>Estimate</dt><dd className="num">{formatEstimate(task.estimate)}</dd></div> : null}
              {project && (
                <div>
                  <dt>Project</dt>
                  <dd>
                    <Link href={`/tasks?project=${project.id}`} className="tpl-link">{project.name}</Link>
                    {milestone && <span className="td-muted-inline"> · {milestone.name} ({formatDate(milestone.due)})</span>}
                  </dd>
                </div>
              )}
              {parent && <div><dt>Subtask of</dt><dd><Link href={`/tasks/${parent.ref}`} className="tpl-link">{parent.ref}</Link> {parent.title}</dd></div>}
              {(task.dependsOn?.length || (manager && canEdit && open)) && (
                <div>
                  <dt>Depends on</dt>
                  <dd>
                    {task.dependsOn?.length
                      ? task.dependsOn.map((r, i) => (
                          <span key={r}>{i > 0 && ", "}<Link href={`/tasks/${r}`} className="tpl-link">{r}</Link></span>
                        ))
                      : "Nothing"}
                    {manager && canEdit && open && <> · <button type="button" className="tpl-link" onClick={() => setDialog("deps")}>Edit</button></>}
                    {waiting.length > 0 && open && <div className="td-wait">Waiting on {waiting.map((w) => w.ref).join(", ")} to finish</div>}
                  </dd>
                </div>
              )}
              {blocks.length > 0 && (
                <div><dt>Blocks</dt><dd>{blocks.map((b, i) => <span key={b.ref}>{i > 0 && ", "}<Link href={`/tasks/${b.ref}`} className="tpl-link">{b.ref}</Link></span>)}</dd></div>
              )}
              {(task.repeat || task.seriesId) && (
                <div>
                  <dt>Repeat</dt>
                  <dd>
                    {task.repeat ? describeRepeat(task.repeat) : <>Part of series <Link href={`/tasks/${task.seriesId}`} className="tpl-link">{task.seriesId}</Link></>}
                    {task.repeat && canEdit && manager && <> · <button type="button" className="tpl-link" onClick={() => setDialog("repeat")}>Change</button></>}
                  </dd>
                </div>
              )}
              {!task.repeat && !task.seriesId && canEdit && manager && open && (
                <div><dt>Repeat</dt><dd>Does not repeat · <button type="button" className="tpl-link" onClick={() => setDialog("repeat")}>Set repeat</button></dd></div>
              )}
              {task.client && <div><dt>Client</dt><dd>{task.client}</dd></div>}
              {task.timeEntries && task.timeEntries.length > 0 && (
                <div><dt>Time logged</dt><dd className="num">{task.timeEntries.reduce((n, e) => n + e.minutes, 0)} min · {task.timeEntries.length} {task.timeEntries.length === 1 ? "entry" : "entries"}</dd></div>
              )}
              {task.tags.length > 0 && (
                <div><dt>Labels</dt><dd className="td-tags">{task.tags.map((g) => <span key={g} className="dep-tag">{g}</span>)}</dd></div>
              )}
            </dl>
          </section>
          <EvidencePanel
            task={task}
            people={people}
            me={me}
            canAdd={canWork}
            canVerify={canVerify && task.status === "submitted"}
            canEditRule={canEdit && open && (manager || meId === task.creator)}
            driveAllowed={driveAllowed}
            today={today}
            tzLabel={tzLabel}
            onAdd={onAddEvidence}
            onRemove={(id) => apply((t) => removeEvidence(t, id, me, now))}
            onReview={(id, review, reason) => applyManaged((t) => reviewEvidence(t, id, review, reason, me, now), review === "rejected" ? "rejected evidence on" : "verified evidence on")}
            onRule={(rule) => applyManaged((t) => setEvidenceRule(t, rule, me, now), "changed the evidence rule of")}
          />
          <ChecklistCard
            task={task}
            canTick={canEdit && open}
            canEdit={canEdit && open && manager}
            onToggle={(id) => apply((t) => toggleChecklistItem(t, id, me, now))}
            onAdd={(text) => applyManaged((t) => addChecklistItem(t, text, me, now), "added a checklist item to")}
            onRemove={(id) => applyManaged((t) => removeChecklistItem(t, id, me, now), "removed a checklist item from")}
          />
          <SubtasksCard
            subtasks={subtasks}
            canAdd={canEdit && open && manager && !task.parentRef}
            onAdd={(title) => {
              let made = ""
              setTasks((prev) => {
                made = nextRef(prev, refFloor)
                const child = makeSubtask(task, made, title, me, meId, now)
                return [child, ...prev.map((t) => (t.ref === task.ref ? noteSubtask(t, child, me, now) : t))]
              })
              toast.success(`Subtask ${made} added`)
            }}
          />
          <TaskNotes notes={task.notes} canAdd={canEdit && open} today={today} tzLabel={tzLabel} onAdd={(text) => apply((t) => addNote(t, text, me, now))} />
        </div>
        <div className="td-col">
          <TaskActions
            task={task}
            actor={actor}
            canEdit={canEdit}
            canVerify={canVerify}
            reviewerText={reviewerText(task.evidenceRule, creator, (id) => byId.get(id)?.name)}
            onStatus={(to: TaskStatus) => applyManaged((t) => changeStatus(t, to, me, now), "changed the status of")}
            onComplete={() => apply((t) => completeTask(t, me, now))}
            onNeedEvidence={() => setDialog("evidence")}
            onVerify={() => applyManaged((t) => verifyTask(t, me, now), "verified")}
            onReject={(reason) => applyManaged((t) => rejectTask(t, reason, me, now), "rejected the evidence of")}
            manage={manager ? {
              onReschedule: () => setDialog("reschedule"),
              onReassign: () => setDialog("reassign"),
              onArchive: () => applyManaged((t) => archiveTask(t, me, now), "removed (archived)"),
            } : undefined}
            member={!manager ? { onPropose: () => setDialog("propose") } : undefined}
          />
          {(overdue || task.overdue) && (
            <OverdueForm
              overdue={task.overdue}
              people={people}
              defaultOwner={people$[0]?.name ?? ""}
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
          open={dialog === "repeat"}
          onOpenChange={(o) => setDialog(o ? "repeat" : null)}
          rule={task.repeat}
          due={task.due}
          today={today}
          onSave={(rule) => setTasks((prev) => materialiseRecurring(prev.map((t) => (t.ref === taskRef ? setRepeat(t, rule, me, now) : t)), today, refFloor))}
        />
      )}
      {(dialog === "reschedule" || dialog === "approve") && (
        <RescheduleDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          task={task}
          tasks={tasks}
          today={today}
          title={dialog === "approve" ? "Approve new dates" : "Reschedule"}
          initial={dialog === "approve" ? task.proposal : undefined}
          onSave={(to, moves) => saveDates(to, moves, dialog === "approve" ? `Date change from ${task.proposal?.by} approved` : undefined)}
        />
      )}
      {dialog === "reassign" && (
        <ReassignDialog open onOpenChange={(o) => !o && setDialog(null)} task={task} people={people} onSave={(ids) => applyManaged((t) => reassign(t, ids, me, now, name), "reassigned")} />
      )}
      {dialog === "propose" && (
        <ProposeDialog open onOpenChange={(o) => !o && setDialog(null)} task={task} today={today} onSave={(p) => apply((t) => proposeDates(t, p, me, now))} />
      )}
      {dialog === "deps" && (
        <DependenciesDialog open onOpenChange={(o) => !o && setDialog(null)} task={task} tasks={tasks} onSave={(refs) => applyManaged((t) => setDependencies(t, refs, me, now), "changed the dependencies of")} />
      )}
      <EvidenceStepDialog
        open={dialog === "evidence"}
        onOpenChange={(o) => setDialog(o ? "evidence" : null)}
        task={task}
        me={me}
        driveAllowed={driveAllowed}
        onAdd={onAddEvidence}
        onComplete={() => {
          apply((t) => completeTask(t, me, now))
          toast.success(`${task.ref}: ${task.evidenceRule.review === "auto" ? "Completed" : "Awaiting verification"}`)
        }}
      />
    </>
  )
}
