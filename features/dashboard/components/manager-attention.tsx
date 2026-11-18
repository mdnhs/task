"use client"

import { useState } from "react"
import Link from "next/link"
import { AnimatePresence, Reorder } from "motion/react"

import { Icon } from "@/components/icon"
import { RollNumber } from "@/components/roll-number"
import { layoutTransition, listItem } from "@/lib/motion"
import type { AttentionRow, ManagerAttentionData } from "../types"

/**
 * The FR-M1-79 feed (GET /v1/attention): what needs a manager now (overdue, blocked, evidence waiting, reports missing or returned), in the API's order, each opening its task or report. The API
 * derives it from the tasks and reports in the caller's scope; it has no department on a row, so the topbar department filter does not narrow it. The manager can still drag rows to set their own
 * priority order (this view only). The decide-and-carry-forward queue is the mock /manager-attention page (G1).
 */
export function ManagerAttention({ data, queue = false }: { data: ManagerAttentionData; /** The mock /manager-attention queue exists only on a demo deployment (ENABLE_MOCK_MODULES, J2): no link otherwise. */ queue?: boolean }) {
  const [base, setBase] = useState(data.items)
  const [order, setOrder] = useState<AttentionRow[]>(data.items)
  const [dragging, setDragging] = useState<string | null>(null)
  // a fresh server answer replaces the order
  if (base !== data.items) {
    setBase(data.items)
    setOrder(data.items)
  }
  const idOf = (it: AttentionRow) => `${it.href}:${it.status.label}`
  const tiers = data.items.reduce<{ label: string; tone: string }[]>((a, it) => (a.some((t) => t.label === it.status.label) ? a : [...a, it.status]), [])
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>{data.title}</h2>
          <div className="sub">{data.subtitle}</div>
        </div>
        {queue && (
          <Link href="/manager-attention" className="pill-btn">
            <Icon name="flag" />
            View queue
          </Link>
        )}
      </div>
      <Reorder.Group as="div" axis="y" values={order} onReorder={setOrder} className="list" id="attention">
        <AnimatePresence initial={false}>
          {order.map((it) => (
            <Reorder.Item
              as="div"
              key={idOf(it)}
              value={it}
              className="item od-drag"
              data-dragging={dragging === idOf(it) || undefined}
              onDragStart={() => setDragging(idOf(it))}
              onDragEnd={() => setDragging(null)}
              {...listItem}
              transition={layoutTransition}
            >
              <span className={`kind ${it.kind}`}><Icon name={it.icon} /></span>
              <div>
                <div className="t">{it.title}</div>
                <div className="m">Owner <b>{it.by}</b> · {it.note}</div>
              </div>
              <div className="r">
                <span className={`st ${it.status.tone}`}>{it.status.label}</span>
                <Link href={it.href} className="mini-btn">Open</Link>
              </div>
            </Reorder.Item>
          ))}
        </AnimatePresence>
      </Reorder.Group>
      {order.length === 0 && <div className="sub attention-empty">Nothing needs you right now.</div>}
      <div className="att-sum">
        {tiers.map((t) => (
          <div key={t.label} className="att-tile">
            <b className={`num ${t.tone}`}><RollNumber value={String(order.filter((it) => it.status.label === t.label).length)} dir="up" /></b>
            <span>{t.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
