import Link from "next/link"

import { CountUp } from "@/components/count-up"
import { Icon } from "@/components/icon"
import type { StaffMyTasksData } from "../types"

// The four figures are the API's (GET /v1/dashboard/staff): the list below is a page of the open tasks, so counting its rows would not equal them.
export function StaffStats({ data }: { data: StaffMyTasksData }) {
  return (
    <section className="stats" aria-label="Summary">
      {data.stats.map((s, i) => (
        <article key={s.key} className={s.hero ? "stat hero" : "stat"}>
          <div className="stat-top">
            <h3>{s.title}</h3>
            <Link className="arrow" href={s.href} aria-label={s.ariaLabel}><Icon name="arrow" /></Link>
          </div>
          <div className="value num"><CountUp value={String(data.counts[s.key])} delay={0.1 + i * 0.04} /></div>
          <div className="note">{s.note}</div>
        </article>
      ))}
    </section>
  )
}
