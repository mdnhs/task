"use client"

import { useState, type ReactNode } from "react"
import Link from "next/link"
import { toast } from "sonner"

import { DataPagination, PagedBody } from "@/components/data-pagination"
import { apiBrowser } from "@/lib/api/browser"
import { userMessage } from "@/lib/api/problem"
import { paginate } from "@/lib/paginate"
import { toTeamTasks } from "../adapters"
import { TEAM_TASKS_PAGE_SIZE } from "../constants"
import type { TeamTaskRow, TeamTasksData } from "../types"

const prio = ["", "Low", "Medium", "High"]

/**
 * The home table of open tasks in the caller's scope, due first (GET /v1/dashboard/team-tasks). The API pages with a cursor: the table keeps its 5-row pages over what is loaded and fetches
 * the next API page when the reader reaches the last one. With a department picked, `data` is the API's answer for that team (`teamId`, B8 Task 24) and the next pages keep it.
 */
export function TeamTasksTable({ data, assignTask, ctx, teamId, teamName }: { data: TeamTasksData; assignTask: ReactNode; ctx: { tz: string; today: string }; teamId?: string; teamName?: string }) {
  const [page, setPage] = useState(1)
  const [base, setBase] = useState(data)
  const [rows, setRows] = useState<TeamTaskRow[]>(data.tasks)
  const [cursor, setCursor] = useState<string | null>(data.nextCursor)
  const [loading, setLoading] = useState(false)
  if (base !== data) {
    setBase(data)
    setRows(data.tasks)
    setCursor(data.nextCursor)
    setPage(1)
  }
  const paged = paginate(rows, page, TEAM_TASKS_PAGE_SIZE)

  async function more(next: number) {
    setPage(next)
    if (!cursor || loading || next < paged.pageCount) return
    setLoading(true)
    try {
      const dto = await apiBrowser.get("/v1/dashboard/team-tasks", { query: { limit: 25, cursor, ...(teamId ? { teamId } : {}) } })
      const add = toTeamTasks(dto, { people: [], tz: ctx.tz, today: ctx.today })
      // the people directory is not on the client: roles of rows loaded later are left blank (the name and avatar come from the row)
      setRows((r) => [...r, ...add.tasks])
      setCursor(add.nextCursor)
    } catch (e) {
      toast.error(userMessage(e).text)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>{data.title}</h2>
          <div className="sub">{teamId && teamName ? teamName : "All departments"}</div>
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
      <DataPagination page={paged.page} pageCount={paged.pageCount + (cursor ? 1 : 0)} total={paged.total} from={paged.from} to={paged.to} label="Team tasks pages" onPageChange={(p) => void more(p)} />
    </div>
  )
}
