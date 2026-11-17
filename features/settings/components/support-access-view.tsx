"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { DataPagination } from "@/components/data-pagination"
import { EmptyState } from "@/components/empty-state"
import { PageHead } from "@/components/page-head"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import { useApiAction } from "@/hooks/use-api-action"
import { apiBrowser } from "@/lib/api/browser"
import { paginate } from "@/lib/paginate"
import type { Status } from "@/lib/types"
import { makeSettingsClient } from "../client"
import { GRANTS_PAGE_SIZE } from "../constants"
import type { SupportGrant } from "../types"

const STATUS: Record<SupportGrant["status"], Status> = {
  active: { tone: "ok", label: "Active" },
  expired: { tone: "mute", label: "Expired" },
  revoked: { tone: "bad", label: "Revoked" },
}

// Support access (FR-SAAS-09/10, GET/DELETE /v1/settings/support-grants): who from OpsDesk support has (had) read-only access to this workspace. Only the Tenant Owner
// can revoke an active grant; support can only ask for access from the console, so there is nothing to approve here.
export function SupportAccessView({ grants, today, tzLabel, canRevoke }: { grants: SupportGrant[]; today: string; tzLabel: string; canRevoke: boolean }) {
  const run = useApiAction()
  const client = makeSettingsClient(apiBrowser, { go: (u) => window.location.assign(u) })
  const [page, setPage] = useState(1)
  const [revoke, setRevoke] = useState<SupportGrant | null>(null)
  const paged = paginate(grants, page, GRANTS_PAGE_SIZE)
  const live = grants.filter((g) => g.status === "active").length

  return (
    <>
      <PageHead title="Support access" subtitle="Support can only see your data while a grant is open" actions={<Link href="/settings/privacy" className="btn btn-outline">Back to privacy</Link>} />
      <section className="card set-card" aria-labelledby="set-sup-h">
        <div className="card-head">
          <div>
            <h2 id="set-sup-h">Grants</h2>
            <div className="sub">{live} active · {grants.length} in total</div>
          </div>
        </div>
        {paged.rows.length > 0 ? (
          <div className="table-wrap">
            <table className="rtable set-table">
              <thead>
                <tr><th>Who</th><th>Reason</th><th>Expires</th><th>Status</th>{canRevoke && <th>Actions</th>}</tr>
              </thead>
              <tbody>
                {paged.rows.map((g) => (
                  <tr key={g.id}>
                    <td data-label="Who"><span className="tt">{g.who}</span></td>
                    <td data-label="Reason">{g.reason}</td>
                    <td data-label="Expires" className="num"><When iso={g.expiresAt} today={today} tzLabel={tzLabel} /></td>
                    <td data-label="Status"><StatusPill status={STATUS[g.status]} /></td>
                    {canRevoke && <td data-label="Actions">{g.status === "active" && <button type="button" className="btn btn-outline set-sm" onClick={() => setRevoke(g)}>Revoke</button>}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="lock" title="No support access grants" text="Support cannot see your data unless a grant is open." />
        )}
        <DataPagination page={paged.page} pageCount={paged.pageCount} total={paged.total} from={paged.from} to={paged.to} label="Support access pages" onPageChange={setPage} />
      </section>
      <ConfirmDialog
        open={!!revoke}
        onOpenChange={(o) => !o && setRevoke(null)}
        title="Revoke support access?"
        text="Support loses access to your workspace on its next request."
        confirmLabel="Revoke access"
        destructive
        onConfirm={() => revoke && void run(`grant:${revoke.id}`, () => client.revokeGrant(revoke.id)).then((r) => r.ok && toast.success("Support access revoked"))}
      />
    </>
  )
}

