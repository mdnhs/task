"use client"

import { useState } from "react"
import { AnimatePresence, Reorder } from "motion/react"

import { useDept } from "@/hooks/use-dept"
import { Icon } from "@/components/icons"
import { layoutTransition, listItem } from "@/lib/motion"
import type { ManagerAttentionData } from "../types"

type Item = ManagerAttentionData["items"][number]

export function ManagerAttention({ data }: { data: ManagerAttentionData }) {
  const dep = useDept()
  // The manager drags items to set their own priority order; the department filter only hides rows.
  const [order, setOrder] = useState<Item[]>(data.items)
  const [dragging, setDragging] = useState<string | null>(null)
  const shown = (it: Item) => dep === "all" || it.dep === dep
  const visible = order.filter(shown)

  // Put the new visible order back into the slots those items hold in the full list.
  function reorder(next: Item[]) {
    let k = 0
    setOrder((prev) => prev.map((it) => (shown(it) ? next[k++] : it)))
  }

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>{data.title}</h2>
          <div className="sub">{data.subtitle}</div>
        </div>
        <button className="pill-btn">
          <Icon name="flag" />
          View queue
        </button>
      </div>
      <Reorder.Group as="div" axis="y" values={visible} onReorder={reorder} className="list" id="attention">
        <AnimatePresence initial={false}>
          {visible.map((it) => (
            <Reorder.Item
              as="div"
              key={it.title}
              value={it}
              className="item od-drag"
              data-dragging={dragging === it.title || undefined}
              onDragStart={() => setDragging(it.title)}
              onDragEnd={() => setDragging(null)}
              {...listItem}
              transition={layoutTransition}
            >
              <span className={`kind ${it.kind}`}><Icon name={it.icon} /></span>
              <div>
                <div className="t">{it.title}</div>
                <div className="m">Raised by <b>{it.by}</b> · {it.note}</div>
              </div>
              <div className="r">
                <span className={`st ${it.status.tone}`}>{it.status.label}</span>
                <button className="mini-btn">Decide</button>
              </div>
            </Reorder.Item>
          ))}
        </AnimatePresence>
      </Reorder.Group>
    </div>
  )
}
