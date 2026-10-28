"use client"

import { useMemo, useState } from "react"

import { CountUp } from "@/components/count-up"
import { DataPagination } from "@/components/data-pagination"
import { EmptyState } from "@/components/empty-state"
import { FilterBar, FilterSearch, FilterSelect } from "@/components/filter-bar"
import { Icon } from "@/components/icons"
import { PageHead } from "@/components/page-head"
import { paginate } from "@/lib/paginate"
import { TENANTS_PAGE_SIZE } from "../constants"
import { EMPTY_FILTERS, currencySymbol, filterTenants, summarize } from "../logic"
import { usePlatform } from "../store"
import { TENANT_STATUS } from "../types"
import type { PlatformSeed, TenantStatus } from "../types"
import { TenantTable } from "./tenant-table"

const STATUS_OPTIONS: { value: "all" | TenantStatus; label: string }[] = [
  { value: "all", label: "All statuses" },
  ...(Object.keys(TENANT_STATUS) as TenantStatus[]).map((s) => ({ value: s, label: TENANT_STATUS[s].label })),
]

export function OverviewView({ seed }: { seed: PlatformSeed }) {
  const { tenants, plans } = usePlatform(seed)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [page, setPage] = useState(1)

  const stats = summarize(tenants, plans)
  const currency = plans[0]?.currency ?? "GBP"
  const rows = useMemo(() => filterTenants(tenants, filters), [tenants, filters])
  const paged = paginate(rows, page, TENANTS_PAGE_SIZE)
  const filtered = filters.q !== "" || filters.status !== "all" || filters.plan !== "all"

  const set = <K extends keyof typeof filters>(k: K, v: (typeof filters)[K]) => {
    setFilters((f) => ({ ...f, [k]: v }))
    setPage(1)
  }

  const cards: { title: string; value: string; prefix?: string; note: string; status: "all" | TenantStatus; label: string }[] = [
    { title: "Tenants", value: String(stats.tenants), note: `${tenants.filter((t) => t.status === "suspended").length} suspended`, status: "all", label: "Show all tenants" },
    { title: "MRR", value: String(stats.mrr), prefix: currencySymbol(currency), note: "From active and past-due tenants", status: "active", label: "Show active tenants" },
    { title: "Trials", value: String(stats.trials), note: "Not yet paying", status: "trial", label: "Show trial tenants" },
    { title: "Past due", value: String(stats.pastDue), note: "Payment needs attention", status: "past_due", label: "Show past-due tenants" },
  ]

  return (
    <>
      <PageHead title="Tenants" subtitle={`${stats.tenants} companies on the platform`} />
      <section className="stats" aria-label="Platform summary">
        {cards.map((c, i) => (
          <article key={c.title} className="stat">
            <div className="stat-top">
              <h3>{c.title}</h3>
              <button type="button" className="arrow pf-arrow" aria-label={c.label} onClick={() => set("status", c.status)}>
                <Icon name="arrow" />
              </button>
            </div>
            <div className="value num">
              {c.prefix && <small>{c.prefix}</small>}
              <CountUp value={c.value} delay={0.1 + i * 0.04} />
            </div>
            <div className="note">{c.note}</div>
          </article>
        ))}
      </section>
      <div className="card pf-card">
        <FilterBar>
          <FilterSearch value={filters.q} onChange={(v) => set("q", v)} placeholder="Search tenants" />
          <FilterSelect label="Status" value={filters.status} options={STATUS_OPTIONS} onChange={(v) => set("status", v)} />
          <FilterSelect
            label="Plan"
            value={filters.plan}
            options={[{ value: "all", label: "All plans" }, ...plans.map((p) => ({ value: p.id, label: p.name }))]}
            onChange={(v) => set("plan", v)}
          />
        </FilterBar>
        {rows.length > 0 ? (
          <>
            <TenantTable tenants={paged.rows} plans={plans} page={paged.page} />
            <DataPagination page={paged.page} pageCount={paged.pageCount} total={paged.total} from={paged.from} to={paged.to} label="Tenants pages" onPageChange={setPage} />
          </>
        ) : (
          <EmptyState
            icon="folder"
            title="No tenants match"
            text={filtered ? "Try a different search or clear the filters." : "No companies have signed up yet."}
            action={
              filtered ? (
                <button type="button" className="btn btn-outline" onClick={() => { setFilters(EMPTY_FILTERS); setPage(1) }}>
                  Clear filters
                </button>
              ) : undefined
            }
          />
        )}
      </div>
    </>
  )
}
