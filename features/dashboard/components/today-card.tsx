"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { taskInbox } from "@/lib/task-inbox"
import { taskVoice, withVoice, type VoiceEntry } from "@/lib/task-voice"
import { dayOrder, daySummary, handledToday, todayCounts, todayHasNews, todayUpdate } from "@/lib/today"
import type { DayItem, DayMode } from "@/lib/today"
import { readAuto, readDismissed, writeDismissed } from "@/lib/today-prefs"
import type { TodayData } from "@/lib/today-data"
import { TodayPlayer } from "./today-player"
import { TodayChipCounts, teamLines, todaySub } from "./today-copy"

// The Today card (FR-M1-70..79, AC-M1-09/10). First paint comes from the server (cookie mirror of the dismissal), then the
// localStorage record wins if it differs. One accordion item: the "Your day" bar (counts) stays put and the body opens and
// closes under it (height only), so the page never jumps. Closing it is the dismissal for the day; opening undoes it.
// The brief only ever holds the user's own tasks, cut on the server (FR-M1-80).

type Tile = { key: string; label: string; n: number; href: string; tone?: "bad" | "warn" }

export function TodayCard({ data }: { data: TodayData }) {
  const router = useRouter()
  const { meId, day, now, tenantId, meName } = data
  const [open, setOpen] = useState(data.mode === "card")
  const [summaryOn, setSummaryOn] = useState(false)
  const [player, setPlayer] = useState<{ autoplay: boolean } | null>(null)
  const [mode, setMode] = useState<DayMode>("all")
  const [done, setDone] = useState<Set<string>>(new Set())
  const [snoozed, setSnoozed] = useState<Set<string>>(new Set())
  const [voiced, setVoiced] = useState<VoiceEntry[]>([])

  // The saved choice (this browser) decides when it disagrees with the cookie the server saw.
  useEffect(() => {
    const want = readAuto(meId) && !readDismissed(meId, day.key)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reconciles with browser storage once after mount
    setOpen((o) => (o === want ? o : want))
  }, [meId, day.key])

  // Done / snoozed earlier this working day (queued task changes survive client navigation; the server seed doesn't know them yet).
  useEffect(() => {
    const h = handledToday(taskInbox.updates(tenantId), day.key)
    if (h.done.size === 0 && h.snoozed.size === 0) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the module-level hand-off once after mount
    setDone((s) => new Set([...s, ...h.done]))
    setSnoozed((s) => new Set([...s, ...h.snoozed]))
  }, [tenantId, day.key])

  // Tasks with voice instructions created in this session (lib/task-voice.ts hand-off; the recordings live in this tab only).
  useEffect(() => {
    const list = taskVoice.list(tenantId)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the module-level hand-off once after mount
    if (list.length) setVoiced(list)
  }, [tenantId])
  const voice = useMemo(() => withVoice(data.tasks, voiced, meId), [data.tasks, voiced, meId])

  const live = useMemo(() => voice.tasks.filter((t) => !done.has(t.ref)), [voice.tasks, done])
  const counts = useMemo(() => todayCounts(live, now, data.review), [live, now, data.review])
  const queue = useMemo(() => dayOrder(live.filter((t) => !snoozed.has(t.ref)), now, mode), [live, snoozed, now, mode])
  const summary = useMemo(() => daySummary(live.filter((t) => !snoozed.has(t.ref)), now, mode), [live, snoozed, now, mode])

  const news = todayHasNews(counts, data.team)
  const mine = `assignee=${encodeURIComponent(meId)}`
  const tiles: Tile[] = [
    { key: "overdue", label: "Overdue", n: counts.overdue, href: `/tasks?due=overdue&${mine}`, tone: "bad" },
    // Open only, like the counts (lib/today.ts todayCounts): done tasks due today or high priority are not on the list.
    { key: "today", label: "Due today", n: counts.dueToday, href: `/tasks?status=open&due=today&${mine}` },
    { key: "high", label: "High priority", n: counts.high, href: `/tasks?status=open&priority=3&${mine}`, tone: "warn" },
    ...(data.team ? [{ key: "review", label: "Waiting for my review", n: counts.review, href: "/tasks?status=review" }] : []),
    { key: "blocked", label: "Blocked", n: counts.blocked, href: `/tasks?status=blocked&${mine}` },
  ]

  const toggle = (next: boolean) => {
    writeDismissed(meId, day.key, !next)
    setOpen(next)
    if (!next) setPlayer(null)
  }

  const markDone = (item: DayItem) => {
    if (item.task.evidenceRequired) {
      // AC-M1-10: evidence-required tasks are never closed from the player; the task page has the upload step.
      toast("Evidence is needed first", { description: `Opening ${item.task.ref} so you can add it.` })
      router.push(`/tasks/${item.task.ref}`)
      return
    }
    // Through the tasks hand-off: the tasks store applies it (status, timeline) when a tasks screen mounts.
    taskInbox.pushUpdates([todayUpdate("done", item.task.ref, tenantId, day.key, meName, now)])
    setDone((s) => new Set(s).add(item.task.ref))
    toast.success(`${item.task.ref} marked done`)
  }
  const snooze = (item: DayItem) => {
    taskInbox.pushUpdates([todayUpdate("snooze", item.task.ref, tenantId, day.key, meName, now)])
    setSnoozed((s) => new Set(s).add(item.task.ref))
    toast(`${item.task.ref} snoozed for today`)
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
              <div className="today-sum-h">{summary.headline}</div>
              <ul>
                {summary.lines.map((l, i) => (
                  <li key={i} data-note={l.ref ? undefined : ""}>
                    {l.ref ? (
                      <Link href={`/tasks/${l.ref}`}>{l.text}</Link>
                    ) : (
                      l.text
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {player && (
            <TodayPlayer
              items={queue}
              voice={voice.notes}
              summary={summary}
              now={now}
              mode={mode}
              autoplay={player.autoplay}
              onMode={setMode}
              onDone={markDone}
              onSnooze={snooze}
              onOpen={(i) => router.push(`/tasks/${i.task.ref}`)}
              onClose={() => setPlayer(null)}
            />
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}
