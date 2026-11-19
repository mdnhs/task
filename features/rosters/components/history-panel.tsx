"use client"

import { useRef, useState } from "react"

import { FilterSelect } from "@/components/filter-bar"
import { Icon } from "@/components/icon"
import { Sk } from "@/components/sk"
import { formatDate, formatTime } from "@/lib/dates"
import type { HistoryEntry, Page, WeekShift } from "../types"

const ACTION: Record<string, string> = {
  week_created: "Started the week",
  week_published: "Published the week",
  week_repeated: "Repeated the week",
  week_template_applied: "Started from a template",
  shift_added: "Added a shift",
  shift_moved: "Changed a shift",
  shift_removed: "Removed a shift",
  shift_confirmed: "Confirmed a shift",
  change_requested: "Asked for a change",
  change_approved: "Approved a change",
  change_rejected: "Rejected a change",
  exchange_requested: "Asked for a shift",
  exchange_recommended: "Recommended a request",
  exchange_approved: "Approved a request",
  exchange_rejected: "Turned down a request",
  exchange_cancelled: "Cancelled a request",
  exchange_declined: "Declined a swap",
  auto_repeat_changed: "Changed auto-repeat",
  template_saved: "Saved a template",
}
const dateIn = (snap: unknown): string | null => (snap && typeof snap === "object" && typeof (snap as { date?: unknown }).date === "string" ? (snap as { date: string }).date : null)
const humanise = (a: string) => ACTION[a] ?? a.replace(/[._]/g, " ").replace(/^./, (c) => c.toUpperCase())

export type HistoryWeek = { id: string; label: string }
export type HistoryPage = Page<HistoryEntry>

/** The rows of a history page that is being fetched: the same row height as a loaded one (a label, a line of who and when). */
export function HistoryRowsSkeleton({ rows }: { rows: number }) {
  return (
    <ul className="ros-hist" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="ros-hist-row">
          <Sk lh={24} w={`${52 + ((i * 11) % 30)}%`} h={14} />
          <Sk lh={20} w={`${34 + ((i * 7) % 20)}%`} h={12} />
        </li>
      ))}
    </ul>
  )
}

// Change history of one week (FR-RS audit trail), newest first, a page at a time: "Load more" asks the API for the next page by its cursor. Who did what, when, and the reason an office edit of a
// published week was given. The names come from the payload; an actor the caller does not know reads "Member". A week is picked when the range has several.
export function HistoryPanel({ weeks, weekId, first, shiftOf, nameOf, load, pageRows }: {
  weeks: HistoryWeek[]
  /** The week the first page belongs to. */
  weekId: string
  first: HistoryPage
  shiftOf(id: string): WeekShift | undefined
  nameOf(id: string | null): string
  /** Reads one page from the API (a server action); `null` = it failed (the page has said why). */
  load(weekId: string, cursor: string | null): Promise<HistoryPage | null>
  pageRows: number
}) {
  const [week, setWeek] = useState(weekId)
  const [page, setPage] = useState({ items: first.items, next: first.nextCursor })
  const [seen, setSeen] = useState(first)
  const [pending, setPending] = useState<"switch" | "more" | null>(null)
  const once = useRef(false)
  // A new first page from the server (a refresh after a write) replaces what is shown.
  if (seen !== first) {
    setSeen(first)
    setWeek(weekId)
    setPage({ items: first.items, next: first.nextCursor })
  }

  async function fetchPage(forWeek: string, cursor: string | null, kind: "switch" | "more") {
    if (once.current) return
    once.current = true
    setPending(kind)
    try {
      const r = await load(forWeek, cursor)
      if (!r) return
      setPage((p) => ({ items: kind === "more" ? [...p.items, ...r.items.filter((x) => !p.items.some((y) => y.id === x.id))] : r.items, next: r.nextCursor }))
      if (kind === "switch") setWeek(forWeek)
    } finally {
      once.current = false
      setPending(null)
    }
  }

  const empty = page.items.length === 0
  return (
    <section className="card ros-panel" aria-label="Roster history">
      <div className="ros-panel-head">
        <h2>History</h2>
        <span className="ros-sum num">{empty ? "" : `${page.items.length}${page.next ? "+" : ""}`}</span>
        {weeks.length > 1 && <span className="ros-panel-x"><FilterSelect label="Week" value={week} options={weeks.map((w) => ({ value: w.id, label: w.label }))} onChange={(v) => void fetchPage(v, null, "switch")} /></span>}
      </div>
      {pending === "switch" ? (
        <HistoryRowsSkeleton rows={Math.min(5, pageRows)} />
      ) : empty ? (
        <p className="ros-empty">{page.next ? "Nothing recent on this page." : "No changes yet."}</p>
      ) : (
        <ul className="ros-hist">
          {page.items.map((h) => {
            const s = h.shiftId ? shiftOf(h.shiftId) : undefined
            const date = s?.date ?? dateIn(h.after) ?? dateIn(h.before)
            return (
              <li key={h.id} className="ros-hist-row">
                <span className="ros-who">{humanise(h.action)}{s ? ` · ${nameOf(s.personId)}` : ""}{date ? `, ${formatDate(date)}` : ""}</span>
                <span className="ros-time num">{nameOf(h.by)} · {formatDate(h.at.slice(0, 10))} {formatTime(h.at)}</span>
                {h.reason && <span className="ros-role">{h.reason}</span>}
              </li>
            )
          })}
        </ul>
      )}
      {pending === "more" && <HistoryRowsSkeleton rows={3} />}
      {page.next && pending !== "switch" && (
        <button type="button" className="btn btn-outline ros-more" disabled={pending !== null} onClick={() => void fetchPage(week, page.next, "more")}>
          <Icon name="history" size={24} />{empty ? "Load older" : "Load more"}
        </button>
      )}
    </section>
  )
}
