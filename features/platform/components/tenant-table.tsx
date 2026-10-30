"use client"

import Link from "next/link"
import { motion } from "motion/react"

import { PagedBody } from "@/components/data-pagination"
import { CopyId } from "@/components/copy-id"
import { Icon } from "@/components/icons"
import { SortHeader } from "@/components/sort-header"
import { StatusPill } from "@/components/status-pill"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { layoutTransition } from "@/lib/motion"
import { PLATFORM_LOCALE } from "../constants"
import { dateY } from "../logic"
import { money } from "../money"
import { tenantPath } from "../tenant-360"
import type { TenantListRow } from "../tenants"
import { TENANT_STATUS } from "../types"
import type { Health, TenantSort } from "../types"

export const HEALTH_BAND: Record<Health["band"], { tone: "ok" | "warn" | "bad"; label: string }> = {
  healthy: { tone: "ok", label: "Healthy" },
  watch: { tone: "warn", label: "Watch" },
  at_risk: { tone: "bad", label: "At risk" },
}

const num = (n: number) => n.toLocaleString(PLATFORM_LOCALE)
/** Seat bar state: near the limit from 90%, over it above 100%. */
const seatState = (pct: number) => (pct > 100 ? "over" : pct >= 90 ? "near" : undefined)

/** D5: band + score; the tooltip (and the screen-reader text) lists the reasons behind the score. */
export function HealthPill({ health, id }: { health: Health; id: string }) {
  const band = HEALTH_BAND[health.band]
  const why = health.reasons.length ? health.reasons.join(" · ") : "No issues found"
  return (
    <Tooltip>
      <TooltipTrigger
        render={<button type="button" className={`st ${band.tone} pf-health`} />}
      >
        {band.label}
        <span className="num pf-score">{health.score}</span>
        {/* Part of the button's name (read once); the tooltip is for pointer users. */}
        <span id={`${id}-why`} className="sr-only">: {why}</span>
      </TooltipTrigger>
      <TooltipContent className="od-tip" sideOffset={6}>
        {health.reasons.length ? (
          <ul className="od-tip-list">{health.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        ) : (
          why
        )}
      </TooltipContent>
    </Tooltip>
  )
}

export type RowActions = {
  canSupport: boolean
  canSuspend: boolean
  onOpen(t: TenantListRow): void
  onCopy(t: TenantListRow): void
  onSupport(t: TenantListRow): void
  onToggle(t: TenantListRow): void
}

export function TenantTable({
  rows,
  page,
  sort,
  onSort,
  sorting,
  showMrr,
  actions,
}: {
  rows: TenantListRow[]
  page: number
  sort: TenantSort
  onSort(s: TenantSort): void
  /** True right after a header click: rows glide to their new place (FLIP); never on filter or page changes (rule 22). */
  sorting: boolean
  /** billing.read: the MRR column and its sort. */
  showMrr: boolean
  actions: RowActions
}) {
  const head = (label: string, key: TenantSort["key"], first: "asc" | "desc" = "asc", className?: string) => (
    <SortHeader label={label} sortKey={key} sort={sort} onSort={onSort} first={first} className={className} />
  )
  return (
    <div className="table-wrap">
      <table className={`rtable pf-table pf-tenants${showMrr ? "" : " pf-no-mrr"}`}>
        <thead>
          <tr>
            {head("Tenant", "name")}
            {head("Plan", "plan")}
            {head("Status", "status")}
            {head("Health", "health")}
            {head("Users", "users", "desc")}
            {head("Storage", "storage", "desc")}
            {showMrr && head("MRR", "mrr", "desc", "pf-r")}
            {head("Created", "created", "desc")}
            <th><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <PagedBody page={page} reorder>
          {rows.map((t) => {
            const state = seatState(t.seatPct)
            return (
              <motion.tr key={t.id} layout={sorting ? "position" : false} transition={layoutTransition}>
                <td data-label="Tenant" className="pf-tcell">
                  <div className="pf-tname">
                    <Link href={tenantPath(t.id)} className="tt pf-link">{t.name}</Link>
                    <span className="pf-slug">
                      <span className="num">{t.slug}</span>
                      <CopyId value={t.id} what="tenant ID" />
                    </span>
                  </div>
                </td>
                <td data-label="Plan">{t.planName}</td>
                <td data-label="Status"><StatusPill status={TENANT_STATUS[t.status]} /></td>
                <td data-label="Health"><HealthPill health={t.health} id={`pf-h-${t.id}`} /></td>
                <td data-label="Users" className="pf-users">
                  <span className="num">{num(t.users)} / {num(t.userLimit)}</span>
                  <span className="pf-seat" data-state={state} aria-hidden="true">
                    <i style={{ width: `${Math.min(100, t.seatPct)}%` }} />
                  </span>
                </td>
                <td data-label="Storage" className="num">{num(t.storageGb)} GB</td>
                {showMrr && <td data-label="MRR" className="num pf-r">{t.mrr ? money(t.mrr, t.currency) : "—"}</td>}
                <td data-label="Created" className="num"><time dateTime={t.createdAt}>{dateY(t.createdAt)}</time></td>
                <td className="pf-menu-cell">
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<button type="button" className="pf-more" aria-label={`Actions for ${t.name}`} />}>
                      <Icon name="more" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" sideOffset={6} className="od-menu pf-row-menu">
                      <DropdownMenuItem onClick={() => actions.onOpen(t)}><Icon name="arrow" />Open</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => actions.onCopy(t)}><Icon name="copy" />Copy ID</DropdownMenuItem>
                      {actions.canSupport && (
                        <DropdownMenuItem onClick={() => actions.onSupport(t)}><Icon name="help" />Request support access</DropdownMenuItem>
                      )}
                      {actions.canSuspend && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className={t.status === "suspended" ? undefined : "pf-danger"} onClick={() => actions.onToggle(t)}>
                            <Icon name={t.status === "suspended" ? "unlock" : "lock"} />
                            {t.status === "suspended" ? "Reactivate" : "Suspend"}
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </motion.tr>
            )
          })}
        </PagedBody>
      </table>
    </div>
  )
}
