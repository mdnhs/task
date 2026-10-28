"use client"

import { useMemo, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { toast } from "sonner"

import { DetailSheet } from "@/components/detail-sheet"
import { EmptyState } from "@/components/empty-state"
import { FilterBar, FilterSeg } from "@/components/filter-bar"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import { useDept } from "@/hooks/use-dept"
import { nowInTz } from "@/lib/dates"
import { listItem } from "@/lib/motion"
import { attentionStore } from "../store"
import { ATTENTION_STATUS, OUTCOME, SOURCE, URGENCY, URGENCY_RANK } from "../types"
import type { AttentionItem, Outcome } from "../types"
import { DecisionDialog } from "./decision-dialog"

type Filter = "open" | "decided" | "all"
const FILTERS: { value: Filter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "decided", label: "Decided" },
  { value: "all", label: "All" },
]

const byUrgency = (a: AttentionItem, b: AttentionItem) => URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] || a.due.localeCompare(b.due)

export function AttentionList({
  items,
  today,
  tz,
  tzLabel,
  canDecide,
  actor,
  scopeKey,
}: {
  items: AttentionItem[]
  today: string
  tz: string
  tzLabel: string
  canDecide: boolean
  /** Name of the signed-in user; stamped on every decision and history entry. */
  actor: string
  scopeKey: string
}) {
  const [stored, setStored] = attentionStore.useStore(items, scopeKey)
  const dept = useDept()
  const [filter, setFilter] = useState<Filter>("open")
  const [openId, setOpenId] = useState<string>()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [deciding, setDeciding] = useState(false)

  const rows = useMemo(
    () =>
      stored
        .filter((i) => (dept === "all" || i.dept === dept) && (filter === "all" || (filter === "open" ? i.status === "open" : i.status !== "open")))
        .sort(byUrgency),
    [stored, dept, filter],
  )
  const current = stored.find((i) => i.id === openId)
  const openCount = stored.filter((i) => i.status === "open" && (dept === "all" || i.dept === dept)).length

  function decide(id: string, outcome: Outcome, note: string) {
    const at = nowInTz(today, tz)
    setStored((prev) =>
      prev.map((i) =>
        i.id === id
          ? { ...i, status: outcome === "deferred" ? i.status : "decided", decisionRecord: { by: actor, at, outcome, note }, history: [...i.history, { at, by: actor, action: OUTCOME[outcome], note }] }
          : i,
      ),
    )
    toast.success(`${OUTCOME[outcome]}: ${stored.find((i) => i.id === id)?.title ?? id}`)
  }

  return (
    <section className="card att-card" aria-labelledby="att-h">
      <div className="card-head">
        <div>
          <h2 id="att-h">Needs your decision</h2>
          <div className="sub">{openCount} awaiting a decision</div>
        </div>
      </div>
      <FilterBar>
        <FilterSeg label="Show" value={filter} options={FILTERS} onChange={(v) => setFilter(v as Filter)} />
      </FilterBar>
      {rows.length > 0 ? (
        <ul className="att-list">
          <AnimatePresence initial={false}>
            {rows.map((i) => (
              <motion.li key={i.id} layout="position" {...listItem}>
                <button
                  type="button"
                  className="att-row"
                  onClick={() => {
                    setOpenId(i.id)
                    setSheetOpen(true)
                  }}
                >
                  <span className="att-main">
                    <span className="att-top">
                      <StatusPill status={URGENCY[i.urgency]} />
                      <span className="att-title">{i.title}</span>
                    </span>
                    <span className="att-sum">{i.summary}</span>
                    <span className="att-ask"><b>Decision:</b> {i.decision}</span>
                  </span>
                  <span className="att-meta">
                    <span className="att-owner">{i.owner}<span className="att-dept"> · {i.dept}</span></span>
                    <span className="att-due">Due <When iso={i.due} today={today} tzLabel={tzLabel} /></span>
                    <StatusPill status={ATTENTION_STATUS[i.status]} />
                  </span>
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      ) : (
        <EmptyState
          icon="flag"
          title={filter === "open" ? "Nothing needs your decision" : "No items to show"}
          text={filter === "open" ? "New items from reports, tasks and clients will appear here." : "Try another filter or department."}
        />
      )}

      <DetailSheet
        open={sheetOpen && !!current}
        onOpenChange={setSheetOpen}
        title={current?.title ?? "Attention item"}
        subtitle={current && <span className="att-sheet-pills"><StatusPill status={URGENCY[current.urgency]} /><StatusPill status={ATTENTION_STATUS[current.status]} /></span>}
        footer={
          current && canDecide && current.status === "open" ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setSheetOpen(false)
                setDeciding(true)
              }}
            >
              Record decision
            </button>
          ) : undefined
        }
      >
        {current && (
          <>
            <dl className="att-dl">
              <div><dt>Summary</dt><dd>{current.summary}</dd></div>
              <div><dt>Impact</dt><dd>{current.impact}</dd></div>
              <div><dt>Requested decision</dt><dd>{current.decision}</dd></div>
              <div><dt>Owner</dt><dd>{current.owner} · {current.dept}</dd></div>
              <div><dt>Source</dt><dd>{SOURCE[current.source]}</dd></div>
              <div><dt>Due</dt><dd><When iso={current.due} today={today} tzLabel={tzLabel} /></dd></div>
              {current.decisionRecord && (
                <div>
                  <dt>Decision</dt>
                  <dd>
                    <strong>{OUTCOME[current.decisionRecord.outcome]}</strong> by {current.decisionRecord.by},{" "}
                    <When iso={current.decisionRecord.at} today={today} tzLabel={tzLabel} />
                    <span className="att-note">{current.decisionRecord.note}</span>
                  </dd>
                </div>
              )}
            </dl>
            <section aria-labelledby="att-hist-h">
              <h3 id="att-hist-h" className="att-sub">History</h3>
              <ol className="att-history">
                {current.history.map((h, n) => (
                  <li key={`${h.at}-${n}`}>
                    <strong>{h.action}</strong> · {h.by}
                    <span className="att-when"><When iso={h.at} today={today} tzLabel={tzLabel} /></span>
                    {h.note && <span className="att-note">{h.note}</span>}
                  </li>
                ))}
              </ol>
            </section>
          </>
        )}
      </DetailSheet>
      <DecisionDialog item={current} open={deciding} onOpenChange={setDeciding} onDecide={decide} />
    </section>
  )
}
