"use client"

import { useMemo, useState } from "react"

import { EmptyState } from "@/components/empty-state"
import { FilterBar, FilterSelect } from "@/components/filter-bar"
import { Icon } from "@/components/icon"
import { PageHead } from "@/components/page-head"
import type { LiveAuditLine } from "../adapters"
import { dateTimeUtc } from "../format"

/** The CSV export is the API's stream (every matching entry, recorded in the platform audit itself), opened through the same-origin BFF so the session cookie goes along. */
export const auditExportHref = (tenantId?: string) => `/v1/platform/audit/export?${new URLSearchParams({ format: "csv", ...(tenantId ? { targetTenantId: tenantId } : {}) })}`

const show = (v: unknown): string => (v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v))

export function AuditList({ lines }: { lines: LiveAuditLine[] }) {
  return (
    <ul className="pf-audit">
      {lines.map((e) => (
        <li key={e.seq}>
          <div className="pf-aud-main"><span className="tt">{e.action}</span><span className="pf-aud-act">{e.entity} {e.entityId}</span></div>
          {(e.before !== null || e.after !== null) && <p className="num">{show(e.before)}{e.before !== null && e.after !== null ? " → " : ""}{show(e.after)}</p>}
          <div className="tm num">{e.actor} · <time dateTime={e.at}>{dateTimeUtc(e.at)}</time></div>
        </li>
      ))}
    </ul>
  )
}

/** The audit log page (owner and viewer). The API returns the newest entries first (up to the limit asked); the filter works on them. */
export function LiveAudit({ lines, tenantId }: { lines: LiveAuditLine[]; tenantId?: string }) {
  const [entity, setEntity] = useState("all")
  const entities = useMemo(() => [...new Set(lines.map((l) => l.entity))].sort(), [lines])
  const rows = entity === "all" ? lines : lines.filter((l) => l.entity === entity)
  return (
    <>
      <PageHead
        title="Audit log"
        subtitle="Every platform action: who, when and what changed"
        actions={<a className="btn btn-outline" href={auditExportHref(tenantId)} download><Icon name="download" />Export CSV</a>}
      />
      <div className="card pf-card">
        <FilterBar>
          <FilterSelect label="Entity" value={entity} options={[{ value: "all", label: "All entities" }, ...entities.map((e) => ({ value: e, label: e }))]} onChange={setEntity} />
        </FilterBar>
        {rows.length ? <AuditList lines={rows} /> : <EmptyState icon="shield" title="Nothing here" text="No platform actions match." />}
      </div>
    </>
  )
}
