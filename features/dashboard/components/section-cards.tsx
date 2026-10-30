"use client"

import Link from "next/link"

import { CountUp } from "@/components/count-up"
import { Icon } from "@/components/icons"
import { useDept } from "@/hooks/use-dept"
import type { SummaryData } from "../types"
import { Sparkline } from "./sparkline"

// The topbar department filter swaps in that department's figures; CountUp rolls each value to the new one.
export function SectionCards({ data }: { data: SummaryData }) {
  const dep = useDept()
  return (
    <section className="stats dash-stats" aria-label="Summary">
      {data.stats.map((stat, i) => {
        const s = { ...stat, ...(dep === "all" ? undefined : stat.byDept?.[dep]) }
        return (
          <article key={s.title} className={s.hero ? "stat hero" : "stat"}>
            <div className="stat-top">
              <div className="stat-title">
                {s.icon && <span className="stat-ico"><Icon name={s.icon} /></span>}
                <h3>{s.title}</h3>
              </div>
              <Link className="arrow" href={s.href} aria-label={s.ariaLabel}><Icon name="arrow" /></Link>
            </div>
            <div className={s.note.tone === "down" ? "stat-mid bad" : "stat-mid"}>
              <div className="value num"><CountUp value={s.value} delay={0.1 + i * 0.04} />{s.valueSuffix && <small>{s.valueSuffix}</small>}</div>
              {s.trend && <Sparkline data={s.trend} />}
            </div>
            <div className="note">
              {s.note.highlight && <span className={s.note.tone}>{s.note.highlight}</span>}
              {s.note.text}
            </div>
          </article>
        )
      })}
    </section>
  )
}
