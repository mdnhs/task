"use client"

import { useEffect, useRef, useState } from "react"
import { useInView, useReducedMotion } from "motion/react"
import { DayDetailsDialog } from "./day-details-dialog"
import type { TasksClosedData } from "../types"
import { Bar, BarChart, Cell, ResponsiveContainer, XAxis } from "recharts"

type Day = TasksClosedData["days"][number]

const fills: Record<Day["t"], string> = {
  s1: "var(--brand-2)",
  s2: "#3c7a4a",
  today: "var(--brand-3)",
  weekend: "url(#bar-stripes)",
}

type ShapeProps = { x?: number; y?: number; width?: number; height?: number; fill?: string; index?: number }

// Full pill (radius = half the width). No minimum height, so the entrance animation starts from 0.
// The on-time tip for the active bar is drawn right above it, like the original.
function PillBar({ x = 0, y = 0, width = 0, height = 0, fill, index = 0, active, showTip, days }: ShapeProps & { active: number; showTip: boolean; days: Day[] }) {
  const w = Math.min(width, 72)
  const h = Math.max(height, 0)
  const left = x + (width - w) / 2
  const top = y + height - h
  const d = days[index]
  return (
    <g style={{ cursor: "pointer" }}>
      <rect x={left} y={top} width={w} height={h} rx={Math.min(w, h) / 2} fill={fill} />
      {index === active && showTip && (
        <foreignObject x={left + w / 2 - 80} y={top - 46} width={160} height={40} style={{ overflow: "visible" }}>
          <div className="tip-wrap">
            <span className="tip tip-static num">{d.n} · {d.on}% on time</span>
          </div>
        </foreignObject>
      )}
    </g>
  )
}

export function TasksClosedChart({ data }: { data: TasksClosedData }) {
  const days = data.days
  const last = days.length - 1
  const [active, setActive] = useState(last)
  const [ready, setReady] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  // Bars mount (and so grow) only once the chart scrolls into view (ui-rules.md rule 20); the tip waits for them.
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: "0px 0px -10% 0px" })
  const reduce = useReducedMotion()
  useEffect(() => {
    if (!inView) return
    const t = setTimeout(() => setReady(true), reduce ? 0 : 900)
    return () => clearTimeout(t)
  }, [inView, reduce])
  return (
    <div className="card chart-card">
      <div className="card-head">
        <div>
          <h2>{data.title}</h2>
          <div className="sub">{data.subtitle}</div>
        </div>
        <div className="legend">
          <span><i className="sw solid" />Weekday</span>
          <span><i className="sw striped" />Weekend cover</span>
          <span><i className="sw light" />Today</span>
        </div>
      </div>
      <div className="rc-bars" ref={ref}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart accessibilityLayer={false} data={days} margin={{ top: 44, right: 8, bottom: 0, left: 8 }} barCategoryGap="14%">
            <defs>
              <pattern id="bar-stripes" width="15" height="15" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="8" height="15" style={{ fill: "var(--stripe)" }} />
              </pattern>
            </defs>
            <XAxis
              dataKey="d"
              axisLine={false}
              tickLine={false}
              tickMargin={10}
              interval={0}
              tick={({ x, y, payload, index }) => (
                <text x={Number(x)} y={Number(y) + 8} textAnchor="middle" className={`rc-tick ${index === days.length - 1 ? "now" : ""}`}>
                  {payload.value}
                </text>
              )}
            />
            {inView && <Bar
              dataKey="n"
              shape={(p: ShapeProps) => <PillBar {...p} days={days} active={active} showTip={ready || active !== last} />}
              isAnimationActive={!reduce}
              animationDuration={900}
              animationEasing="ease-out"
              onMouseEnter={(_, i) => setActive(i)}
              onMouseLeave={() => setActive(last)}
              onClick={(_, i) => setSelected(i)}
            >
              {days.map((x, i) => (
                <Cell key={i} fill={fills[x.t]} />
              ))}
            </Bar>}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DayDetailsDialog day={selected === null ? null : days[selected]} onClose={() => setSelected(null)} />
    </div>
  )
}
