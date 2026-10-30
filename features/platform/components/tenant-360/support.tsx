"use client"

import Link from "next/link"

import { EmptyState } from "@/components/empty-state"
import { Icon } from "@/components/icons"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import { effectiveStatus } from "../../logic"
import type { SupportTab, T360Head } from "../../tenant-360"
import { REQUEST_STATUS } from "../../types"
import { useOrgNow } from "../clock"
import { useLiveTenant, useTenantRequests, type T360Ctx } from "./live"

// Support tab: this tenant's support access requests and sessions (FR-SAAS-09). Filing a request happens on the
// support page (the tenants list's row action does the same), so the request store and its audit stay in one place.
export function SupportTabView({ head, data, ctx, tz }: { head: T360Head; data: SupportTab; ctx: T360Ctx; tz: string }) {
  const t = useLiveTenant(head.tenant, head.can.amounts)
  const requests = useTenantRequests(data.requests, t.id)
  const now = useOrgNow(ctx.today, tz)
  const request = head.can.support ? (
    <Link href={`/platform/support?request=${encodeURIComponent(t.id)}`} className="btn btn-primary pf-act">
      <Icon name="plus" />
      Request access
    </Link>
  ) : null

  return (
    <section className="card pf-card" aria-labelledby="pf-sup-h">
      <div className="card-head">
        <div>
          <h2 id="pf-sup-h">Support access</h2>
          <div className="sub">{t.name} grants time-limited access from its own settings. Every session is audited.</div>
        </div>
        {requests.length > 0 && request}
      </div>
      {requests.length ? (
        <div className="table-wrap">
          <table className="rtable pf-support pf-tsup">
            <thead>
              <tr><th>Request</th><th>Requested by</th><th>Reason</th><th>Status</th><th>Requested</th><th>Access until</th></tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td data-label="Request" className="num">{r.id}</td>
                  <td data-label="Requested by">{r.requester}</td>
                  <td data-label="Reason" className="pf-reason">{r.reason}</td>
                  <td data-label="Status"><StatusPill status={REQUEST_STATUS[now === null ? r.status : effectiveStatus(r, now)]} tick={false} /></td>
                  <td data-label="Requested" className="num"><When iso={r.requestedAt} today={ctx.today} tzLabel={ctx.tzLabel} /></td>
                  <td data-label="Access until" className="num">{r.expiresAt ? <When iso={r.expiresAt} today={ctx.today} tzLabel={ctx.tzLabel} /> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon="help" title="No support requests" text={`Nobody has asked ${t.name} for support access yet.`} action={request ?? undefined} />
      )}
    </section>
  )
}
