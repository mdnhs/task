"use client"

import { useMemo, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  closestCorners,
  defaultDropAnimationSideEffects,
  useDndMonitor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import type { Announcements, DragEndEvent, DragOverEvent, DragStartEvent, DropAnimation } from "@dnd-kit/core"
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform, useVelocity } from "motion/react"

import { When } from "@/components/when"
import { STAGE, STAGE_ORDER } from "../types"
import type { Candidate, Stage } from "../types"

const COL = "col:"
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)"
// The overlay settles into the card's new slot; the slot fades back in underneath it.
const DROP: DropAnimation = {
  duration: 220,
  easing: EASE,
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: "0.4" } } }),
}

type Ids = Record<Stage, string[]>
const noop = () => () => {}

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

// The lifted card leans into the drag like a held sheet of paper: horizontal speed → tilt, pivoting on the grab point.
// When the pointer stops (or the card is dropped) the speed falls to 0 and the spring settles it upright.
function Lifted({ c, origin }: { c: Candidate; origin: string }) {
  const x = useMotionValue(0)
  const speed = useVelocity(x)
  const rotate = useSpring(useTransform(speed, [-1800, 0, 1800], [-10, 0, 10], { clamp: true }), { stiffness: 300, damping: 20, mass: 0.6 })
  useDndMonitor({ onDragMove: ({ delta }) => x.set(delta.x) })
  return (
    <motion.div className="rec-card rec-card-overlay" style={{ rotate, transformOrigin: origin }}>
      <CardBody c={c} />
    </motion.div>
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
    transition: calm ? null : { duration: 220, easing: EASE },
  })
  return (
    <button
      type="button"
      ref={setNodeRef}
      className="rec-card rec-card-drag"
      data-dragging={isDragging ? "" : undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
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
  const client = useSyncExternalStore(noop, () => true, () => false)
  const [activeId, setActiveId] = useState<string>()
  const [origin, setOrigin] = useState("50% 50%")
  // Column order while a card is held: the card joins the column it hovers, so the other cards slide aside for it.
  const [draft, setDraft] = useState<Ids>()
  // MouseSensor + TouchSensor (not PointerSensor): a touch-held card drags only after 200ms, so swiping scrolls the board.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    // Space lifts and drops; Enter stays "open the sheet".
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] } }),
  )
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
    const r = (ev.target as Element | null)?.closest(".rec-card")?.getBoundingClientRect()
    const p = ev instanceof MouseEvent ? ev : typeof TouchEvent !== "undefined" && ev instanceof TouchEvent ? ev.touches[0] : undefined
    setOrigin(r && p ? `${((p.clientX - r.left) / r.width) * 100}% ${((p.clientY - r.top) / r.height) * 100}%` : "50% 50%")
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
      {/* Portalled to <body>: an animated ancestor (page enter transform) would otherwise offset the fixed overlay from the pointer and skew collisions. */}
      {client && createPortal(
        <DragOverlay dropAnimation={reduce ? null : DROP}>
          {active && (reduce ? (
            <div className="rec-card rec-card-overlay">
              <CardBody c={active} />
            </div>
          ) : (
            <Lifted c={active} origin={origin} />
          ))}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  )
}
