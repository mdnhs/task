"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"

import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import { cancelDeletion, dateY } from "../../logic"
import { tenantPath, type SettingsTab, type T360Head } from "../../tenant-360"
import { TENANT_STATUS } from "../../types"
import type { DataRequest } from "../../types"
import { SlugConfirmDialog } from "../slug-confirm-dialog"
import { ExportDialog, SlugDialog, SuspendDialog } from "./dialogs"
import { commitTenant, useLiveDataRequests, useLiveTenant, type T360Ctx } from "./live"

const DSR_STATUS: Record<DataRequest["status"], { tone: "info" | "warn" | "ok" | "bad"; label: string }> = {
  received: { tone: "info", label: "Received" },
  in_progress: { tone: "warn", label: "In progress" },
  completed: { tone: "ok", label: "Completed" },
  rejected: { tone: "bad", label: "Rejected" },
}

type Dialog = "suspend" | "slug" | "export" | "undelete" | null

// Settings tab: the danger zone. Each row says what the action does and who may take it; buttons only show with the
// permission (staffCan, via head.can). Every action takes a reason (D7) and destructive ones a typed slug.
export function SettingsTabView({ head, data, ctx }: { head: T360Head; data: SettingsTab; ctx: T360Ctx }) {
  const t = useLiveTenant(head.tenant, head.can.amounts)
  const requests = useLiveDataRequests(data.dataRequests, t.id)
  const [dialog, setDialog] = useState<Dialog>(null)
  const { can } = head
  const suspended = t.status === "suspended"
  const any = can.suspend || can.lifecycle || can.dataRequests
  const close = (o: boolean, d: Dialog) => setDialog(o ? d : null)

  function undelete(reason: string) {
    const after = cancelDeletion(t, reason)
    commitTenant(ctx, t, after, { action: "tenant.deletion_cancelled", detail: `Scheduled deletion cancelled: ${reason}`, reason })
    toast.success("Deletion cancelled")
  }

  return (
    <div className="pf-col">
      {!any && <p className="pf-readonly">You can see these settings; changing them needs another staff role.</p>}
      <section className="card pf-danger-zone" aria-labelledby="pf-dz-h">
        <div className="card-head">
          <div>
            <h2 id="pf-dz-h">Danger zone</h2>
            <div className="sub">Each action needs a reason and is recorded in the platform audit trail</div>
          </div>
        </div>
        <ul className="pf-dz">
          <li>
            <div className="pf-dz-main">
              <span className="tt">{suspended ? "Reactivate workspace" : "Suspend workspace"}</span>
              <span className="pf-dz-d">
                {suspended
                  ? `Suspended${t.suspendedAt ? ` since ${dateY(t.suspendedAt)}` : ""}. Reactivating returns it to its previous status; the subscription is unchanged.`
                  : "Everyone keeps read-only access until it is reactivated. Billing and the subscription are unchanged."}
              </span>
            </div>
            <div className="pf-dz-side">
              <StatusPill status={TENANT_STATUS[t.status]} />
              {can.suspend && (
                <button type="button" className={`btn ${suspended ? "btn-primary" : "btn-danger"} pf-act`} onClick={() => setDialog("suspend")}>
                  {suspended ? "Reactivate" : "Suspend"}
                </button>
              )}
            </div>
          </li>
          <li>
            <div className="pf-dz-main">
              <span className="tt">Change slug</span>
              <span className="pf-dz-d">The workspace address is <span className="num">{t.subdomain}</span>. Old links stop working after a change.</span>
            </div>
            {can.lifecycle && (
              <div className="pf-dz-side">
                <button type="button" className="btn btn-outline pf-act" onClick={() => setDialog("slug")}>Change slug</button>
              </div>
            )}
          </li>
          <li>
            <div className="pf-dz-main">
              <span className="tt">Export tenant data</span>
              <span className="pf-dz-d">Files a data export request for the whole workspace, due within 30 days.</span>
              {requests.length > 0 && (
                <ul className="pf-dz-reqs">
                  {requests.map((r) => (
                    <li key={r.id}>
                      <span className="num">{r.id}</span>
                      <span>{r.kind === "export" ? "Export" : r.kind === "deletion" ? "Deletion" : "Correction"}</span>
                      <StatusPill status={DSR_STATUS[r.status]} tick={false} />
                      <span className="num pf-dz-due">Due <When iso={r.dueAt} today={ctx.today} tzLabel={ctx.tzLabel} mode="date" /></span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {can.dataRequests && (
              <div className="pf-dz-side">
                <button type="button" className="btn btn-outline pf-act" onClick={() => setDialog("export")}>Request export</button>
              </div>
            )}
          </li>
          <li>
            <div className="pf-dz-main">
              <span className="tt">Delete workspace</span>
              <span className="pf-dz-d">
                {t.deletionAt
                  ? `Deletion is scheduled for ${dateY(t.deletionAt)}. Until then it can be cancelled.`
                  : `Schedules deletion of the workspace and all its data ${data.retentionDays} days from today (the retention period).`}
              </span>
            </div>
            {can.lifecycle && (
              <div className="pf-dz-side">
                {t.deletionAt ? (
                  <button type="button" className="btn btn-outline pf-act" onClick={() => setDialog("undelete")}>Cancel deletion</button>
                ) : (
                  <Link href={tenantPath(t.id, "schedule-deletion")} className="btn btn-danger pf-act">Schedule deletion</Link>
                )}
              </div>
            )}
          </li>
        </ul>
      </section>

      {can.suspend && <SuspendDialog tenant={t} ctx={ctx} open={dialog === "suspend"} onOpenChange={(o) => close(o, "suspend")} />}
      {can.lifecycle && <SlugDialog tenant={t} ctx={ctx} taken={data.takenSlugs} open={dialog === "slug"} onOpenChange={(o) => close(o, "slug")} />}
      {can.dataRequests && <ExportDialog tenant={t} ctx={ctx} dsrFloor={head.ids.dsr} open={dialog === "export"} onOpenChange={(o) => close(o, "export")} />}
      {can.lifecycle && t.deletionAt && (
        <SlugConfirmDialog
          open={dialog === "undelete"}
          onOpenChange={(o) => close(o, "undelete")}
          title={`Cancel ${t.name}'s deletion?`}
          text="The workspace and its data are kept. The reason is recorded in the platform audit trail."
          reason
          confirmLabel="Cancel deletion"
          onConfirm={undelete}
        />
      )}
    </div>
  )
}
