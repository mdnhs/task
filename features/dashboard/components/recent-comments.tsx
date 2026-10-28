import Link from "next/link"

import { Icon } from "@/components/icons"
import { When } from "@/components/when"
import type { StaffCommentsData } from "../types"

export function RecentComments({ data, today, tzLabel }: { data: StaffCommentsData; today: string; tzLabel: string }) {
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>{data.title}</h2>
          <div className="sub">{data.subtitle}</div>
        </div>
      </div>
      <div className="list">
        {data.items.map((c) => (
          <Link key={`${c.ref}-${c.at}`} href={`/tasks/${c.ref}`} className="item item-link">
            <span className={`kind ${c.kind === "comment" ? "amber" : "blue"}`}><Icon name={c.kind === "comment" ? "chat" : "task"} /></span>
            <div>
              <div className="t">{c.title}</div>
              <div className="m clamp" title={c.text}><b>{c.by}</b> · {c.text}</div>
              <div className="m"><When iso={c.at} today={today} tzLabel={tzLabel} /></div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
