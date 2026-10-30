"use client"

import { useState, type ReactNode } from "react"
import Link from "next/link"

import { DataPagination, PagedBody } from "@/components/data-pagination"
import { useDept } from "@/hooks/use-dept"
import { paginate } from "@/lib/paginate"
import { TEAM_TASKS_PAGE_SIZE } from "../constants"
import type { TeamTasksData } from "../types"

const prio = ["", "Low", "Medium", "High"]

export function TeamTasksTable({ data, assignTask }: { data: TeamTasksData; assignTask: ReactNode }) {
  const dep = useDept()
  const [page, setPage] = useState(1)
  const [seenDept, setSeenDept] = useState(dep)
  if (seenDept !== dep) {
    setSeenDept(dep)
    setPage(1)
  }
  const paged = paginate(data.tasks.filter((t) => dep === "all" || t.dept === dep), page, TEAM_TASKS_PAGE_SIZE)

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>{data.title}</h2>
          <div className="sub">{dep === "all" ? "All departments" : dep}</div>
        </div>
        {assignTask}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Assignee</th><th>Task</th><th>Dept</th><th>Priority</th><th>Due</th><th>Status</th></tr>
          </thead>
          <PagedBody page={paged.page}>
            {paged.rows.map((t) => (
              <tr key={t.ref}>
                <td>
                  <div className="pers">
                    <span className={`avatar ${t.avatar}`}>{t.initials}</span>
                    <div><div className="tt">{t.name}</div><div className="tm">{t.role}</div></div>
                  </div>
                </td>
                <td><Link href={`/tasks/${t.ref}`} className="tt team-link">{t.task}</Link><div className="tm num">{t.ref}</div></td>
                <td><span className="dep-tag">{t.dept}</span></td>
                <td>
                  <span className={`prio p${t.priority}`} title={`${prio[t.priority]} priority`}><i /><i /><i /></span>
                </td>
                <td className={`num due ${t.late ? "due-late" : ""}`}>{t.due}{t.late ? " · late" : ""}</td>
                <td><span className={`st ${t.status.tone}`}>{t.status.label}</span></td>
              </tr>
            ))}
          </PagedBody>
        </table>
      </div>
      <DataPagination page={paged.page} pageCount={paged.pageCount} total={paged.total} from={paged.from} to={paged.to} label="Team tasks pages" onPageChange={setPage} />
    </div>
  )
}
