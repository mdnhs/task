"use client"

import { useMemo, useState } from "react"
import { toast } from "sonner"

import { CountUp } from "@/components/count-up"
import { DataPagination } from "@/components/data-pagination"
import { EmptyState } from "@/components/empty-state"
import { FilterBar, FilterSearch, FilterSelect, FilterSeg } from "@/components/filter-bar"
import { Icon } from "@/components/icons"
import { PageHead } from "@/components/page-head"
import { useDept } from "@/hooks/use-dept"
import { nowInTz } from "@/lib/dates"
import { paginate } from "@/lib/paginate"
import { byStage, changeStage, moveCandidate, newCandidate, nextId, recruitmentCounts } from "../mutations"
import { candidatesStore } from "../store"
import { RECRUITMENT_PAGE_SIZE, STAGE, STAGE_ORDER } from "../types"
import type { Candidate, Stage, View } from "../types"
import { AddCandidateDialog } from "./add-candidate-dialog"
import type { NewCandidateInput } from "./add-candidate-dialog"
import { CandidateSheet } from "./candidate-sheet"
import { CandidateTable } from "./candidate-table"
import { Pipeline } from "./pipeline"

const VIEWS: { value: View; label: string }[] = [
  { value: "pipeline", label: "Pipeline" },
  { value: "list", label: "List" },
]
const STAGES = [{ value: "all", label: "All stages" }, ...STAGE_ORDER.map((s) => ({ value: s as string, label: STAGE[s].label }))]

const STATS = [
  { key: "reviewed", title: "Reviewed", note: "Applications reviewed", icon: "report" },
  { key: "contacted", title: "Contacted", note: "Candidates contacted", icon: "phone" },
  { key: "interviews", title: "Interviews", note: "Interviews arranged", icon: "chat" },
  { key: "starters", title: "New starters", note: "Joined or joining", icon: "userplus" },
  { key: "outstanding", title: "Outstanding", note: "Still in the pipeline", icon: "flag" },
] as const

export function RecruitmentView({
  candidates,
  owners,
  departments,
  today,
  tz,
  tzLabel,
  canWrite,
  actor,
  scopeKey,
}: {
  candidates: Candidate[]
  owners: string[]
  departments: string[]
  today: string
  /** IANA timezone from the org settings; stamps history entries. */
  tz: string
  tzLabel: string
  canWrite: boolean
  /** Name of the signed-in user; stamped on every history entry. */
  actor: string
  /** Names what `candidates` was scoped for (tenant + whether contact details are included). */
  scopeKey: string
}) {
  const dept = useDept()
  const [stored, setStored] = candidatesStore.useStore(candidates, scopeKey)
  const [view, setView] = useState<View>("pipeline")
  const [q, setQ] = useState("")
  const [owner, setOwner] = useState("all")
  const [stage, setStage] = useState("all")
  const [page, setPage] = useState(1)
  const [seenDept, setSeenDept] = useState(dept)
  const [openId, setOpenId] = useState<string>()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  if (seenDept !== dept) {
    setSeenDept(dept)
    setPage(1)
  }

  const scoped = useMemo(() => stored.filter((c) => dept === "all" || c.dept === dept), [stored, dept])
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return scoped.filter(
      (c) =>
        (owner === "all" || c.owner === owner) &&
        (view === "pipeline" || stage === "all" || c.stage === stage) &&
        (!needle || [c.name, c.role, c.id, c.nextAction].some((s) => s.toLowerCase().includes(needle))),
    )
  }, [scoped, owner, stage, q, view])
  const counts = recruitmentCounts(scoped)
  const groups = useMemo(() => byStage(rows), [rows])
  const paged = paginate(rows, page, RECRUITMENT_PAGE_SIZE)
  const current = stored.find((c) => c.id === openId)
  const filtered = !!q || owner !== "all" || (view === "list" && stage !== "all") || dept !== "all"

  const open = (id: string) => {
    setOpenId(id)
    setSheetOpen(true)
  }

  function onStage(id: string, next: Stage) {
    const c = stored.find((x) => x.id === id)
    if (!c || c.stage === next || !canWrite) return
    const at = nowInTz(today, tz)
    setStored((prev) => prev.map((x) => (x.id === id ? changeStage(x, next, actor, at) : x)))
    toast.success(`${c.name} moved to ${STAGE[next].label}`)
  }

  // Drag-and-drop: same mutation as the sheet's stage select (history entry), same toast; same-column drops only reorder.
  function onMove(id: string, next: Stage, overId: string | null) {
    const c = stored.find((x) => x.id === id)
    if (!c || !canWrite) return
    const at = nowInTz(today, tz)
    setStored((prev) => moveCandidate(prev, id, next, overId, actor, at))
    if (c.stage !== next) toast.success(`${c.name} moved to ${STAGE[next].label}`)
  }

  function onAdd(input: NewCandidateInput) {
    const at = nowInTz(today, tz)
    const c = newCandidate(input, nextId(stored), actor, at)
    setStored((prev) => [c, ...prev])
    setPage(1)
    toast.success(`${c.name} added as ${c.id}`)
  }

  return (
    <>
      <PageHead
        title="Recruitment"
        subtitle={`${rows.length} of ${scoped.length} candidates`}
        actions={
          canWrite && (
            <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
              <Icon name="plus" />
              Add candidate
            </button>
          )
        }
      />
      <section className="stats rec-stats" aria-label="Recruitment summary">
        {STATS.map((s, i) => (
          <article key={s.key} className="stat">
            <div className="stat-top">
              <h3>{s.title}</h3>
              <span className="arrow" aria-hidden="true"><Icon name={s.icon} /></span>
            </div>
            <div className="value num"><CountUp value={String(counts[s.key])} delay={0.1 + i * 0.04} /></div>
            <div className="note">{s.note}</div>
          </article>
        ))}
      </section>
      <div className="card rec-card-wrap">
        <FilterBar>
          <FilterSeg label="View" value={view} options={VIEWS} onChange={(v) => { setView(v); setPage(1) }} />
          <FilterSearch value={q} onChange={(v) => { setQ(v); setPage(1) }} placeholder="Search candidates" />
          <FilterSelect label="Owner" value={owner} options={[{ value: "all", label: "All owners" }, ...owners.map((o) => ({ value: o, label: o }))]} onChange={(v) => { setOwner(v); setPage(1) }} />
          {view === "list" && <FilterSelect label="Stage" value={stage} options={STAGES} onChange={(v) => { setStage(v); setPage(1) }} />}
        </FilterBar>
        {rows.length === 0 ? (
          <EmptyState
            icon="userplus"
            title="No candidates match"
            text={filtered ? "Try a different search or clear the filters." : "There are no candidates yet."}
            action={
              filtered && (q || owner !== "all" || stage !== "all") ? (
                <button type="button" className="btn btn-outline" onClick={() => { setQ(""); setOwner("all"); setStage("all"); setPage(1) }}>
                  Clear filters
                </button>
              ) : undefined
            }
          />
        ) : view === "pipeline" ? (
          <Pipeline groups={groups} canDrag={canWrite} onOpen={open} onMove={onMove} />
        ) : (
          <>
            <CandidateTable rows={paged.rows} page={paged.page} today={today} tzLabel={tzLabel} onOpen={open} />
            <DataPagination page={paged.page} pageCount={paged.pageCount} total={paged.total} from={paged.from} to={paged.to} label="Candidates pages" onPageChange={setPage} />
          </>
        )}
      </div>
      <CandidateSheet candidate={current} open={sheetOpen} onOpenChange={setSheetOpen} today={today} tzLabel={tzLabel} canWrite={canWrite} onStage={onStage} />
      {canWrite && <AddCandidateDialog open={adding} onOpenChange={setAdding} departments={departments} owners={owners} defaultDept={dept !== "all" ? dept : (departments[0] ?? "")} onAdd={onAdd} />}
    </>
  )
}
