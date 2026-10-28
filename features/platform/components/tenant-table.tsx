import Link from "next/link"

import { PagedBody } from "@/components/data-pagination"
import { StatusPill } from "@/components/status-pill"
import { dateY, money, planOf, tenantMrr } from "../logic"
import { TENANT_STATUS } from "../types"
import type { Plan, PlatformTenant } from "../types"

export function TenantTable({ tenants, plans, page = 1 }: { tenants: PlatformTenant[]; plans: Plan[]; page?: number }) {
  return (
    <div className="table-wrap">
      <table className="rtable pf-table">
        <thead>
          <tr><th>Tenant</th><th>Subdomain</th><th>Plan</th><th>Status</th><th>Users</th><th>Storage</th><th>Created</th><th>MRR</th></tr>
        </thead>
        <PagedBody page={page}>
          {tenants.map((t) => {
            const plan = planOf(plans, t.plan)
            const mrr = tenantMrr(t, plans)
            return (
              <tr key={t.id}>
                <td data-label="Tenant">
                  <Link href={`/platform/tenants/${t.id}`} className="tt pf-link">{t.name}</Link>
                </td>
                <td data-label="Subdomain" className="num pf-sub">{t.subdomain}</td>
                <td data-label="Plan">{plan?.name ?? t.plan}</td>
                <td data-label="Status"><StatusPill status={TENANT_STATUS[t.status]} /></td>
                <td data-label="Users" className="num">{t.users}</td>
                <td data-label="Storage" className="num">{t.storageGb} GB</td>
                <td data-label="Created" className="num"><time dateTime={t.createdAt}>{dateY(t.createdAt)}</time></td>
                <td data-label="MRR" className="num">{mrr ? money(mrr, plan?.currency ?? "GBP") : "—"}</td>
              </tr>
            )
          })}
        </PagedBody>
      </table>
    </div>
  )
}
