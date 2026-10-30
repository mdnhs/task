"use client"

import { useState } from "react"
import Link from "next/link"
import { AnimatePresence, Reorder } from "motion/react"
import { toast } from "sonner"

import { useDept } from "@/hooks/use-dept"
import { Icon } from "@/components/icons"
import { RollNumber } from "@/components/roll-number"
import { layoutTransition, listItem } from "@/lib/motion"
import type { ManagerAttentionData } from "../types"
import { DecideDialog, type Outcome } from "./decide-dialog"

type Item = ManagerAttentionData["items"][number]

const DONE: Record<Outcome, string> = { approved: "Approved", rejected: "Rejected", deferred: "Deferred" }

export function ManagerAttention({ data, canDecide }: { data: ManagerAttentionData; canDecide: boolean }) {
  const dep = useDept()
  // The manager drags items to set their own priority order; the department filter only hides rows.
  const [order, setOrder] = useState<Item[]>(data.items)
  const [dragging, setDragging] = useState<string | null>(null)
  const [deciding, setDeciding] = useState<Item | null>(null)
  const shown = (it: Item) => dep === "all" || it.dep === dep
  const visible = order.filter(shown)
  // Priority summary under the list: one tile per priority in the data (stable as items are decided or filtered out).
  const tiers = data.items.reduce<{ label: string; tone: string }[]>((a, it) => (a.some((t) => t.label === it.status.label) ? a : [...a, it.status]), [])

  // Put the new visible order back into the slots those items hold in the full list.
  function reorder(next: Item[]) {
    let k = 0
    setOrder((prev) => prev.map((it) => (shown(it) ? next[k++] : it)))
  }

  // Mock: the decided item leaves this list; the record itself belongs to /manager-attention.
  function decide(outcome: Outcome) {
    if (!deciding) return
    const title = deciding.title
    setOrder((prev) => prev.filter((it) => it.title !== title))
    toast.success(`${DONE[outcome]}: ${title}`)
  }

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>{data.title}</h2>
          <div className="sub">{data.subtitle}</div>
        </div>
        <Link href="/manager-attention" className="pill-btn">
          <Icon name="flag" />
          View queue
        </Link>
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
                {canDecide && (
                  <button type="button" className="mini-btn" onClick={() => setDeciding(it)}>Decide</button>
                )}
              </div>
            </Reorder.Item>
          ))}
        </AnimatePresence>
      </Reorder.Group>
      {visible.length === 0 && <div className="sub attention-empty">Nothing waiting for a decision.</div>}
      <div className="att-sum">
        {tiers.map((t) => (
          <div key={t.label} className="att-tile">
            <TierCount tone={t.tone} n={visible.filter((it) => it.status.label === t.label).length} />
            <span>{t.label}</span>
          </div>
        ))}
      </div>
      <DecideDialog item={deciding} onClose={() => setDeciding(null)} onDecide={decide} />
    </div>
  )
}

// Live count: rolls down when an item is decided, up or down when the department filter changes (ui-rules.md rule 13).
function TierCount({ tone, n }: { tone: string; n: number }) {
  // Previous value kept in state (React's "adjust state on prop change" pattern), so no ref is read during render.
  const [prev, setPrev] = useState(n)
  const [dir, setDir] = useState<"up" | "down">("up")
  if (n !== prev) {
    setPrev(n)
    setDir(n < prev ? "down" : "up")
  }
  return <b className={`num ${tone}`}><RollNumber value={String(n)} dir={dir} /></b>
}
