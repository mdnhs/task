import type { ReactNode } from "react"
import Link from "next/link"

import { Icon } from "@/components/icons"
import type { DashboardPerms, HeaderData } from "../types"

export function PageHeader({ data, perms, newTask }: { data: HeaderData; perms: DashboardPerms; newTask: ReactNode }) {
  return (
    <div className="head">
      <div>
        <h1>{data.title}</h1>
        <p>{data.subtitle}</p>
      </div>
      <div className="head-actions">
        {perms.tasks && newTask}
        {perms.reports && (
          <Link href="/daily-reports" className="btn btn-outline">
            <Icon name="report" />
            Start Daily Report
          </Link>
        )}
      </div>
    </div>
  )
}
