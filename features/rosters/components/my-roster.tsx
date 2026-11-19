"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { cancelExchange, confirmShift, declineExchange, proposeSwap } from "@/app/actions/rosters"
import { ActionButton } from "@/components/action-button"
import { CountUp } from "@/components/count-up"
import { useSlideDir } from "@/components/data-pagination"
import { FadeSwap } from "@/components/fade-swap"
import { FilterSeg } from "@/components/filter-bar"
import { FormSection } from "@/components/form-section"
import { Icon } from "@/components/icon"
import { PageHead } from "@/components/page-head"
import { StatusPill } from "@/components/status-pill"
import { formatDate, formatTime } from "@/lib/dates"
import { durationLabel } from "@/lib/shifts"
import { downloadMyCalendar } from "../ics-download"
import { endsAfter, myRequests, realMinutes } from "../self-service"
import type { ApiExchange, ApiLeave, MineShift, MyRoster } from "../types"
import { AvailabilityForm } from "./availability-form"
import { LeaveForm } from "./leave-form"
import { LeavePanel } from "./leave-panel"
import { MyCalendar } from "./my-calendar"
import { SwapDialog } from "./swap-dialog"

export type MyRosterProps = {
  /** GET /v1/roster/mine (published shifts across every site, own availability and leave, the caller's access). */
  mine: MyRoster
  /** Waiting leave the API lists for this caller (own requests and the people they may decide for). */
  queue: ApiLeave[]
  /** Names of the people the API lets this caller see; anyone else is "Member". */
  names: Record<string, string>
  /** Claims and swaps the caller is a party to (or may decide). */
  exchanges: ApiExchange[]
  /** Colleagues to offer a swap to: the API's people list for this caller, or null when the caller has none (staff without a site view). */
  people: { id: string; name: string }[] | null
  peopleTruncated: boolean
  me: string
  /** The organisation's wall clock (ISO, for the calendar and date pickers) and the same moment as an instant (for "still to come"). */
  today: string
  nowAt: string
}

type Tab = "calendar" | "shifts" | "off"
const TABS: Tab[] = ["calendar", "shifts", "off"]
const when = (x: Pick<MineShift, "date" | "start" | "end">) => `${formatTime(`${x.date}T${x.start}`)} to ${formatTime(`${x.date}T${x.end}`)}`

// My roster on the API (B8 Task 22; FR-RS-23, 33, 40, 41): the signed-in person's PUBLISHED shifts across every location as one list (the API's /mine: nobody else, never a draft), each
// confirmed through the API (the confirmation is the API's `confirmedAt`, so it survives a reload, and an office edit clears it: confirm again), the calendar file from the API's builder, own
// claims and swaps (cancel, or decline a swap offered to you), availability and leave. Every refusal is the API's, shown short.
export function MyRosterView({ mine, queue, names, exchanges, people, peopleTruncated, me, today, nowAt }: MyRosterProps) {
  const router = useRouter()
  const [confirmed, setConfirmed] = useState<Record<string, string>>({})
  const [tab, setTab] = useState<Tab>("calendar")
  const tabDir = useSlideDir(TABS.indexOf(tab))
  const [swapping, setSwapping] = useState<{ id: string; n: number } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const once = useRef(false)

  const shifts = mine.shifts
  const isConfirmed = (s: MineShift) => s.confirmedAt !== null || confirmed[s.id] !== undefined
  const upcoming = shifts.filter((s) => endsAfter(s, nowAt))
  const earlier = shifts.filter((s) => !endsAfter(s, nowAt))
  const next = upcoming[0]
  const toConfirm = upcoming.filter((s) => !isConfirmed(s))
  const { mine: asked, offered } = myRequests(exchanges, me)
  const swapOpen = (id: string) => asked.some((x) => x.kind === "swap" && x.shiftId === id)
  const decide = queue.filter((l) => l.status === "requested" && l.personId !== me).length

  /** One request at a time (a double click sends one); false when refused. */
  async function guarded<T>(key: string, call: () => Promise<{ ok: true; value: T } | { ok: false; error: { toast: { text: string } | null } }>): Promise<T | null> {
    if (once.current) return null
    once.current = true
    setBusy(key)
    try {
      const r = await call()
      if (!r.ok) {
        toast.error(r.error.toast?.text ?? "Not saved.")
        return null
      }
      return r.value
    } finally {
      once.current = false
      setBusy(null)
    }
  }
  async function confirm(s: MineShift): Promise<boolean> {
    const v = await guarded(s.id, () => confirmShift(s.id))
    if (!v) return false
    setConfirmed((c) => ({ ...c, [s.id]: v.confirmedAt ?? new Date(0).toISOString() }))
    router.refresh()
    return true
  }
  async function confirmAll(): Promise<boolean> {
    let n = 0
    for (const s of toConfirm) {
      const v = await guarded(s.id, () => confirmShift(s.id))
      if (!v) break
      n++
      setConfirmed((c) => ({ ...c, [s.id]: v.confirmedAt ?? new Date(0).toISOString() }))
    }
    if (n) toast.success(`${n} shift${n > 1 ? "s" : ""} confirmed`)
    router.refresh()
    return n > 0
  }
  async function download(): Promise<boolean> {
    const r = await downloadMyCalendar({ from: today.slice(0, 10), to: mine.to })
    if (!r.ok) toast.error(r.error.toast?.text ?? "Couldn't get the calendar file.")
    return r.ok
  }
  async function cancel(x: ApiExchange, decline: boolean) {
    const v = await guarded(x.id, () => (decline ? declineExchange(x.id) : cancelExchange(x.id)))
    if (!v) return
    toast.success(decline ? "Swap declined" : "Request cancelled")
    router.refresh()
  }
  const swapShift = swapping ? shifts.find((s) => s.id === swapping.id) : undefined
  async function sendSwap(personId: string) {
    if (!swapShift) return
    const v = await guarded(swapShift.id, () => proposeSwap(swapShift.id, { toUserId: personId }))
    if (!v) return
    toast.success("Swap asked")
    setSwapping(null)
    router.refresh()
  }

  const row = (id: string, close?: () => void) => {
    const s = shifts.find((x) => x.id === id)
    if (!s) return null
    const ahead = endsAfter(s, nowAt)
    const done = isConfirmed(s)
    return (
      <li key={s.id} className="mr-shift">
        <div className="mr-when">
          <b>{formatDate(s.date)}</b>
          <span className="num">{when(s)}{s.end <= s.start && <b className="ros-next" title="Ends the next day"> +1</b>} · {durationLabel(realMinutes(s))}</span>
        </div>
        <div className="mr-where">
          <span>{s.role}</span>
          <span className="rl-note">{s.locationName}</span>
        </div>
        <div className="mr-act">
          {ahead && (
            <FadeSwap id={done ? "done" : "ask"}>
              {done ? (
                <StatusPill status={{ tone: "ok", label: "Confirmed" }} tick={false} />
              ) : (
                <button type="button" className="btn btn-outline mr-btn" aria-label={`Confirm ${formatDate(s.date)}`} disabled={busy !== null} onClick={() => void confirm(s)}>
                  <Icon name="check" size={24} />
                  Confirm
                </button>
              )}
            </FadeSwap>
          )}
          {ahead && people && (swapOpen(s.id) ? (
            <StatusPill status={{ tone: "warn", label: "Swap asked" }} tick={false} />
          ) : (
            <button type="button" className="btn btn-outline mr-btn" aria-label={`Swap ${formatDate(s.date)}`} disabled={busy !== null} onClick={() => { close?.(); setSwapping({ id: s.id, n: (swapping?.n ?? 0) + 1 }) }}>
              <Icon name="swap" size={24} />
              Swap
            </button>
          ))}
        </div>
      </li>
    )
  }
  const reqRow = (x: ApiExchange, incoming: boolean) => (
    <li key={x.id} className="mr-chip">
      <span>
        <b>{incoming ? "Swap offered to you" : x.kind === "claim" ? "Claim" : "Swap"}</b> <span className="rl-note num">{formatDate(x.date)} · {when(x)}</span>
      </span>
      <span className="mr-decide">
        <StatusPill status={{ tone: "warn", label: x.status === "recommended" ? "Recommended" : "Waiting" }} tick={false} />
        <button type="button" className="fs-act bad" aria-label={`${incoming ? "Decline" : "Cancel"} ${formatDate(x.date)}`} disabled={busy !== null} onClick={() => void cancel(x, incoming)}>
          <Icon name="close" size={24} />
        </button>
      </span>
    </li>
  )

  return (
    <>
      <PageHead
        title="My roster"
        subtitle="Your published shifts across every location."
        actions={
          <ActionButton className="btn btn-outline mr-cal" disabled={upcoming.length === 0} title={upcoming.length === 0 ? "No upcoming shifts" : undefined} onAction={download}>
            <Icon name="calendar-plus" size={24} />
            Add to calendar
          </ActionButton>
        }
      />
      <div className="mr-sum od-cascade">
        <div className="mr-tile">
          <span className="mr-tile-k">Next shift</span>
          {next ? (
            <>
              <b>{formatDate(next.date)}</b>
              <span className="num">{when(next)}</span>
              <span className="rl-note">{next.locationName}</span>
            </>
          ) : (
            <span className="rl-empty">Nothing coming up</span>
          )}
        </div>
        <div className="mr-tile">
          <span className="mr-tile-k">To confirm</span>
          <b className="num"><CountUp value={String(toConfirm.length)} /></b>
          {toConfirm.length > 0 ? (
            <ActionButton className="btn btn-outline mr-btn" disabled={busy !== null} onAction={confirmAll}>
              <Icon name="check-all" size={24} />
              Confirm all
            </ActionButton>
          ) : (
            <span className="rl-note">{upcoming.length ? "All confirmed" : "No shifts"}</span>
          )}
        </div>
        <div className="mr-tile">
          <span className="mr-tile-k">My requests</span>
          <b className="num"><CountUp value={String(asked.length + offered.length)} /></b>
          {asked.length + offered.length > 0 ? (
            <button type="button" className="btn btn-outline mr-btn" onClick={() => setTab("shifts")}>
              <Icon name="swap" size={24} />
              See them
            </button>
          ) : (
            <span className="rl-note">None open</span>
          )}
        </div>
      </div>
      <div className="mr-tabs">
        <FilterSeg
          label="My roster sections"
          value={tab}
          options={[
            { value: "calendar" as const, label: "Calendar" },
            { value: "shifts" as const, label: `Shifts${upcoming.length ? ` · ${upcoming.length}` : ""}` },
            { value: "off" as const, label: `Time off${decide ? ` · ${decide}` : ""}` },
          ]}
          onChange={(v) => setTab(v as Tab)}
        />
      </div>
      <div className="card nt-card">
        <div className="od-form nt-form od-slide" key={tab} data-slide={tabDir}>
          {tab === "calendar" && (
            <FormSection icon="calendar" title="Calendar" note="Pick a day">
              <MyCalendar shifts={shifts} leave={mine.leave} today={today} renderShift={row} />
            </FormSection>
          )}
          {tab === "shifts" && (
            <>
              <FormSection icon="list-checks" title="Upcoming shifts" note={upcoming.length ? `${upcoming.length}` : undefined}>
                {upcoming.length === 0 ? <p className="rl-empty">No published shifts coming up.</p> : <ul className="mr-list">{upcoming.map((s) => row(s.id))}</ul>}
                {earlier.length > 0 && (
                  <details className="ev-earlier">
                    <summary>Earlier shifts ({earlier.length})</summary>
                    <ul className="mr-list">{[...earlier].reverse().map((s) => row(s.id))}</ul>
                  </details>
                )}
              </FormSection>
              <FormSection icon="swap" title="My requests" note={asked.length + offered.length ? `${asked.length + offered.length}` : undefined}>
                {asked.length + offered.length === 0 ? (
                  <p className="rl-empty">No open claims or swaps.</p>
                ) : (
                  <ul className="mr-chips">
                    {offered.map((x) => reqRow(x, true))}
                    {asked.map((x) => reqRow(x, false))}
                  </ul>
                )}
              </FormSection>
            </>
          )}
          {tab === "off" && (
            <div className="od-form-cols">
              <div className="od-form-col">
                <LeaveForm today={today.slice(0, 10)} />
                <LeavePanel mine={mine.leave} queue={queue} names={names} me={me} today={today} />
              </div>
              <div className="od-form-col">
                <AvailabilityForm windows={mine.availability} />
              </div>
            </div>
          )}
        </div>
      </div>
      {swapShift && swapping && people && (
        <SwapDialog key={swapping.n} shift={swapShift} place={swapShift.locationName} people={people.filter((p) => p.id !== me)} truncated={peopleTruncated} onSend={sendSwap} onClose={() => setSwapping(null)} />
      )}
    </>
  )
}
