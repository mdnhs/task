"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { EmptyState } from "@/components/empty-state"
import { PageHead } from "@/components/page-head"
import { StatusPill } from "@/components/status-pill"
import { apiBrowser } from "@/lib/api/browser"
import { userMessage } from "@/lib/api/problem"
import { formatDate } from "@/lib/dates"
import { toCard } from "../adapters"
import type { ArchivedTask } from "../api"
import { ARCHIVE_DAYS } from "../planning"
import { useTaskWrites } from "../use-task-writes"
import { STATUS } from "../types"
import type { Person, Task } from "../types"
import { TaskViewTabs } from "./task-view-tabs"

/**
 * Removed tasks (FR-M1-13): the list is the API's (managers only), restorable for 30 days (410 archive_expired after that). A tenant admin (settings:write) may purge one for
 * good, after a confirmation. A restored task leaves the list at once; a refusal puts it back and shows the mapped copy.
 */
export function TaskArchive({ tasks: first, nextCursor, people, canRestore, canPurge }: {
  tasks: ArchivedTask[]
  people: Person[]
  nextCursor: string | null
  canRestore: boolean
  canPurge: boolean
}) {
  const { tasks, write, act } = useTaskWrites(first)
  const [purging, setPurging] = useState<Task | null>(null)
  const [more, setMore] = useState<{ base: ArchivedTask[]; rows: ArchivedTask[]; cursor: string | null }>({ base: first, rows: [], cursor: nextCursor })
  const fresh = more.base === first
  const cursor = fresh ? more.cursor : nextCursor
  const left = useMemo(() => new Map([...first, ...(fresh ? more.rows : [])].map((t) => [t.id, t.archiveDaysLeft])), [first, fresh, more.rows])
  const rows = [...tasks, ...(fresh ? more.rows : [])].filter((t) => t.archivedAt)

  async function loadMore() {
    if (!cursor) return
    try {
      const page = await apiBrowser.get("/v1/tasks/archive", { query: { limit: 25, cursor } })
      setMore({ base: first, rows: [...(fresh ? more.rows : []), ...page.items.map((d) => ({ ...toCard(d), archiveDaysLeft: d.daysLeft }))], cursor: page.nextCursor })
    } catch (e) {
      toast.error(userMessage(e).text)
    }
  }
  return (
    <>
      <PageHead title="Tasks" subtitle={`${rows.length}${cursor ? "+" : ""} archived · kept for ${ARCHIVE_DAYS} days`} />
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
                  <tr key={t.id}>
                    <td data-label="Task">
                      <Link href={`/tasks/${t.ref}`} className="tt task-link">{t.title}</Link>
                      <div className="tm num">{t.ref}</div>
                    </td>
                    <td data-label="Status"><StatusPill status={STATUS[t.status]} /></td>
                    <td data-label="Removed" className="num">{formatDate(t.archivedAt!)}{t.archivedBy ? ` · ${people.find((p) => p.id === t.archivedBy)?.name ?? "Member"}` : ""}</td>
                    <td data-label="Restorable" className="num">{left.get(t.id!) ?? 0} days left</td>
                    <td data-label="Actions">
                      <div className="ar-btns">
                        {canRestore && (
                          <button type="button" className="btn btn-outline ev-btn" onClick={() => void write(t, "restore", { predict: (x) => ({ ...x, archivedAt: undefined, archivedBy: undefined }), request: (c) => c.restore(t), success: `${t.ref} restored` })}>Restore</button>
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
        {cursor && (
          <div className="tasks-more">
            <button type="button" className="btn btn-outline" onClick={() => void loadMore()}>Load more</button>
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
        onConfirm={async () => {
          if (!purging) return
          const t = purging
          setPurging(null)
          // FR-M0-13: a purge is permanent and audited (the API writes the audit row in the same transaction).
          await act(`purge:${t.id}`, (c) => c.purge(t), { success: `${t.ref} deleted` })
        }}
      />
    </>
  )
}
