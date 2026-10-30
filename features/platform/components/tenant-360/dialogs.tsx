"use client"

import { useState } from "react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { Field } from "@/components/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { REASON_MIN } from "../../constants"
import { CREDIT_MAX, SLUG_RE, applyCredit, changeSlug, exportRequest, nowIso, reactivateTenant, suspendTenant } from "../../logic"
import { money } from "../../money"
import { TENANT_STATUS } from "../../types"
import type { PlatformTenant } from "../../types"
import { SlugConfirmDialog } from "../slug-confirm-dialog"
import { commitTenant, nextDsrIds, type T360Ctx } from "./live"

// Short D7 dialogs shared by the header's menu and the tabs (rule 31: small forms stay dialogs). Each one applies the
// pure action (logic.ts) and commits the patch + audit line through live.ts. Longer forms are pages (change plan,
// extend trial, schedule deletion).

type Base = { tenant: PlatformTenant; ctx: T360Ctx; open: boolean; onOpenChange(o: boolean): void }

/** Suspend (reason + type the slug) or reactivate (reason) the tenant. Reactivate returns to the status before. */
export function SuspendDialog({ tenant: t, ctx, open, onOpenChange }: Base) {
  const suspended = t.status === "suspended"
  const back = suspended ? reactivateTenant(t).status : null
  function confirm(reason: string) {
    const after = suspended ? reactivateTenant(t) : suspendTenant(t, nowIso(ctx.today), reason)
    commitTenant(ctx, t, after, { action: suspended ? "tenant.reactivated" : "tenant.suspended", detail: `${suspended ? "Reactivated" : "Suspended"}: ${reason}`, reason })
    toast.success(`${t.name} ${suspended ? `reactivated as ${TENANT_STATUS[after.status].label.toLowerCase()}` : "suspended"}`)
  }
  return (
    <SlugConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={suspended ? `Reactivate ${t.name}?` : `Suspend ${t.name}?`}
      text={
        suspended
          ? `${t.name} gets full write access again and returns to ${TENANT_STATUS[back!].label.toLowerCase()}. The subscription is unchanged. The reason is recorded in the platform audit trail.`
          : `Everyone at ${t.name} keeps read-only access until you reactivate it. Billing and the subscription are unchanged. The reason is recorded in the platform audit trail.`
      }
      reason
      slug={suspended ? undefined : t.slug}
      confirmLabel={suspended ? "Reactivate" : "Suspend"}
      destructive={!suspended}
      onConfirm={confirm}
    />
  )
}

/** "Export tenant data": files a GDPR export data request (the queue is /platform/data-requests). */
export function ExportDialog({ tenant: t, ctx, open, onOpenChange, dsrFloor }: Base & { dsrFloor: string }) {
  function confirm(reason: string) {
    const request = exportRequest(t, { at: nowIso(ctx.today), by: ctx.operator.name, reason, ids: nextDsrIds(dsrFloor) })
    commitTenant(ctx, t, t, { action: "data.export_requested", detail: `Export of the ${t.name} workspace requested (${request.id})`, reason, request })
    toast.success(`Export requested (${request.id})`, { description: "It is in the data requests queue." })
  }
  return (
    <SlugConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Export ${t.name}'s data?`}
      text="This files a data export request for the whole workspace. It joins the data requests queue with a 30-day deadline; nothing is exported until the request is worked. The reason is recorded in the platform audit trail."
      reason
      confirmLabel="Request export"
      onConfirm={confirm}
    />
  )
}

/** Account credit in the plan currency, with a reason. */
export function CreditDialog({ tenant: t, ctx, open, onOpenChange, currency }: Base & { currency: string }) {
  const [amount, setAmount] = useState("")
  const [why, setWhy] = useState("")
  const value = Number(amount.replace(",", "."))
  const amountOk = amount.trim() !== "" && Number.isFinite(value) && value > 0 && value <= CREDIT_MAX
  const reasonOk = why.trim().length >= REASON_MIN
  function change(o: boolean) {
    onOpenChange(o)
    if (!o) {
      setAmount("")
      setWhy("")
    }
  }
  function confirm() {
    const after = applyCredit(t, value, why)
    commitTenant(ctx, t, after, { action: "billing.credit_applied", detail: `Applied ${money(value, currency)} credit: ${why.trim()}`, reason: why })
    toast.success(`Credit applied to ${t.name}`)
  }
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={change}
      title={`Apply credit to ${t.name}?`}
      text="The credit is used up by the next invoices before the card is charged. The reason is recorded in the platform audit trail."
      confirmLabel="Apply credit"
      confirmDisabled={!amountOk || !reasonOk}
      onConfirm={confirm}
    >
      <Field label={`Amount (${currency})`} htmlFor="pf-credit-amount" hint={`Above 0 and up to ${CREDIT_MAX}.`} required>
        <Input id="pf-credit-amount" inputMode="decimal" value={amount} autoComplete="off" onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="Reason" htmlFor="pf-credit-reason" hint={`At least ${REASON_MIN} characters. Saved in the audit trail.`} required>
        <Textarea id="pf-credit-reason" value={why} rows={2} maxLength={300} onChange={(e) => setWhy(e.target.value)} />
      </Field>
    </ConfirmDialog>
  )
}

/** Change slug: the new slug, a reason, and the current slug typed to confirm (it changes the tenant's address). */
export function SlugDialog({ tenant: t, ctx, open, onOpenChange, taken }: Base & { taken: string[] }) {
  const [slug, setSlug] = useState("")
  const [why, setWhy] = useState("")
  const [typed, setTyped] = useState("")
  const next = slug.trim().toLowerCase()
  const error = !next ? undefined : next === t.slug ? "That is the current slug" : !SLUG_RE.test(next) ? "Use 3 to 32 lowercase letters, digits or single hyphens" : taken.includes(next) ? "That slug is taken by another tenant" : undefined
  const ok = !!next && !error && why.trim().length >= REASON_MIN && t.slug !== "" && typed.trim() === t.slug
  function change(o: boolean) {
    onOpenChange(o)
    if (!o) {
      setSlug("")
      setWhy("")
      setTyped("")
    }
  }
  function confirm() {
    const after = changeSlug(t, next, taken, why)
    commitTenant(ctx, t, after, { action: "tenant.slug_changed", detail: `Slug changed from ${t.slug} to ${after.slug}: ${why.trim()}`, reason: why })
    toast.success(`Slug changed to ${after.slug}`, { description: after.subdomain })
  }
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={change}
      title={`Change ${t.name}'s slug?`}
      text={`The workspace address changes from ${t.subdomain}. Old links stop working. The reason is recorded in the platform audit trail.`}
      confirmLabel="Change slug"
      destructive
      confirmDisabled={!ok}
      onConfirm={confirm}
    >
      <Field label="New slug" htmlFor="pf-slug-new" error={error} hint="Lowercase letters, digits and hyphens." required>
        <Input id="pf-slug-new" value={slug} autoComplete="off" spellCheck={false} onChange={(e) => setSlug(e.target.value)} />
      </Field>
      <Field label="Reason" htmlFor="pf-slug-reason" hint={`At least ${REASON_MIN} characters. Saved in the audit trail.`} required>
        <Textarea id="pf-slug-reason" value={why} rows={2} maxLength={300} onChange={(e) => setWhy(e.target.value)} />
      </Field>
      <Field label={`Type ${t.slug} to confirm`} htmlFor="pf-slug-confirm" required>
        <Input id="pf-slug-confirm" value={typed} autoComplete="off" spellCheck={false} onChange={(e) => setTyped(e.target.value)} />
      </Field>
    </ConfirmDialog>
  )
}
