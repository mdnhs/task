"use client"

import Link from "next/link"
import { ArrowRightLeft, Check, HandHelping, X } from "lucide-react"

import { formatDate } from "@/lib/dates"
import type { Claim, RosterShift, SwapRequest } from "../types"

// Open shifts of the shown range with who offered to take them, and swap requests waiting (FR-RS-38/42/43, D6). `canDecide` is approverFor for the
// shift's week and location, so a supervisor sees the buttons only where they may decide. Each open shift is also a derived gap in Staff & Rosters
// (D12): a plain link, the features never import each other.
export function OpenShiftsPanel({ gapsLink, open, claims, swaps, shiftOf, nameOf, placeOf, canDecide, onClaim, onSwap }: {
  gapsLink: boolean
  open: RosterShift[]
  claims: Claim[]
  swaps: SwapRequest[]
  shiftOf(id: string): RosterShift | undefined
  nameOf(id: string | null): string
  placeOf(locationId: string): string
  canDecide(shiftId: string): boolean
  onClaim(c: Claim, approve: boolean): void
  onSwap(r: SwapRequest, approve: boolean): void
}) {
  const waiting = swaps.filter((r) => r.status === "open" && shiftOf(r.shiftId))
  if (!open.length && !waiting.length) return null
  const when = (s: RosterShift) => `${formatDate(s.date)} ${s.start}–${s.end}`
  return (
    <section className="card ros-panel" aria-label="Open shifts and swaps">
      <div className="ros-panel-head">
        <h2>Open shifts and swaps</h2>
        <span className="ros-sum num">{open.length} open{waiting.length ? ` · ${waiting.length} swap${waiting.length === 1 ? "" : "s"}` : ""}</span>
        {gapsLink && <Link href="/staff-rosters" className="ros-req-btn ros-os-gap">Roster gaps</Link>}
      </div>
      <ul className="ros-req-list">
        {open.map((s) => {
          const mine = claims.filter((c) => c.shiftId === s.id && c.status === "open")
          return (
            <li key={s.id} className="ros-os" data-id={s.id}>
              <div className="ros-req-main">
                <span className="ros-who"><HandHelping aria-hidden="true" className="ros-os-i" />{when(s)} · {s.role}</span>
                <span className="ros-role">{placeOf(s.locationId)}{mine.length === 0 ? " · nobody has offered yet" : ""}</span>
              </div>
              {mine.map((c) => (
                <div key={c.id} className="ros-os-claim">
                  <span className="ros-who">{nameOf(c.personId)}</span>
                  {canDecide(s.id) ? (
                    <span className="ros-req-act">
                      <button type="button" className="btn btn-outline" aria-label={`Reject ${nameOf(c.personId)}`} onClick={() => onClaim(c, false)}><X aria-hidden="true" />Reject</button>
                      <button type="button" className="btn btn-primary" aria-label={`Approve ${nameOf(c.personId)}`} onClick={() => onClaim(c, true)}><Check aria-hidden="true" />Approve</button>
                    </span>
                  ) : (
                    <span className="ros-role">A higher-level user approves</span>
                  )}
                </div>
              ))}
            </li>
          )
        })}
        {waiting.map((r) => {
          const s = shiftOf(r.shiftId)!
          const t = r.toShiftId ? shiftOf(r.toShiftId) : undefined
          return (
            <li key={r.id} className="ros-os" data-id={r.id}>
              <div className="ros-req-main">
                <span className="ros-who"><ArrowRightLeft aria-hidden="true" className="ros-os-i" />{nameOf(r.fromPersonId)} to {nameOf(r.toPersonId)}</span>
                <span className="ros-time num">{when(s)}{t ? ` for ${when(t)}` : ""}</span>
                <span className="ros-role">{placeOf(s.locationId)}</span>
              </div>
              {canDecide(s.id) ? (
                <span className="ros-req-act">
                  <button type="button" className="btn btn-outline" aria-label={`Reject swap, ${nameOf(r.fromPersonId)}`} onClick={() => onSwap(r, false)}><X aria-hidden="true" />Reject</button>
                  <button type="button" className="btn btn-primary" aria-label={`Approve swap, ${nameOf(r.fromPersonId)}`} onClick={() => onSwap(r, true)}><Check aria-hidden="true" />Approve</button>
                </span>
              ) : (
                <span className="ros-role">A higher-level user approves</span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
