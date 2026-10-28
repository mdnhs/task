"use client"

import { useCallback, useMemo, useState } from "react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { DataPagination, PagedBody } from "@/components/data-pagination"
import { EmptyState } from "@/components/empty-state"
import { FilterBar, FilterSearch, FilterSelect } from "@/components/filter-bar"
import { Icon } from "@/components/icons"
import { PageHead } from "@/components/page-head"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import { paginate } from "@/lib/paginate"
import { SUPPORT_PAGE_SIZE } from "../constants"
import { auditEntry, effectiveStatus, nowIso } from "../logic"
import { usePlatform } from "../store"
import { REQUEST_STATUS } from "../types"
import type { PlatformSeed, RequestStatus, SupportRequest } from "../types"
import { AuditList } from "./audit-list"
import { Countdown } from "./countdown"
import { useOrgNow } from "./clock"
import { RequestDialog } from "./request-dialog"

const STATUS_OPTIONS: { value: "all" | RequestStatus; label: string }[] = [
  { value: "all", label: "All statuses" },
  ...(Object.keys(REQUEST_STATUS) as RequestStatus[]).map((s) => ({ value: s, label: REQUEST_STATUS[s].label })),
]

export function SupportView({ seed, today, tz, tzLabel, actor }: { seed: PlatformSeed; today: string; tz: string; tzLabel: string; actor: string }) {
  const { tenants, requests, setRequests, audit, setAudit } = usePlatform(seed)
  const now = useOrgNow(today, tz)
  const [q, setQ] = useState("")
  const [status, setStatus] = useState<"all" | RequestStatus>("all")
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const [viewing, setViewing] = useState<SupportRequest | undefined>()
  const [revoking, setRevoking] = useState<SupportRequest | undefined>()

  const names = useMemo(() => new Map(tenants.map((t) => [t.id, t.name])), [tenants])
  const eff = useCallback((r: SupportRequest): RequestStatus => (now === null ? r.status : effectiveStatus(r, now)), [now])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return requests.filter(
      (r) =>
        (status === "all" || eff(r) === status) &&
        (!needle || [r.id, r.reason, r.requester, names.get(r.tenantId) ?? ""].some((s) => s.toLowerCase().includes(needle))),
    )
  }, [requests, q, status, names, eff])
  const paged = paginate(rows, page, SUPPORT_PAGE_SIZE)
  const filtered = q !== "" || status !== "all"

  function record(action: string, r: SupportRequest, detail: string) {
    const at = nowIso(today)
    setAudit((all) => [auditEntry(all, at, actor, action, names.get(r.tenantId) ?? r.tenantId, detail), ...all])
  }

  function startSession(r: SupportRequest) {
    record("support.session_started", r, `Support session started under ${r.id}`)
    toast.success(`Support session started for ${names.get(r.tenantId)}. It is being audited.`)
  }

  function revoke(r: SupportRequest) {
    setRequests((all) => all.map((x) => (x.id === r.id ? { ...x, status: "revoked" } : x)))
    record("support.revoked", r, `Support access ${r.id} revoked by a platform administrator`)
    toast.success(`Access ${r.id} revoked`)
  }

  return (
    <>
      <PageHead
        title="Support access"
        subtitle="Tenant data stays hidden until the tenant grants time-limited access"
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" />
            Request access
          </button>
        }
      />
      <div className="card pf-card">
        <FilterBar>
          <FilterSearch value={q} onChange={(v) => { setQ(v); setPage(1) }} placeholder="Search requests" />
          <FilterSelect label="Status" value={status} options={STATUS_OPTIONS} onChange={(v) => { setStatus(v); setPage(1) }} />
        </FilterBar>
        {rows.length > 0 ? (
          <>
            <div className="table-wrap">
              <table className="rtable pf-table pf-support">
                <thead>
                  <tr><th>Request</th><th>Tenant</th><th>Requester</th><th>Reason</th><th>Status</th><th>Expires</th><th><span className="sr-only">Actions</span></th></tr>
                </thead>
                <PagedBody page={paged.page}>
                  {paged.rows.map((r) => {
                    const s = eff(r)
                    return (
                      <tr key={r.id}>
                        <td data-label="Request">
                          <div className="tt num">{r.id}</div>
                          <div className="tm num"><When iso={r.requestedAt} today={today} tzLabel={tzLabel} /></div>
                        </td>
                        <td data-label="Tenant" className="tt">{names.get(r.tenantId) ?? r.tenantId}</td>
                        <td data-label="Requester">{r.requester}</td>
                        <td data-label="Reason" className="pf-reason">{r.reason}</td>
                        <td data-label="Status"><StatusPill status={REQUEST_STATUS[s]} /></td>
                        <td data-label="Expires" className="num">
                          {r.expiresAt ? <When iso={r.expiresAt} today={today} tzLabel={tzLabel} /> : "—"}
                        </td>
                        <td className="pf-acts">
                          {s === "granted" && r.expiresAt && (
                            <>
                              <button type="button" className="btn btn-primary pf-act" onClick={() => setViewing(r)}>
                                <Icon name="badge" />
                                View as support
                                <Countdown expiresAt={r.expiresAt} now={now} />
                              </button>
                              <button type="button" className="btn btn-outline pf-act" onClick={() => setRevoking(r)}>Revoke</button>
                            </>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </PagedBody>
              </table>
            </div>
            <DataPagination page={paged.page} pageCount={paged.pageCount} total={paged.total} from={paged.from} to={paged.to} label="Support request pages" onPageChange={setPage} />
          </>
        ) : (
          <EmptyState
            icon="help"
            title="No requests match"
            text={filtered ? "Try a different search or clear the filters." : "No support access has been requested yet."}
            action={filtered ? <button type="button" className="btn btn-outline" onClick={() => { setQ(""); setStatus("all"); setPage(1) }}>Clear filters</button> : undefined}
          />
        )}
      </div>
      <AuditList entries={audit} today={today} tzLabel={tzLabel} />

      <RequestDialog tenants={tenants} open={creating} onOpenChange={setCreating} actor={actor} today={today} />
      <ConfirmDialog
        open={!!viewing}
        onOpenChange={(o) => !o && setViewing(undefined)}
        title="Start a support session?"
        text={`This opens a time-limited support session for ${viewing ? names.get(viewing.tenantId) : "this tenant"}. Starting it and everything you do in it is recorded in the audit trail.`}
        confirmLabel="View as support"
        onConfirm={() => viewing && startSession(viewing)}
      />
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(undefined)}
        title="Revoke support access?"
        text={`${revoking?.id ?? "This access"} ends immediately and the support session closes. This is recorded in the audit trail.`}
        confirmLabel="Revoke access"
        destructive
        onConfirm={() => revoking && revoke(revoking)}
      />
    </>
  )
}
