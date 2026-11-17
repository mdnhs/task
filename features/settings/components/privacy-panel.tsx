"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"

import { DataPagination } from "@/components/data-pagination"
import { EmptyState } from "@/components/empty-state"
import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useApiAction } from "@/hooks/use-api-action"
import { apiBrowser } from "@/lib/api/browser"
import { paginate } from "@/lib/paginate"
import type { Status } from "@/lib/types"
import { makeSettingsClient } from "../client"
import { REQUESTS_PAGE_SIZE } from "../constants"
import type { DataRequestRow, DataRequestStatus } from "../types"

const STATUS: Record<DataRequestStatus, Status> = {
  pending: { tone: "info", label: "Pending" },
  running: { tone: "info", label: "Running" },
  completed: { tone: "ok", label: "Done" },
  failed: { tone: "bad", label: "Failed" },
  rejected: { tone: "mute", label: "Declined" },
}
const KIND = { export: "Export", erase: "Erase", correct: "Correct" } as const

// Data and privacy (FR-SAAS-09/10/15, GET/POST /v1/me/data-export and /v1/data-requests). "Export my data" is open to every member; the request list and opening a request
// (export, erase, correct for a person) are the owner's. An erase asks you to type the person's name first. Support access has its own page.
export function PrivacyPanel({
  mine, requests, people, today, tzLabel, canWrite, canRequests,
}: {
  /** The signed-in member's own export requests. */
  mine: DataRequestRow[]
  requests: DataRequestRow[]
  people: { id: string; name: string }[]
  today: string
  tzLabel: string
  /** Tenant Owner: may open requests (FR-SET-08). */
  canWrite: boolean
  /** The caller may read the tenant's request list (owner or admin). */
  canRequests: boolean
}) {
  const run = useApiAction()
  const client = makeSettingsClient(apiBrowser, { go: (u) => window.location.assign(u) })
  const [page, setPage] = useState(1)
  const [opening, setOpening] = useState(0)
  const paged = paginate(requests, page, REQUESTS_PAGE_SIZE)
  const open = mine.some((r) => r.status === "pending" || r.status === "running")

  return (
    <>
      <section className="card set-card" aria-labelledby="set-data-h">
        <div className="card-head">
          <div>
            <h2 id="set-data-h">Your data</h2>
            <div className="sub">Ask for a copy of your own data</div>
          </div>
        </div>
        <div className="set-data">
          <div>
            <h3>Export my data</h3>
            <p>{open ? "Your export is being prepared. You get a download when it is ready." : mine[0] ? `Last request: ${KIND[mine[0].kind]}, ${mine[0].status}.` : "Everything we hold about you, as one file."}</p>
          </div>
          <button type="button" className="btn btn-outline" disabled={open} onClick={() => void run("export", () => client.requestExport()).then((r) => r.ok && toast.success("Export requested", { description: "It is due within 30 days, usually minutes." }))}>
            {open ? "Preparing" : "Export my data"}
          </button>
        </div>
        <div className="set-data">
          <div>
            <h3>Support access</h3>
            <p>Who from OpsDesk support can see your workspace, and for how long.</p>
          </div>
          <Link href="/settings/support-access" className="btn btn-outline">View</Link>
        </div>
      </section>

      {canRequests && (
        <section className="card set-card" aria-labelledby="set-req-h">
          <div className="card-head">
            <div>
              <h2 id="set-req-h">Data requests</h2>
              <div className="sub">{requests.filter((r) => r.status === "pending" || r.status === "running").length} open · due within 30 days</div>
            </div>
            {canWrite && <button type="button" className="btn btn-primary" onClick={() => setOpening((n) => n + 1)}>New request</button>}
          </div>
          {paged.rows.length > 0 ? (
            <div className="table-wrap">
              <table className="rtable set-table">
                <thead>
                  <tr><th>Person</th><th>Kind</th><th>Due</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {paged.rows.map((r) => (
                    <tr key={r.id}>
                      <td data-label="Person"><span className="tt">{r.subject}</span></td>
                      <td data-label="Kind">{KIND[r.kind]}</td>
                      <td data-label="Due" className="num"><When iso={r.dueAt} today={today} tzLabel={tzLabel} mode="date" /> {r.overdue && <StatusPill status={{ tone: "bad", label: "Overdue" }} />}</td>
                      <td data-label="Status"><StatusPill status={STATUS[r.status]} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon="lock" title="No data requests" text="Requests about a person's data appear here." />
          )}
          <DataPagination page={paged.page} pageCount={paged.pageCount} total={paged.total} from={paged.from} to={paged.to} label="Data requests pages" onPageChange={setPage} />
        </section>
      )}
      {opening > 0 && <RequestDialog key={opening} people={people} onClose={() => setOpening(0)} onOpen={(r) => run("request", () => client.openRequest(r)).then((x) => x.ok)} />}
    </>
  )
}

function RequestDialog({ people, onClose, onOpen }: { people: { id: string; name: string }[]; onClose(): void; onOpen(r: { subjectUserId: string; kind: "export" | "erase" | "correct"; reason: string }): Promise<boolean> }) {
  const [who, setWho] = useState("")
  const [kind, setKind] = useState<"export" | "erase" | "correct">("export")
  const [reason, setReason] = useState("")
  const [typed, setTyped] = useState("")
  const name = people.find((p) => p.id === who)?.name ?? ""
  // erasing is permanent: type the person's name to confirm
  const confirmed = kind !== "erase" || (name !== "" && typed.trim() === name)
  const ok = !!who && reason.trim().length > 0 && confirmed

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!ok) return
    if (await onOpen({ subjectUserId: who, kind, reason: reason.trim() })) {
      toast.success("Request opened", { description: "It is due within 30 days." })
      onClose()
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>New data request</DialogTitle>
          <DialogDescription>{kind === "erase" ? "This permanently erases the person's personal data. To confirm, type their name." : "Opens a request about one person's data."}</DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={submit} noValidate>
          <Field label="Person" htmlFor="dsr-who" required>
            <FilterSelect label="Person" value={who} onChange={setWho} options={[{ value: "", label: "Choose a person" }, ...people.map((p) => ({ value: p.id, label: p.name }))]} />
          </Field>
          <Field label="Kind" htmlFor="dsr-kind">
            <FilterSelect label="Kind" value={kind} onChange={(v) => setKind(v as typeof kind)} options={[{ value: "export", label: "Export" }, { value: "correct", label: "Correct" }, { value: "erase", label: "Erase" }]} />
          </Field>
          <Field label="Reason" htmlFor="dsr-reason" required>
            <Input id="dsr-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Asked by email" />
          </Field>
          {kind === "erase" && (
            <Field label="Type the name to confirm" htmlFor="dsr-confirm" hint={typed && !confirmed ? "The name does not match yet" : undefined}>
              <Input id="dsr-confirm" value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
            </Field>
          )}
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <button type="submit" className={kind === "erase" ? "btn btn-danger" : "btn btn-primary"} disabled={!ok}>Open request</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
