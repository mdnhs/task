import { formatDate } from "@/lib/dates"
import { PageHead } from "@/components/page-head"
import type { Org } from "@/lib/org"
import type { getStaffDashboard } from "../api"
import { EvidenceList } from "./evidence-list"
import { MyTasks } from "./my-tasks"
import { RecentComments } from "./recent-comments"
import { StaffStats } from "./staff-stats"
import { TodayReport } from "./today-report"

// Staff home (SRS §10.1). `org` carries today, the tenant timezone and the report deadline.
export function StaffDashboardView({ data, org }: { data: Awaited<ReturnType<typeof getStaffDashboard>>; org: Org }) {
  const { today, tzLabel } = org
  return (
    <>
      <PageHead title={data.header.title} subtitle={`${formatDate(today)} · ${data.header.subtitle}`} />
      <StaffStats data={data.myTasks} today={today} />
      <section className="grid-2">
        <div className="staff-col">
          <MyTasks data={data.myTasks} today={today} tzLabel={tzLabel} />
          <EvidenceList data={data.evidence} today={today} tzLabel={tzLabel} />
        </div>
        <div className="staff-col">
          {data.report.owner && <TodayReport data={data.report} org={org} />}
          <RecentComments data={data.comments} today={today} tzLabel={tzLabel} />
        </div>
      </section>
    </>
  )
}
