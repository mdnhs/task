import { formatDateYear } from "@/lib/dates"
import { PageHead } from "@/components/page-head"
import type { Org } from "@/lib/org"
import type { TodayData } from "@/lib/today-data"
import type { getStaffDashboard } from "../api"
import type { ReportDeadlineCardData } from "../types"
import { EvidenceList } from "./evidence-list"
import { MyTasks } from "./my-tasks"
import { RecentComments } from "./recent-comments"
import { StaffStats } from "./staff-stats"
import { TodayCard } from "./today-card"
import { ReportDeadlineCard } from "./report-deadline-card"

// Staff home (SRS §10.1). `deadline` is the member's own shift report card (undefined when they don't report).
export function StaffDashboardView({ data, org, todayCard, deadline }: { data: Awaited<ReturnType<typeof getStaffDashboard>>; org: Org; todayCard?: TodayData; deadline?: ReportDeadlineCardData }) {
  const { today, tzLabel } = org
  return (
    <>
      <PageHead title={data.header.title} subtitle={`${formatDateYear(today)} · ${data.header.subtitle}`} />
      {todayCard && <TodayCard data={todayCard} />}
      <StaffStats data={data.myTasks} today={today} />
      <section className="grid-2">
        <div className="staff-col">
          <MyTasks data={data.myTasks} today={today} tzLabel={tzLabel} />
          <EvidenceList data={data.evidence} today={today} tzLabel={tzLabel} />
        </div>
        <div className="staff-col">
          {deadline && <ReportDeadlineCard data={deadline} canRemind={false} />}
          <RecentComments data={data.comments} today={today} tzLabel={tzLabel} />
        </div>
      </section>
    </>
  )
}
