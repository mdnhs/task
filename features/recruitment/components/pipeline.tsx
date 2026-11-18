"use client"

import { useMemo, useRef, useState } from "react"
import {
  DndContext,
  MeasuringStrategy,
  closestCorners,
  useDroppable,
} from "@dnd-kit/core"
import type { Announcements, DragEndEvent, DragOverEvent, DragStartEvent } from "@dnd-kit/core"
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"

import { cssZoom, unzoom } from "@/lib/zoom"
import { DRAG_SLIDE, DragLayer, originOf, useDragSensors } from "@/lib/drag-card"
import { useReducedMotion } from "motion/react"

import { When } from "@/components/when"
import { STAGE, STAGE_ORDER } from "../types"
import type { Candidate, Stage } from "../types"

const COL = "col:"
type Ids = Record<Stage, string[]>
function CardBody({ c }: { c: Candidate }) {
  return (
    <>
      <span className="rec-card-name">{c.name}</span>
      <span className="rec-card-role">{c.role} · {c.dept}</span>
      <span className="rec-card-next"><b>Next:</b> {c.nextAction}</span>
      <span className="rec-card-foot">
        <span className="rec-card-owner">{c.owner}</span>
        <span className="rec-card-when">{c.lastContact ? <When iso={c.lastContact} today="" tzLabel="" mode="date" /> : "No contact"}</span>
      </span>
    </>
  )
}

// Read-only roles get a plain button: no sortable hook, no listeners, default cursor.
function StaticCard({ c, onOpen }: { c: Candidate; onOpen(id: string): void }) {
  return (
    <button type="button" className="rec-card" onClick={() => onOpen(c.id)}>
      <CardBody c={c} />
    </button>
  )
}

function DragCard({ c, calm, onOpen }: { c: Candidate; calm: boolean; onOpen(id: string): void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: c.id,
    transition: calm ? null : DRAG_SLIDE,
  })
  return (
    <button
      type="button"
      ref={setNodeRef}
      className="rec-card dnd-card"
      data-dragging={isDragging ? "" : undefined}
      style={{ transform: CSS.Translate.toString(transform && { ...transform, x: unzoom(transform.x, cssZoom(document.body)), y: unzoom(transform.y, cssZoom(document.body)) }), transition }}
      onClick={() => onOpen(c.id)}
      {...attributes}
      {...listeners}
    >
      <CardBody c={c} />
    </button>
  )
}

function Column({ stage, items, canDrag, calm, over, onOpen }: { stage: Stage; items: Candidate[]; canDrag: boolean; calm: boolean; over: boolean; onOpen(id: string): void }) {
  const { setNodeRef } = useDroppable({ id: COL + stage, disabled: !canDrag })
  return (
    <section className="rec-col" aria-label={`${STAGE[stage].label}, ${items.length} candidates`} data-over={over ? "" : undefined}>
      <header className="rec-col-head">
        <h3>{STAGE[stage].label}</h3>
        <span className="rec-col-n num">{items.length}</span>
      </header>
      <ul className="rec-col-body" ref={canDrag ? setNodeRef : undefined}>
        {items.length === 0 && <li className="rec-col-empty">No candidates</li>}
        {items.map((c) => (
          <li key={c.id}>{canDrag ? <DragCard c={c} calm={calm} onOpen={onOpen} /> : <StaticCard c={c} onOpen={onOpen} />}</li>
        ))}
      </ul>
    </section>
  )
}

// Horizontal stage columns. The board scrolls sideways inside its card (never the page); each column scrolls on its own
// when it holds more cards than fit. With write access, cards drag between columns (or reorder within one); the sheet's stage select stays the non-drag way.
export function Pipeline({
  groups,
  canDrag,
  onOpen,
  onMove,
}: {
  groups: Record<Stage, Candidate[]>
  canDrag: boolean
  onOpen(id: string): void
  onMove(id: string, stage: Stage, overId: string | null): void
}) {
  const reduce = !!useReducedMotion()
  const [activeId, setActiveId] = useState<string>()
  const [origin, setOrigin] = useState("50% 50%")
  // Column order while a card is held: the card joins the column it hovers, so the other cards slide aside for it.
  const [draft, setDraft] = useState<Ids>()
  const sensors = useDragSensors(sortableKeyboardCoordinates)
  const all = STAGE_ORDER.flatMap((s) => groups[s])
  const byId = (id: unknown) => all.find((c) => c.id === id)
  const stageOf = (id: unknown): Stage | undefined => {
    const k = String(id)
    return k.startsWith(COL) ? (k.slice(COL.length) as Stage) : byId(k)?.stage
  }
  const active = byId(activeId)

  const announcements: Announcements = {
    onDragStart: ({ active: a }) => `Picked up ${byId(a.id)?.name ?? "candidate"} from ${STAGE[stageOf(a.id) ?? "applied"].label}.`,
    onDragOver: ({ active: a, over }) => (over ? `${byId(a.id)?.name} is over ${STAGE[stageOf(over.id) ?? "applied"].label}.` : `${byId(a.id)?.name} is not over a column.`),
    onDragEnd: ({ active: a, over }) => (over ? `${byId(a.id)?.name} dropped in ${STAGE[stageOf(over.id) ?? "applied"].label}.` : `${byId(a.id)?.name} dropped outside the board.`),
    onDragCancel: ({ active: a }) => `Move cancelled. ${byId(a.id)?.name} stays in ${STAGE[stageOf(a.id) ?? "applied"].label}.`,
  }

  const base = useMemo(() => Object.fromEntries(STAGE_ORDER.map((s) => [s, groups[s].map((c) => c.id)])) as Ids, [groups])
  const ids = draft ?? base
  // Set for one frame after a card changes column: the shifted layout re-fires onDragOver and would bounce the card back (update loop).
  const settling = useRef(false)
  const columnOf = (id: unknown): Stage | undefined => {
    const k = String(id)
    return k.startsWith(COL) ? (k.slice(COL.length) as Stage) : STAGE_ORDER.find((s) => ids[s].includes(k))
  }
  const heldIn = activeId ? columnOf(activeId) : undefined

  const clear = () => {
    setActiveId(undefined)
    setDraft(undefined)
  }

  function onDragStart({ active: a, activatorEvent: ev }: DragStartEvent) {
    setActiveId(String(a.id))
    // Pivot the tilt on the grab point (keyboard lifts pivot on the centre).
    setOrigin(originOf(ev, ".rec-card"))
  }

  function onDragOver({ active: a, over }: DragOverEvent) {
    if (!over || settling.current) return
    const from = columnOf(a.id)
    const to = columnOf(over.id)
    if (!from || !to || from === to) return
    // Crossing into another column: drop the card in at the hovered card's slot (or at the end when over the column itself).
    const id = String(a.id)
    const target = ids[to]
    const at = target.indexOf(String(over.id))
    const below = at >= 0 && a.rect.current.translated && a.rect.current.translated.top > over.rect.top + over.rect.height / 2
    const index = at < 0 ? target.length : at + (below ? 1 : 0)
    settling.current = true
    requestAnimationFrame(() => (settling.current = false))
    setDraft({ ...ids, [from]: ids[from].filter((x) => x !== id), [to]: [...target.slice(0, index), id, ...target.slice(index)] })
  }

  function onDragEnd({ active: a, over }: DragEndEvent) {
    const id = String(a.id)
    const stage = columnOf(id)
    const origin = byId(id)?.stage
    if (!over || !stage || !origin) return clear()
    let list = ids[stage]
    const overAt = list.indexOf(String(over.id))
    if (overAt >= 0 && String(over.id) !== id) list = arrayMove(list, list.indexOf(id), overAt)
    const i = list.indexOf(id)
    const was = groups[origin].findIndex((c) => c.id === id)
    // Translate the final slot into moveCandidate's anchor: same column moving down lands after the card above, otherwise before the card below.
    if (stage === origin) {
      if (i !== was) onMove(id, stage, i > was ? list[i - 1] : list[i + 1])
    } else onMove(id, stage, list[i + 1] ?? null)
    clear()
  }

  const board = (
    <div className="rec-board" role="group" aria-label="Recruitment pipeline">
      {STAGE_ORDER.map((s) => {
        const items = ids[s].map((id) => byId(id)).filter((c): c is Candidate => !!c)
        return (
          <SortableContext key={s} items={ids[s]} strategy={verticalListSortingStrategy} disabled={!canDrag}>
            <Column stage={s} items={items} canDrag={canDrag} calm={reduce} over={heldIn === s && stageOf(activeId) !== s} onOpen={onOpen} />
          </SortableContext>
        )
      })}
    </div>
  )
  if (!canDrag) return board

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      accessibility={{ announcements }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragCancel={clear}
      onDragEnd={onDragEnd}
    >
      {board}
      <DragLayer show={!!active} reduce={reduce} className="rec-card" origin={origin}>
        {active && <CardBody c={active} />}
      </DragLayer>
    </DndContext>
  )
}
