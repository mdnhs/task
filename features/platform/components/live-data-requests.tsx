"use client"

import { useState } from "react"
import Link from "next/link"

import { EmptyState } from "@/components/empty-state"
import { FilterBar, FilterSeg } from "@/components/filter-bar"
import { PageHead } from "@/components/page-head"
import { StatusPill } from "@/components/status-pill"
import type { LiveDataRequests } from "../adapters"
import { dateUtc } from "../format"
import { tenantPath } from "../tenant-360"

type View = "all" | "overdue"

/** GDPR requests across tenants (read only: the API has no resolve route and sends no subject identity). Overdue first, then by due date, as the API orders them. */
export function LiveDataRequests({ data }: { data: LiveDataRequests }) {
  const [view, setView] = useState<View>("all")
  const rows = view === "overdue" ? data.rows.filter((r) => r.overdue) : data.rows
  const overdue = data.rows.filter((r) => r.overdue).length
  return (
    <>
      <PageHead title="Data requests" subtitle="Export, erase and correct requests and their due dates" />
      <div className="card pf-card">
        <FilterBar>
          <FilterSeg label="View" value={view} onChange={(v) => setView(v as View)} options={[{ value: "all", label: <>All <span className="num pf-count">{data.rows.length}</span></> }, { value: "overdue", label: <>Overdue <span className="num pf-count">{overdue}</span></> }]} />
        </FilterBar>
        {rows.length ? (
          <div className="table-wrap">
            <table className="rtable pf-table">
              <thead><tr><th>Tenant</th><th>Kind</th><th>Status</th><th>Requested</th><th>Due</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Tenant"><Link href={tenantPath(r.tenantId)} className="tt pf-link">{r.tenant}</Link></td>
                    <td data-label="Kind">{r.kindLabel}</td>
                    <td data-label="Status"><StatusPill status={r.overdue ? { tone: "bad", label: "Overdue" } : { tone: r.status === "pending" || r.status === "running" ? "info" : "ok", label: r.status[0]!.toUpperCase() + r.status.slice(1) }} /></td>
                    <td data-label="Requested" className="num"><time dateTime={r.createdAt}>{dateUtc(r.createdAt)}</time></td>
                    <td data-label="Due" className="num"><time dateTime={r.dueAt}>{dateUtc(r.dueAt)}</time></td>
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
    </>
  )
}
