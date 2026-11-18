"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { apiBrowser } from "@/lib/api/browser"
import { userMessage } from "@/lib/api/problem"
import type { DayItem, DayMode } from "@/lib/today"
import { readAuto, readDismissed, readSnoozed, writeDismissed, writeSnoozed } from "@/lib/today-prefs"
import { toToday } from "../adapters"
import { makeTodayClient } from "../client"
import type { TodayData } from "../types"
import { TodayPlayer } from "./today-player"
import { TodayChipCounts, teamLines, todayNews, todaySub } from "./today-copy"

// The Today card (FR-M1-70..79, AC-M1-09/10), on GET /v1/today (B6 T6.7). The numbers, the order and the written summary are the SERVER's (cached 30 s per user, busted by this tenant's writes):
// the card refetches after its own writes and tolerates a slightly stale figure from another server instance. First paint comes from the server (cookie mirror of the dismissal), then the
// localStorage record wins if it differs. One accordion item: the "Your day" bar (counts) stays put and the body opens and closes under it (height only), so the page never jumps.
// "Mark done" and "Snooze" send ONE request each with dayKey = workingDay.key (H6). An evidence-required task is never closed from the card: it opens the task page (AC-M1-10), and an
// "evidence still needed" answer shows the same prompt. The brief only ever holds the user's own tasks, cut by the API (FR-M1-80).

type Tile = { key: string; label: string; n: number; href: string; tone?: "bad" | "warn" }

export function TodayCard({ data: initial }: { data: TodayData }) {
  const router = useRouter()
  const client = useMemo(() => makeTodayClient(apiBrowser), [])
  const [base, setBase] = useState(initial)
  const [data, setData] = useState(initial)
  // a new server render (after router.refresh) replaces what the card holds
  if (base !== initial) {
    setBase(initial)
    setData(initial)
  }
  const { meId, day } = data
  const [open, setOpen] = useState(initial.mode === "card")
  const [summaryOn, setSummaryOn] = useState(false)
  const [player, setPlayer] = useState<{ autoplay: boolean } | null>(null)
  const [mode, setMode] = useState<DayMode>("all")
  const [done, setDone] = useState<Set<string>>(new Set())
  const [snoozed, setSnoozed] = useState<Set<string>>(new Set())
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // The saved choice (this browser) decides when it disagrees with the cookie the server saw.
  useEffect(() => {
    const want = readAuto(meId) && !readDismissed(meId, day.key)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reconciles with browser storage once after mount
    setOpen((o) => (o === want ? o : want))
  }, [meId, day.key])

  // Snoozed earlier this working day in this browser (the server keeps only the history line, so the card remembers which tasks to leave out).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads browser storage once after mount
    setSnoozed(new Set(readSnoozed(meId, day.key)))
  }, [meId, day.key])

  const live = useMemo(() => data.order.filter((i) => !done.has(i.task.id)), [data.order, done])
  const queue = useMemo(() => live.filter((i) => !snoozed.has(i.task.ref)), [live, snoozed])
  const counts = data.counts
  const news = todayNews(counts, data.team, data.reports)
  const mine = `assignee=${encodeURIComponent(meId)}`
  const tiles: Tile[] = [
    { key: "overdue", label: "Overdue", n: counts.overdue, href: `/tasks?due=overdue&${mine}`, tone: "bad" },
    // Open only, like the counts the server makes: done tasks due today or high priority are not on the list.
    { key: "today", label: "Due today", n: counts.dueToday, href: `/tasks?status=open&due=today&${mine}` },
    { key: "high", label: "High priority", n: counts.high, href: `/tasks?status=open&priority=3&${mine}`, tone: "warn" },
    ...(data.team ? [{ key: "review", label: "Waiting for my review", n: counts.review, href: "/tasks?status=review" }] : []),
    { key: "blocked", label: "Blocked", n: counts.blocked, href: `/tasks?status=blocked&${mine}` },
  ]

  /** Fetch the card again (for a mode, or after a write): the server's numbers replace the card's. */
  async function refetch(m: DayMode = mode) {
    try {
      const fresh = toToday(await client.load(m), { meId, tz: data.tz, nowAt: data.nowAt, now: data.now, tzLabel: data.tzLabel, mode: data.mode })
      if (mounted.current) setData(fresh)
    } catch (e) {
      toast.error(userMessage(e).text)
    }
  }

  const toggle = (next: boolean) => {
    writeDismissed(meId, day.key, !next)
    setOpen(next)
    if (!next) setPlayer(null)
  }

  const itemOf = (i: DayItem) => data.order.find((x) => x.task.ref === i.task.ref)
  const evidencePrompt = (ref: string) => {
    // AC-M1-10: evidence-required tasks are never closed from the player; the task page has the upload step.
    toast("Evidence is needed first", { description: `Opening ${ref} so you can add it.` })
    router.push(`/tasks/${ref}`)
  }

  const markDone = async (di: DayItem) => {
    const item = itemOf(di)
    if (!item) return
    if (item.task.evidenceRequired) return evidencePrompt(item.task.ref)
    try {
      const r = await client.update(item.task.id, "done", day.key)
      switch (r.kind) {
        case "done":
          setDone((s) => new Set(s).add(item.task.id))
          toast.success(`${item.task.ref} marked done`)
          break
        case "needs_evidence":
          evidencePrompt(item.task.ref)
          break
        case "duplicate":
          setDone((s) => new Set(s).add(item.task.id))
          toast(`${item.task.ref} is already done`)
          break
        case "archived":
          toast(`${item.task.ref} was archived`)
          break
        case "stale_day":
          toast("The day changed. Refreshing.")
          break
        case "snoozed":
          break
      }
      await refetch()
      router.refresh()
    } catch (e) {
      toast.error(userMessage(e).text)
    }
  }
  const snooze = async (di: DayItem) => {
    const item = itemOf(di)
    if (!item) return
    try {
      const r = await client.update(item.task.id, "snooze", day.key)
      if (r.kind === "snoozed" || r.kind === "duplicate") {
        const next = new Set(snoozed).add(item.task.ref)
        setSnoozed(next)
        writeSnoozed(meId, day.key, [...next])
        toast(`${item.task.ref} snoozed for today`)
      } else if (r.kind === "stale_day") {
        toast("The day changed. Refreshing.")
        await refetch()
        router.refresh()
      }
    } catch (e) {
      toast.error(userMessage(e).text)
    }
  }
  const changeMode = (m: DayMode) => {
    setMode(m)
    void refetch(m)
  }

  return (
    <Accordion className="today-acc" value={open ? ["today"] : []} onValueChange={(v) => toggle(v.includes("today"))}>
      <AccordionItem value="today" className="card today">
        <AccordionTrigger className="today-bar" aria-label={open ? "Close your day" : news ? "Open your day, new items waiting" : "Open your day"}>
          <span className="today-chip-t" id="today-h">Your day</span>
          <span className="today-peek" aria-hidden={open}><TodayChipCounts counts={counts} /></span>
          {news && <span className="today-pulse" aria-hidden="true" />}
          <span className="today-chip-a">{open ? "Hide" : "Open"}</span>
        </AccordionTrigger>
        <AccordionContent keepMounted className="today-body">
          <div className="today-head">
            <div className="sub">{todaySub(day)}</div>
            <div className="today-actions">
              <button type="button" className="pill-btn" aria-pressed={summaryOn} onClick={() => setSummaryOn((v) => !v)}>
                Summarise my day
              </button>
              <button type="button" className="pill-btn today-play" onClick={() => setPlayer({ autoplay: true })}>
                Play my day
              </button>
            </div>
          </div>

          <ul className="today-tiles" data-n={tiles.length}>
            {tiles.map((t) => (
              <li key={t.key}>
                <Link href={t.href} className="today-tile" data-tone={t.n > 0 ? t.tone : undefined}>
                  <b>{t.n}</b>
                  <span>{t.label}</span>
                </Link>
              </li>
            ))}
          </ul>

          {data.team && (
            <div className="today-team" aria-label="Team">
              <div className="today-team-h">Team today</div>
              <ul className="today-team-l">
                {teamLines(data.team, counts.reports).map((l) => (
                  <li key={l.label}>
                    <Link href={l.href}><b>{l.n}</b> {l.label}</Link>
                    {l.who && <span className="today-team-m"> · {l.who}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {summaryOn && (
            <div className="today-sum" aria-live="polite">
              <div className="today-sum-h">{data.summary.headline}</div>
              <ul>
                {data.summary.lines.map((l, i) => (
                  <li key={i} data-note={l.ref ? undefined : ""}>
                    {l.ref ? <Link href={`/tasks/${l.ref}`}>{l.text}</Link> : l.text}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {player && (
            <TodayPlayer
              items={queue}
              summary={data.summary}
              now={data.now}
              mode={mode}
              autoplay={player.autoplay}
              onMode={changeMode}
              onDone={(i) => void markDone(i)}
              onSnooze={(i) => void snooze(i)}
              onOpen={(i) => router.push(`/tasks/${i.task.ref}`)}
              onClose={() => setPlayer(null)}
            />
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}
