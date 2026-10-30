"use client"

import { useRef } from "react"
import { useInView, useReducedMotion } from "motion/react"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { compact, money } from "../money"
import type { SeriesRow } from "../overview"

// Monthly recurring revenue over 12 months (Task 3). Two panels on one month axis instead of a dual-axis chart (dataviz):
// the MRR area on top, the month's movements below as a diverging stacked bar (new + expansion above zero, contraction +
// churn below). Hovering either panel shows one tip with every value for that month (syncId). Like the dashboard chart,
// the series mount only once the card scrolls into view (ui-rules rule 20), so the entrance never plays off screen.
// Colours are chart tokens (--pf-c-*, platform.css), validated light and dark with the dataviz palette script.

export const MOVES = [
  { key: "new", label: "New", color: "var(--pf-c-new)" },
  { key: "expansion", label: "Expansion", color: "var(--pf-c-exp)" },
  { key: "contraction", label: "Contraction", color: "var(--pf-c-con)" },
  { key: "churn", label: "Churn", color: "var(--pf-c-churn)" },
] as const

const ENTER_MS = 900
const Y_WIDTH = 48
const MARGIN = { top: 8, right: 8, bottom: 0, left: 0 }
const tickStyle = { fontSize: 12, fill: "var(--ink-3)" }

function axisMoney(n: number, currency: string): string {
  if (n < 0) return `-${axisMoney(-n, currency)}`
  const c = compact(n, currency)
  return `${c.prefix}${c.value}${c.suffix}`
}

/** A round step (1, 2, 2.5 or 5 × 10^n) that splits `span` into about `parts` intervals. */
function niceStep(span: number, parts: number) {
  if (span <= 0) return 1
  const raw = span / parts
  const mag = 10 ** Math.floor(Math.log10(raw))
  return ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag
}
function ticksFor(lo: number, hi: number, parts: number) {
  const step = niceStep(Math.max(hi, 0) - Math.min(lo, 0), parts)
  const from = Math.floor(Math.min(lo, 0) / step) * step
  const to = Math.max(Math.ceil(Math.max(hi, 0) / step) * step, from + step)
  return Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step)
}

function Tip({ row, currency }: { row: SeriesRow; currency: string }) {
  const net = row.new + row.expansion + row.contraction + row.churn
  return (
    <div className="pf-tip num">
      <div className="pf-tip-h">{row.label} {row.month.slice(0, 4)}</div>
      <div className="pf-tip-row pf-tip-mrr"><i style={{ background: "var(--pf-mrr)" }} />MRR<b>{money(row.mrr, currency)}</b></div>
      {MOVES.map((m) => (
        <div key={m.key} className="pf-tip-row"><i style={{ background: m.color }} />{m.label}<b>{money(row[m.key], currency)}</b></div>
      ))}
      <div className="pf-tip-row pf-tip-net">Net change<b>{net > 0 ? "+" : ""}{money(net, currency)}</b></div>
    </div>
  )
}

export function MrrChart({ series, currency, skeleton = false }: { series: SeriesRow[]; currency: string; skeleton?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: "0px 0px -10% 0px" })
  const reduce = useReducedMotion()
  const last = series.length - 1
  const fmt = (n: number) => axisMoney(n, currency)
  const areaTicks = ticksFor(0, Math.max(...series.map((r) => r.mrr), 0), 3)
  const moveTicks = ticksFor(
    Math.min(...series.map((r) => r.contraction + r.churn), 0),
    Math.max(...series.map((r) => r.new + r.expansion), 0),
    2,
  )

  return (
    <section className="card chart-card pf-mrr" aria-labelledby="pf-mrr-h">
      <div className="card-head">
        <div>
          <h2 id="pf-mrr-h">Monthly recurring revenue</h2>
          <div className="sub">Last {series.length} months, with each month&apos;s movements</div>
        </div>
        <div className="legend pf-legend">
          <span><i className="sw pf-sw-line" />MRR</span>
          {MOVES.map((m) => (
            <span key={m.key}><i className="sw" style={{ background: m.color }} />{m.label}</span>
          ))}
        </div>
      </div>
      <div className="pf-mrr-plots" ref={ref} aria-hidden="true">
        {skeleton ? (
          <>
            <div className="pf-mrr-area" />
            <div className="pf-mrr-moves" />
          </>
        ) : (
          <>
            <div className="pf-mrr-area">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart accessibilityLayer={false} data={series} syncId="pf-mrr" margin={MARGIN}>
                  <defs>
                    <linearGradient id="pf-mrr-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" style={{ stopColor: "var(--pf-mrr)", stopOpacity: 0.22 }} />
                      <stop offset="100%" style={{ stopColor: "var(--pf-mrr)", stopOpacity: 0 }} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--line)" />
                  <XAxis dataKey="label" hide />
                  <YAxis width={Y_WIDTH} axisLine={false} tickLine={false} tick={tickStyle} ticks={areaTicks} domain={[areaTicks[0], areaTicks[areaTicks.length - 1]]} tickFormatter={fmt} />
                  <Tooltip
                    cursor={{ stroke: "var(--ink-3)", strokeWidth: 1, strokeDasharray: "3 3" }}
                    isAnimationActive={false}
                    content={({ active, payload }) => (active && payload?.[0] ? <Tip row={payload[0].payload as SeriesRow} currency={currency} /> : null)}
                  />
                  {inView && (
                    <Area
                      type="monotone"
                      dataKey="mrr"
                      stroke="var(--pf-mrr)"
                      strokeWidth={2}
                      fill="url(#pf-mrr-fill)"
                      dot={false}
                      activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2, fill: "var(--pf-mrr)" }}
                      isAnimationActive={!reduce}
                      animationDuration={ENTER_MS}
                      animationEasing="ease-out"
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="pf-mrr-moves">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart accessibilityLayer={false} data={series} syncId="pf-mrr" stackOffset="sign" margin={MARGIN} barCategoryGap="30%">
                  <XAxis
                    dataKey="label"
                    axisLine={false}
                    tickLine={false}
                    tickMargin={8}
                    interval="preserveStartEnd"
                    minTickGap={4}
                    tick={({ x, y, payload, index }) => (
                      <text x={Number(x)} y={Number(y) + 8} textAnchor="middle" className={`rc-tick pf-tick ${index === last ? "now" : ""}`}>
                        {payload.value}
                      </text>
                    )}
                  />
                  <YAxis width={Y_WIDTH} axisLine={false} tickLine={false} tick={tickStyle} ticks={moveTicks} domain={[moveTicks[0], moveTicks[moveTicks.length - 1]]} tickFormatter={fmt} />
                  <ReferenceLine y={0} stroke="var(--line)" />
                  <Tooltip cursor={{ fill: "var(--mute-bg)", radius: 6 } as object} isAnimationActive={false} content={() => null} />
                  {inView &&
                    MOVES.map((m) => (
                      <Bar
                        key={m.key}
                        dataKey={m.key}
                        stackId="moves"
                        fill={m.color}
                        stroke="var(--card)"
                        strokeWidth={1}
                        maxBarSize={22}
                        isAnimationActive={!reduce}
                        animationDuration={ENTER_MS}
                        animationEasing="ease-out"
                      />
                    ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </div>
      {/* The same numbers as a table, for screen readers (the plots are aria-hidden). */}
      <div className="sr-only">
      <table>
        <caption>Monthly recurring revenue and movements by month</caption>
        <thead>
          <tr><th scope="col">Month</th><th scope="col">MRR</th>{MOVES.map((m) => <th key={m.key} scope="col">{m.label}</th>)}</tr>
        </thead>
        <tbody>
          {series.map((r) => (
            <tr key={r.month}>
              <th scope="row">{r.label} {r.month.slice(0, 4)}</th>
              <td>{money(r.mrr, currency)}</td>
              {MOVES.map((m) => <td key={m.key}>{money(r[m.key], currency)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </section>
  )
}
