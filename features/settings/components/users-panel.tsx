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
import { Icon } from "@/components/icon"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { PhoneField } from "@/components/phone-field"
import { WA_STAGE_HINT, WaNumberDialog } from "@/components/wa-number-dialog"
import { useApiAction } from "@/hooks/use-api-action"
import { useDept } from "@/hooks/use-dept"
import { apiBrowser } from "@/lib/api/browser"
import { daysBetween } from "@/lib/dates"
import { paginate } from "@/lib/paginate"
import { PHONE_DEFAULT_COUNTRY, nationalDigits, validE164 } from "@/lib/phone"
import type { PhoneCountry, PhoneValue } from "@/lib/phone"
import { stageNumber, stagedStore } from "@/lib/wa-staged"
import { WA_PERSON_STATUS, effectiveStatus } from "@/lib/wa-status"
import type { WaPersonStatus } from "@/lib/wa-status"
import { makeSettingsClient } from "../client"
import { inviteDaysOf, needsRoleConfirm } from "../adapters"
import { INVITES_PAGE_SIZE, USERS_PAGE_SIZE } from "../constants"
import type { Invite, MatrixRole, SettingsUser } from "../types"

const inviteSchema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  role: z.string().min(1, "Choose a role"),
})

type Props = {
  users: SettingsUser[]
  invites: Invite[]
  roles: MatrixRole[]
  today: string
  tzLabel: string
  /** Seat cap of the tenant's plan and the seats in use (GET /v1/entitlements, FR-SAAS-06). */
  seatLimit: number
  seatsUsed: number
  planName: string
  canWrite: boolean
  /** The signed-in member (a role change on yourself is asked about first). */
  meId: string
  /** MOCK (demo flag only): the staged WhatsApp number column and the optional number of the invite form. `status` = the WhatsApp status per lower-case email. Local state, never sent to the API. */
  whatsapp?: { countries: PhoneCountry[]; status: Record<string, WaPersonStatus>; scope: string }
}

// Users and invites (GET /v1/people, GET/POST/DELETE /v1/invites, PATCH /v1/members/{id}). A role change or invite the API refuses (403 role_escalation, 422
// role_not_invitable, 409 seat_limit...) is one toast with the mapped copy and the screen reverts to the server's record. Deactivate (asked first) and reactivate are one call each
// (POST /v1/members/{id}/deactivate|reactivate, B8 Task 24); the API's answer is the row's status at once, then the refresh brings the server's record. Yourself and the last active owner cannot
// be deactivated (the button says why; the API refuses too: 422 self_deactivation, 409 last_owner). Last active is the API's (null = "Never").
export function UsersPanel({ users, invites, roles, today, tzLabel, seatLimit, seatsUsed, planName, canWrite, meId, whatsapp }: Props) {
  const run = useApiAction()
  const client = makeSettingsClient(apiBrowser, { go: (u) => window.location.assign(u) })
  const dept = useDept()
  const [q, setQ] = useState("")
  const [role, setRole] = useState("all")
  const [page, setPage] = useState(1)
  const [invPage, setInvPage] = useState(1)
  const [inviting, setInviting] = useState(0)
  const [confirmInvite, setConfirmInvite] = useState<Invite | null>(null)
  const [confirmRole, setConfirmRole] = useState<{ u: SettingsUser; next: string } | null>(null)
  // The API's answer to a deactivate/reactivate, shown until the refreshed list arrives (a new `users` prop resets it).
  const [status, setStatus] = useState<{ base: SettingsUser[]; by: Record<string, boolean> }>({ base: users, by: {} })
  const activeOf = (u: SettingsUser) => (status.base === users ? status.by[u.id] : undefined) ?? u.active !== false
  const [confirmOff, setConfirmOff] = useState<SettingsUser | null>(null)
  const activeOwners = users.filter((u) => u.role === "owner" && activeOf(u)).length
  /** Why this row's Deactivate is off (null = allowed). */
  const blockedOff = (u: SettingsUser): string | null => (u.id === meId ? "You can't deactivate yourself" : u.role === "owner" && activeOwners <= 1 ? "The last owner can't be deactivated" : null)
  // MOCK (demo flag only): staged WhatsApp numbers, local to this tab.
  const [staged] = stagedStore.useStore({}, whatsapp?.scope ?? "")
  const [waEdit, setWaEdit] = useState<SettingsUser | null>(null)
  const waStatus = (u: SettingsUser): WaPersonStatus => effectiveStatus(whatsapp?.status[u.email.toLowerCase()] ?? "no_number", staged[u.email.toLowerCase()])
  const inviteDays = inviteDaysOf(invites)

  const roleLabel = (key: string) => roles.find((r) => r.id === key)?.label ?? key
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
    return users.filter((u) => (dept === "all" || !u.dept || u.dept === dept) && (role === "all" || u.role === role) && (!s || u.name.toLowerCase().includes(s) || u.email.toLowerCase().includes(s)))
  }, [users, dept, role, q])
  const paged = paginate(rows, page, USERS_PAGE_SIZE)
  const pagedInv = paginate(invites, invPage, INVITES_PAGE_SIZE)
  const filtered = q || role !== "all" || dept !== "all"

  const askRole = (u: SettingsUser, next: string) => (needsRoleConfirm(u, meId) ? setConfirmRole({ u, next }) : void changeRole(u, next))
  const changeRole = (u: SettingsUser, next: string) =>
    run(`role:${u.id}`, () => client.changeRole(u.id, next, roles)).then((r) => r.ok && toast.success("Role updated", { description: `${u.name}: ${roleLabel(next)}` }))
  const setActive = async (u: SettingsUser, on: boolean) => {
    const r = await run(`active:${u.id}`, () => (on ? client.reactivate(u.id) : client.deactivate(u.id)))
    if (!r.ok) return
    setStatus((s) => ({ base: users, by: { ...(s.base === users ? s.by : {}), [u.id]: r.value.status === "active" } }))
    toast.success(on ? "Reactivated" : "Deactivated", { description: u.name })
  }
  const invite = async (v: { email: string; role: string }) => {
    const r = await run("invite", () => client.invite(v.email, v.role, roles))
    if (r.ok) toast.success("Invite sent", { description: v.email })
    return r.ok
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
            <span>All {seatLimit} seats on the {planName} plan are in use. <Link href="/settings/billing">Change plan</Link> to invite more people.</span>
          </p>
        )}
        <FilterBar>
          <FilterSelect label="Role" value={role} onChange={reset(setRole)} options={[{ value: "all", label: "All roles" }, ...roles.map((r) => ({ value: r.id, label: r.label }))]} />
          <FilterSearch value={q} onChange={reset(setQ)} placeholder="Search name or email" />
        </FilterBar>
        {paged.rows.length > 0 ? (
          <div className="table-wrap">
            <table className="rtable set-table">
              <thead>
                <tr><th>User</th><th>Role</th><th>Department</th>{whatsapp && <th>WhatsApp <span className="tm">Demo</span></th>}<th>Status</th><th>Last active</th>{canWrite && <th><span className="sr-only">Actions</span></th>}</tr>
              </thead>
              <tbody>
                {paged.rows.map((u) => (
                  <tr key={u.id}>
                    <td data-label="User">
                      <div className="tt">{u.name}</div>
                      <div className="tm">{u.email}</div>
                    </td>
                    <td data-label="Role">
                      {canWrite ? (
                        <div className="od-filters set-access">
                          <FilterSelect label={`Role of ${u.name}`} value={u.role} options={roles.map((r) => ({ value: r.id, label: r.label }))} onChange={(v) => askRole(u, v)} />
                        </div>
                      ) : (
                        roleLabel(u.role)
                      )}
                    </td>
                    <td data-label="Department">{u.dept ? <span className="dep-tag">{u.dept}</span> : <span className="tm">All departments</span>}</td>
                    {whatsapp && (
                      <td data-label="WhatsApp">
                        <span className="wa-user-cell">
                          <StatusPill status={WA_PERSON_STATUS[waStatus(u)]} tick={false} />
                          {canWrite && <button type="button" className="btn btn-outline set-sm" onClick={() => setWaEdit(u)} aria-label={`Edit WhatsApp number of ${u.name}`}>Edit</button>}
                        </span>
                      </td>
                    )}
                    {(() => {
                      const on = activeOf(u)
                      const why = on ? blockedOff(u) : null
                      return (
                        <>
                          <td data-label="Status"><StatusPill status={on ? { tone: "ok", label: "Active" } : { tone: "mute", label: "Deactivated" }} /></td>
                          <td data-label="Last active" className="num">{u.lastActiveAt ? <When iso={u.lastActiveAt} today={today} tzLabel={tzLabel} /> : <span className="tm">Never</span>}</td>
                          {canWrite && (
                            <td data-label="Actions">
                              {on ? (
                                <button type="button" className="btn btn-outline set-sm" aria-label={`Deactivate ${u.name}`} title={why ?? undefined} disabled={why !== null} onClick={() => setConfirmOff(u)}>Deactivate</button>
                              ) : (
                                <button type="button" className="btn btn-outline set-sm" aria-label={`Reactivate ${u.name}`} disabled={full} title={full ? "No free seat" : undefined} onClick={() => void setActive(u, true)}>Reactivate</button>
                              )}
                            </td>
                          )}
                        </>
                      )
                    })()}
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
            <div className="sub">{invites.length} waiting{inviteDays ? ` · invites expire after ${inviteDays} ${inviteDays === 1 ? "day" : "days"}` : ""}</div>
          </div>
        </div>
        {pagedInv.rows.length > 0 ? (
          <div className="table-wrap">
            <table className="rtable set-table">
              <thead>
                <tr><th>Email</th><th>Role</th><th>Expires</th>{canWrite && <th>Actions</th>}</tr>
              </thead>
              <tbody>
                {pagedInv.rows.map((i) => {
                  const expired = daysBetween(i.expiresAt, today) < 0
                  return (
                    <tr key={i.id}>
                      <td data-label="Email"><div className="tt">{i.email}</div></td>
                      <td data-label="Role">{roleLabel(i.role)}</td>
                      <td data-label="Expires" className="num">
                        <When iso={i.expiresAt} today={today} tzLabel={tzLabel} mode="date" /> {expired && <StatusPill status={{ tone: "bad", label: "Expired" }} />}
                      </td>
                      {canWrite && (
                        <td data-label="Actions">
                          <span className="set-actions">
                            <button
                              type="button"
                              className="btn btn-outline set-sm"
                              onClick={() => void run(`resend:${i.id}`, () => client.resendInvite(i.id)).then((r) => r.ok && toast.success("Invite resent", { description: i.email }))}
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

      <ConfirmDialog
        open={!!confirmRole}
        onOpenChange={(o) => !o && setConfirmRole(null)}
        title={confirmRole?.u.id === meId ? "Change your own role?" : `Change ${confirmRole?.u.name ?? "this person"}'s role?`}
        text={confirmRole?.u.id === meId ? "You may lose access to settings if the new role has less." : "They are the workspace owner. Their access changes straight away."}
        confirmLabel="Change role"
        destructive
        onConfirm={() => confirmRole && void changeRole(confirmRole.u, confirmRole.next)}
      />
      <ConfirmDialog
        open={!!confirmOff}
        onOpenChange={(o) => !o && setConfirmOff(null)}
        title={`Deactivate ${confirmOff?.name ?? "this person"}?`}
        text="They lose access at once. Their history and shifts stay; open shift assignments end today. You can reactivate them later."
        confirmLabel="Deactivate"
        destructive
        onConfirm={() => confirmOff && void setActive(confirmOff, false)}
      />
      {inviting > 0 && <InviteDialog key={inviting} roles={roles} inviteDays={inviteDays} wa={whatsapp?.countries} onClose={() => setInviting(0)} onInvite={invite} />}
      {whatsapp && waEdit && (
        <WaNumberDialog key={waEdit.id} name={waEdit.name} email={waEdit.email} countries={whatsapp.countries} current={staged[waEdit.email.toLowerCase()] ?? null} status={waStatus(waEdit)} onClose={() => setWaEdit(null)} />
      )}
      <ConfirmDialog
        open={!!confirmInvite}
        onOpenChange={(o) => !o && setConfirmInvite(null)}
        title="Revoke this invite?"
        text={`${confirmInvite?.email ?? "This person"} will no longer be able to join with the link they were sent.`}
        confirmLabel="Revoke invite"
        destructive
        onConfirm={() => {
          if (!confirmInvite) return
          const i = confirmInvite
          void run(`revoke:${i.id}`, () => client.revokeInvite(i.id)).then((r) => r.ok && toast.success("Invite revoked", { description: i.email }))
        }}
      />
    </>
  )
}

// Invite dialog (FR-SAAS-05): email and role. The API only offers the roles an invite may carry (an owner role is refused, 422 role_not_invitable).
function InviteDialog({ roles, inviteDays, wa, onClose, onInvite }: { roles: MatrixRole[]; inviteDays: number | null; wa?: PhoneCountry[]; onClose(): void; onInvite(v: { email: string; role: string }): Promise<boolean> }) {
  const [email, setEmail] = useState("")
  const [role, setRole] = useState("")
  const [errors, setErrors] = useState<{ email?: string; role?: string; phone?: string }>({})
  // MOCK (demo flag only): the optional WhatsApp number is only staged locally (Pending confirmation); the invite itself goes to the API without it.
  const [phone, setPhone] = useState<PhoneValue>({ country: PHONE_DEFAULT_COUNTRY, national: "" })

  async function submit(e: React.FormEvent) {
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
    const dial = wa?.find((c) => c.code === phone.country)?.dial ?? "353"
    const typed = nationalDigits(phone.national) !== ""
    if (wa && typed && !validE164(dial, phone.national)) {
      setErrors({ phone: "Enter a valid number, for example 87 123 4567." })
      return
    }
    if (await onInvite({ email: parsed.data.email, role: parsed.data.role })) {
      if (wa && typed) stageNumber(parsed.data.email, { country: phone.country, national: nationalDigits(phone.national) })
      onClose()
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Invite user</DialogTitle>
          <DialogDescription>They get a join link by email{inviteDays ? `. It expires after ${inviteDays} ${inviteDays === 1 ? "day" : "days"}.` : "."}</DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={submit} noValidate>
          <Field label="Email" htmlFor="inv-email" error={errors.email} required>
            <Input id="inv-email" type="email" placeholder="e.g. name@company.com" value={email} onChange={(e) => { setEmail(e.target.value); setErrors((x) => ({ ...x, email: undefined })) }} />
          </Field>
          <Field label="Role" htmlFor="inv-role" error={errors.role} required>
            <FilterSelect label="Role" value={role} onChange={(v) => { setRole(v); setErrors((x) => ({ ...x, role: undefined })) }} options={[{ value: "", label: "Choose a role" }, ...roles.filter((r) => r.id !== "owner").map((r) => ({ value: r.id, label: r.label }))]} />
          </Field>
          {wa && (
            <PhoneField id="inv-wa" countries={wa} value={phone} onChange={(v) => { setPhone(v); setErrors((x) => ({ ...x, phone: undefined })) }} error={errors.phone} hint={`Optional. ${WA_STAGE_HINT}`} />
          )}
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <button type="submit" className="btn btn-primary">Send invite</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
