import Link from "next/link"

import { Icon } from "@/components/icons"
import { StatusPill } from "@/components/status-pill"
import { formatTime } from "@/lib/dates"
import type { Org } from "@/lib/org"
import type { StaffReportData } from "../types"
import { DeadlineCountdown } from "./deadline-countdown"

// Only the report owner sees this card (SRS §10.1). The deadline, timezone and label come from the org settings.
export function TodayReport({
  data,
  org,
}: {
  data: StaffReportData
  org: Pick<Org, "today" | "timezone" | "tzLabel" | "deadline" | "reminders">
}) {
  const [hour, minute] = org.deadline.split(":").map(Number)
  const day = org.today.slice(0, 10)
  const reminders = org.reminders.map((r) => formatTime(`${day}T${r}:00`)).join(" & ")
  const dueIso = `${org.today.slice(0, 10)}T${org.deadline}:00`
  return (
    <div className="card deadline">
      <h2>{data.title}</h2>
      <div className="big">Due today, {formatTime(dueIso)}</div>
      <div className="tz">{org.tzLabel} · reminders at {reminders}</div>
      <DeadlineCountdown hour={hour} minute={minute} timeZone={org.timezone} />
      <div className="rep-row">
        <div>
          <span className="dep">{data.section}</span>
          <small>{data.detail}</small>
          <div suppressHydrationWarning className="progress"><i style={{ width: `${data.progress}%` }} /></div>
        </div>
        <StatusPill status={data.status} />
      </div>
      <Link href={data.href} className="btn btn-primary">
        <Icon name="report" />
        {data.action}
      </Link>
    </div>
  )
}
