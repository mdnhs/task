"use client"

import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import { useDept } from "@/hooks/use-dept"
import { formatTime } from "@/lib/dates"
import { isLateSubmission, sectionProgress } from "../lifecycle"
import { REPORT_STATUS } from "../types"
import type { Report, TemplateSection } from "../types"
import type { Person } from "@/lib/types"

// Today's submissions: one row per department with its report owner, status and submission time (FR-REP-11).
export function SubmissionBoard({
  reports,
  people,
  template,
  departments,
  today,
  tzLabel,
  deadline,
}: {
  reports: Report[]
  people: Map<string, Person>
  template: TemplateSection[]
  departments: string[]
  today: string
  tzLabel: string
  deadline: string
}) {
  const dept = useDept()
  const day = today.slice(0, 10)
  const rows = departments.filter((d) => dept === "all" || d === dept)
  return (
    <section className="card rep-board">
      <div className="card-head">
        <div>
          <h2>Today&apos;s submissions</h2>
          <div className="sub">Due {formatTime(`${day}T${deadline}:00`)} {tzLabel}</div>
        </div>
      </div>
      <ul className="rep-rows">
        {rows.map((d) => {
          const r = reports.find((x) => x.date === day && x.dept === d)
          const owner = r ? people.get(r.owner) : undefined
          const { done, total } = r ? sectionProgress(r, template) : { done: 0, total: 0 }
          return (
            <li key={d} className="rep-row-item">
              <span className="dep-tag">{d}</span>
              <div className="pers rep-owner">
                {owner && <span className={`avatar ${owner.avatar}`}>{owner.initials}</span>}
                <div>
                  <div className="tt">{owner?.name ?? "Unassigned"}</div>
                  <div className="tm">
                    {r?.submittedAt ? (
                      <>
                        Submitted <When iso={r.submittedAt} today={today} tzLabel={tzLabel} mode="time" />
                        {isLateSubmission(r, deadline) ? " · late" : ""}
                      </>
                    ) : r ? (
                      `${done} of ${total} sections complete`
                    ) : (
                      "No report started"
                    )}
                  </div>
                </div>
              </div>
              {r ? <StatusPill status={REPORT_STATUS[r.status]} /> : <StatusPill status={{ tone: "mute", label: "Not started" }} />}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
