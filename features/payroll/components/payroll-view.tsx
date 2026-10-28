"use client"

import { useMemo, useState } from "react"
import { toast } from "sonner"

import { CountUp } from "@/components/count-up"
import { DataPagination, PagedBody } from "@/components/data-pagination"
import { DetailSheet } from "@/components/detail-sheet"
import { EmptyState } from "@/components/empty-state"
import { FilterBar, FilterSearch, FilterSelect } from "@/components/filter-bar"
import { Icon } from "@/components/icons"
import { PageHead } from "@/components/page-head"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import { useDept } from "@/hooks/use-dept"
import { nowInTz } from "@/lib/dates"
import { paginate } from "@/lib/paginate"
import { payrollStore } from "../store"
import { PAYROLL_PAGE_SIZE, STATUS, STATUS_ORDER, TYPE, TYPE_ORDER, nextRef } from "../types"
import type { IssueStatus, IssueType, PayrollDirectory, PayrollIssue } from "../types"
import { LogDialog } from "./log-dialog"
import type { NewIssue } from "./log-dialog"
import { StatusDialog } from "./status-dialog"

const STATUSES = [{ value: "all", label: "All statuses" }, ...STATUS_ORDER.map((s) => ({ value: s, label: STATUS[s].label }))]
const TYPES = [{ value: "all", label: "All types" }, ...TYPE_ORDER.map((t) => ({ value: t, label: TYPE[t] }))]

export function PayrollView({
  issues,
  directory,
  today,
  tz,
  tzLabel,
  canWrite,
  actor,
  scopeKey,
}: {
  issues: PayrollIssue[]
  directory: PayrollDirectory
  today: string
  /** IANA timezone from the org settings; stamps history. */
  tz: string
  tzLabel: string
  canWrite: boolean
  actor: string
  scopeKey: string
}) {
  const dept = useDept()
  const [stored, setStored] = payrollStore.useStore(issues, scopeKey)
  const [q, setQ] = useState("")
  const [status, setStatus] = useState("all")
  const [type, setType] = useState("all")
  const [page, setPage] = useState(1)
  const [seenDept, setSeenDept] = useState(dept)
  const [logging, setLogging] = useState(false)
  const [openRef, setOpenRef] = useState<string>()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [edit, setEdit] = useState<{ initial: IssueStatus; open: boolean; n: number }>()
  if (seenDept !== dept) {
    setSeenDept(dept)
    setPage(1)
  }

  const scoped = useMemo(() => stored.filter((i) => dept === "all" || i.dept === dept), [stored, dept])
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return scoped
      .filter(
        (i) =>
          (status === "all" || i.status === status) &&
          (type === "all" || i.type === type) &&
          (!s || [i.ref, i.staff, i.description, i.owner].some((v) => v.toLowerCase().includes(s))),
      )
      .sort((a, b) => Number(a.status === "resolved") - Number(b.status === "resolved") || a.target.localeCompare(b.target) || a.ref.localeCompare(b.ref))
  }, [scoped, q, status, type])
  const paged = paginate(rows, page, PAYROLL_PAGE_SIZE)
  const current = stored.find((i) => i.ref === openRef)
  const filtered = !!q || status !== "all" || type !== "all" || dept !== "all"
  const count = (s: IssueStatus) => scoped.filter((i) => i.status === s).length
  const stats: { s: IssueStatus; note: string }[] = [
    { s: "open", note: "Waiting to be picked up" },
    { s: "info_needed", note: "Waiting on the employee or payroll" },
    { s: "correction_required", note: "Fix goes in the next run" },
    { s: "resolved", note: "Closed with a resolution note" },
  ]

  function log(n: NewIssue) {
    const at = nowInTz(today, tz)
    const ref = nextRef(stored)
    const d = directory.staff.find((s) => s.name === n.staff)?.dept ?? ""
    const issue: PayrollIssue = {
      ref,
      staff: n.staff,
      dept: d,
      type: n.type,
      description: n.description,
      owner: n.owner,
      target: `${n.target.slice(0, 10)}T17:00:00`,
      status: "open",
      createdAt: at,
      history: [{ at, by: actor, action: "Issue logged" }],
    }
    setStored((prev) => [issue, ...prev])
    setPage(1)
    toast.success(`${ref} logged for ${n.staff}`)
  }

  function change(ref: string, next: IssueStatus, note: string) {
    const at = nowInTz(today, tz)
    setStored((prev) =>
      prev.map((i) =>
        i.ref === ref
          ? {
              ...i,
              status: next,
              resolution: next === "resolved" ? note : undefined,
              history: [...i.history, { at, by: actor, action: next === "resolved" ? "Resolved" : `Status: ${STATUS[next].label}`, note: note || undefined }],
            }
          : i,
      ),
    )
    toast.success(next === "resolved" ? `${ref} resolved` : `${ref} set to ${STATUS[next].label}`)
  }

  const openEdit = (initial: IssueStatus) => {
    setSheetOpen(false)
    setEdit((e) => ({ initial, open: true, n: (e?.n ?? 0) + 1 }))
  }

  return (
    <>
      <PageHead
        title="Payroll Issues"
        subtitle={`${rows.length} of ${scoped.length} issues`}
        actions={
          canWrite && (
            <button type="button" className="btn btn-primary" onClick={() => setLogging(true)}>
              <Icon name="plus" />
              Log issue
            </button>
          )
        }
      />
      <div className="pay-banner" role="note">
        <span className="pay-banner-ico" aria-hidden="true"><Icon name="wallet" /></span>
        <span>Issue tracking only: no payroll calculation</span>
      </div>
      <section className="stats" aria-label="Summary">
        {stats.map(({ s, note }, i) => (
          <article key={s} className="stat pay-stat">
            <div className="stat-top"><h3>{STATUS[s].label}</h3></div>
            <div className="value num"><CountUp value={String(count(s))} delay={0.1 + i * 0.04} /></div>
            <div className="note">{note}</div>
          </article>
        ))}
      </section>
      <div className="card pay-card">
        <FilterBar>
          <FilterSearch value={q} onChange={(v) => { setQ(v); setPage(1) }} placeholder="Search issues" />
          <FilterSelect label="Status" value={status} options={STATUSES} onChange={(v) => { setStatus(v); setPage(1) }} />
          <FilterSelect label="Type" value={type} options={TYPES} onChange={(v) => { setType(v); setPage(1) }} />
        </FilterBar>
        {rows.length > 0 ? (
          <>
            <div className="table-wrap">
              <table className="rtable pay-table">
                <thead>
                  <tr><th>Issue</th><th>Staff</th><th>Type</th><th>Owner</th><th>Target</th><th>Status</th></tr>
                </thead>
                <PagedBody page={paged.page}>
                    {paged.rows.map((i) => (
                      <tr key={i.ref}>
                        <td data-label="Issue">
                          <button type="button" className="tt pay-link" onClick={() => { setOpenRef(i.ref); setSheetOpen(true) }}>{i.description}</button>
                          <div className="tm num">{i.ref}</div>
                        </td>
                        <td data-label="Staff">
                          <div className="tt">{i.staff}</div>
                          <div className="tm">{i.dept}</div>
                        </td>
                        <td data-label="Type">{TYPE[i.type]}</td>
                        <td data-label="Owner">{i.owner}</td>
                        <td data-label="Target" className="num"><When iso={i.target} today={today} tzLabel={tzLabel} mode="date" /></td>
                        <td data-label="Status"><StatusPill status={STATUS[i.status]} /></td>
                      </tr>
                    ))}
                </PagedBody>
              </table>
            </div>
            <DataPagination page={paged.page} pageCount={paged.pageCount} total={paged.total} from={paged.from} to={paged.to} label="Payroll issues pages" onPageChange={setPage} />
          </>
        ) : (
          <EmptyState
            icon="wallet"
            title="No payroll issues match"
            text={filtered ? "Try a different search or clear the filters." : "Logged payroll issues will appear here."}
            action={
              filtered ? (
                <button type="button" className="btn btn-outline" onClick={() => { setQ(""); setStatus("all"); setType("all"); setPage(1) }}>
                  Clear filters
                </button>
              ) : undefined
            }
          />
        )}
      </div>

      <DetailSheet
        open={sheetOpen && !!current}
        onOpenChange={setSheetOpen}
        title={current?.ref ?? "Payroll issue"}
        subtitle={current && <span className="pay-sheet-pills"><StatusPill status={STATUS[current.status]} /></span>}
        footer={
          current && canWrite ? (
            <>
              <button type="button" className="btn btn-outline" onClick={() => openEdit(current.status === "resolved" ? "open" : current.status)}>
                {current.status === "resolved" ? "Reopen" : "Update status"}
              </button>
              {current.status !== "resolved" && (
                <button type="button" className="btn btn-primary" onClick={() => openEdit("resolved")}>Resolve</button>
              )}
            </>
          ) : undefined
        }
      >
        {current && (
          <>
            <dl className="pay-dl">
              <div><dt>Description</dt><dd>{current.description}</dd></div>
              <div><dt>Staff</dt><dd>{current.staff} · {current.dept}</dd></div>
              <div><dt>Type</dt><dd>{TYPE[current.type as IssueType]}</dd></div>
              <div><dt>Owner</dt><dd>{current.owner}</dd></div>
              <div><dt>Target</dt><dd><When iso={current.target} today={today} tzLabel={tzLabel} mode="date" /></dd></div>
              <div><dt>Logged</dt><dd><When iso={current.createdAt} today={today} tzLabel={tzLabel} /></dd></div>
              {current.resolution && <div><dt>Resolution</dt><dd>{current.resolution}</dd></div>}
            </dl>
            <section aria-labelledby="pay-hist-h">
              <h3 id="pay-hist-h" className="pay-sub">History</h3>
              <ol className="pay-history">
                {current.history.map((h, n) => (
                  <li key={`${h.at}-${n}`}>
                    <strong>{h.action}</strong> · {h.by}
                    <span className="pay-when"><When iso={h.at} today={today} tzLabel={tzLabel} /></span>
                    {h.note && <span className="pay-note">{h.note}</span>}
                  </li>
                ))}
              </ol>
            </section>
          </>
        )}
      </DetailSheet>
      {canWrite && <LogDialog directory={directory} today={today} open={logging} onOpenChange={setLogging} onLog={log} />}
      {canWrite && (
        <StatusDialog
          key={edit?.n ?? 0}
          issue={current}
          initial={edit?.initial ?? "open"}
          open={!!edit?.open}
          onOpenChange={(o) => !o && setEdit((e) => e && { ...e, open: false })}
          onChange={change}
        />
      )}
    </>
  )
}
