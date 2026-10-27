import { CountUp } from "@/components/count-up"
import { Icon } from "@/components/icons"
import type { SummaryData } from "../types"

export function SectionCards({ data }: { data: SummaryData }) {
  return (
    <section className="stats" aria-label="Summary">
      {data.stats.map((s, i) => (
        <article key={s.title} className={s.hero ? "stat hero" : "stat"}>
          <div className="stat-top">
            <h3>{s.title}</h3>
            <a className="arrow" href="#" aria-label={s.ariaLabel}><Icon name="arrow" /></a>
          </div>
          <div className="value num"><CountUp value={s.value} delay={0.1 + i * 0.04} />{s.valueSuffix && <small>{s.valueSuffix}</small>}</div>
          <div className="note">
            {s.note.highlight && <span className={s.note.tone}>{s.note.highlight}</span>}
            {s.note.text}
          </div>
        </article>
      ))}
    </section>
  )
}
