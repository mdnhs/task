"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { EmptyState } from "@/components/empty-state"
import { PageHead } from "@/components/page-head"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import { apiBrowser } from "@/lib/api/browser"
import { userMessage } from "@/lib/api/problem"
import { formatDate, isOverdue } from "@/lib/dates"
import { EVIDENCE_STATE, reviewerText } from "@/lib/task-evidence"
import { FileRefused, VoiceTooLong, isKnockOnChanged } from "../client"
import { canVerifyTask, evState, fileRefusedCopy, type Viewer } from "../evidence-view"
import { isOpen } from "../lifecycle"
import { isLateAt } from "../time"
import {
  archiveTask, changeStatus, completeTask, declineProposal, nowIso, proposeDates, reassign, rejectTask, reschedule, restoreTask, reviewEvidence, setDependencies, setEvidenceRule, setOverdue, setRepeat, verifyTask,
} from "../mutations"
import { archiveDaysLeft, assigneesOf } from "../planning"
import { describeRepeat } from "../recurrence"
import { useTaskWrites } from "../use-task-writes"
import { STATUS } from "../types"
import type { Person, Project, Task, TaskStatus } from "../types"
import { EvidencePanel, EvidenceStepDialog, type EvidenceAdds } from "./evidence-panel"
import { OverdueForm } from "./overdue-form"
import { RepeatDialog } from "./repeat-dialog"
import type { PatternChoice } from "./repeat-field"
import { ProposeDialog, ReassignDialog, RescheduleDialog, type PreviewData, type SaveResult } from "./schedule-dialogs"
import { TaskActions } from "./task-actions"
import { TaskNotes } from "./task-notes"
import { ChecklistCard, DependenciesDialog, SubtasksCard } from "./task-plan-cards"
import { TaskTimeline } from "./task-timeline"
import { VoiceCard } from "./voice-card"

const PRIO = ["", "Low", "Medium", "High"]
export const formatEstimate = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`)

export function TaskDetail({
  taskRef,
  task: server,
  people,
  projects = [],
  today,
  nowAt,
  tzLabel,
  actor,
  canEdit,
  viewer,
  driveAllowed,
  patterns = [],
}: {
  taskRef: string
  /** The task the API returned for this ref, or null: out of scope looks exactly like "no such task" (404 task_not_found). */
  task: Task | null
  people: Person[]
  projects?: Project[]
  today: string
  /** The clock as a UTC instant: lateness compares it with `dueAt` (I12). */
  nowAt?: string
  tzLabel: string
  actor: "assignee" | "reviewer"
  canEdit: boolean
  /** The signed-in member. `name` is written on predicted timeline lines; `purge` is settings:write (permanent delete of an archived task). */
  viewer: Viewer & { purge: boolean }
  /** Device policy decision for Google Drive (computed on the server). */
  driveAllowed: boolean
  /** Shift patterns for "Every shift" repeats; empty when the shifts data is not available. */
  patterns?: PatternChoice[]
}) {
  const router = useRouter()
  const { tasks, write, act, client } = useTaskWrites(useMemo(() => (server ? [server] : []), [server]))
  const task = tasks[0]
  const me = viewer.name
  const now = nowIso(today)
  const [dialog, setDialog] = useState<null | "repeat" | "reschedule" | "approve" | "reassign" | "propose" | "deps" | "evidence">(null)
  const [purging, setPurging] = useState(false)
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people])
  const name = useCallback((id: string) => byId.get(id)?.name ?? "Member", [byId])
  const meId = viewer.id
  const manager = actor === "reviewer"
  const knockOnChanged = useRef(false)

  const adds: EvidenceAdds = useMemo(
    () => ({
      file: async (f, kind, source, onScanning) => {
        if (!task) return false
        const r = await act(`evidence-file:${task.id}:${f.name}:${f.size}`, (c) => c.addFileEvidence(task, kind, f, { source, onScanning }), {
          handled: (e) => {
            if (!(e instanceof FileRefused)) return false
            toast.error(fileRefusedCopy(e.reason, f.name))
            return true
          },
        })
        return r.ok
      },
      text: async (kind, text) => (task ? (await act(`evidence-${kind}:${task.id}`, (c) => (kind === "drive" ? c.addDriveEvidence(task, text) : c.addNoteEvidence(task, text)), { success: kind === "drive" ? "Drive link added" : "Note added" })).ok : false),
      checklist: async () => (task ? (await act(`evidence-checklist:${task.id}`, (c) => c.addChecklistEvidence(task))).ok : false),
    }),
    [act, task],
  )

  const searchTasks = useCallback(
    async (q: string) => {
      try {
        const page = await apiBrowser.get("/v1/tasks", { query: { q, limit: 10 } })
        return page.items.map((t) => ({ id: t.id, ref: t.ref, title: t.title }))
      } catch {
        return []
      }
    },
    [],
  )

  if (!task) {
    return (
      <div className="card">
        <EmptyState icon="task" title="Task not found" text={`There is no task ${taskRef} that you can open.`} action={<Link href="/tasks" className="btn btn-outline">Back to tasks</Link>} />
      </div>
    )
  }

  /** A change the viewer made to someone else's task tells the people on it (the API writes the notices; the history line lists who). The prediction only needs the line. */
  const w = <T,>(key: string, request: (c: typeof client) => Promise<T>, predict?: (t: Task) => Task, success?: string) => write(task, key, { request, predict, success })
  const copyOf = (e: unknown) => userMessage(e)

  const people$ = assigneesOf(task).map((id) => byId.get(id) ?? { id, name: id, initials: "?", avatar: "av1" as const, role: "", dept: "" })
  const creator = name(task.creator)
  const open = isOpen(task) && !task.archivedAt
  const late = isLateAt(task, now, nowAt)
  const overdue = open && (nowAt && task.dueAt ? Date.parse(task.dueAt) < Date.parse(nowAt) : isOverdue(task.due, now))
  const done = task.status === "submitted" || task.status === "completed"
  const lateLabel = late ? (done ? "Delivered late" : "Late") : "On time"
  const evS = evState(task)
  // D8: the check always gets the WHOLE task (primary and every co-assignee), never a partial list; the API still answers 403 self_verification if it is forced.
  const canVerify = canEdit && canVerifyTask(task, viewer)
  // Members work their own tasks; managers may also act for the assignee (add evidence). Nothing changes while it is under review.
  const canWork = canEdit && open && task.status !== "submitted"
  const project = projects.find((p) => p.id === task.projectId)
  const milestone = project?.milestones.find((m) => m.id === task.milestoneId)
  const subtasks = task.subtasks ?? []
  // A parent outside the caller's scope has no ref in the DTO (E15): no link, no crash.
  const parentRef = task.parentRef
  const canVoice = canEdit && open && (manager || meId === task.creator)

  const preview = async (to: { start: string; due: string }): Promise<PreviewData | null> => {
    try {
      const p = await client.previewReschedule(task, to)
      return { moves: p.moves.flatMap((m) => (m.outOfScope ? [] : [{ ref: m.ref, title: m.title, from: m.from, to: m.to }])), hidden: p.hiddenMoves, hash: p.previewHash }
    } catch (e) {
      toast.error(copyOf(e).text)
      return null
    }
  }
  const saveDates = async (to: { start: string; due: string }, ko: { apply: false } | { apply: true; previewHash: string }, approve: boolean): Promise<SaveResult> => {
    knockOnChanged.current = false
    const ok = await write(task, approve ? "approve" : "reschedule", {
      predict: approve ? undefined : (t) => reschedule(t, to, me, now),
      request: (c) => (approve ? c.approveProposal(task, ko) : c.reschedule(task, to, ko)),
      handled: (e) => {
        if (!isKnockOnChanged(e)) return false
        knockOnChanged.current = true // the dialog shows the preview again and the manager decides again
        return true
      },
    })
    return ok ? "ok" : knockOnChanged.current ? "changed" : "failed"
  }
  return (
    <>
      <Link href="/tasks" className="td-back">← All tasks</Link>
      <PageHead title={task.title} subtitle={<span className="num">{task.ref}</span>} />
      {task.archivedAt && (
        <div className="td-state mute td-banner" role="status">
          <strong>Archived {formatDate(task.archivedAt)}{task.archivedBy ? ` by ${name(task.archivedBy)}` : ""}</strong>
          <span>
            Restorable for {archiveDaysLeft(task.archivedAt, today)} more days.{" "}
            {canEdit && manager && (
              <button type="button" className="tpl-link" onClick={() => void w("restore", (c) => c.restore(task), (t) => restoreTask(t, me, now), `${task.ref} restored`)}>Restore</button>
            )}
            {canEdit && manager && viewer.purge && (
              <> · <button type="button" className="tpl-link bad" onClick={() => setPurging(true)}>Delete permanently</button></>
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
            <button type="button" className="btn btn-outline" onClick={() => void w("decline", (c) => c.declineProposal(task), (t) => declineProposal(t, me, now), "Proposal declined")}>Decline</button>
          </span>
        </div>
      )}
      <div className="td-grid">
        <div className="td-col">
          <section className="card td-main" aria-label="Task details">
            <div className="td-badges">
              <StatusPill status={STATUS[task.status]} />
              {evS && <StatusPill status={EVIDENCE_STATE[evS]} />}
              <span className="td-prio">
                <span className={`prio p${task.priority}`} aria-hidden="true"><i /><i /><i /></span>
                {PRIO[task.priority]} priority
              </span>
              {task.status !== "cancelled" && <span className={`st ${late ? "bad" : "ok"}`}>{lateLabel}</span>}
            </div>
            <p className="td-desc">{task.description}</p>
            <VoiceCard
              task={task}
              canManage={canVoice}
              canSeePlays={manager && canEdit}
              today={today}
              tzLabel={tzLabel}
              onSet={async (blob, sec) => (await write(task, "voice", { request: (c) => c.setVoice(task, new File([blob], "voice-note", { type: blob.type || "audio/webm" }), sec), handled: (e) => (e instanceof VoiceTooLong ? (toast.error("A voice note can be 2 minutes at most."), true) : false) }))}
              onClear={() => w("voice-clear", (c) => c.clearVoice(task))}
              loadPlays={async () => {
                try {
                  return (await client.voicePlays(task)).items.map((p) => ({ id: p.id, by: p.by, at: p.at }))
                } catch (e) {
                  toast.error(copyOf(e).text)
                  return null
                }
              }}
            />
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
              {parentRef && <div><dt>Subtask of</dt><dd><Link href={`/tasks/${parentRef}`} className="tpl-link">{parentRef}</Link></dd></div>}
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
                  </dd>
                </div>
              )}
              {(task.repeat || task.seriesId) && (
                <div>
                  <dt>Repeat</dt>
                  <dd>
                    {task.repeat ? describeRepeat(task.repeat) : <>Part of a repeating series</>}
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
            viewer={viewer}
            canAdd={canWork}
            canVerify={canVerify && task.status === "submitted"}
            canEditRule={canEdit && open && (manager || meId === task.creator)}
            driveAllowed={driveAllowed}
            today={today}
            tzLabel={tzLabel}
            adds={adds}
            onRemove={(id) => w(`evidence-rm:${id}`, (c) => c.removeEvidence(task, id), (t) => ({ ...t, evidence: t.evidence.filter((e) => e.id !== id) }))}
            onReview={(id, review, reason) =>
              w(`review:${id}`, (c) => (review === "accepted" ? c.verify(task, [id]) : c.reject(task, reason ?? "", [id])), (t) => reviewEvidence(t, id, review, reason, me, now))
            }
            onRule={(rule) => w("rule", (c) => c.setEvidenceRule(task, rule), (t) => setEvidenceRule(t, rule, me, now))}
          />
          <ChecklistCard
            task={task}
            canTick={canEdit && open}
            canEdit={canEdit && open && manager}
            onToggle={(id, done) => w(`check:${id}`, (c) => c.setChecklistDone(task, id, done), (t) => ({ ...t, checklist: (t.checklist ?? []).map((i) => (i.id === id ? { ...i, done } : i)) }))}
            onAdd={(text) => w("check-add", (c) => c.addChecklistItem(task, text))}
            onRemove={(id) => w(`check-rm:${id}`, (c) => c.removeChecklistItem(task, id), (t) => ({ ...t, checklist: (t.checklist ?? []).filter((i) => i.id !== id) }))}
          />
          <SubtasksCard
            subtasks={subtasks}
            canAdd={canEdit && open && manager && !task.parentRef}
            onAdd={(title) => w("subtask", (c) => c.addSubtask(task, title), undefined, "Subtask added")}
          />
          <TaskNotes notes={task.notes} canAdd={canEdit && open} today={today} tzLabel={tzLabel} onAdd={(text) => w("comment", (c) => c.comment(task, text))} />
        </div>
        <div className="td-col">
          <TaskActions
            task={task}
            actor={actor}
            canEdit={canEdit}
            canVerify={canVerify}
            reviewerText={reviewerText(task.evidenceRule, creator, (id) => byId.get(id)?.name)}
            onStatus={(to: TaskStatus) => w(`status:${to}`, (c) => c.setStatus(task, to), (t) => changeStatus(t, to, me, now))}
            onComplete={() => w("complete", (c) => c.complete(task), (t) => completeTask(t, me, now))}
            onNeedEvidence={() => setDialog("evidence")}
            onVerify={() => w("verify", (c) => c.verify(task), (t) => verifyTask(t, me, now))}
            onReject={(reason) => w("reject", (c) => c.reject(task, reason), (t) => rejectTask(t, reason, me, now))}
            manage={manager ? {
              onReschedule: () => setDialog("reschedule"),
              onReassign: () => setDialog("reassign"),
              onArchive: () => w("archive", (c) => c.archive(task), (t) => archiveTask(t, me, now)),
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
              onSave={(o) => void w("overdue", (c) => c.patch(task, setOverdue(task, o, me, now)), (t) => setOverdue(t, o, me, now))}
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
          patterns={patterns}
          onSave={(rule) => w("repeat", (c) => c.setRepeat(task, rule ?? null), (t) => setRepeat(t, rule, me, now))}
        />
      )}
      {(dialog === "reschedule" || dialog === "approve") && (
        <RescheduleDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          task={task}
          today={today}
          title={dialog === "approve" ? "Approve new dates" : "Reschedule"}
          initial={dialog === "approve" ? task.proposal : undefined}
          onPreview={preview}
          onSave={(to, ko) => saveDates(to, ko, dialog === "approve")}
        />
      )}
      {dialog === "reassign" && (
        <ReassignDialog open onOpenChange={(o) => !o && setDialog(null)} task={task} people={people} onSave={(primary, others) => w("assign", (c) => c.setAssignees(task, primary, others), (t) => reassign(t, [primary, ...others], me, now, name))} />
      )}
      {dialog === "propose" && (
        <ProposeDialog open onOpenChange={(o) => !o && setDialog(null)} task={task} today={today} onSave={(p) => w("propose", (c) => c.propose(task, p), (t) => proposeDates(t, p, me, now))} />
      )}
      {dialog === "deps" && (
        <DependenciesDialog open onOpenChange={(o) => !o && setDialog(null)} task={task} search={searchTasks} onSave={(ids) => w("deps", (c) => c.setDependencies(task, ids), (t) => setDependencies(t, [], me, now))} />
      )}
      <EvidenceStepDialog
        open={dialog === "evidence"}
        onOpenChange={(o) => setDialog(o ? "evidence" : null)}
        task={task}
        me={me}
        driveAllowed={driveAllowed}
        adds={adds}
        onComplete={async () => {
          const ok = await w("complete", (c) => c.complete(task), (t) => completeTask(t, me, now))
          if (ok) toast.success(`${task.ref}: ${task.evidenceRule.review === "auto" ? "Completed" : "Awaiting verification"}`)
          return ok
        }}
      />
      <ConfirmDialog
        open={purging}
        onOpenChange={setPurging}
        title="Delete permanently?"
        text={`${task.ref}, its subtasks and files are deleted for good. This can't be undone.`}
        confirmLabel="Delete permanently"
        destructive
        onConfirm={async () => {
          const r = await act(`purge:${task.id}`, (c) => c.purge(task))
          if (r.ok) {
            toast.success(`${task.ref} deleted`)
            router.push("/tasks/archive")
          }
        }}
      />
    </>
  )
}
