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
import { paginate } from "@/lib/paginate"
import { nowInTz } from "@/lib/dates"
import { clientsStore } from "../store"
import { CLIENT_STATUS, FILES_PAGE_SIZE, OPEN_TOAST } from "../types"
import type { ClientDocStatus, ClientFile } from "../types"

const STATUSES: { value: "all" | ClientDocStatus; label: string }[] = [
  { value: "all", label: "All statuses" },
  ...(Object.keys(CLIENT_STATUS) as ClientDocStatus[]).map((s) => ({ value: s, label: CLIENT_STATUS[s].label })),
]

export function ClientFiles({
  clients: seed,
  today,
  tz,
  tzLabel,
  actor,
  scopeKey,
}: {
  clients: ClientFile[]
  today: string
  tz: string
  tzLabel: string
  actor: string
  scopeKey: string
}) {
  const [clients, setClients] = clientsStore.useStore(seed, scopeKey)
  const dept = useDept()
  const [q, setQ] = useState("")
  const [status, setStatus] = useState<"all" | ClientDocStatus>("all")
  const [page, setPage] = useState(1)
  const [seenDept, setSeenDept] = useState(dept)
  const [openId, setOpenId] = useState<string>()
  const [sheetOpen, setSheetOpen] = useState(false)
  if (seenDept !== dept) {
    setSeenDept(dept)
    setPage(1)
  }

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return clients.filter(
      (c) =>
        (dept === "all" || c.dept === dept) &&
        (status === "all" || c.docStatus === status) &&
        (!s || [c.client, c.site, c.contractRef, ...c.contacts.map((p) => p.name)].some((v) => v.toLowerCase().includes(s))),
    )
  }, [clients, dept, status, q])
  const paged = paginate(rows, page, FILES_PAGE_SIZE)
  const current = clients.find((c) => c.id === openId)
  const local = status !== "all" || !!q
  const filtered = local || dept !== "all"
  const open = (c: ClientFile) => {
    const at = nowInTz(today, tz)
    setClients((prev) => prev.map((x) => (x.id === c.id ? { ...x, history: [...(x.history ?? []), { at, by: actor, action: "Opened secure link" }] } : x)))
    toast.success(OPEN_TOAST)
  }

  return (
    <>
      <FilterBar>
        <FilterSearch value={q} onChange={(v) => { setQ(v); setPage(1) }} placeholder="Search clients" />
        <FilterSelect label="Status" value={status} options={STATUSES} onChange={(v) => { setStatus(v); setPage(1) }} />
      </FilterBar>
      {rows.length > 0 ? (
        <>
          <div className="table-wrap">
            <table className="rtable files-table files-clients">
              <thead>
                <tr><th>Client</th><th>Contacts</th><th>Contract</th><th>Status</th><th>Outstanding</th><th><span className="sr-only">Actions</span></th></tr>
              </thead>
              <PagedBody page={paged.page}>
                {paged.rows.map((c) => (
                  <tr key={c.id}>
                    <td data-label="Client">
                      <button type="button" className="files-link tt" onClick={() => { setOpenId(c.id); setSheetOpen(true) }}>{c.client}</button>
                      <div className="tm">{c.site} · {c.dept}</div>
                    </td>
                    <td data-label="Contacts">{c.contacts.map((p) => p.name).join(", ")}</td>
                    <td data-label="Contract" className="num">{c.contractRef}</td>
                    <td data-label="Status"><StatusPill status={CLIENT_STATUS[c.docStatus]} /></td>
                    <td data-label="Outstanding">{c.outstanding.length ? `${c.outstanding.length} outstanding` : "None"}</td>
                    <td data-label="Actions">
                      <div className="files-actions">
                        <button type="button" className="btn btn-outline files-btn" onClick={() => open(c)}>Open file</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </PagedBody>
            </table>
          </div>
          <DataPagination page={paged.page} pageCount={paged.pageCount} total={paged.total} from={paged.from} to={paged.to} label="Client files pages" onPageChange={setPage} />
        </>
      ) : (
        <EmptyState
          icon="folder"
          title="No client files match"
          text={filtered ? (local ? "Try a different search or clear the filters." : "Nothing in this department. Change the department filter to see more.") : "No client files have been filed yet."}
          action={local ? <button type="button" className="btn btn-outline" onClick={() => { setQ(""); setStatus("all"); setPage(1) }}>Clear filters</button> : undefined}
        />
      )}

      <DetailSheet
        open={sheetOpen && !!current}
        onOpenChange={setSheetOpen}
        title={current?.client ?? "Client file"}
        subtitle={current && <StatusPill status={CLIENT_STATUS[current.docStatus]} />}
        footer={current && <div className="files-actions"><button type="button" className="btn btn-outline files-btn" onClick={() => open(current)}>Open file</button></div>}
      >
        {current && (
          <>
            <dl className="files-dl">
              <div><dt>Site</dt><dd>{current.site} · {current.dept}</dd></div>
              <div><dt>Contract reference</dt><dd className="num">{current.contractRef}</dd></div>
              <div><dt>Storage reference</dt><dd className="files-ref">{current.storageRef}</dd></div>
              <div><dt>Last updated</dt><dd><When iso={current.updated} today={today} tzLabel={tzLabel} /></dd></div>
            </dl>
            <section aria-labelledby="files-contacts-h">
              <h3 id="files-contacts-h" className="files-sub">Contacts</h3>
              <ul className="files-list">
                {current.contacts.map((p) => (
                  <li key={p.name}><strong>{p.name}</strong> · {p.role}<span className="files-when">{p.phone}</span></li>
                ))}
              </ul>
            </section>
            <section aria-labelledby="files-out-h">
              <h3 id="files-out-h" className="files-sub">Outstanding paperwork</h3>
              {current.outstanding.length ? (
                <ul className="files-list">{current.outstanding.map((o) => <li key={o}>{o}</li>)}</ul>
              ) : (
                <p className="files-none">Nothing outstanding.</p>
              )}
            </section>
            {!!current.history?.length && (
              <section aria-labelledby="files-chist-h">
                <h3 id="files-chist-h" className="files-sub">Access history</h3>
                <ol className="files-history">
                  {current.history.map((h, n) => (
                    <li key={`${h.at}-${n}`}>
                      <strong>{h.action}</strong> · {h.by}
                      <span className="files-when"><When iso={h.at} today={today} tzLabel={tzLabel} /></span>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </>
        )}
      </DetailSheet>
    </>
  )
}
