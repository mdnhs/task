"use client"

import { useState } from "react"
import Link from "next/link"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { EmptyState } from "@/components/empty-state"
import { Field } from "@/components/field"
import { FilterBar, FilterSeg } from "@/components/filter-bar"
import { PageHead } from "@/components/page-head"
import { StatusPill } from "@/components/status-pill"
import { Textarea } from "@/components/ui/textarea"
import type { LiveDataRequest, LiveDataRequests } from "../adapters"
import { REASON_MAX } from "../client"
import { dateUtc } from "../format"
import { tenantPath } from "../tenant-360"
import { usePlatform } from "./use-platform"

type View = "all" | "overdue"
type Outcome = "completed" | "rejected"

/** A request staff can close by hand (B8 T17, AH2): `running` (being processed) or `failed` (stuck). A `pending` one is picked up by its job. */
export const resolvable = (status: string) => status === "running" || status === "failed"
const label = (s: string) => s[0]!.toUpperCase() + s.slice(1)
const pill = (r: LiveDataRequest) =>
  r.overdue && !(r.status === "completed" || r.status === "rejected") ? { tone: "bad" as const, label: "Overdue" }
  : { tone: r.status === "failed" ? ("bad" as const) : r.status === "pending" || r.status === "running" ? ("info" as const) : r.status === "rejected" ? ("mute" as const) : ("ok" as const), label: label(r.status) }

/**
 * GDPR requests across tenants (no subject identity). Overdue first, then by due date, as the API orders them. Owner and support may resolve a `running` or `failed` request by hand
 * (POST /v1/platform/data-requests/{id}/resolve): an outcome and a note (1..500, shown to the tenant) are both required; the row shows the API's answer at once, then the refresh.
 */
export function LiveDataRequests({ data, canResolve = false }: { data: LiveDataRequests; canResolve?: boolean }) {
  const [view, setView] = useState<View>("all")
  const [done, setDone] = useState<{ base: LiveDataRequests; by: Record<string, Outcome> }>({ base: data, by: {} })
  const settled = done.base === data ? done.by : {}
  const all = data.rows.map((r) => (settled[r.id] ? { ...r, status: settled[r.id]!, overdue: false } : r))
  const rows = view === "overdue" ? all.filter((r) => r.overdue) : all
  const overdue = all.filter((r) => r.overdue).length
  const [target, setTarget] = useState<LiveDataRequest | null>(null)
  const showActions = canResolve && all.some((r) => resolvable(r.status))
  return (
    <>
      <PageHead title="Data requests" subtitle="Export, erase and correct requests and their due dates" />
      <div className="card pf-card">
        <FilterBar>
          <FilterSeg label="View" value={view} onChange={(v) => setView(v as View)} options={[{ value: "all", label: <>All <span className="num pf-count">{all.length}</span></> }, { value: "overdue", label: <>Overdue <span className="num pf-count">{overdue}</span></> }]} />
        </FilterBar>
        {rows.length ? (
          <div className="table-wrap">
            <table className="rtable pf-table">
              <thead><tr><th>Tenant</th><th>Kind</th><th>Status</th><th>Requested</th><th>Due</th>{showActions && <th><span className="sr-only">Actions</span></th>}</tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Tenant"><Link href={tenantPath(r.tenantId)} className="tt pf-link">{r.tenant}</Link></td>
                    <td data-label="Kind">{r.kindLabel}</td>
                    <td data-label="Status"><StatusPill status={pill(r)} /></td>
                    <td data-label="Requested" className="num"><time dateTime={r.createdAt}>{dateUtc(r.createdAt)}</time></td>
                    <td data-label="Due" className="num"><time dateTime={r.dueAt}>{dateUtc(r.dueAt)}</time></td>
                    {showActions && (
                      <td className="pf-menu-cell">
                        {resolvable(r.status) && <button type="button" className="btn btn-outline set-sm" aria-label={`Resolve ${r.kindLabel} request of ${r.tenant}`} onClick={() => setTarget(r)}>Resolve</button>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="download" title="No requests" text="Nothing waiting." />
        )}
        {data.total > data.rows.length && <p className="pf-note">Showing the first {data.rows.length} of {data.total}.</p>}
      </div>
      {canResolve && target && (
        <ResolveDialog
          key={target.id}
          request={target}
          onClose={() => setTarget(null)}
          onResolved={(id, status) => setDone((d) => ({ base: data, by: { ...(d.base === data ? d.by : {}), [id]: status } }))}
        />
      )}
    </>
  )
}

function ResolveDialog({ request, onClose, onResolved }: { request: LiveDataRequest; onClose(): void; onResolved(id: string, status: Outcome): void }) {
  const { client, act } = usePlatform()
  const [outcome, setOutcome] = useState<Outcome | "">("")
  const [note, setNote] = useState("")
  const ok = outcome !== "" && note.trim().length >= 1 && note.trim().length <= REASON_MAX
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Resolve ${request.kindLabel.toLowerCase()} request?`}
      text={`${request.tenant} sees the outcome and your note. Completed records that it was handled outside the job; it does not run it.`}
      confirmLabel="Resolve"
      confirmDisabled={!ok}
      onConfirm={() => {
        if (!outcome) return
        void act(`dsr:${request.id}`, () => client.resolveDataRequest(request.id, outcome, note), outcome === "completed" ? "Marked completed" : "Marked rejected").then((r) => r.ok && onResolved(request.id, r.value.status))
      }}
    >
      <Field label="Outcome" htmlFor="pf-dsr-outcome" required>
        <div id="pf-dsr-outcome">
          <FilterSeg label="Outcome" value={outcome} onChange={(v) => setOutcome(v as Outcome)} options={[{ value: "completed", label: "Completed" }, { value: "rejected", label: "Rejected" }]} />
        </div>
      </Field>
      <Field label="Note to the company" htmlFor="pf-dsr-note" hint={`Up to ${REASON_MAX} characters`} required>
        <Textarea id="pf-dsr-note" value={note} rows={3} maxLength={REASON_MAX} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </ConfirmDialog>
  )
}
