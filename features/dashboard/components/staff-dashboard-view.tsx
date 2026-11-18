import { formatDateYear } from "@/lib/dates"
import { PageHead } from "@/components/page-head"
import type { Org } from "@/lib/org"
import type { ReportDeadlineCardData, StaffCommentsData, StaffEvidenceData, StaffHeaderData, StaffMyTasksData, TodayData } from "../types"
import { EvidenceList } from "./evidence-list"
import { MyTasks } from "./my-tasks"
import { RecentComments } from "./recent-comments"
import { StaffStats } from "./staff-stats"
import { TodayCard } from "./today-card"
import { ReportDeadlineCard } from "./report-deadline-card"

// Staff home (SRS §10.1) on GET /v1/dashboard/staff. `deadline` is the member's own shift report card (undefined when they don't report). `todayCard` is null for a caller the API refuses Today (403).
export function StaffDashboardView({ header, myTasks, evidence, comments, org, todayCard, deadline }: { header: StaffHeaderData; myTasks: StaffMyTasksData; evidence: StaffEvidenceData; comments: StaffCommentsData; org: Org; todayCard?: TodayData | null; deadline?: ReportDeadlineCardData }) {
  const { today, tzLabel } = org
  return (
    <>
      <PageHead title={header.title} subtitle={`${formatDateYear(today)} · ${header.subtitle}`} />
      {todayCard && <TodayCard data={todayCard} />}
      <StaffStats data={myTasks} />
      <section className="grid-2">
        <div className="staff-col">
          <MyTasks data={myTasks} today={today} tzLabel={tzLabel} />
          <EvidenceList data={evidence} />
        </div>
        <div className="staff-col">
          {deadline && <ReportDeadlineCard data={deadline} canRemind={false} />}
          <RecentComments data={comments} today={today} tzLabel={tzLabel} />
        </div>
      </section>
    </>
  )
}
