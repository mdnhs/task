"use client"

import { useMemo, useState } from "react"
import { toast } from "sonner"

import { DataPagination, PagedBody } from "@/components/data-pagination"
import { DetailSheet } from "@/components/detail-sheet"
import { EmptyState } from "@/components/empty-state"
import { FilterBar, FilterSearch, FilterSelect } from "@/components/filter-bar"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import { useDept } from "@/hooks/use-dept"
import { nowInTz } from "@/lib/dates"
import { paginate } from "@/lib/paginate"
import { expiryLabel, statusAfterConfirm } from "../expiry"
import { docsStore } from "../store"
import { DOC_STATUS, FILES_PAGE_SIZE, OPEN_TOAST } from "../types"
import type { DocStatus, EmployeeDoc } from "../types"

const STATUSES: { value: "all" | DocStatus; label: string }[] = [
  { value: "all", label: "All statuses" },
  ...(Object.keys(DOC_STATUS) as DocStatus[]).map((s) => ({ value: s, label: DOC_STATUS[s].label })),
]

export function EmployeeDocs({
  documents,
  today,
  tz,
  tzLabel,
  canWrite,
  actor,
  scopeKey,
}: {
  documents: EmployeeDoc[]
  today: string
  tz: string
  tzLabel: string
  canWrite: boolean
  actor: string
  scopeKey: string
}) {
  const [stored, setStored] = docsStore.useStore(documents, scopeKey)
  const dept = useDept()
  const [q, setQ] = useState("")
  const [status, setStatus] = useState<"all" | DocStatus>("all")
  const [type, setType] = useState("all")
  const [page, setPage] = useState(1)
  const [seenDept, setSeenDept] = useState(dept)
  const [openId, setOpenId] = useState<string>()
  const [sheetOpen, setSheetOpen] = useState(false)
  if (seenDept !== dept) {
    setSeenDept(dept)
    setPage(1)
  }

  const types = useMemo(() => [...new Set(stored.map((d) => d.type))].sort(), [stored])
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return stored.filter(
      (d) =>
        (dept === "all" || d.dept === dept) &&
        (status === "all" || d.status === status) &&
        (type === "all" || d.type === type) &&
        (!s || [d.type, d.staff, d.id].some((v) => v.toLowerCase().includes(s))),
    )
  }, [stored, dept, status, type, q])
  const paged = paginate(rows, page, FILES_PAGE_SIZE)
  const current = stored.find((d) => d.id === openId)
  const local = status !== "all" || type !== "all" || !!q
  const filtered = local || dept !== "all"

  function update<K>(set: (v: K) => void, v: K) {
    set(v)
    setPage(1)
  }
  function openFile(d: EmployeeDoc) {
    const at = nowInTz(today, tz)
    setStored((prev) => prev.map((x) => (x.id === d.id ? { ...x, history: [...x.history, { at, by: actor, action: "Opened secure link" }] } : x)))
    toast.success(OPEN_TOAST)
  }
  function confirm(d: EmployeeDoc) {
    const at = nowInTz(today, tz)
    setStored((prev) =>
      prev.map((x) =>
        x.id === d.id ? { ...x, status: statusAfterConfirm(x.expiry, today), confirmedBy: actor, history: [...x.history, { at, by: actor, action: "Confirmed valid" }] } : x,
      ),
    )
    toast.success(`${d.type} confirmed valid: ${d.staff}`)
  }

  const actions = (d: EmployeeDoc) => (
    <>
      {d.storageRef && (
        <button type="button" className="btn btn-outline files-btn" onClick={() => openFile(d)}>
          Open file
        </button>
      )}
      {canWrite && d.status === "unverified" && (
        <button type="button" className="btn btn-primary files-btn" onClick={() => confirm(d)}>
          Confirm valid
        </button>
      )}
    </>
  )

  return (
    <>
      <FilterBar>
        <FilterSearch value={q} onChange={(v) => update(setQ, v)} placeholder="Search documents" />
        <FilterSelect label="Status" value={status} options={STATUSES} onChange={(v) => update(setStatus, v)} />
        <FilterSelect label="Type" value={type} options={[{ value: "all", label: "All types" }, ...types.map((t) => ({ value: t, label: t }))]} onChange={(v) => update(setType, v)} />
      </FilterBar>
      {rows.length > 0 ? (
        <>
          <div className="table-wrap">
            <table className="rtable files-table">
              <thead>
                <tr><th>Document</th><th>Dept</th><th>Received</th><th>Expiry</th><th>Status</th><th>Confirmed by</th><th><span className="sr-only">Actions</span></th></tr>
              </thead>
              <PagedBody page={paged.page}>
                  {paged.rows.map((d) => (
                    <tr key={d.id}>
                      <td data-label="Document">
                        <button type="button" className="files-link tt" onClick={() => { setOpenId(d.id); setSheetOpen(true) }}>{d.type}</button>
                        <div className="tm">{d.staff}</div>
                      </td>
                      <td data-label="Dept"><span className="dep-tag">{d.dept}</span></td>
                      <td data-label="Received" className="num">{d.received ? <When iso={d.received} today={today} tzLabel={tzLabel} mode="date" /> : "Not received"}</td>
                      <td data-label="Expiry" className="num">
                        {d.expiry ? (
                          <>
                            <When iso={d.expiry} today={today} tzLabel={tzLabel} mode="date" />
                            <div className="tm">{expiryLabel(d.expiry, today)}</div>
                          </>
                        ) : (
                          "No expiry"
                        )}
                      </td>
                      <td data-label="Status"><StatusPill status={DOC_STATUS[d.status]} /></td>
                      <td data-label="Confirmed by">{d.confirmedBy ?? "Not confirmed"}</td>
                      <td data-label="Actions"><div className="files-actions">{actions(d)}</div></td>
                    </tr>
                  ))}
              </PagedBody>
            </table>
          </div>
          <DataPagination page={paged.page} pageCount={paged.pageCount} total={paged.total} from={paged.from} to={paged.to} label="Employee documents pages" onPageChange={setPage} />
        </>
      ) : (
        <EmptyState
          icon="folder"
          title="No documents match"
          text={filtered ? (local ? "Try a different search or clear the filters." : "Nothing in this department. Change the department filter to see more.") : "No employee documents have been filed yet."}
          action={
            local ? (
              <button type="button" className="btn btn-outline" onClick={() => { setQ(""); setStatus("all"); setType("all"); setPage(1) }}>
                Clear filters
              </button>
            ) : undefined
          }
        />
      )}

      <DetailSheet
        open={sheetOpen && !!current}
        onOpenChange={setSheetOpen}
        title={current ? `${current.type} · ${current.staff}` : "Document"}
        subtitle={current && <StatusPill status={DOC_STATUS[current.status]} />}
        footer={current && <div className="files-actions">{actions(current)}</div>}
      >
        {current && (
          <>
            <dl className="files-dl">
              <div><dt>Employee</dt><dd>{current.staff} · {current.dept}</dd></div>
              <div><dt>Received</dt><dd>{current.received ? <When iso={current.received} today={today} tzLabel={tzLabel} mode="date" /> : "Not received"}</dd></div>
              <div><dt>Expiry</dt><dd>{current.expiry ? <><When iso={current.expiry} today={today} tzLabel={tzLabel} mode="date" /> · {expiryLabel(current.expiry, today)}</> : "No expiry"}</dd></div>
              <div><dt>Storage reference</dt><dd className="files-ref">{current.storageRef ?? "No file stored"}</dd></div>
              <div><dt>Confirmed by</dt><dd>{current.confirmedBy ?? "Not confirmed"}</dd></div>
            </dl>
            <section aria-labelledby="files-hist-h">
              <h3 id="files-hist-h" className="files-sub">History</h3>
              <ol className="files-history">
                {current.history.map((h, n) => (
                  <li key={`${h.at}-${n}`}>
                    <strong>{h.action}</strong> · {h.by}
                    <span className="files-when"><When iso={h.at} today={today} tzLabel={tzLabel} /></span>
                  </li>
                ))}
              </ol>
            </section>
          </>
        )}
      </DetailSheet>
    </>
  )
}
