"use client"

import { useState } from "react"
import { Plus } from "lucide-react"

import { formatDate } from "@/lib/dates"
import type { RosterViewKind, ViewBlock, ViewDay, ViewShift } from "../view"

// By location (FR-RS-10): one card per day, laid out as the seven-day columns (a single column at 640px and under). A card shows the
// day's count against its target (the shortfall is highlighted), then each person with their own times and role.
/** What the board needs to edit (FR-RS-20/21): which days take edits, and the actions. Only passed when the role may edit. */
export type DayEditor = {
  editable(locationId: string, date: string): boolean
  /** A shift's own location and date, to check a drop. */
  shiftInfo(id: string): { locationId: string; date: string } | undefined
  onAdd(locationId: string, date: string): void
  onEdit(id: string): void
  onMove(id: string, date: string): void
  /** Published week the role can't edit but may ask to change (FR-RS-36). */
  canRequest(locationId: string, date: string): boolean
  onRequest(id: string): void
  /** Draft week of the shown range that this role may publish (FR-RS-23). */
  canPublish(locationId: string): boolean
  onPublish(locationId: string): void
  publishLabel(locationId: string): string
  /** Repeat the shown week of this location into later draft weeks (FR-RS-26). */
  canRepeat(locationId: string): boolean
  onRepeat(locationId: string): void
}

function Lines({ s, place }: { s: ViewShift; place?: boolean }) {
  return (
    <>
      <span className="ros-who">{s.person}</span>
      <span className="ros-time num">
        {s.start}–{s.end}
        {s.endsNextDay && (
          <>
            {" "}
            <b className="ros-next" aria-hidden="true">+1</b>
            <span className="sr-only">, ends the next day</span>
          </>
        )}
      </span>
      <span className="ros-role">{place && s.location ? `${s.role} · ${s.location}` : s.role}</span>
    </>
  )
}

export function ShiftLine({ s, place, onEdit, onRequest, onDragStart }: { s: ViewShift; place?: boolean; onEdit?(): void; onRequest?(): void; onDragStart?(): void }) {
  if (!onEdit && onRequest) {
    return (
      <li className="ros-shift" data-open={s.open || undefined}>
        <Lines s={s} place={place} />
        <button type="button" className="ros-req-btn" onClick={onRequest} aria-label={`Request change, ${s.person}, ${s.start} to ${s.end}`}>Request change</button>
      </li>
    )
  }
  if (!onEdit) {
    return (
      <li className="ros-shift" data-open={s.open || undefined}>
        <Lines s={s} place={place} />
      </li>
    )
  }
  // Editable: the whole card opens the edit form (also the keyboard and touch way to move it); mouse users can drag it to another day.
  return (
    <li
      className="ros-shift"
      data-open={s.open || undefined}
      draggable
      onDragStartCapture={(e: React.DragEvent) => {
        e.dataTransfer.setData("text/plain", s.id)
        e.dataTransfer.effectAllowed = "move"
        onDragStart?.()
      }}
    >
      <button type="button" className="ros-shift-btn" onClick={onEdit} aria-label={`Edit shift, ${s.person}, ${s.start} to ${s.end}`}>
        <Lines s={s} place={place} />
      </button>
    </li>
  )
}

function Day({ day, today, locationId, editor, dragId, setDragId }: { day: ViewDay; today: string; locationId: string; editor?: DayEditor; dragId: string | null; setDragId(id: string | null): void }) {
  const short = day.short > 0
  const canEdit = !!editor && day.hasRoster && editor.editable(locationId, day.date)
  const canAsk = !canEdit && !!editor && day.hasRoster && editor.canRequest(locationId, day.date)
  const [over, setOver] = useState(false)
  const dragged = dragId && editor ? editor.shiftInfo(dragId) : undefined
  const droppable = canEdit && !!dragged && dragged.locationId === locationId && dragged.date !== day.date
  return (
    <section
      className="ros-day"
      data-today={day.date === today || undefined}
      data-short={short || undefined}
      data-over={over && droppable ? "ok" : undefined}
      aria-label={formatDate(day.date)}
      onDragOver={(e) => {
        if (!droppable) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const id = e.dataTransfer.getData("text/plain") || dragId
        setDragId(null)
        if (id && droppable) editor?.onMove(id, day.date)
      }}
    >
      <header className="ros-day-head">
        <span className="ros-day-name">{formatDate(day.date)}</span>
        {day.hasRoster && (
          <span className="ros-count num">
            {day.count}
            {day.target > 0 && <span className="ros-target">/{day.target}</span>}
            {day.short > 0 && <b className="ros-gap" data-kind="short"> −{day.short}<span className="sr-only"> short</span></b>}
            {day.over > 0 && <b className="ros-gap" data-kind="over"> +{day.over}<span className="sr-only"> over</span></b>}
          </span>
        )}
        {canEdit && (
          <button type="button" className="ros-add" aria-label={`Add shift on ${formatDate(day.date)}`} onClick={() => editor?.onAdd(locationId, day.date)}>
            <Plus aria-hidden="true" />
          </button>
        )}
      </header>
      {day.shifts.length > 0 ? (
        <ul className="ros-shifts" onDragEnd={() => { setDragId(null); setOver(false) }}>
          {day.shifts.map((s) => (
            <ShiftLine key={s.id} s={s} onEdit={canEdit ? () => editor?.onEdit(s.id) : undefined} onRequest={canAsk ? () => editor?.onRequest(s.id) : undefined} onDragStart={() => setDragId(s.id)} />
          ))}
        </ul>
      ) : (
        <span className="ros-none">{day.hasRoster ? "No shifts" : "No roster"}</span>
      )}
    </section>
  )
}

export function DayBoard({ block, today, view, firstWeekday, editor }: { block: ViewBlock; today: string; view: RosterViewKind; firstWeekday: number; editor?: DayEditor }) {
  const [dragId, setDragId] = useState<string | null>(null)
  return (
    <div className="ros-board" data-view={view}>
      {block.days.map((d, i) => (
        <div key={d.date} className="ros-cell" style={i === 0 && view === "month" ? { gridColumnStart: firstWeekday + 1 } : undefined}>
          <Day day={d} today={today} locationId={block.locationId} editor={editor} dragId={dragId} setDragId={setDragId} />
        </div>
      ))}
    </div>
  )
}
