"use client"

import { memo, useId, useMemo, useRef } from "react"
import { useInView, useReducedMotion } from "motion/react"
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { formatDate } from "@/lib/dates"
import { PLATFORM_LOCALE } from "../../constants"
import type { UsageMetric } from "../../tenant-360"

// One usage metric against its plan limit (tenant 360: overview sparklines, usage tab charts). The limit is a dashed
// reference line; the series turns warn near the limit (90%) and bad above it, the same states as the meters. Like the
// MRR chart, the series mounts only once the chart scrolls into view (ui-rules rule 20). Sparklines are aria-hidden: the
// card states the value and limit in text; the full chart carries an sr-only table.

const ENTER_MS = 700
const tickStyle = { fontSize: 12, fill: "var(--ink-3)" }
const num = (n: number) => n.toLocaleString(PLATFORM_LOCALE)
// Stable props: recharts 3 re-syncs its store when an object or function prop changes identity, and with inline values
// a parent re-render (typing a note) looped ("Maximum update depth exceeded"). Hence constants + memo below.
const SPARK_MARGIN = { top: 4, right: 0, bottom: 0, left: 0 }
const FULL_MARGIN = { top: 8, right: 8, bottom: 0, left: 0 }
const CURSOR = { stroke: "var(--ink-3)", strokeWidth: 1, strokeDasharray: "3 3" }
const dayTick = (d: string) => formatDate(d).replace(/^\w+ /, "")
const numTick = (n: number) => num(Math.round(n))

export function meterState(used: number, limit: number | undefined): "near" | "over" | undefined {
  if (!limit) return undefined
  return used > limit ? "over" : used / limit >= 0.9 ? "near" : undefined
}

/** The axis top: four round steps (1, 2, 2.5 or 5 × 10^n each) that cover `n`. */
function niceTop(n: number): number {
  if (n <= 0) return 1
  const raw = n / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  return ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag * 4
}

const COLOR = { near: "var(--warn)", over: "var(--bad)" } as const

export const UsageChart = memo(function UsageChart({ metric, limit, variant }: { metric: UsageMetric; limit: number | undefined; variant: "spark" | "full" }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: "0px 0px -10% 0px" })
  const reduce = useReducedMotion()
  const gid = useId().replace(/:/g, "")
  const peak = Math.max(0, ...metric.series.map((p) => p.value))
  const state = meterState(peak, limit)
  const color = state ? COLOR[state] : "var(--pf-mrr)"
  const top = niceTop(Math.max(peak, limit ?? 0) * 1.08)
  const spark = variant === "spark"
  const unit = metric.unit ? ` ${metric.unit}` : ""
  const domain = useMemo(() => [0, top] as [number, number], [top])
  // The limit label sits just above the dashed line, right-aligned, with a card-coloured halo (paint-order stroke) so a
  // series running at the limit can't make it unreadable. Stable identity (see above).
  const label = useMemo(() => {
    if (spark || limit === undefined) return undefined
    const text = `Limit ${num(limit)}${unit}`
    return function LimitLabel({ viewBox }: { viewBox?: unknown }) {
      const { x = 0, y = 0, width = 0 } = (viewBox ?? {}) as { x?: number; y?: number; width?: number }
      return (
        <text x={x + width - 4} y={y - 6} textAnchor="end" fontSize={12} fontWeight={600} fill="var(--ink-2)" stroke="var(--card)" strokeWidth={4} strokeLinejoin="round" paintOrder="stroke" className="pf-limit-lbl">
          {text}
        </text>
      )
    }
  }, [spark, limit, unit])
  const activeDot = useMemo(() => (spark ? false : { r: 4, stroke: "var(--card)", strokeWidth: 2, fill: color }), [spark, color])

  return (
    <div ref={ref} className={spark ? "pf-spark" : "pf-usage-plot"} aria-hidden={spark || undefined}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart accessibilityLayer={false} data={metric.series} margin={spark ? SPARK_MARGIN : FULL_MARGIN}>
          <defs>
            <linearGradient id={`pf-u-${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.22 }} />
              <stop offset="100%" style={{ stopColor: color, stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          {!spark && <CartesianGrid vertical={false} stroke="var(--line)" />}
          <XAxis
            dataKey="date"
            hide={spark}
            axisLine={false}
            tickLine={false}
            tickMargin={8}
            minTickGap={36}
            tick={tickStyle}
            tickFormatter={dayTick}
          />
          <YAxis hide={spark} width={44} tickCount={5} axisLine={false} tickLine={false} tick={tickStyle} domain={domain} tickFormatter={numTick} />
          {limit !== undefined && (
            <ReferenceLine y={limit} stroke="var(--ink-3)" strokeDasharray="4 4" strokeWidth={1} label={label} />
          )}
          {!spark && (
            <Tooltip
              cursor={CURSOR}
              isAnimationActive={false}
              content={({ active, payload }) => {
                const p = active ? (payload?.[0]?.payload as { date: string; value: number } | undefined) : undefined
                return p ? (
                  <div className="pf-tip num">
                    <div className="pf-tip-h">{formatDate(p.date)}</div>
                    <div className="pf-tip-row"><i style={{ background: color }} />{metric.kind === "flow" ? "Month to date" : metric.label}<b>{num(p.value)}{unit}</b></div>
                    {limit !== undefined && <div className="pf-tip-row"><i style={{ background: "var(--ink-3)" }} />Limit<b>{num(limit)}{unit}</b></div>}
                  </div>
                ) : null
              }}
            />
          )}
          {inView && (
            <Area
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={spark ? 1.6 : 2}
              fill={`url(#pf-u-${gid})`}
              dot={false}
              activeDot={activeDot}
              isAnimationActive={!reduce}
              animationDuration={ENTER_MS}
              animationEasing="ease-out"
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
})
