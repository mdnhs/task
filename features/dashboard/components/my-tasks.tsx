import Link from "next/link"

import { Icon } from "@/components/icons"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import type { StaffMyTasksData, StaffTaskState } from "../types"

const KIND: Record<StaffTaskState, string> = { open: "", blocked: "red", review: "blue", returned: "amber" }

export function MyTasks({ data, today, tzLabel }: { data: StaffMyTasksData; today: string; tzLabel: string }) {
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>{data.title}</h2>
          <div className="sub">{data.subtitle}</div>
        </div>
        <Link href="/tasks" className="pill-btn">
          <Icon name="task" />
          {data.action}
        </Link>
      </div>
      <div className="list">
        {data.tasks.map((t) => (
          <Link key={t.ref} href={`/tasks/${t.ref}`} className="item item-link">
            <span className={`kind ${KIND[t.state]}`}><Icon name="task" /></span>
            <div>
              <div className="t">{t.title}</div>
              <div className="m">{t.ref} · Due <b><When iso={t.due} today={today} tzLabel={tzLabel} /></b></div>
            </div>
            <div className="r"><StatusPill status={t.status} /></div>
          </Link>
        ))}
      </div>
    </div>
  )
}
