"use client"

import { useMemo, useState } from "react"
import { toast } from "sonner"

import { DataPagination } from "@/components/data-pagination"
import { EmptyState } from "@/components/empty-state"
import { FilterBar, FilterSearch, FilterSeg } from "@/components/filter-bar"
import { Icon } from "@/components/icons"
import { PageHead } from "@/components/page-head"
import { useDept } from "@/hooks/use-dept"
import { nowInTz } from "@/lib/dates"
import { moneyFormatter } from "@/lib/money"
import { paginate } from "@/lib/paginate"
import { ORDERS_PAGE_SIZE, inTab, matchesQuery, orderStats, sortFor } from "../filters"
import { approve, markOrdered, receive, reject } from "../mutations"
import { ordersStore } from "../store"
import { TABS } from "../types"
import type { Order, OrdersTab } from "../types"
import { DeliverDialog } from "./deliver-dialog"
import { NewOrderDialog } from "./new-order-dialog"
import { OrderSheet } from "./order-sheet"
import type { OrderAction } from "./order-sheet"
import { OrdersStats } from "./orders-stats"
import { OrdersTable } from "./orders-table"
import { RejectDialog } from "./reject-dialog"

const EMPTY: Record<OrdersTab, { title: string; text: string }> = {
  waiting: { title: "Nothing waiting for approval", text: "New stock requests that need a decision will appear here." },
  orders: { title: "No orders match", text: "Approved and rejected orders will appear here." },
  deliveries: { title: "No deliveries to show", text: "Orders appear here once they have been placed with the supplier." },
}

export function OrdersView({
  orders,
  departments,
  today,
  tz,
  tzLabel,
  currency,
  locale,
  canWrite,
  actor,
  scopeKey,
}: {
  orders: Order[]
  departments: string[]
  today: string
  /** IANA timezone from the org settings; stamps history entries. */
  tz: string
  tzLabel: string
  /** Money format from the org settings (lib/money.ts). */
  currency: string
  locale: string
  /** Approvers: can request, approve, reject, mark ordered and delivered. */
  canWrite: boolean
  actor: string
  scopeKey: string
}) {
  const dept = useDept()
  const money = useMemo(() => moneyFormatter(currency, locale), [currency, locale])
  const [stored, setStored] = ordersStore.useStore(orders, scopeKey)
  const [tab, setTab] = useState<OrdersTab>("waiting")
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const [seenDept, setSeenDept] = useState(dept)
  const [openRef, setOpenRef] = useState<string>()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [delivering, setDelivering] = useState(false)
  const [creating, setCreating] = useState(false)
  if (seenDept !== dept) {
    setSeenDept(dept)
    setPage(1)
  }

  const scoped = useMemo(() => stored.filter((o) => dept === "all" || o.dept === dept), [stored, dept])
  const stats = useMemo(() => orderStats(scoped), [scoped])
  const rows = useMemo(() => scoped.filter((o) => inTab(o, tab) && matchesQuery(o, q)).sort(sortFor(tab)), [scoped, tab, q])
  const paged = paginate(rows, page, ORDERS_PAGE_SIZE)
  const current = stored.find((o) => o.ref === openRef)

  function change(ref: string, fn: (o: Order, at: string) => Order, message: string) {
    const at = nowInTz(today, tz)
    setStored((prev) => prev.map((o) => (o.ref === ref ? fn(o, at) : o)))
    toast.success(message)
  }

  function onAction(a: OrderAction) {
    if (!current) return
    if (a === "approve") {
      change(current.ref, (o, at) => approve(o, actor, at), `${current.item} (${current.ref}) approved`)
      setSheetOpen(false)
    } else if (a === "ordered") {
      change(current.ref, (o, at) => markOrdered(o, actor, at), `${current.ref} marked as ordered`)
    } else {
      setSheetOpen(false)
      if (a === "reject") setRejecting(true)
      else setDelivering(true)
    }
  }

  return (
    <>
      <PageHead
        title="Orders & Stock"
        subtitle={`${scoped.length} requests · ${stats.waiting} waiting for approval`}
        actions={
          canWrite && (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              <Icon name="plus" />
              New request
            </button>
          )
        }
      />
      <OrdersStats stats={stats} money={money} />
      <div className="card ord-card">
        <FilterBar>
          <FilterSearch value={q} onChange={(v) => { setQ(v); setPage(1) }} placeholder="Search orders" />
          <FilterSeg label="View" value={tab} options={TABS} onChange={(v) => { setTab(v); setPage(1) }} />
        </FilterBar>
        {rows.length > 0 ? (
          <>
            <OrdersTable orders={paged.rows} page={paged.page} today={today} tzLabel={tzLabel} money={money} onOpen={(ref) => { setOpenRef(ref); setSheetOpen(true) }} />
            <DataPagination page={paged.page} pageCount={paged.pageCount} total={paged.total} from={paged.from} to={paged.to} label="Orders pages" onPageChange={setPage} />
          </>
        ) : (
          <EmptyState
            icon="box"
            title={q || dept !== "all" ? "No orders match" : EMPTY[tab].title}
            text={q || dept !== "all" ? "Try a different search or department." : EMPTY[tab].text}
            action={q ? <button type="button" className="btn btn-outline" onClick={() => { setQ(""); setPage(1) }}>Clear search</button> : undefined}
          />
        )}
      </div>
      <OrderSheet order={current} open={sheetOpen} onOpenChange={setSheetOpen} today={today} tzLabel={tzLabel} money={money} canAct={canWrite} onAction={onAction} />
      {canWrite && (
        <>
          <RejectDialog
            order={current}
            open={rejecting}
            onOpenChange={setRejecting}
            onReject={(ref, reason) => change(ref, (o, at) => reject(o, actor, at, reason), `${ref} rejected`)}
          />
          <DeliverDialog
            order={current}
            open={delivering}
            onOpenChange={setDelivering}
            onReceive={(ref, qty) => change(ref, (o, at) => receive(o, actor, at, qty), `${qty} received for ${ref}`)}
          />
          <NewOrderDialog
            open={creating}
            onOpenChange={setCreating}
            departments={departments}
            defaultDept={dept !== "all" ? dept : (departments[0] ?? "")}
            requester={actor}
            today={today}
            currency={currency}
            onCreated={() => { setTab("waiting"); setQ(""); setPage(1) }}
          />
        </>
      )}
    </>
  )
}
