"use client"

import { useMemo } from "react"

import { PageHead } from "@/components/page-head"
import type { Person } from "@/lib/types"
import type { ExportMeta } from "../export"
import { buildBoardDoc, buildReportDoc } from "../export-rows"
import { reportsStore } from "../store"
import { EMPTY_FILTERS } from "../filters"
import type { Report, ReportsFilters, TemplateSection } from "../types"
import { ExportMenu } from "./export-menu"
import { ReportHistory } from "./report-history"
import { ReviewQueue } from "./review-queue"
import { SubmissionBoard } from "./submission-board"
import { TodayReportCard } from "./today-report-card"

export function ReportsView({
  reports,
  template,
  people,
  departments,
  today,
  tzLabel,
  countdown,
  deadline,
  reminders,
  staff,
  canReview,
  meId,
  initialFilters = EMPTY_FILTERS,
  scopeKey,
  exportMeta,
  canPayroll,
}: {
  reports: Report[]
  template: TemplateSection[]
  people: Person[]
  departments: string[]
  today: string
  tzLabel: string
  /** Deadline countdown node (server page passes the dashboard's DeadlineCountdown). */
  countdown: React.ReactNode
  /** Org report deadline, "17:30". Never hard-coded. */
  deadline: string
  reminders: string[]
  /** Staff-home roles: own report card and own history. Manager-home roles: board, queue (if they can review) and history. */
  staff: boolean
  canReview: boolean
  meId: string
  initialFilters?: ReportsFilters
  /** Names what `reports` was scoped for (tenant + role). When it changes, the in-memory store is reseeded. */
  scopeKey: string
  /** Company, date label and brand colour for export file headers (FR-REP-12). */
  exportMeta: ExportMeta
  /** Role may read payroll; the restricted section is left out of exports when false. */
  canPayroll: boolean
}) {
  const [stored] = reportsStore.useStore(reports, scopeKey)
  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people])
  const day = today.slice(0, 10)
  const mine = useMemo(() => (staff ? stored.filter((r) => r.owner === meId) : stored), [stored, staff, meId])
  const me = peopleById.get(meId)
  const todays = mine.find((r) => r.date === day)

  const skip = useMemo(() => (canPayroll ? [] : template.filter((s) => s.restricted).map((s) => s.id)), [canPayroll, template])
  // Staff export only their own report (the list is already scoped to it); reviewers and managers export the day's board.
  const group = useMemo(() => {
    if (staff) {
      const doc = todays ? buildReportDoc({ report: todays, template, owner: me?.name ?? todays.owner, skip, deadline, tzLabel }) : null
      return { key: "today", label: "Today's report", doc }
    }
    return { key: "board", label: "Submission board", doc: buildBoardDoc({ reports: stored, people: peopleById, template, departments, today, tzLabel, deadline }) }
  }, [staff, todays, template, me, skip, deadline, tzLabel, stored, peopleById, departments, today])

  return (
    <>
      <PageHead
        title="Daily Reports"
        subtitle={staff ? "Your end-of-day report and past submissions" : "Today's submissions, the review queue and report history"}
        actions={<ExportMenu groups={[group]} meta={exportMeta} />}
      />
      {staff ? (
        <div className="rep-top rep-top-staff">
          <TodayReportCard
            report={todays}
            template={template}
            dept={me?.dept ?? todays?.dept ?? ""}
            today={today}
            tzLabel={tzLabel}
            countdown={countdown}
            deadline={deadline}
            reminders={reminders}
          />
        </div>
      ) : (
        <div className={`rep-top${canReview ? "" : " rep-top-one"}`}>
          <SubmissionBoard reports={stored} people={peopleById} template={template} departments={departments} today={today} tzLabel={tzLabel} deadline={deadline} />
          {canReview && <ReviewQueue reports={stored} people={peopleById} today={today} tzLabel={tzLabel} deadline={deadline} />}
        </div>
      )}
      <ReportHistory
        reports={mine}
        people={peopleById}
        today={today}
        tzLabel={tzLabel}
        deadline={deadline}
        initialFilters={initialFilters}
        showOwner={!staff}
        exportMeta={exportMeta}
      />
    </>
  )
}
