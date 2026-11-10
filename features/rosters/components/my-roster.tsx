"use client"

import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { ArrowRightLeft, CalendarDays, CalendarPlus, Check, CheckCheck, HandHelping, ListChecks } from "lucide-react"
import { toast } from "sonner"

import { FilterSeg } from "@/components/filter-bar"
import { CountUp } from "@/components/count-up"
import { FadeSwap } from "@/components/fade-swap"
import { useSlideDir } from "@/components/data-pagination"
import { PageHead } from "@/components/page-head"
import { StatusPill } from "@/components/status-pill"
import { formatDate, formatTime } from "@/lib/dates"
import { toIcs } from "@/lib/ics"
import { shiftMinutes } from "@/lib/rosters"
import { durationLabel } from "@/lib/shifts"
import { FormSection } from "@/components/form-section"
import { claimShift, requestSwap } from "../exchange"
import { claimsStore, confirmStore, leaveStore, shiftsStore, swapsStore, weeksStore } from "../store"
import { isSeen, isUpcoming, mergeMine, shiftSig } from "../self-service"
import { exchangeScopeKey, mergeById } from "../scope"
import type { LeaveQueue, MyExchange, MyRosterData, RosterShift } from "../types"
import { AvailabilityForm } from "./availability-form"
import { LeaveForm } from "./leave-form"
import { LeavePanel } from "./leave-panel"
import { MyCalendar } from "./my-calendar"
import { SwapDialog } from "./swap-dialog"

// My roster (FR-RS-23, 33, 40, 41): the signed-in person's published shifts across every location, a "Seen" confirm, an .ics export,
// their not-available windows and leave requests. Leave decisions (D8) show only for roles that can decide. Edits live in stores until reload.
export function MyRosterView({ data, queue, exchange, me, tz, today, scopeKey }: { data: MyRosterData; queue: LeaveQueue; exchange: MyExchange; me: string; tz: string; today: string; scopeKey: string }) {
  const [confirmed, setConfirmed] = confirmStore.useStore({}, scopeKey)
  // Claims and swaps are one list on this page and on Rosters (same key), so an approval there shows here. Whichever page seeded first, top up with ours.
  const exchangeKey = exchangeScopeKey(scopeKey)
  const [claims, setClaims] = claimsStore.useStore(exchange.claims, exchangeKey)
  const [swaps, setSwaps] = swapsStore.useStore(exchange.swaps, exchangeKey)
  useEffect(() => {
    setClaims((p) => mergeById(p, exchange.claims))
    setSwaps((p) => mergeById(p, exchange.swaps))
  }, [exchange.claims, exchange.swaps, setClaims, setSwaps])
  const [swapping, setSwapping] = useState<{ id: string; n: number } | null>(null)
  const places = useMemo(() => new Map([...exchange.locations, ...data.locations].map((l) => [l.id, l.name])), [data.locations, exchange.locations])
  // The Rosters page stores, once seeded in this session, carry office edits (moves, deletions, publish): merge them over the server list.
  const liveShifts = useSyncExternalStore(shiftsStore.subscribe, shiftsStore.get, () => undefined)
  const liveWeeks = useSyncExternalStore(weeksStore.subscribe, weeksStore.get, () => undefined)
  const shifts = useMemo(
    () => mergeMine(me, data.shifts, data.weeks, liveShifts && liveWeeks ? { shifts: liveShifts, weeks: liveWeeks } : undefined),
    [me, data.shifts, data.weeks, liveShifts, liveWeeks],
  )
  const stamp = `${today.slice(0, 10)}T${today.slice(11, 16)}:00`
  // Open shifts the server offered, minus any the Rosters page stores show as taken in this session.
  const open = exchange.open.filter((s) => !liveShifts || (liveShifts.find((x) => x.id === s.id)?.personId ?? null) === null)
  // The same list the leave panel and the leave form write to (same seed, same key), so a new request shows on the calendar at once.
  const [allLeave] = leaveStore.useStore([...data.leave, ...queue.leave.filter((q) => !data.leave.some((l) => l.id === q.id))], scopeKey)
  const myLeave = allLeave.filter((l) => l.personId === me)
  const upcoming = shifts.filter((s) => isUpcoming(s, today, tz))
  const earlier = shifts.filter((s) => !isUpcoming(s, today, tz))
  const [tab, setTab] = useState<"calendar" | "shifts" | "off">("calendar")
  const tabDir = useSlideDir(["calendar", "shifts", "off"].indexOf(tab))
  const next = upcoming[0]
  const unseen = upcoming.filter((s) => !isSeen(s, confirmed))
  function confirmAll() {
    setConfirmed((p) => ({ ...p, ...Object.fromEntries(unseen.map((s) => [s.id, { at: today, sig: shiftSig(s) }])) }))
    toast.success(`${unseen.length} shift${unseen.length > 1 ? "s" : ""} marked as seen`)
  }

  function download(list: RosterShift[], name: string) {
    const ics = toIcs(list.map((s) => ({ id: s.id, date: s.date, start: s.start, end: s.end, role: s.role, location: places.get(s.locationId) })), tz)
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }))
    const a = document.createElement("a")
    a.href = url
    a.download = `${name}.ics`
    a.rel = "noopener"
    // The link has to be in the page for Firefox and Safari to follow it, and the URL must outlive the click or the download is cancelled.
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    toast.success(list.length === 1 ? "Shift saved to your calendar file" : `${list.length} shifts saved to your calendar file`)
  }

  function claim(s: RosterShift) {
    const t = exchange.templates.find((x) => x.id === s.templateId)
    if (!exchange.member || !t) return
    try {
      const c = claimShift(s, exchange.member, t, stamp, { week: exchange.weeks.find((w) => w.id === s.weekId), tz })
      setClaims((p) => [...p, c])
      toast.success("Offer sent", { description: `${formatDate(s.date)} · ${s.start}–${s.end}` })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not claim this shift")
    }
  }

  const swapShift = swapping ? shifts.find((s) => s.id === swapping.id) : undefined
  function sendSwap(personId: string) {
    const t = swapShift && exchange.templates.find((x) => x.id === swapShift.templateId)
    const target = ((swapShift && exchange.peers[swapShift.id]) || []).find((p) => p.id === personId)
    if (!swapShift || !t || !target) return
    try {
      // Only id and name reach this browser, so the target's own licences are re-checked by whoever approves (the full rule check).
      const stub = { id: target.id, name: target.name, role: "", dept: "", homeLocationId: null, qualifications: t.requires.map((r) => ({ type: r, expires: null })), leftOn: null }
      setSwaps((p) => [...p, requestSwap(swapShift, me, stub, t, null, stamp, `sw-${Date.now().toString(36)}-${p.length + 1}`, { week: exchange.weeks.find((w) => w.id === swapShift.weekId), tz })])
      toast.success("Swap requested", { description: `${target.name} · ${formatDate(swapShift.date)}` })
      setSwapping(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not request the swap")
    }
  }

  const row = (s: RosterShift, close?: () => void) => {
    const when = isSeen(s, confirmed)
    return (
      <li key={s.id} className="mr-shift">
        <div className="mr-when">
          <b>{formatDate(s.date)}</b>
          <span className="num">{formatTime(`${s.date}T${s.start}`)} to {formatTime(`${s.date}T${s.end}`)}{s.end <= s.start && <b className="ros-next" title="Ends the next day"> +1</b>} · {durationLabel(shiftMinutes(s, tz))}</span>
        </div>
        <div className="mr-where">
          <span>{s.role}</span>
          <span className="rl-note">{places.get(s.locationId) ?? ""}</span>
        </div>
        <div className="mr-act">
          <FadeSwap id={when ? "seen" : "ask"}>
            {when ? (
              <StatusPill status={{ tone: "ok", label: "Confirmed" }} tick={false} />
            ) : (
              <button type="button" className="btn btn-outline mr-btn" onClick={() => setConfirmed((p) => ({ ...p, [s.id]: { at: today, sig: shiftSig(s) } }))}>
                <Check aria-hidden="true" />
                Seen
              </button>
            )}
          </FadeSwap>
          {exchange.peers[s.id] && (swaps.some((x) => x.shiftId === s.id && x.fromPersonId === me && x.status === "open") ? (
            <StatusPill status={{ tone: "warn", label: "Swap asked" }} tick={false} />
          ) : (
            <button type="button" className="btn btn-outline mr-btn" aria-label={`Swap ${formatDate(s.date)}`} onClick={() => { close?.(); setSwapping({ id: s.id, n: (swapping?.n ?? 0) + 1 }) }}>
              <ArrowRightLeft aria-hidden="true" />
              Swap
            </button>
          ))}
          <button type="button" className="mr-ics" aria-label={`Add ${formatDate(s.date)} to calendar`} onClick={() => download([s], `shift-${s.date}`)}>
            <CalendarPlus aria-hidden="true" />
          </button>
        </div>
      </li>
    )
  }

  return (
    <>
      <PageHead
        title="My roster"
        subtitle="Your published shifts across every location."
        actions={
          <button
            type="button"
            className="btn btn-outline"
            disabled={upcoming.length === 0}
            title={upcoming.length === 0 ? "No upcoming shifts to add" : undefined}
            onClick={() => download(upcoming, "my-roster")}
          >
            <CalendarPlus aria-hidden="true" />
            Add to calendar
          </button>
        }
      />
      <div className="mr-sum od-cascade">
        <div className="mr-tile">
          <span className="mr-tile-k">Next shift</span>
          {next ? (
            <>
              <b>{formatDate(next.date)}</b>
              <span className="num">{formatTime(`${next.date}T${next.start}`)} to {formatTime(`${next.date}T${next.end}`)}</span>
              <span className="rl-note">{places.get(next.locationId) ?? ""}</span>
            </>
          ) : (
            <span className="rl-empty">Nothing coming up</span>
          )}
        </div>
        <div className="mr-tile">
          <span className="mr-tile-k">To confirm</span>
          <b className="num"><CountUp value={String(unseen.length)} /></b>
          {unseen.length > 0 ? (
            <button type="button" className="btn btn-outline mr-btn" onClick={confirmAll}>
              <CheckCheck aria-hidden="true" />
              Mark all as seen
            </button>
          ) : (
            <span className="rl-note">{upcoming.length ? "All seen" : "No shifts"}</span>
          )}
        </div>
        <div className="mr-tile">
          <span className="mr-tile-k">Open shifts you can take</span>
          <b className="num"><CountUp value={String(open.length)} /></b>
          {open.length > 0 ? (
            <button type="button" className="btn btn-outline mr-btn" onClick={() => setTab("shifts")}>
              <HandHelping aria-hidden="true" />
              See them
            </button>
          ) : (
            <span className="rl-note">None right now</span>
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
            { value: "off" as const, label: `Time off${queue.leave.length ? ` · ${queue.leave.length}` : ""}` },
          ]}
          onChange={(v) => setTab(v as "calendar" | "shifts" | "off")}
        />
      </div>
      <div className="card nt-card">
        <div className="od-form nt-form od-slide" key={tab} data-slide={tabDir}>
          {tab === "calendar" && (
            <FormSection icon={CalendarDays} title="Calendar" note="Pick a day to see its shifts">
              <MyCalendar shifts={shifts} leave={myLeave} today={today} places={places} renderShift={row} />
            </FormSection>
          )}
          {tab === "shifts" && (
            <>
              <FormSection icon={ListChecks} title="Upcoming shifts" note={upcoming.length ? `${upcoming.length}` : undefined}>
                {upcoming.length === 0 ? <p className="rl-empty">No published shifts coming up.</p> : <ul className="mr-list">{upcoming.map((s) => row(s))}</ul>}
                {earlier.length > 0 && (
                  <details className="ev-earlier">
                    <summary>Earlier shifts ({earlier.length})</summary>
                    <ul className="mr-list">{[...earlier].reverse().map((s) => row(s))}</ul>
                  </details>
                )}
              </FormSection>
              <FormSection icon={HandHelping} title="Open shifts you can take" note={open.length ? `${open.length}` : undefined}>
                {open.length === 0 ? (
                  <p className="rl-empty">No open shifts right now.</p>
                ) : (
                  <ul className="mr-list">
                    {open.map((s) => {
                      const offered = claims.some((c) => c.shiftId === s.id && c.personId === me && c.status === "open")
                      return (
                        <li key={s.id} className="mr-shift">
                          <div className="mr-when">
                            <b>{formatDate(s.date)}</b>
                            <span className="num">{formatTime(`${s.date}T${s.start}`)} to {formatTime(`${s.date}T${s.end}`)}{s.end <= s.start && <b className="ros-next" title="Ends the next day"> +1</b>} · {durationLabel(shiftMinutes(s, tz))}</span>
                          </div>
                          <div className="mr-where">
                            <span>{s.role}</span>
                            <span className="rl-note">{places.get(s.locationId) ?? ""}</span>
                          </div>
                          <div className="mr-act">
                            <FadeSwap id={offered ? "offered" : "claim"}>
                              {offered ? (
                                <StatusPill status={{ tone: "warn", label: "Offered" }} tick={false} />
                              ) : (
                                <button type="button" className="btn btn-primary mr-btn" aria-label={`Claim ${formatDate(s.date)}`} onClick={() => claim(s)}>
                                  <HandHelping aria-hidden="true" />
                                  Claim
                                </button>
                              )}
                            </FadeSwap>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </FormSection>
            </>
          )}
          {tab === "off" && (
            <div className="od-form-cols">
              <div className="od-form-col">
                <LeaveForm me={me} today={today} scopeKey={scopeKey} data={data} queue={queue} />
                <LeavePanel me={me} today={today} scopeKey={scopeKey} data={data} queue={queue} />
              </div>
              <div className="od-form-col">
                <AvailabilityForm me={me} scopeKey={scopeKey} data={data} />
              </div>
            </div>
          )}
        </div>
      </div>
      {swapShift && swapping && (
        <SwapDialog key={swapping.n} shift={swapShift} place={places.get(swapShift.locationId) ?? ""} people={exchange.peers[swapShift.id] ?? []} onSend={sendSwap} onClose={() => setSwapping(null)} />
      )}
    </>
  )
}
