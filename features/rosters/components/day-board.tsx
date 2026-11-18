"use client"

import { useState } from "react"
import { DndContext, rectIntersection, useDraggable, useDroppable } from "@dnd-kit/core"
import type { Announcements, DragEndEvent, DragStartEvent } from "@dnd-kit/core"
import { useReducedMotion } from "motion/react"

import { RollNumber } from "@/components/roll-number"
import { formatDate } from "@/lib/dates"
import { numDir } from "@/lib/motion"
import { DragLayer, moveBetweenTargets, originOf, useDragSensors } from "@/lib/drag-card"
import type { RosterViewKind, ViewBlock, ViewDay, ViewShift } from "../view"
import { Icon } from "@/components/icon"

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

/** The day's count: a change after mount rolls per digit (down when it fell), never on first paint (ui-rules.md rule 26). */
function RollCount({ value }: { value: number }) {
  const [seen, setSeen] = useState({ value, dir: "up" as "up" | "down" })
  if (seen.value !== value) setSeen({ value, dir: numDir(String(seen.value), String(value)) })
  return <RollNumber value={String(value)} dir={seen.dir} />
}

type LineProps = { s: ViewShift; place?: boolean; fresh?: boolean; card?: boolean; onEdit?(): void; onRequest?(): void }

/** One shift. `card` = a card on a day column (the same card as the recruitment kanban: lib/drag-card.tsx + drag.css); the person grid uses plain lines. */
export function ShiftLine({ s, place, fresh, card, onEdit, onRequest }: LineProps) {
  const cls = card ? "ros-shift ros-scard" : "ros-shift"
  if (!onEdit && onRequest) {
    return (
      <li className={cls} data-open={s.open || undefined} data-new={fresh || undefined}>
        <Lines s={s} place={place} />
        <button type="button" className="ros-req-btn" onClick={onRequest} aria-label={`Request change, ${s.person}, ${s.start} to ${s.end}`}>Request change</button>
      </li>
    )
  }
  if (!onEdit) {
    return (
      <li className={cls} data-open={s.open || undefined} data-new={fresh || undefined}>
        <Lines s={s} place={place} />
      </li>
    )
  }
  return <DragShift s={s} place={place} fresh={fresh} card={card} onEdit={onEdit} />
}

// Editable: the whole card opens the edit form (Enter; also the touch way to move it); drag it to another day with the mouse, a held touch,
// or the keyboard (Space lifts, arrow keys pick the day, Space drops). Needs a DndContext (DayBoard).
function DragShift({ s, place, fresh, card, onEdit }: { s: ViewShift; place?: boolean; fresh?: boolean; card?: boolean; onEdit(): void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: s.id })
  return (
    <li
      ref={setNodeRef}
      className={`${card ? "ros-shift ros-scard" : "ros-shift"} dnd-card`}
      data-edit=""
      data-dragging={isDragging ? "" : undefined}
      data-open={s.open || undefined} data-new={fresh || undefined}
    >
      <button type="button" className="ros-shift-btn" onClick={onEdit} aria-label={`Edit shift, ${s.person}, ${s.start} to ${s.end}`} {...attributes} {...listeners}>
        <Lines s={s} place={place} />
      </button>
      <span className="dnd-grip" aria-hidden="true"><Icon name="grip" size={14} /></span>
    </li>
  )
}

function Day({ day, today, locationId, editor, dragId }: { day: ViewDay; today: string; locationId: string; editor?: DayEditor; dragId: string | null }) {
  const short = day.short > 0
  const canEdit = !!editor && day.hasRoster && editor.editable(locationId, day.date)
  const canAsk = !canEdit && !!editor && day.hasRoster && editor.canRequest(locationId, day.date)
  // Cards that arrive after the first paint (added, or moved here from another day) fade in once; the first paint is covered by the page enter.
  const key = day.shifts.map((x) => x.id).join("|")
  const [known, setKnown] = useState({ key, ids: new Set(day.shifts.map((x) => x.id)), fresh: new Set<string>() })
  if (known.key !== key) {
    const ids = new Set(day.shifts.map((x) => x.id))
    setKnown({ key, ids, fresh: new Set([...ids].filter((id) => !known.ids.has(id))) })
  }
  const fresh = known.fresh
  const dragged = dragId && editor ? editor.shiftInfo(dragId) : undefined
  const droppable = canEdit && !!dragged && dragged.locationId === locationId && dragged.date !== day.date
  // Same drop target as a kanban column: tinted while a card is held, the hovered one lit up (drag.css / rosters.css).
  const { setNodeRef, isOver } = useDroppable({ id: day.date, disabled: !droppable })
  return (
    <section
      ref={setNodeRef}
      className="ros-day"
      data-today={day.date === today || undefined}
      data-short={short || undefined}
      data-target={droppable || undefined}
      data-over={droppable && isOver ? "" : undefined}
      aria-label={formatDate(day.date)}
    >
      <header className="ros-day-head">
        <span className="ros-day-name">{formatDate(day.date)}</span>
        {day.hasRoster && (
          <span className="ros-count num">
            <RollCount value={day.count} />
            {day.target > 0 && <span className="ros-target">/{day.target}</span>}
            {day.short > 0 && <b className="ros-gap" data-kind="short"> −{day.short}<span className="sr-only"> short</span></b>}
            {day.over > 0 && <b className="ros-gap" data-kind="over"> +{day.over}<span className="sr-only"> over</span></b>}
          </span>
        )}
        {canEdit && (
          <button type="button" className="ros-add" aria-label={`Add shift on ${formatDate(day.date)}`} onClick={() => editor?.onAdd(locationId, day.date)}>
            <Icon name="plus" size={24} />
          </button>
        )}
      </header>
      {day.shifts.length > 0 ? (
        <ul className="ros-shifts">
          {day.shifts.map((s) => (
            <ShiftLine key={s.id} s={s} card fresh={fresh.has(s.id)} onEdit={canEdit ? () => editor?.onEdit(s.id) : undefined} onRequest={canAsk ? () => editor?.onRequest(s.id) : undefined} />
          ))}
        </ul>
      ) : (
        <span className="ros-none" data-drop={droppable || undefined}>{droppable ? "Drop here" : day.hasRoster ? "No shifts" : "No roster"}</span>
      )}
    </section>
  )
}

export function DayBoard({ block, today, view, firstWeekday, editor }: { block: ViewBlock; today: string; view: RosterViewKind; firstWeekday: number; editor?: DayEditor }) {
  const reduce = !!useReducedMotion()
  const [dragId, setDragId] = useState<string | null>(null)
  const [origin, setOrigin] = useState("50% 50%")
  const sensors = useDragSensors(moveBetweenTargets)
  const held = dragId ? block.days.flatMap((d) => d.shifts).find((x) => x.id === dragId) : undefined
  const dayName = (id: unknown) => formatDate(String(id))
  const who = (id: unknown) => block.days.flatMap((d) => d.shifts).find((x) => x.id === id)?.person || "Shift"
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up the shift of ${who(active.id)}. Use the arrow keys to choose a day, Space to drop.`,
    onDragOver: ({ active, over }) => (over ? `${who(active.id)} is over ${dayName(over.id)}.` : `${who(active.id)} is not over a day.`),
    onDragEnd: ({ active, over }) => (over ? `${who(active.id)} moved to ${dayName(over.id)}.` : `${who(active.id)} dropped, not moved.`),
    onDragCancel: ({ active }) => `Move cancelled. ${who(active.id)} stays on the same day.`,
  }
  const board = (
    <div className="ros-board" data-view={view}>
      {block.days.map((d, i) => (
        <div key={d.date} className="ros-cell" style={i === 0 && view === "month" ? { gridColumnStart: firstWeekday + 1 } : undefined}>
          <Day day={d} today={today} locationId={block.locationId} editor={editor} dragId={dragId} />
        </div>
      ))}
    </div>
  )
  if (!editor) return board
  const end = ({ active, over }: DragEndEvent) => {
    setDragId(null)
    if (over) editor.onMove(String(active.id), String(over.id))
  }
  return (
    <DndContext
      id={`ros-${block.locationId}`}
      sensors={sensors}
      collisionDetection={rectIntersection}
      accessibility={{ announcements }}
      onDragStart={({ active, activatorEvent }: DragStartEvent) => { setDragId(String(active.id)); setOrigin(originOf(activatorEvent, ".ros-scard")) }}
      onDragCancel={() => setDragId(null)}
      onDragEnd={end}
    >
      {board}
      <DragLayer show={!!held} reduce={reduce} className="ros-shift ros-scard" origin={origin}>
        {held && <Lines s={held} />}
      </DragLayer>
    </DndContext>
  )
}
