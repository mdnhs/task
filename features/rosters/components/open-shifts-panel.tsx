"use client"

import { AnimatePresence, motion } from "motion/react"
import { listItem } from "@/lib/motion"

import { Icon } from "@/components/icon"
import { formatDate } from "@/lib/dates"
import { canClaim, exchangeActions, isParty, openExchanges } from "../exchange"
import type { ApiExchange, WeekAccess, WeekShift } from "../types"

/** One open shift of a published week in view, with the place and what it needs to know about its week for the approver matrix. */
export type OpenRow = { shift: WeekShift; place: string; weekStatus: "draft" | "published"; delegated: boolean }
export type SwapRow = { exchange: ApiExchange; place: string; weekStatus: "draft" | "published"; delegated: boolean }

// Open shifts of the shown range with who offered to take them, and swap requests waiting (FR-RS-38/42/43, D6, R8-11). Which buttons show is `exchangeActions` (the matrix); the API decides every one
// again. Staff & Rosters no longer derives its gaps from these (R8-15, B8 Task 23), so the panel links nowhere else.
export function OpenShiftsPanel({ level, me, today, open, swaps, exchanges, nameOf, busy, onClaim, onRecommend, onDecide }: {
  /** The caller's user id (empty when unknown): nothing is offered on an exchange they are party to, and Claim goes once they have an open claim on the shift. */
  me: string
  level: WeekAccess["level"]
  today: string
  open: OpenRow[]
  swaps: SwapRow[]
  /** Every exchange the API listed for the shown shifts. */
  exchanges: ApiExchange[]
  nameOf(id: string | null): string
  /** Keys (shift or exchange ids) with a request on its way: their buttons are off. */
  busy: ReadonlySet<string>
  onClaim(shiftId: string): void
  onRecommend(x: ApiExchange): void
  onDecide(x: ApiExchange, decision: "approve" | "reject"): void
}) {
  const waiting = swaps.filter((r) => r.exchange.status === "requested" || r.exchange.status === "recommended")
  if (!open.length && !waiting.length) return null
  const when = (date: string, start: string, end: string) => `${formatDate(date)} ${start}–${end}`
  const buttons = (x: ApiExchange, row: { weekStatus: "draft" | "published"; delegated: boolean }, label: string) => {
    const party = isParty(x, me)
    const a = exchangeActions({ level, weekStatus: row.weekStatus, delegated: row.delegated, status: x.status, expired: x.expired, party })
    const working = busy.has(x.id)
    if (party) return <span className="ros-role">{x.kind === "claim" ? "Your claim" : "Your swap"}: a manager decides</span>
    if (!a.approve && !a.reject && !a.recommend) return <span className="ros-role">{x.status === "recommended" ? "Recommended: the office approves" : "A higher-level user approves"}</span>
    return (
      <span className="ros-req-act">
        {a.recommend && <button type="button" className="btn btn-outline" disabled={working} aria-label={`Recommend ${label}`} onClick={() => onRecommend(x)}><Icon name="send" size={24} />Recommend</button>}
        {a.reject && <button type="button" className="btn btn-outline" disabled={working} aria-label={`Reject ${label}`} onClick={() => onDecide(x, "reject")}><Icon name="close" size={24} />Reject</button>}
        {a.approve && <button type="button" className="btn btn-primary" disabled={working} aria-label={`Approve ${label}`} onClick={() => onDecide(x, "approve")}><Icon name="check" size={24} />Approve</button>}
      </span>
    )
  }
  return (
    <section className="card ros-panel" aria-label="Open shifts and swaps">
      <div className="ros-panel-head">
        <h2>Open shifts and swaps</h2>
        <span className="ros-sum num">{open.length} open{waiting.length ? ` · ${waiting.length} swap${waiting.length === 1 ? "" : "s"}` : ""}</span>
      </div>
      <ul className="ros-req-list">
        <AnimatePresence initial={false}>
          {open.map((row) => {
            const s = row.shift
            const claims = openExchanges(exchanges, s.id, "claim")
            return (
              <motion.li key={s.id} className="ros-os" data-id={s.id} {...listItem}>
                <div className="ros-os-top">
                  <div className="ros-req-main">
                    <span className="ros-who"><Icon name="hand" className="ros-os-i" size={24} />{when(s.date, s.start, s.end)} · {s.role}</span>
                    <span className="ros-role">{row.place}{claims.length === 0 ? " · nobody has offered yet" : ""}</span>
                  </div>
                  {canClaim(row.weekStatus, s.personId, s.date, today) && !claims.some((c) => !!me && c.fromUserId === me) && (
                    <button type="button" className="btn btn-outline" disabled={busy.has(s.id)} aria-label={`Claim ${when(s.date, s.start, s.end)}`} onClick={() => onClaim(s.id)}><Icon name="hand" size={24} />Claim</button>
                  )}
                </div>
                {claims.map((c) => (
                  <div key={c.id} className="ros-os-claim">
                    <span className="ros-who">{nameOf(c.fromUserId)}{c.status === "recommended" ? " · recommended" : ""}</span>
                    {buttons(c, row, nameOf(c.fromUserId))}
                  </div>
                ))}
              </motion.li>
            )
          })}
          {waiting.map((r) => {
            const x = r.exchange
            return (
              <motion.li key={x.id} className="ros-os" data-id={x.id} {...listItem}>
                <div className="ros-req-main">
                  <span className="ros-who"><Icon name="swap" className="ros-os-i" size={24} />{nameOf(x.fromUserId)} to {nameOf(x.toUserId)}{x.status === "recommended" ? " · recommended" : ""}</span>
                  <span className="ros-time num">{when(x.date, x.start, x.end)}</span>
                  <span className="ros-role">{r.place}</span>
                </div>
                {buttons(x, r, `swap, ${nameOf(x.fromUserId)}`)}
              </motion.li>
            )
          })}
        </AnimatePresence>
      </ul>
    </section>
  )
}
