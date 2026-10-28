"use client"

import Link from "next/link"

import { EmptyState } from "@/components/empty-state"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import { useDept } from "@/hooks/use-dept"
import { isLateSubmission } from "../lifecycle"
import { REPORT_STATUS } from "../types"
import type { Report } from "../types"
import type { Person } from "@/lib/types"

const latest = (r: Report) => r.versions.at(-1)?.at ?? r.submittedAt ?? ""

// Submitted and resubmitted reports waiting for a reviewer (FR-REP-09). Oldest first.
export function ReviewQueue({
  reports,
  people,
  today,
  tzLabel,
  deadline,
}: {
  reports: Report[]
  people: Map<string, Person>
  today: string
  tzLabel: string
  deadline: string
}) {
  const dept = useDept()
  const rows = reports
    .filter((r) => (r.status === "submitted" || r.status === "resubmitted") && (dept === "all" || r.dept === dept))
    .sort((a, b) => latest(a).localeCompare(latest(b)))
  return (
    <section className="card rep-queue">
      <div className="card-head">
        <div>
          <h2>Review queue</h2>
          <div className="sub">{rows.length} awaiting review</div>
        </div>
      </div>
      {rows.length > 0 ? (
        <ul className="rep-rows">
          {rows.map((r) => {
            const o = people.get(r.owner)
            return (
              <li key={r.id} className="rep-row-item rep-q-item">
                <Link href={`/daily-reports/${r.id}`} className="rep-q-link">
                  <div className="rep-q-main">
                    <div className="tt">
                      <When iso={`${r.date}T00:00:00`} today={today} tzLabel={tzLabel} mode="date" /> · {r.dept}
                    </div>
                    <div className="tm">
                      {o?.name ?? r.owner}
                      {r.submittedAt && (
                        <>
                          {" · "}
                          <When iso={r.submittedAt} today={today} tzLabel={tzLabel} mode="time" />
                          {isLateSubmission(r, deadline) ? " · late" : ""}
                        </>
                      )}
                    </div>
                  </div>
                  <StatusPill status={REPORT_STATUS[r.status]} />
                </Link>
              </li>
            )
          })}
        </ul>
      ) : (
        <EmptyState icon="report" title="Nothing to review" text="Submitted reports will appear here." />
      )}
    </section>
  )
}
