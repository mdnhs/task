"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useInView, useReducedMotion } from "motion/react"
import { Bar, BarChart, Cell, ResponsiveContainer, XAxis } from "recharts"

import { cssZoom, unzoom } from "@/lib/zoom"

import { useDept } from "@/hooks/use-dept"
import { DUR } from "@/lib/motion"
import { DayDetailsDialog } from "./day-details-dialog"
import type { TasksClosedData } from "../types"

type Day = TasksClosedData["days"][number]

const fills: Record<Day["t"], string> = {
  s1: "var(--brand-2)",
  s2: "var(--brand-shade)",
  today: "var(--brand-3)",
  weekend: "url(#bar-stripes)",
}

type ShapeProps = { x?: number; y?: number; width?: number; height?: number; fill?: string; index?: number }

// Full pill (radius = half the width). No minimum height, so the entrance animation starts from 0.
// `data-bar` lets the tip find the bar it sits on.
function PillBar({ x = 0, y = 0, width = 0, height = 0, fill, index = 0 }: ShapeProps) {
  const w = Math.min(width, 72)
  const h = Math.max(height, 0)
  const left = x + (width - w) / 2
  const top = y + height - h
  return (
    <g style={{ cursor: "pointer" }}>
      <rect data-bar={index} x={left} y={top} width={w} height={h} rx={Math.min(w, h) / 2} fill={fill} />
    </g>
  )
}

// Puts the tip's anchor on the top centre of bar `i` (the tip itself is offset above it in CSS).
function placeTip(wrap: HTMLElement, tip: HTMLElement, i: number) {
  const bar = wrap.querySelector(`[data-bar="${i}"]`)
  if (!bar) return
  const b = bar.getBoundingClientRect()
  const w = wrap.getBoundingClientRect()
  // Rects are on-screen px; the translate is zoomed again by the Text size preset, so divide it back (lib/zoom.ts).
  const z = cssZoom(wrap)
  tip.style.transform = `translate(${unzoom(b.left - w.left + b.width / 2, z)}px,${unzoom(b.top - w.top, z)}px)`
}

const ENTER_MS = 900
// Department switch: bars ease to their new heights (Recharts animates data changes).
const UPDATE_MS = Math.round(DUR.count * 1000)

export function TasksClosedChart({ data }: { data: TasksClosedData }) {
  const dep = useDept()
  // The topbar department filter shows that department's closed count per day (byDept, 0 when absent); "all" is the total.
  const days = useMemo(
    () => (dep === "all" ? data.days : data.days.map((d) => ({ ...d, n: d.byDept[dep] ?? 0 }))),
    [data.days, dep]
  )
  const last = days.length - 1
  const [active, setActive] = useState(last)
  const [ready, setReady] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  // Bars mount (and so grow) only once the chart scrolls into view (ui-rules.md rule 20); the tip waits for them.
  const ref = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: "0px 0px -10% 0px" })
  const reduce = useReducedMotion()
  useEffect(() => {
    if (!inView) return
    const t = setTimeout(() => setReady(true), reduce ? 0 : ENTER_MS)
    return () => clearTimeout(t)
  }, [inView, reduce])

  // One tip for the whole chart, moved with a transform: hovering another bar glides it there (CSS transition)
  // instead of re-creating it. While bars animate (entrance, department switch) it tracks the bar top every frame.
  const activeRef = useRef(active)
  useLayoutEffect(() => {
    activeRef.current = active
    if (ref.current && tipRef.current) placeTip(ref.current, tipRef.current, active)
  }, [active])
  useLayoutEffect(() => {
    const wrap = ref.current
    const tip = tipRef.current
    if (!wrap || !tip || !inView) return
    const place = () => placeTip(wrap, tip, activeRef.current)
    place()
    let raf = 0
    const until = performance.now() + (reduce ? 0 : ENTER_MS)
    const follow = () => {
      place()
      if (performance.now() < until) raf = requestAnimationFrame(follow)
      else delete tip.dataset.follow
    }
    if (!reduce) {
      tip.dataset.follow = ""
      raf = requestAnimationFrame(follow)
    }
    const ro = new ResizeObserver(place)
    ro.observe(wrap)
    return () => {
      cancelAnimationFrame(raf)
      delete tip.dataset.follow
      ro.disconnect()
    }
    // `days` re-runs it after a department switch, so the tip rides the bars to their new heights.
  }, [days, inView, reduce])

  const d = days[active]
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
        <div ref={tipRef} className="rc-tip" data-show={inView && (ready || active !== last) ? "" : undefined} aria-hidden="true">
          <span className="tip tip-static tip-2l num"><b>{d.n}</b><span>{d.on}% on time</span></span>
        </div>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart accessibilityLayer={false} data={days} margin={{ top: 60, right: 8, bottom: 0, left: 8 }} barCategoryGap="26%">
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
              shape={(p: ShapeProps) => <PillBar {...p} />}
              isAnimationActive={!reduce}
              animationDuration={ready ? UPDATE_MS : ENTER_MS}
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
