"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"

import { PagedBody } from "@/components/data-pagination"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import { isLate } from "../lifecycle"
import { describeRepeat } from "../recurrence"
import { morphToRecord } from "../record-transition"
import { STATUS } from "../types"
import type { Person, Task } from "../types"

const PRIO = ["", "Low", "Medium", "High"]

export function TaskTable({ tasks, people, today, tzLabel, page }: { tasks: Task[]; people: Map<string, Person>; today: string; tzLabel: string; page: number }) {
  const router = useRouter()
  return (
    <div className="table-wrap">
      <table className="rtable tasks-table">
        <thead>
          <tr><th>Task</th><th>Assignee</th><th>Dept</th><th>Priority</th><th>Due</th><th>Status</th></tr>
        </thead>
        {/* PagedBody slides the rows in on a page, filter or search change (ui-rules.md → Motion, rule 22). */}
        <PagedBody page={page}>
            {tasks.map((t) => {
              const a = people.get(t.assignee)
              const late = isLate(t, today)
              return (
                <tr key={t.ref}>
                  <td data-label="Task">
                    <Link
                      href={`/tasks/${t.ref}`}
                      className="tt task-link"
                      onClick={(e) => {
                        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
                        // The title morphs into the detail heading (View Transitions); unsupported → normal navigation.
                        if (morphToRecord({ source: e.currentTarget, title: t.title, ref: t.ref, href: `/tasks/${t.ref}`, push: router.push })) e.preventDefault()
                      }}
                    >
                      {t.title}
                    </Link>
                    <div className="tm num">{t.ref}{(t.repeat || t.seriesId) && <span className="rp-badge" title={t.repeat ? describeRepeat(t.repeat) : `Repeats from ${t.seriesId}`}><span aria-hidden="true">↻ </span>{t.repeat ? "Repeats" : "Recurring"}</span>}</div>
                  </td>
                  <td data-label="Assignee">
                    {a && (
                      <div className="pers">
                        <span className={`avatar ${a.avatar}`}>{a.initials}</span>
                        <div><div className="tt">{a.name}</div><div className="tm">{a.role}</div></div>
                      </div>
                    )}
                  </td>
                  <td data-label="Dept"><span className="dep-tag">{t.dept}</span></td>
                  <td data-label="Priority">
                    <span className={`prio p${t.priority}`} title={`${PRIO[t.priority]} priority`}><i /><i /><i /></span>
                  </td>
                  <td data-label="Due" className={`num due ${late ? "due-late" : ""}`}>
                    <When iso={t.due} today={today} tzLabel={tzLabel} />
                    {late ? " · late" : ""}
                  </td>
                  <td data-label="Status"><StatusPill status={STATUS[t.status]} /></td>
                </tr>
              )
            })}
        </PagedBody>
      </table>
    </div>
  )
}
