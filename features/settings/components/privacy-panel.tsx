"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { DataPagination } from "@/components/data-pagination"
import { EmptyState } from "@/components/empty-state"
import { Field } from "@/components/field"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { paginate } from "@/lib/paginate"
import { useSupportAccess } from "@/hooks/use-support-access"
import { SUPPORT_STATUS, supportRows, type SupportAccess } from "@/lib/support-access"
import { GRANTS_PAGE_SIZE } from "../constants"
import type { PrivacyData } from "../types"

const addHours = (iso: string, h: number) => {
  const [y, m, d, hh = 0, mi = 0] = iso.split(/[-T:]/).map((x) => parseInt(x, 10))
  const t = new Date(Date.UTC(y, m - 1, d, hh + h, mi))
  const p = (x: number) => String(x).padStart(2, "0")
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}T${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:00`
}

// Data and privacy (FR-SAAS-09/10/15): export, deletion request (type the company name) and support access. Support
// rows are shared with the platform console (lib/support-access.ts): its requests show here to approve or decline.
export function PrivacyPanel({
  data,
  requests,
  tenantId,
  actor,
  companyName,
  today,
  tzLabel,
  canWrite,
}: {
  data: PrivacyData
  /** This tenant's support access rows. */
  requests: SupportAccess[]
  tenantId: string
  /** Signed-in user's name, recorded as `grantedBy`. */
  actor: string
  companyName: string
  today: string
  tzLabel: string
  canWrite: boolean
}) {
  const [all, setAll] = useSupportAccess(requests)
  const list = all.filter((r) => r.tenantId === tenantId)
  const [page, setPage] = useState(1)
  const [progress, setProgress] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(0)
  const [revoke, setRevoke] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => () => { if (timer.current) clearInterval(timer.current) }, [])

  function startExport() {
    setProgress(0)
    let p = 0
    timer.current = setInterval(() => {
      p = Math.min(100, p + 20)
      setProgress(p)
      if (p >= 100) {
        if (timer.current) clearInterval(timer.current)
        toast.success("Export ready", { description: "A download link was sent to your email." })
        setTimeout(() => setProgress(null), 600)
      }
    }, 350)
  }

  const rows = supportRows(list, today)
  const paged = paginate(rows, page, GRANTS_PAGE_SIZE)
  const live = rows.filter((r) => r.status === "granted").length
  const waiting = rows.filter((r) => r.status === "requested").length
  const update = (id: string, fn: (r: SupportAccess) => SupportAccess) => setAll((p) => p.map((r) => (r.id === id ? fn(r) : r)))
  const grant = (r: SupportAccess) => ({ ...r, status: "granted" as const, expiresAt: addHours(today, data.grantHours), grantedBy: actor })

  return (
    <>
      <section className="card set-card" aria-labelledby="set-data-h">
        <div className="card-head">
          <div>
            <h2 id="set-data-h">Your data</h2>
            <div className="sub">Export everything or ask for the workspace to be deleted</div>
          </div>
        </div>
        <div className="set-data">
          <div>
            <h3>Export all data</h3>
            <p>Tasks, reports, files and people as a single archive, emailed when ready.</p>
            {progress !== null && (
              <div suppressHydrationWarning className="progress set-progress" role="progressbar" aria-label="Export progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
                <i style={{ width: `${progress}%` }} />
              </div>
            )}
          </div>
          <button type="button" className="btn btn-outline" disabled={progress !== null} onClick={startExport}>{progress !== null ? `Exporting ${progress}%` : "Export all data"}</button>
        </div>
        {canWrite && (
          <div className="set-data">
            <div>
              <h3>Request deletion</h3>
              <p>Permanently deletes the workspace and all its data after a 30 day grace period.</p>
            </div>
            <button type="button" className="btn btn-danger" onClick={() => setDeleting((n) => n + 1)}>Request deletion</button>
          </div>
        )}
      </section>

      <section className="card set-card" aria-labelledby="set-sup-h">
        <div className="card-head">
          <div>
            <h2 id="set-sup-h">Support access</h2>
            <div className="sub">{live} active{waiting ? ` · ${waiting} waiting for you` : ""} · support can only see your data while a grant is open</div>
          </div>
          {canWrite && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                const r: SupportAccess = { id: `SUP-${Date.now().toString(36)}`, tenantId, requester: "OpsDesk Support", reason: "Granted from settings", status: "requested", requestedAt: today, expiresAt: null, grantedBy: null }
                setAll((p) => [grant(r), ...p])
                setPage(1)
                toast.success(`Support access granted for ${data.grantHours} hours`, { description: "You can revoke it at any time." })
              }}
            >
              Grant {data.grantHours}h access
            </button>
          )}
        </div>
        {paged.rows.length > 0 ? (
          <div className="table-wrap">
            <table className="rtable set-table">
              <thead>
                <tr><th>Who</th><th>Reason</th><th>Requested</th><th>Expires</th><th>Status</th>{canWrite && <th>Actions</th>}</tr>
              </thead>
              <tbody>
                {paged.rows.map(({ row: g, status: s }) => {
                  return (
                    <tr key={g.id}>
                      <td data-label="Who"><span className="tt">{g.requester}</span></td>
                      <td data-label="Reason">{g.reason}</td>
                      <td data-label="Requested" className="num"><When iso={g.requestedAt} today={today} tzLabel={tzLabel} /></td>
                      <td data-label="Expires" className="num">{g.expiresAt ? <When iso={g.expiresAt} today={today} tzLabel={tzLabel} /> : "Not granted"}</td>
                      <td data-label="Status"><StatusPill status={SUPPORT_STATUS[s]} /></td>
                      {canWrite && (
                        <td data-label="Actions">
                          {s === "requested" && (
                            <span className="set-actions">
                              <button type="button" className="btn btn-primary set-sm" onClick={() => { update(g.id, grant); toast.success(`Support access granted for ${data.grantHours} hours`) }}>Approve</button>
                              <button type="button" className="btn btn-outline set-sm" onClick={() => { update(g.id, (r) => ({ ...r, status: "revoked" })); toast.success("Request declined") }}>Decline</button>
                            </span>
                          )}
                          {s === "granted" && <button type="button" className="btn btn-outline set-sm" onClick={() => setRevoke(g.id)}>Revoke</button>}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="lock" title="No support access grants" text="Support cannot see your data unless you grant access." />
        )}
        <DataPagination page={paged.page} pageCount={paged.pageCount} total={paged.total} from={paged.from} to={paged.to} label="Support access pages" onPageChange={setPage} />
      </section>

      {deleting > 0 && <DeleteDialog key={deleting} companyName={companyName} onClose={() => setDeleting(0)} />}
      <ConfirmDialog
        open={!!revoke}
        onOpenChange={(o) => !o && setRevoke(null)}
        title="Revoke support access?"
        text="Support loses access to your workspace straight away."
        confirmLabel="Revoke access"
        destructive
        onConfirm={() => {
          if (revoke) update(revoke, (r) => ({ ...r, status: "revoked", expiresAt: today }))
          toast.success("Support access revoked")
        }}
      />
    </>
  )
}

function DeleteDialog({ companyName, onClose }: { companyName: string; onClose(): void }) {
  const [typed, setTyped] = useState("")
  const ok = typed.trim() === companyName
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Request workspace deletion</DialogTitle>
          <DialogDescription>This deletes all tasks, reports, files and people after a 30 day grace period. To confirm, type the company name: {companyName}</DialogDescription>
        </DialogHeader>
        <form
          className="od-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            if (!ok) return
            toast.success("Deletion requested", { description: "You have 30 days to cancel before the data is removed." })
            onClose()
          }}
        >
          <Field label="Company name" htmlFor="del-name" hint={typed && !ok ? "The name does not match yet" : undefined}>
            <Input id="del-name" value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
          </Field>
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <button type="submit" className="btn btn-danger" disabled={!ok}>Request deletion</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
