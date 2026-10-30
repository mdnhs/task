"use client"

import { useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { ArrowLeftRight, CalendarCheck, CalendarPlus, Layers, ShieldCheck, Trash2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { EmptyState } from "@/components/empty-state"
import { Field } from "@/components/field"
import { FilterSeg } from "@/components/filter-bar"
import { FormSection } from "@/components/form-section"
import { PageHead } from "@/components/page-head"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { effectiveModules } from "@/lib/entitlements"
import { PLATFORM_LOCALE, REASON_MIN } from "../../constants"
import { TRIAL_EXTENSION_MAX, addDaysToDate, changePlan, dateY, extendTrial, nowIso, scheduleDeletion } from "../../logic"
import { money } from "../../money"
import { planChoices } from "../../plans"
import { plansStore } from "../../store"
import { tenantPath, type ModulesTab, type T360Head } from "../../tenant-360"
import { LIMITS } from "../../types"
import type { Plan, PlatformTenant } from "../../types"
import { commitTenant, subIds, useLiveTenant, type T360Ctx } from "./live"

// The tenant 360's long forms (rule 31: they would scroll as dialogs at 1568×698): change plan, extend trial and
// schedule deletion. Each is its own route with an exact skeleton; .od-form-cols with two columns above 1100px.

const num = (n: number) => n.toLocaleString(PLATFORM_LOCALE)

function Back({ t, to, label }: { t: PlatformTenant; to: Parameters<typeof tenantPath>[1]; label: string }) {
  return <Link href={tenantPath(t.id, to)} className="pf-back">← {label}</Link>
}

function ReasonField({ value, onChange, error }: { value: string; onChange(v: string): void; error?: string }) {
  return (
    <Field label="Reason" htmlFor="pf-form-reason" error={error} hint={`At least ${REASON_MIN} characters · audit trail`} required>
      <Textarea id="pf-form-reason" value={value} rows={3} maxLength={300} onChange={(e) => onChange(e.target.value)} />
    </Field>
  )
}
const reasonError = (r: string) => (r.trim().length < REASON_MIN ? `Explain why in at least ${REASON_MIN} characters` : undefined)

// ---------- Change plan ----------

export function ChangePlanView({ head, modules, ctx }: { head: T360Head; modules: ModulesTab; ctx: T360Ctx }) {
  const router = useRouter()
  const t = useLiveTenant(head.tenant, head.can.amounts)
  // Archived plans can't be chosen (Task 7): the server flag, plus any archive made in this session (plans store).
  const stored = useSyncExternalStore(plansStore.subscribe, plansStore.get, () => undefined)
  const archivedNow = new Set((stored ?? []).filter((p) => p.archived).map((p) => p.id))
  const choices = planChoices(head.plans, t.plan, archivedNow)
  const current = head.plans.find((p) => p.id === t.plan)
  const [to, setTo] = useState(() => choices.find((p) => p.id !== t.plan)?.id ?? "")
  const [reason, setReason] = useState("")
  const [errors, setErrors] = useState<{ reason?: string }>({})
  const target = head.plans.find((p) => p.id === to)
  const plans: Plan[] = head.plans.map((p) => ({ ...p, priceMonthly: p.priceMonthly ?? 0, trialDays: 0 }))
  const paying = t.status === "active" || t.status === "past_due"
  const delta = target && current && paying ? (target.priceMonthly ?? 0) - (current.priceMonthly ?? 0) : 0
  const currency = target?.currency ?? current?.currency ?? ""
  const ent = { productModules: modules.catalogue, plans: modules.plans, core: modules.core, modules: {}, assistant: "", defaultPlan: t.plan }
  const before = new Set(effectiveModules(ent, t.plan, t.moduleOverrides))
  const after = new Set(target ? effectiveModules(ent, target.id, t.moduleOverrides) : [])
  const gained = modules.catalogue.filter((m) => after.has(m.id) && !before.has(m.id))
  const lost = modules.catalogue.filter((m) => before.has(m.id) && !after.has(m.id))
  const over = target ? LIMITS.filter((l) => t[l.used] > target.limits[l.key]) : []

  if (t.status === "suspended") {
    return (
      <>
        <Back t={t} to="billing" label="Billing" />
        <EmptyState icon="lock" title="Reactivate first" text={`${t.name} is suspended. Reactivate it before changing its plan.`} action={<Link href={tenantPath(t.id, "settings")} className="btn btn-outline">Go to settings</Link>} />
      </>
    )
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const err = { reason: reasonError(reason) }
    setErrors(err)
    if (err.reason || !target) return
    const { tenant, event } = changePlan(t, plans.find((p) => p.id === target.id)!, nowIso(ctx.today), reason, { plans, events: subIds(head.ids.sub) })
    commitTenant(ctx, t, tenant, { action: "subscription.plan_changed", detail: `Plan changed from ${current?.name ?? t.plan} to ${target.name}: ${reason.trim()}`, reason, event })
    toast.success(`${t.name} is on ${target.name} now`)
    router.push(tenantPath(t.id, "billing"))
  }

  return (
    <>
      <Back t={t} to="billing" label="Billing" />
      <PageHead title={`Change ${t.name}'s plan`} subtitle={`Now on ${current?.name ?? t.plan}. The change applies immediately and is recorded in the audit trail.`} />
      <form className="card pf-form od-form" onSubmit={submit} noValidate aria-label="Change plan">
        <div className="od-form-cols">
          <div className="od-form-col">
            <FormSection icon={Layers} title="New plan">
            <fieldset className="pf-plan-pick">
              <legend className="sr-only">New plan</legend>
              {choices.map((p) => {
                const isCurrent = p.id === t.plan
                return (
                  <label key={p.id} className="pf-plan-opt" data-current={isCurrent || undefined}>
                    <input type="radio" name="plan" value={p.id} checked={to === p.id} disabled={isCurrent} onChange={() => setTo(p.id)} />
                    <span className="pf-plan-opt-main">
                      <span className="tt">{p.name}{isCurrent && <span className="pf-plan-cur">Current</span>}</span>
                      <span className="pf-plan-opt-d num">
                        {num(p.limits.activeUsers)} users · {num(p.limits.storageGb)} GB · {num(p.limits.messages)} messages
                      </span>
                    </span>
                    {p.priceMonthly != null && <span className="pf-plan-opt-p num">{money(p.priceMonthly, p.currency)}<small> / month</small></span>}
                  </label>
                )
              })}
            </fieldset>
            </FormSection>
          </div>
          <div className="od-form-col">
            <FormSection icon={ArrowLeftRight} title="What changes">
            <div className="pf-form-sum" aria-live="polite">
              <dl className="pf-meta pf-meta-1">
                <div>
                  <dt>Monthly recurring revenue</dt>
                  <dd className="num">
                    {!paying ? "No change: trials don't bill until they convert" : delta === 0 ? "No change" : `${delta > 0 ? "+" : "−"}${money(Math.abs(delta), currency)} / month`}
                  </dd>
                </div>
                <div>
                  <dt>Modules</dt>
                  <dd>{gained.length || lost.length ? [gained.length ? `Gains ${gained.map((m) => m.label).join(", ")}` : "", lost.length ? `Loses ${lost.map((m) => m.label).join(", ")}` : ""].filter(Boolean).join(". ") : "Same modules"}</dd>
                </div>
                {over.length > 0 && target && (
                  <div>
                    <dt>Over the new limits</dt>
                    <dd className="pf-warn-text">{over.map((l) => `${l.label} ${num(t[l.used])}${l.unit ? ` ${l.unit}` : ""} (limit ${num(target.limits[l.key])})`).join(" · ")}</dd>
                  </div>
                )}
              </dl>
            </div>
            </FormSection>
            <FormSection icon={ShieldCheck} title="Confirm">
              <ReasonField value={reason} onChange={(v) => { setReason(v); if (errors.reason) setErrors({}) }} error={errors.reason} />
            </FormSection>
          </div>
        </div>
        <div className="od-form-foot">
          <Link href={tenantPath(t.id, "billing")} className="btn btn-outline">Cancel</Link>
          <button type="submit" className="btn btn-primary" disabled={!target}>{target ? `Move to ${target.name}` : "Change plan"}</button>
        </div>
      </form>
    </>
  )
}

// ---------- Extend trial ----------

const PRESETS = ["7", "14", "30"] as const

export function ExtendTrialView({ head, ctx }: { head: T360Head; ctx: T360Ctx }) {
  const router = useRouter()
  const t = useLiveTenant(head.tenant, head.can.amounts)
  const [days, setDays] = useState("7")
  const [reason, setReason] = useState("")
  const [errors, setErrors] = useState<{ days?: string; reason?: string }>({})
  const n = Number(days)
  const daysOk = Number.isInteger(n) && n >= 1 && n <= TRIAL_EXTENSION_MAX
  const end = t.billing.trialEndsOn

  if (t.status !== "trial" || !end) {
    return (
      <>
        <Back t={t} to="overview" label="Overview" />
        <EmptyState icon="clock" title="Not on a trial" text={`Only a tenant on a trial can have its trial extended. ${t.name} isn't on one.`} action={<Link href={tenantPath(t.id)} className="btn btn-outline">Back to overview</Link>} />
      </>
    )
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const err = { days: daysOk ? undefined : `Choose 1 to ${TRIAL_EXTENSION_MAX} days`, reason: reasonError(reason) }
    setErrors(err)
    if (err.days || err.reason) return
    const after = extendTrial(t, n, reason)
    commitTenant(ctx, t, after, { action: "subscription.trial_extended", detail: `Trial extended by ${n} days to ${dateY(after.billing.trialEndsOn!)}: ${reason.trim()}`, reason })
    toast.success(`Trial extended to ${dateY(after.billing.trialEndsOn!)}`)
    router.push(tenantPath(t.id))
  }

  return (
    <>
      <Back t={t} to="overview" label="Overview" />
      <PageHead title={`Extend ${t.name}'s trial`} subtitle={`The trial ends on ${dateY(end)} ${ctx.tzLabel}. Extensions are recorded in the audit trail.`} />
      <form className="card pf-form od-form" onSubmit={submit} noValidate aria-label="Extend trial">
        <div className="od-form-cols">
          <div className="od-form-col">
            <FormSection icon={CalendarPlus} title="Extend by">
              <FilterSeg
                label="Extend by"
                value={(PRESETS as readonly string[]).includes(days) ? (days as (typeof PRESETS)[number]) : ("" as (typeof PRESETS)[number])}
                options={PRESETS.map((d) => ({ value: d, label: `${d} days` }))}
                onChange={(v) => { setDays(v); if (errors.days) setErrors((x) => ({ ...x, days: undefined })) }}
              />
              <Field label="Days" htmlFor="pf-trial-days" error={errors.days} hint={`Max ${TRIAL_EXTENSION_MAX}`} required>
                <Input id="pf-trial-days" inputMode="numeric" value={days} onChange={(e) => { setDays(e.target.value.replace(/\D/g, "")); if (errors.days) setErrors((x) => ({ ...x, days: undefined })) }} />
              </Field>
            </FormSection>
          </div>
          <div className="od-form-col">
            <FormSection icon={CalendarCheck} title="New trial end">
              <div className="pf-form-sum" aria-live="polite">
                <p className="pf-form-big num">{daysOk ? `${dateY(addDaysToDate(end, n))} ${ctx.tzLabel}` : "—"}</p>
              </div>
            </FormSection>
            <FormSection icon={ShieldCheck} title="Confirm">
              <ReasonField value={reason} onChange={(v) => { setReason(v); if (errors.reason) setErrors((x) => ({ ...x, reason: undefined })) }} error={errors.reason} />
            </FormSection>
          </div>
        </div>
        <div className="od-form-foot">
          <Link href={tenantPath(t.id)} className="btn btn-outline">Cancel</Link>
          <button type="submit" className="btn btn-primary">Extend trial</button>
        </div>
      </form>
    </>
  )
}

// ---------- Schedule deletion ----------

export function ScheduleDeletionView({ head, ctx, retentionDays }: { head: T360Head; ctx: T360Ctx; retentionDays: number }) {
  const router = useRouter()
  const t = useLiveTenant(head.tenant, head.can.amounts)
  const [reason, setReason] = useState("")
  const [typed, setTyped] = useState("")
  const [errors, setErrors] = useState<{ reason?: string; slug?: string }>({})
  const on = addDaysToDate(ctx.today, retentionDays)

  if (t.deletionAt) {
    return (
      <>
        <Back t={t} to="settings" label="Settings" />
        <EmptyState icon="lock" title="Deletion already scheduled" text={`${t.name} is scheduled for deletion on ${dateY(t.deletionAt)}.`} action={<Link href={tenantPath(t.id, "settings")} className="btn btn-outline">Back to settings</Link>} />
      </>
    )
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    // Fails closed: without a slug there is nothing to type, so the form never submits.
    const err = { reason: reasonError(reason), slug: t.slug && typed.trim() === t.slug ? undefined : `Type ${t.slug} exactly to confirm` }
    setErrors(err)
    if (err.reason || err.slug) return
    const after = scheduleDeletion(t, ctx.today, retentionDays, reason)
    commitTenant(ctx, t, after, { action: "tenant.deletion_scheduled", detail: `Deletion scheduled for ${dateY(after.deletionAt!)}: ${reason.trim()}`, reason })
    toast.success(`Deletion scheduled for ${dateY(after.deletionAt!)}`)
    router.push(tenantPath(t.id, "settings"))
  }

  return (
    <>
      <Back t={t} to="settings" label="Settings" />
      <PageHead title={`Schedule deletion of ${t.name}`} subtitle={`After the ${retentionDays}-day retention period the workspace and all its data are deleted. Until then it can be cancelled.`} />
      <form className="card pf-form od-form" onSubmit={submit} noValidate aria-label="Schedule deletion">
        <div className="od-form-cols">
          <div className="od-form-col">
            <FormSection icon={Trash2} title={`Deleted on ${dateY(on)}`} className="pf-sec-danger">
            <div className="pf-form-sum pf-form-danger">
              <ul className="pf-form-list">
                <li>The workspace <span className="num">{t.subdomain}</span> and its settings</li>
                <li><span className="num">{num(t.users)}</span> user accounts and their sign-ins</li>
                <li><span className="num">{num(t.storageGb)} GB</span> of stored files and records</li>
              </ul>
              <p className="pf-muted">Invoices are kept. Export first? <Link href={tenantPath(t.id, "settings")} className="pf-inline-link">Request one in Settings</Link>.</p>
            </div>
            </FormSection>
          </div>
          <div className="od-form-col">
            <FormSection icon={ShieldCheck} title="Confirm">
              <ReasonField value={reason} onChange={(v) => { setReason(v); if (errors.reason) setErrors((x) => ({ ...x, reason: undefined })) }} error={errors.reason} />
              <Field label={`Type ${t.slug} to confirm`} htmlFor="pf-del-slug" error={errors.slug} required>
                <Input id="pf-del-slug" value={typed} autoComplete="off" spellCheck={false} onChange={(e) => { setTyped(e.target.value); if (errors.slug) setErrors((x) => ({ ...x, slug: undefined })) }} />
              </Field>
            </FormSection>
          </div>
        </div>
        <div className="od-form-foot">
          <Link href={tenantPath(t.id, "settings")} className="btn btn-outline">Cancel</Link>
          <button type="submit" className="btn btn-danger">Schedule deletion</button>
        </div>
      </form>
    </>
  )
}
