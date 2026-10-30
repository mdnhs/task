"use client"

import { useEffect, useRef, useState } from "react"
import { useInView, useReducedMotion } from "motion/react"
import { Pie, PieChart } from "recharts"

import { CountUp } from "@/components/count-up"
import type { TaskProgressData } from "../types"

// Layered arcs (back to front): each starts at the left end and the next sits on top,
// so the rounded caps overlap. `to` is how far round the half-circle each arc reaches.
export function TaskProgress({ data }: { data: TaskProgressData }) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(220)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.min(Math.round(e.contentRect.width), 300)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // Arcs mount (and so animate) only once the gauge scrolls into view (ui-rules.md rule 20).
  const inView = useInView(ref, { once: true, margin: "0px 0px -10% 0px" })
  const reduce = useReducedMotion()
  const k = w / 220
  const total = data.legend.reduce((n, l) => n + l.count, 0) || 1
  return (
    <div className="card">
      <div className="card-head"><h2>{data.title}</h2></div>
      <div className="gauge-wrap">
        <div className="rc-gauge" ref={ref} style={{ height: 140 * k }} role="img" aria-label={data.ariaLabel}>
          <PieChart accessibilityLayer={false} width={w} height={140 * k}>
            <defs>
              <pattern id="gauge-stripes" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="8" height="8" style={{ fill: "var(--card)" }} />
                <rect width="4" height="8" style={{ fill: "var(--stripe)" }} />
              </pattern>
            </defs>
            {inView && data.layers.map((l) => (
              <Pie
                key={l.to}
                data={[{ v: 1 }]}
                dataKey="v"
                startAngle={180}
                endAngle={180 - 180 * l.to}
                cx={110 * k}
                cy={124 * k}
                innerRadius={74 * k}
                outerRadius={104 * k}
                stroke="var(--card)"
                strokeWidth={3}
                cornerRadius={15 * k}
                fill={l.fill}
                isAnimationActive={!reduce}
                animationBegin={150}
                animationDuration={1000}
                animationEasing="ease-out"
              />
            ))}
          </PieChart>
          <div className="rc-gauge-text">
            {/* Counts up in step with the arcs (same 150ms delay, 1s duration) */}
            <div className="gauge-val num"><CountUp value={String(data.percent)} delay={0.15} duration={1} />%</div>
            <div className="gauge-lbl">{data.label}</div>
          </div>
        </div>
        {/* Breakdown: each status with its count, share of the week and a thin meter (fills once in view, like the arcs). */}
        <ul className="gauge-list">
          {data.legend.map((l, i) => {
            const pct = Math.round((l.count / total) * 100)
            return (
              <li key={l.key}>
                <div className="gl-row">
                  <i className={`sw ${l.key}`} />
                  <span className="gl-lbl">{l.label}</span>
                  <b className="num"><CountUp value={String(l.count)} delay={0.15} duration={1} /></b>
                  <span className="gl-pct num">{pct}%</span>
                </div>
                {/* scaleX fill (transform only), staggered 60ms per row, held until the gauge is in view */}
                <div className="gl-track">
                  <span className={`gl-fill ${l.key}`} data-on={inView || undefined} style={{ width: `${pct}%`, transitionDelay: `${150 + i * 60}ms` }} />
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
