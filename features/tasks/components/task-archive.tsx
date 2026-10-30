"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { EmptyState } from "@/components/empty-state"
import { PageHead } from "@/components/page-head"
import { StatusPill } from "@/components/status-pill"
import { auditOutbox } from "@/lib/audit-outbox"
import { formatDate } from "@/lib/dates"
import { nowIso, restoreTask } from "../mutations"
import { ARCHIVE_DAYS, archiveDaysLeft, archivedTasks, isAssigned } from "../planning"
import { useTasksStore } from "../store"
import { STATUS } from "../types"
import type { Person, Task } from "../types"
import { TaskViewTabs } from "./task-view-tabs"

/**
 * Removed tasks (FR-M1-13): restorable for 30 days by managers; a tenant admin may purge one for good before that.
 * Expired ones are not shown (a backend deletes them).
 */
export function TaskArchive({ tasks, people, today, scopeKey, refFloor, onlyAssignee, canRestore, canPurge, me, meRole }: {
  tasks: Task[]
  people: Person[]
  today: string
  scopeKey: string
  refFloor: number
  onlyAssignee?: string
  canRestore: boolean
  canPurge: boolean
  me: string
  /** Role label of the signed-in user, recorded on the purge's audit event. */
  meRole: string
}) {
  const [stored, setTasks] = useTasksStore(tasks, scopeKey, people, { today, refFloor })
  const [purging, setPurging] = useState<Task | null>(null)
  const rows = archivedTasks(onlyAssignee ? stored.filter((t) => isAssigned(t, onlyAssignee)) : stored, today)
  const now = nowIso(today)
  return (
    <>
      <PageHead title="Tasks" subtitle={`${rows.length} archived · kept for ${ARCHIVE_DAYS} days`} />
      <TaskViewTabs active="archive" />
      <div className="card tasks-card">
        {rows.length === 0 ? (
          <EmptyState icon="task" title="The archive is empty" text={`Removed tasks stay here for ${ARCHIVE_DAYS} days so they can be restored.`} />
        ) : (
          <div className="table-wrap">
            <table className="rtable tasks-table">
              <thead>
                <tr><th>Task</th><th>Status</th><th>Removed</th><th>Restorable</th><th><span className="sr-only">Actions</span></th></tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.ref}>
                    <td data-label="Task">
                      <Link href={`/tasks/${t.ref}`} className="tt task-link">{t.title}</Link>
                      <div className="tm num">{t.ref}</div>
                    </td>
                    <td data-label="Status"><StatusPill status={STATUS[t.status]} /></td>
                    <td data-label="Removed" className="num">{formatDate(t.archivedAt!)} · {t.archivedBy}</td>
                    <td data-label="Restorable" className="num">{archiveDaysLeft(t.archivedAt!, today)} days left</td>
                    <td data-label="Actions">
                      <div className="ar-btns">
                        {canRestore && (
                          <button type="button" className="btn btn-outline ev-btn" onClick={() => { setTasks((prev) => prev.map((x) => (x.ref === t.ref ? restoreTask(x, me, now) : x))); toast.success(`${t.ref} restored`) }}>Restore</button>
                        )}
                        {canPurge && <button type="button" className="btn btn-outline ev-btn" onClick={() => setPurging(t)}>Delete now</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={!!purging}
        onOpenChange={(o) => !o && setPurging(null)}
        title="Delete this task for good?"
        text={`${purging?.ref ?? ""} and its evidence and history are deleted now and can't be restored.`}
        confirmLabel="Delete for good"
        destructive
        onConfirm={() => {
          if (!purging) return
          setTasks((prev) => prev.filter((x) => x.ref !== purging.ref))
          // FR-M0-13: a purge is permanent, so it is audited (merged into the audit log by lib/audit-outbox.ts).
          auditOutbox.push({
            key: `purge:${scopeKey.split(":")[0]}:${purging.ref}`,
            tenantId: scopeKey.split(":")[0] ?? "",
            at: now,
            actor: me,
            actorRole: meRole,
            action: "purge",
            recordType: "Task",
            recordRef: purging.ref,
            sensitive: true,
            meta: { Title: purging.title, "Archived by": purging.archivedBy ?? "", "Archived at": purging.archivedAt ?? "", Reason: "Deleted from the archive before the 30 days were up" },
          })
          toast.success(`${purging.ref} deleted`)
          setPurging(null)
        }}
      />
    </>
  )
}
