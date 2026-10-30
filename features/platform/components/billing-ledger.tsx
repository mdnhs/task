"use client"

import { useMemo, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { motion } from "motion/react"
import { toast } from "sonner"

import { CountUp } from "@/components/count-up"
import { DataPagination, PagedBody } from "@/components/data-pagination"
import { EmptyState } from "@/components/empty-state"
import { FilterBar, FilterSearch, FilterSeg, FilterSelect } from "@/components/filter-bar"
import { Icon } from "@/components/icons"
import { PageHead } from "@/components/page-head"
import { SortHeader } from "@/components/sort-header"
import { StatusPill } from "@/components/status-pill"
import { downloadCsv, toCsv } from "@/lib/csv"
import { layoutTransition } from "@/lib/motion"
import { paginate } from "@/lib/paginate"
import {
  BILLING_VIEWS, DEFAULT_INVOICE_SORT, billingSummary, billingViewCounts, filterInvoices, sortInvoices, type BillingData, type InvoiceRow,
} from "../billing"
import { BILLING_PAGE_SIZE, PAGE_HEADS } from "../constants"
import { monthKey } from "../metrics"
import { compact, isCompacted, money } from "../money"
import { PLATFORM_CURRENCY } from "../overview"
import { dateY } from "../logic"
import { applyPatches } from "../patches"
import { invoicesStore, useInvoicePatches } from "../store"
import { INVOICE_STATUS } from "../types"
import type { BillingView, InvoiceSort } from "../types"
import { tenantPath } from "../tenant-360"
import { invoiceActions } from "./invoice-actions"
import { InvoiceSheet } from "./invoice-sheet"
import type { Operator } from "./tenants-view"

const SORTS: { value: string; label: string }[] = [
  { value: "issued:desc", label: "Newest" },
  { value: "issued:asc", label: "Oldest" },
  { value: "amount:desc", label: "Amount, highest" },
  { value: "due:asc", label: "Due soonest" },
  { value: "next:asc", label: "Next retry" },
  { value: "tenant:asc", label: "Tenant A–Z" },
  { value: "status:asc", label: "Status" },
]

const monthName = (key: string) => new Intl.DateTimeFormat("en-IE", { month: "long", timeZone: "UTC" }).format(new Date(`${key}-01T00:00:00Z`))
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`

// `q`: a search from the URL (`?q=`), e.g. an invoice number picked in the ⌘K palette.
type Props = { data: BillingData; view: BillingView; q?: string; today: string; tzLabel: string; operator: Operator }

export function BillingLedger({ data, view, q = "", today, tzLabel, operator }: Props) {
  // Patch model (store.ts): server rows, overlaid by the full invoices store when a full page already loaded it, then
  // by this page's own invoice patches. The ledger never writes the full stores.
  const full = useSyncExternalStore(invoicesStore.subscribe, invoicesStore.get, () => undefined)
  const patches = useInvoicePatches()
  const rowsLive = useMemo(() => {
    const byId = new Map((full ?? []).map((i) => [i.id, i]))
    const base = data.invoices.map((i) => {
      const f = byId.get(i.id)
      return f ? { ...i, status: f.status, attempts: f.attempts, nextRetryAt: f.nextRetryAt, events: f.events } : i
    })
    return applyPatches(base, patches)
  }, [data.invoices, full, patches])

  const [filters, setFilters] = useState({ view, q })
  const [sort, setSort] = useState<InvoiceSort>(DEFAULT_INVOICE_SORT)
  const [sorting, setSorting] = useState(false)
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  // A soft navigation to another `?view=` / `?q=` while on the page (a link, the search) brings new props: follow them.
  const [seen, setSeen] = useState({ view, q })
  if (seen.view !== view || seen.q !== q) {
    setSeen({ view, q })
    setFilters({ view, q })
    setPage(1)
  }

  const month = monthKey(today)
  const summary = useMemo(() => billingSummary(rowsLive, month), [rowsLive, month])
  const counts = useMemo(() => billingViewCounts(rowsLive), [rowsLive])
  const rows = useMemo(() => sortInvoices(filterInvoices(rowsLive, filters), sort), [rowsLive, filters, sort])
  const paged = paginate(rows, page, BILLING_PAGE_SIZE)
  const current = rowsLive.find((i) => i.id === openId) ?? null
  const filtered = filters.q !== "" || filters.view !== "all"

  function setView(v: BillingView) {
    setFilters((f) => ({ ...f, view: v }))
    setSorting(false)
    setPage(1)
    const url = new URL(window.location.href)
    if (v === "all") url.searchParams.delete("view")
    else url.searchParams.set("view", v)
    window.history.replaceState(null, "", `${url.pathname}${url.search}`)
  }
  function changeSort(s: InvoiceSort) {
    setSort(s)
    setSorting(true)
    setPage(1)
  }
  function open(i: InvoiceRow) {
    setOpenId(i.id)
    setSheetOpen(true)
  }

  // One write path with the 360 (invoice-actions.ts): patch + audit, toasts, and the payment-recovered rule.
  const { onRetry, onMarkPaid, onRefund, onVoid } = invoiceActions({ operator, today, provider: data.provider }, rowsLive)

  function exportCsv() {
    const csv = toCsv(
      rows.map((i) => ({
        number: i.number, id: i.id, tenant: i.tenantName, tenantId: i.tenantId, issued: i.issuedAt.slice(0, 10), due: i.dueAt.slice(0, 10),
        amount: i.amount, currency: i.currency, status: INVOICE_STATUS[i.status].label, attempts: i.attempts, next: i.nextRetryAt?.slice(0, 10) ?? "",
      })),
      [
        { key: "number", label: "Number" }, { key: "id", label: "Invoice ID" }, { key: "tenant", label: "Tenant" }, { key: "tenantId", label: "Tenant ID" },
        { key: "issued", label: "Issued" }, { key: "due", label: "Due" }, { key: "amount", label: "Amount" }, { key: "currency", label: "Currency" },
        { key: "status", label: "Status" }, { key: "attempts", label: "Attempts" }, { key: "next", label: "Next retry" },
      ],
    )
    const file = `billing-${filters.view}-${today.slice(0, 10)}.csv`
    downloadCsv(csv, file)
    toast.success("CSV exported", { description: file })
  }

  const cards = [
    { key: "collected", title: "Collected", sub: `This month · ${monthName(month)}`, t: summary.collected, note: `${plural(summary.collected.count, "invoice")} paid`, view: null },
    { key: "open", title: "Open", sub: "Not yet due or charged", t: summary.open, note: `${plural(summary.open.count, "invoice")} outstanding`, view: "open" as const },
    { key: "failed", title: "Failed", sub: "In dunning", t: summary.failed, note: `${plural(summary.failed.count, "invoice")} failing`, view: "failed" as const },
    { key: "refunded", title: "Refunded", sub: "All time", t: summary.refunded, note: plural(summary.refunded.count, "invoice"), view: "refunded" as const },
  ]
  const { title, subtitle } = PAGE_HEADS.billing
  const head = (label: string, key: InvoiceSort["key"], first: "asc" | "desc" = "asc", className?: string) => (
    <SortHeader label={label} sortKey={key} sort={sort} onSort={changeSort} first={first} className={className} />
  )

  return (
    <>
      <PageHead
        title={title}
        subtitle={`${subtitle} · ${data.provider.name}${data.provider.mode === "live" ? "" : ` (${data.provider.mode} mode)`}`}
        actions={
          <button type="button" className="btn btn-outline" onClick={exportCsv} disabled={rows.length === 0}>
            <Icon name="download" />
            Export CSV
          </button>
        }
      />

      <section className="stats pf-kpis pf-kpis-4" aria-label={`Billing totals in ${PLATFORM_CURRENCY}`}>
        {cards.map((c, k) => {
          const v = compact(c.t.amount, PLATFORM_CURRENCY)
          return (
            <article key={c.key} className="stat">
              <div className="stat-top">
                <div>
                  <h3>{c.title}</h3>
                  <div className="pf-kpi-sub">{c.sub}</div>
                </div>
                {c.view && (
                  <button type="button" className="arrow" aria-label={`Show ${c.title.toLowerCase()} invoices`} onClick={() => setView(c.view)}>
                    <Icon name="arrow" />
                  </button>
                )}
              </div>
              <div className="value num" title={money(c.t.amount, PLATFORM_CURRENCY)}>
                <small>{v.prefix}</small>
                <CountUp value={v.value} delay={0.1 + k * 0.04} decimals />
                {v.suffix && <small>{v.suffix}</small>}
              </div>
              {/* The exact amount, readable without hover (D11), when the card shows a compacted one. */}
              {isCompacted(v.suffix) && <div className="pf-exact num">{money(c.t.amount, PLATFORM_CURRENCY)}</div>}
              <div className="note">{c.note}</div>
            </article>
          )
        })}
      </section>

      <div className="card pf-card">
        <FilterBar>
          <FilterSeg
            label="Saved views"
            value={filters.view}
            onChange={setView}
            options={BILLING_VIEWS.map((v) => ({ value: v.value, label: <>{v.label} <span className="num pf-count">{counts[v.value]}</span></> }))}
          />
        </FilterBar>
        <FilterBar>
          <FilterSearch value={filters.q} onChange={(q) => { setFilters((f) => ({ ...f, q })); setSorting(false); setPage(1) }} placeholder="Search number or tenant" />
          <span className="pf-sort-m">
            <FilterSelect
              label="Sort by"
              value={SORTS.some((s) => s.value === `${sort.key}:${sort.dir}`) ? `${sort.key}:${sort.dir}` : "issued:desc"}
              options={SORTS}
              onChange={(v) => {
                const [key, dir] = v.split(":") as [InvoiceSort["key"], InvoiceSort["dir"]]
                changeSort({ key, dir })
              }}
            />
          </span>
        </FilterBar>
        {rows.length > 0 ? (
          <>
            <div className="table-wrap">
              <table className="rtable pf-table pf-ledger">
                <thead>
                  <tr>
                    {head("Number", "number")}
                    {head("Tenant", "tenant")}
                    {head("Issued", "issued", "desc")}
                    {head("Due", "due", "desc")}
                    {head("Amount", "amount", "desc", "pf-r")}
                    {head("Status", "status")}
                    {head("Attempts", "attempts", "desc", "pf-r")}
                    {head("Next retry", "next")}
                  </tr>
                </thead>
                <PagedBody page={paged.page} reorder>
                  {paged.rows.map((i) => (
                    <motion.tr key={i.id} layout={sorting ? "position" : false} transition={layoutTransition}>
                      <td data-label="Number">
                        <button type="button" className="pf-inv-open num" onClick={() => open(i)} aria-haspopup="dialog">{i.number}</button>
                      </td>
                      <td data-label="Tenant" className="pf-inv-tenant"><Link href={tenantPath(i.tenantId, "billing")} className="pf-link">{i.tenantName}</Link></td>
                      <td data-label="Issued" className="num"><time dateTime={i.issuedAt}>{dateY(i.issuedAt)}</time></td>
                      <td data-label="Due" className="num"><time dateTime={i.dueAt}>{dateY(i.dueAt)}</time></td>
                      <td data-label="Amount" className="num pf-r">{money(i.amount, i.currency)}</td>
                      <td data-label="Status"><StatusPill status={INVOICE_STATUS[i.status]} /></td>
                      <td data-label="Attempts" className="num pf-r">{i.attempts}</td>
                      <td data-label="Next retry" className="num">
                        {i.nextRetryAt ? (
                          <time dateTime={i.nextRetryAt}>{dateY(i.nextRetryAt)}</time>
                        ) : i.status === "failed" ? (
                          <span className="pf-dun-out">Retries exhausted</span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </motion.tr>
                  ))}
                </PagedBody>
              </table>
            </div>
            <DataPagination page={paged.page} pageCount={paged.pageCount} total={paged.total} from={paged.from} to={paged.to} label="Invoice pages" onPageChange={(p) => { setSorting(false); setPage(p) }} />
          </>
        ) : (
          <EmptyState
            icon="receipt"
            title="No invoices match"
            text={filtered ? "Try a different search or view." : "No invoices have been issued yet."}
            action={filtered ? <button type="button" className="btn btn-outline" onClick={() => { setView("all"); setFilters({ view: "all", q: "" }) }}>Clear filters</button> : undefined}
          />
        )}
      </div>

      <InvoiceSheet
        invoice={current}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        canWrite={data.can.write}
        provider={data.provider.name}
        tzLabel={tzLabel}
        onRetry={onRetry}
        onMarkPaid={onMarkPaid}
        onRefund={onRefund}
        onVoid={onVoid}
      />
    </>
  )
}
