"use client"

import { useState } from "react"
import { motion } from "motion/react"
import { toast } from "sonner"

import { Field } from "@/components/field"
import { FilterSeg } from "@/components/filter-bar"
import { Icon } from "@/components/icons"
import { PageHead } from "@/components/page-head"
import { StatusPill } from "@/components/status-pill"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { When } from "@/components/when"
import { layoutTransition } from "@/lib/motion"
import { PAGE_HEADS, REASON_MIN } from "../constants"
import { auditEntry, dateY, nowIso, sensitiveEntry } from "../logic"
import { STAFF_ROLES, STAFF_ROLE_LABEL } from "../permissions"
import { auditOutbox, staffStore, SCOPE, knownAudit } from "../store"
import { STAFF_STATUS, canBeOwner, changeStaffRole, disableStaff, inviteStaff, mfaLabel, type TeamData } from "../team"
import type { StaffMember, StaffRole } from "../types"
import { SlugConfirmDialog } from "./slug-confirm-dialog"
import type { Operator } from "./tenants-view"

const known = knownAudit
const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : "That change isn't allowed")

type Props = { data: TeamData; today: string; tzLabel: string; operator: Operator }

// Platform team (Task 9, team.manage). Staff, their role, two-step verification, last sign-in and status. Role changes and
// disabling are D7 actions (reason, audited with before/after); a member without MFA shows "MFA required" and can't be
// made owner (team.ts). The staff store is this page's own; audit lines go to the outbox (store.ts contract).
export function TeamView({ data, today, tzLabel, operator }: Props) {
  const [staff] = staffStore.useStore(data.staff, SCOPE)
  const [inviting, setInviting] = useState(false)
  const roleDlg = useDialogTarget<StaffMember>()
  const disableDlg = useDialogTarget<StaffMember>()
  const disabling = disableDlg.target
  const ctx = { staff, operatorId: data.operatorId }
  const at = () => nowIso(today)

  function write(next: StaffMember) {
    staffStore.set((all) => (all.some((s) => s.id === next.id) ? all.map((s) => (s.id === next.id ? next : s)) : [...all, next]))
  }

  function changeRole(m: StaffMember, to: StaffRole, reason: string): boolean {
    let next: StaffMember
    try {
      next = changeStaffRole(m, to, reason, ctx)
    } catch (e) {
      fail(e)
      return false
    }
    write(next)
    const detail = `${m.name}: ${STAFF_ROLE_LABEL[m.role]} → ${STAFF_ROLE_LABEL[to]}`
    auditOutbox.set((list) => [
      sensitiveEntry(known(), { at: at(), actor: operator.name, staffRole: operator.role, action: "staff.role_changed", target: m.name, detail, before: { role: m.role }, after: { role: to }, reason }),
      ...list,
    ])
    toast.success(`${m.name} is now ${STAFF_ROLE_LABEL[to].toLowerCase()}`)
    return true
  }

  function disable(m: StaffMember, reason: string) {
    let next: StaffMember
    try {
      next = disableStaff(m, reason, ctx)
    } catch (e) {
      fail(e)
      return
    }
    write(next)
    auditOutbox.set((list) => [
      sensitiveEntry(known(), { at: at(), actor: operator.name, staffRole: operator.role, action: "staff.disabled", target: m.name, detail: `${m.name} can no longer sign in to the console`, before: { status: m.status }, after: { status: "disabled" }, reason }),
      ...list,
    ])
    toast.success(`${m.name} disabled`)
  }

  function invite(input: { name: string; email: string; role: StaffRole }): string | null {
    let next: StaffMember
    try {
      next = inviteStaff(staff, input)
    } catch (e) {
      return e instanceof Error ? e.message : "Couldn't invite"
    }
    write(next)
    auditOutbox.set((list) => [
      { ...auditEntry(known(), at(), operator.name, "staff.invited", next.name, `Invited ${next.email} as ${STAFF_ROLE_LABEL[next.role].toLowerCase()}`), staffRole: operator.role, before: {}, after: { email: next.email, role: next.role } },
      ...list,
    ])
    toast.success(`Invite sent to ${next.email}`)
    return null
  }

  const { title, subtitle } = PAGE_HEADS.team
  const noMfa = staff.filter((s) => !s.mfa && s.status !== "disabled").length
  return (
    <>
      <PageHead
        title={title}
        subtitle={subtitle}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setInviting(true)}>
            <Icon name="userplus" />
            Invite staff
          </button>
        }
      />
      <div className="card pf-card">
        <p className="pf-aud-note">
          <Icon name="lock" />
          <span>
            Two-step verification is required for platform staff. {noMfa ? `${noMfa} ${noMfa === 1 ? "member hasn't" : "members haven't"} set it up yet; they` : "Members without it"} can&apos;t be made owner.
          </span>
        </p>
        <div className="table-wrap">
          <table className="rtable pf-table pf-team">
            <thead>
              <tr><th>Member</th><th>Role</th><th>Two-step</th><th>Last sign-in</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {staff.map((m) => {
                const self = m.id === data.operatorId
                const active = m.status !== "disabled"
                return (
                  <motion.tr key={m.id} layout="position" transition={layoutTransition}>
                    <td data-label="Member" className="pf-team-who">
                      <div className="pf-dr-stack">
                        <div className="tt">{m.name}{self && <span className="pf-you">You</span>}</div>
                        <div className="tm">{m.email}</div>
                      </div>
                    </td>
                    <td data-label="Role">{STAFF_ROLE_LABEL[m.role]}</td>
                    <td data-label="Two-step"><StatusPill status={mfaLabel(m)} /></td>
                    <td data-label="Last sign-in" className="num">
                      {/* Wall-clock on the platform clock (no offset in staff.json), so it is labelled with the platform zone. */}
                      {m.lastSignInAt ? (
                        <div className="pf-dr-stack">
                          <time dateTime={m.lastSignInAt}>{dateY(m.lastSignInAt)}</time>
                          <div className="tm"><When iso={m.lastSignInAt} today={today} tzLabel={tzLabel} mode="time" /></div>
                        </div>
                      ) : <span className="tm">Never</span>}
                    </td>
                    <td data-label="Status"><StatusPill status={STAFF_STATUS[m.status]} /></td>
                    <td className="pf-acts">
                      {!self && active && (
                        <>
                          <button type="button" className="btn btn-outline pf-act" onClick={() => roleDlg.show(m)}>Change role</button>
                          <button type="button" className="btn btn-outline pf-act" onClick={() => disableDlg.show(m)}>Disable</button>
                        </>
                      )}
                    </td>
                  </motion.tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <InviteDialog open={inviting} onOpenChange={setInviting} onInvite={invite} />
      <RoleDialog key={roleDlg.n} member={roleDlg.target} open={roleDlg.open} onClose={roleDlg.hide} onSave={changeRole} />
      <SlugConfirmDialog
        key={`dis-${disableDlg.n}`}
        open={disableDlg.open && !!disabling}
        onOpenChange={(o) => !o && disableDlg.hide()}
        title={`Disable ${disabling?.name ?? ""}?`}
        text="They can't sign in to the console any more. The reason is recorded in the audit trail."
        reason
        slug={disabling?.email ?? ""}
        confirmLabel="Disable member"
        destructive
        onConfirm={(reason) => disabling && disable(disabling, reason)}
      />
    </>
  )
}

const INVITE_ROLES = STAFF_ROLES.filter((r) => r !== "owner")

function InviteDialog({ open, onOpenChange, onInvite }: { open: boolean; onOpenChange(o: boolean): void; onInvite(i: { name: string; email: string; role: StaffRole }): string | null }) {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<StaffRole>("viewer")
  const [error, setError] = useState<{ field: "name" | "email"; text: string } | null>(null)
  function close(o: boolean) {
    onOpenChange(o)
    if (!o) {
      setName("")
      setEmail("")
      setRole("viewer")
      setError(null)
    }
  }
  function submit(e: React.FormEvent) {
    e.preventDefault()
    const msg = onInvite({ name, email, role })
    if (!msg) return close(false)
    setError({ field: /name/i.test(msg) ? "name" : "email", text: msg })
  }
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Invite staff</DialogTitle>
          <DialogDescription>They get an email to join the console and set up two-step verification.</DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={submit} noValidate>
          <Field label="Name" htmlFor="pf-inv-name" error={error?.field === "name" ? error.text : undefined} required>
            <Input id="pf-inv-name" value={name} autoComplete="off" onChange={(e) => { setName(e.target.value); setError(null) }} />
          </Field>
          <Field label="Work email" htmlFor="pf-inv-email" error={error?.field === "email" ? error.text : undefined} required>
            <Input id="pf-inv-email" type="email" placeholder="e.g. name@company.com" value={email} autoComplete="off" onChange={(e) => { setEmail(e.target.value); setError(null) }} />
          </Field>
          <div className="od-field">
            <span className="fs-label">Role</span>
            <FilterSeg<StaffRole> label="Role" value={role} options={INVITE_ROLES.map((r) => ({ value: r, label: STAFF_ROLE_LABEL[r] }))} onChange={setRole} />
            <div className="od-field-msg"><p className="od-field-hint">Owner comes later, once two-step verification is on.</p></div>
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

// The dialog keeps its last target while it closes, so the exit animation plays with its content; a new key per open
// (`n`) gives each opening fresh form state.
function useDialogTarget<T>() {
  const [s, setS] = useState<{ target: T | null; open: boolean; n: number }>({ target: null, open: false, n: 0 })
  return { ...s, show: (target: T) => setS((p) => ({ target, open: true, n: p.n + 1 })), hide: () => setS((p) => ({ ...p, open: false })) }
}

function RoleDialog({ member, open, onClose, onSave }: { member: StaffMember | null; open: boolean; onClose(): void; onSave(m: StaffMember, to: StaffRole, reason: string): boolean }) {
  const choices = member ? STAFF_ROLES.filter((r) => r !== member.role && (r !== "owner" || canBeOwner(member))) : []
  const [role, setRole] = useState<StaffRole | "">(choices[0] ?? "")
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | undefined>()
  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!member || !role) return
    if (reason.trim().length < REASON_MIN) return setError(`Explain why in at least ${REASON_MIN} characters`)
    if (onSave(member, role, reason.trim())) onClose()
  }
  return (
    <Dialog open={open && !!member} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Change {member?.name}&apos;s role</DialogTitle>
          <DialogDescription>Now {member ? STAFF_ROLE_LABEL[member.role].toLowerCase() : ""}. The change and your reason are recorded in the audit trail.</DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={submit} noValidate>
          <div className="od-field">
            <span className="fs-label">New role</span>
            <FilterSeg<StaffRole | ""> label="New role" value={role} options={choices.map((r) => ({ value: r, label: STAFF_ROLE_LABEL[r] }))} onChange={setRole} />
            {member && !canBeOwner(member) && <div className="od-field-msg"><p className="od-field-hint">Owner needs two-step verification first.</p></div>}
          </div>
          <Field label="Reason" htmlFor="pf-role-reason" error={error} hint={`At least ${REASON_MIN} characters`} required>
            <Textarea id="pf-role-reason" value={reason} rows={3} maxLength={300} onChange={(e) => { setReason(e.target.value); setError(undefined) }} />
          </Field>
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <button type="submit" className="btn btn-primary">Change role</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
