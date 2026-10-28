"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { z } from "zod"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { DataPagination } from "@/components/data-pagination"
import { EmptyState } from "@/components/empty-state"
import { Field } from "@/components/field"
import { FilterBar, FilterSearch, FilterSelect } from "@/components/filter-bar"
import { Icon } from "@/components/icons"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useDept } from "@/hooks/use-dept"
import { daysBetween } from "@/lib/dates"
import { paginate } from "@/lib/paginate"
import { INVITES_PAGE_SIZE, INVITE_DAYS, USERS_PAGE_SIZE } from "../constants"
import { invitesStore, usersStore } from "../store"
import type { Invite, RoleOption, SettingsUser } from "../types"

const addDays = (iso: string, n: number) => {
  const [y, m, d, h = 0, mi = 0] = iso.split(/[-T:]/).map((x) => parseInt(x, 10))
  const t = new Date(Date.UTC(y, m - 1, d + n, h, mi))
  const p = (x: number) => String(x).padStart(2, "0")
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}T${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:00`
}

const inviteSchema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  role: z.string().min(1, "Choose a role"),
})

type Props = {
  users: SettingsUser[]
  invites: Invite[]
  roles: RoleOption[]
  departments: string[]
  today: string
  tzLabel: string
  /** Seat limit of the tenant's plan (FR-SAAS-06). */
  seatLimit: number
  planName: string
  canWrite: boolean
  scopeKey: string
}

export function UsersPanel({ users, invites, roles, departments, today, tzLabel, seatLimit, planName, canWrite, scopeKey }: Props) {
  const [stored, setStored] = usersStore.useStore(users, scopeKey)
  const [storedInvites, setInvites] = invitesStore.useStore(invites, scopeKey)
  const dept = useDept()
  const [q, setQ] = useState("")
  const [role, setRole] = useState("all")
  const [status, setStatus] = useState("all")
  const [page, setPage] = useState(1)
  const [invPage, setInvPage] = useState(1)
  const [inviting, setInviting] = useState(0)
  const [confirmUser, setConfirmUser] = useState<SettingsUser | null>(null)
  const [confirmInvite, setConfirmInvite] = useState<Invite | null>(null)

  const roleLabel = (id: string) => roles.find((r) => r.id === id)?.label ?? id
  const seatsUsed = stored.filter((u) => u.status === "active").length
  const full = seatsUsed >= seatLimit

  // Any filter, search or department change goes back to page 1.
  const [seenDept, setSeenDept] = useState(dept)
  if (seenDept !== dept) {
    setSeenDept(dept)
    setPage(1)
    setInvPage(1)
  }
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setPage(1)
    setInvPage(1)
  }

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return stored.filter(
      (u) =>
        (dept === "all" || !u.dept || u.dept === dept) &&
        (role === "all" || u.role === role) &&
        (status === "all" || u.status === status) &&
        (!s || u.name.toLowerCase().includes(s) || u.email.toLowerCase().includes(s)),
    )
  }, [stored, dept, role, status, q])
  const invRows = useMemo(() => storedInvites.filter((i) => dept === "all" || !i.dept || i.dept === dept), [storedInvites, dept])
  const paged = paginate(rows, page, USERS_PAGE_SIZE)
  const pagedInv = paginate(invRows, invPage, INVITES_PAGE_SIZE)
  const filtered = q || role !== "all" || status !== "all" || dept !== "all"

  const toggle = (u: SettingsUser, next: SettingsUser["status"]) => {
    setStored((p) => p.map((x) => (x.id === u.id ? { ...x, status: next } : x)))
    toast.success(next === "active" ? "User reactivated" : "User deactivated", { description: u.name })
  }
  const invite = (v: { email: string; role: string; dept: string }) => {
    setInvites((p) => [{ id: `inv-${Date.now().toString(36)}`, ...v, sentAt: today, expiresAt: addDays(today, INVITE_DAYS) }, ...p])
    toast.success("Invite sent", { description: v.email })
  }

  return (
    <>
      <section className="card set-card" aria-labelledby="set-users-h">
        <div className="card-head">
          <div>
            <h2 id="set-users-h">Users</h2>
            <div className="sub num">{seatsUsed} of {seatLimit} seats used · {planName} plan</div>
          </div>
          {canWrite && (
            <button type="button" className="btn btn-primary" disabled={full} onClick={() => setInviting((n) => n + 1)}>
              <Icon name="userplus" />
              Invite user
            </button>
          )}
        </div>
        {full && (
          <p className="set-notice" role="status">
            <Icon name="lock" />
            <span>All {seatLimit} seats on the {planName} plan are in use. <Link href="/settings/billing">Change plan</Link> or deactivate a user to invite or reactivate someone.</span>
          </p>
        )}
        <FilterBar>
          <FilterSearch value={q} onChange={reset(setQ)} placeholder="Search name or email" />
          <FilterSelect label="Role" value={role} onChange={reset(setRole)} options={[{ value: "all", label: "All roles" }, ...roles.map((r) => ({ value: r.id, label: r.label }))]} />
          <FilterSelect label="Status" value={status} onChange={reset(setStatus)} options={[{ value: "all", label: "All statuses" }, { value: "active", label: "Active" }, { value: "deactivated", label: "Deactivated" }]} />
        </FilterBar>
        {paged.rows.length > 0 ? (
          <div className="table-wrap">
            <table className="rtable set-table">
              <thead>
                <tr><th>User</th><th>Role</th><th>Department</th><th>Status</th><th>Last active</th>{canWrite && <th>Actions</th>}</tr>
              </thead>
              <tbody>
                {paged.rows.map((u) => (
                  <tr key={u.id}>
                    <td data-label="User">
                      <div className="tt">{u.name}</div>
                      <div className="tm">{u.email}</div>
                    </td>
                    <td data-label="Role">{roleLabel(u.role)}</td>
                    <td data-label="Department">{u.dept ? <span className="dep-tag">{u.dept}</span> : <span className="tm">All departments</span>}</td>
                    <td data-label="Status"><StatusPill status={u.status === "active" ? { tone: "ok", label: "Active" } : { tone: "mute", label: "Deactivated" }} /></td>
                    <td data-label="Last active" className="num"><When iso={u.lastActive} today={today} tzLabel={tzLabel} /></td>
                    {canWrite && (
                      <td data-label="Actions">
                        {u.status === "active" ? (
                          <button type="button" className="btn btn-outline set-sm" onClick={() => setConfirmUser(u)}>Deactivate</button>
                        ) : (
                          <button type="button" className="btn btn-outline set-sm" disabled={full} onClick={() => toggle(u, "active")}>Reactivate</button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="userplus" title={filtered ? "No users match" : "No users yet"} text={filtered ? "Try a different search or clear a filter." : "Invite your first teammate."} />
        )}
        <DataPagination page={paged.page} pageCount={paged.pageCount} total={paged.total} from={paged.from} to={paged.to} label="Users pages" onPageChange={setPage} />
      </section>

      <section className="card set-card" aria-labelledby="set-inv-h">
        <div className="card-head">
          <div>
            <h2 id="set-inv-h">Pending invites</h2>
            <div className="sub">{invRows.length} waiting · invites expire after {INVITE_DAYS} days</div>
          </div>
        </div>
        {pagedInv.rows.length > 0 ? (
          <div className="table-wrap">
            <table className="rtable set-table">
              <thead>
                <tr><th>Email</th><th>Role</th><th>Department</th><th>Expires</th>{canWrite && <th>Actions</th>}</tr>
              </thead>
              <tbody>
                {pagedInv.rows.map((i) => {
                  const expired = daysBetween(i.expiresAt, today) < 0
                  return (
                    <tr key={i.id}>
                      <td data-label="Email"><div className="tt">{i.email}</div></td>
                      <td data-label="Role">{roleLabel(i.role)}</td>
                      <td data-label="Department">{i.dept ? <span className="dep-tag">{i.dept}</span> : <span className="tm">All departments</span>}</td>
                      <td data-label="Expires" className="num">
                        <When iso={i.expiresAt} today={today} tzLabel={tzLabel} mode="date" /> {expired && <StatusPill status={{ tone: "bad", label: "Expired" }} />}
                      </td>
                      {canWrite && (
                        <td data-label="Actions">
                          <span className="set-actions">
                            <button
                              type="button"
                              className="btn btn-outline set-sm"
                              onClick={() => {
                                setInvites((p) => p.map((x) => (x.id === i.id ? { ...x, sentAt: today, expiresAt: addDays(today, INVITE_DAYS) } : x)))
                                toast.success("Invite resent", { description: i.email })
                              }}
                            >
                              Resend
                            </button>
                            <button type="button" className="btn btn-outline set-sm" onClick={() => setConfirmInvite(i)}>Revoke</button>
                          </span>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="mail" title="No pending invites" text="Invites you send appear here until they are accepted." />
        )}
        <DataPagination page={pagedInv.page} pageCount={pagedInv.pageCount} total={pagedInv.total} from={pagedInv.from} to={pagedInv.to} label="Invites pages" onPageChange={setInvPage} />
      </section>

      {inviting > 0 && <InviteDialog key={inviting} roles={roles} departments={departments} onClose={() => setInviting(0)} onInvite={invite} />}
      <ConfirmDialog
        open={!!confirmUser}
        onOpenChange={(o) => !o && setConfirmUser(null)}
        title={`Deactivate ${confirmUser?.name ?? "user"}?`}
        text="They are signed out and lose access immediately. Their history is kept, and a seat is freed."
        confirmLabel="Deactivate"
        destructive
        onConfirm={() => confirmUser && toggle(confirmUser, "deactivated")}
      />
      <ConfirmDialog
        open={!!confirmInvite}
        onOpenChange={(o) => !o && setConfirmInvite(null)}
        title="Revoke this invite?"
        text={`${confirmInvite?.email ?? "This person"} will no longer be able to join with the link they were sent.`}
        confirmLabel="Revoke invite"
        destructive
        onConfirm={() => {
          if (!confirmInvite) return
          setInvites((p) => p.filter((x) => x.id !== confirmInvite.id))
          toast.success("Invite revoked", { description: confirmInvite.email })
        }}
      />
    </>
  )
}

// Invite dialog (FR-SAAS-05): email, role and department.
function InviteDialog({ roles, departments, onClose, onInvite }: { roles: RoleOption[]; departments: string[]; onClose(): void; onInvite(v: { email: string; role: string; dept: string }): void }) {
  const [email, setEmail] = useState("")
  const [role, setRole] = useState("")
  const [dept, setDept] = useState("all")
  const [errors, setErrors] = useState<{ email?: string; role?: string }>({})

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = inviteSchema.safeParse({ email, role })
    if (!parsed.success) {
      const next: typeof errors = {}
      for (const i of parsed.error.issues) {
        const k = i.path[0] as keyof typeof errors
        if (!next[k]) next[k] = i.message
      }
      setErrors(next)
      return
    }
    onInvite({ email: parsed.data.email, role: parsed.data.role, dept: dept === "all" ? "" : dept })
    onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Invite user</DialogTitle>
          <DialogDescription>They get an email with a link to join. It expires after {INVITE_DAYS} days.</DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={submit} noValidate>
          <Field label="Email" htmlFor="inv-email" error={errors.email} required>
            <Input id="inv-email" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setErrors((x) => ({ ...x, email: undefined })) }} />
          </Field>
          <div className="od-row2">
            <Field label="Role" htmlFor="inv-role" error={errors.role} required>
              <FilterSelect label="Role" value={role} onChange={(v) => { setRole(v); setErrors((x) => ({ ...x, role: undefined })) }} options={[{ value: "", label: "Choose a role" }, ...roles.map((r) => ({ value: r.id, label: r.label }))]} />
            </Field>
            <Field label="Department" htmlFor="inv-dept">
              <FilterSelect label="Department" value={dept} onChange={setDept} options={[{ value: "all", label: "All departments" }, ...departments.map((d) => ({ value: d, label: d }))]} />
            </Field>
          </div>
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <button type="submit" className="btn btn-primary">Send invite</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
