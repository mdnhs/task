import { CountUp } from "@/components/count-up"
import { orderStats } from "../filters"
import type { Money } from "@/lib/money"

// Counts come from the same (department-filtered) list as the table, so the two always agree.
export function OrdersStats({ stats, money }: { stats: ReturnType<typeof orderStats>; money: Money }) {
  const cards = [
    { title: "Waiting approval", value: String(stats.waiting), note: "Requests that need a decision", hero: true },
    { title: "Value waiting", value: money.format(stats.waitingValue), note: "Total of undecided requests" },
    { title: "On order", value: String(stats.inTransit), note: "Approved, not fully delivered" },
    { title: "Delivered", value: String(stats.delivered), note: "Fully received orders" },
  ]
  return (
    <section className="stats" aria-label="Summary">
      {cards.map((c, i) => (
        <article key={c.title} className={c.hero ? "stat hero" : "stat"}>
          <div className="stat-top">
            <h3>{c.title}</h3>
          </div>
          <div className="value num"><CountUp value={c.value} delay={0.1 + i * 0.04} /></div>
          <div className="note">{c.note}</div>
        </article>
      ))}
    </section>
  )
}
