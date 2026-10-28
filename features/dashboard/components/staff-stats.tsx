import Link from "next/link"

import { CountUp } from "@/components/count-up"
import { Icon } from "@/components/icons"
import { isOverdue } from "@/lib/dates"
import type { StaffMyTasksData } from "../types"

// Counts come from the task list itself, so the stat row and the list always agree.
export function staffCounts(tasks: StaffMyTasksData["tasks"], today: string) {
  // The list holds only open tasks, so each count equals the row count at its card's deep link (/tasks?status=open|stuck|submitted|changes_requested).
  return {
    open: tasks.length,
    overdue: tasks.filter((t) => t.state === "blocked" || isOverdue(t.due, today)).length,
    review: tasks.filter((t) => t.state === "review").length,
    returned: tasks.filter((t) => t.state === "returned").length,
  }
}

export function StaffStats({ data, today }: { data: StaffMyTasksData; today: string }) {
  const counts = staffCounts(data.tasks, today)
  return (
    <section className="stats" aria-label="Summary">
      {data.stats.map((s, i) => (
        <article key={s.key} className={s.hero ? "stat hero" : "stat"}>
          <div className="stat-top">
            <h3>{s.title}</h3>
            <Link className="arrow" href={s.href} aria-label={s.ariaLabel}><Icon name="arrow" /></Link>
          </div>
          <div className="value num"><CountUp value={String(counts[s.key])} delay={0.1 + i * 0.04} /></div>
          <div className="note">{s.note}</div>
        </article>
      ))}
    </section>
  )
}
