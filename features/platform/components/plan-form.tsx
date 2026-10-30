"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { z } from "zod"

import { Field } from "@/components/field"
import { Input } from "@/components/ui/input"
import { PageHead } from "@/components/page-head"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { withPlanModules, type EntitlementsData } from "@/lib/entitlements"
import { PLAN_EDIT_SUBTITLE, PLAN_NEW_SUBTITLE, PLANS_PATH, PRICE_CHANGE_NOTICE, REASON_MIN } from "../constants"
import { auditEntry, limitLabel, nowIso, priceLabel, sensitiveEntry } from "../logic"
import { money } from "../money"
import { validateNewPlan, TRIAL_LABEL, type NewPlanErrors, type NewPlanInput, type PlanFormData } from "../plans"
import { SCOPE, auditOutbox, entitlementsStore, knownAudit, plansStore, settingsStore } from "../store"
import { LIMITS } from "../types"
import type { Plan, StaffRole } from "../types"

export type Operator = { name: string; role: StaffRole }

const whole = (label: string) => z.string().trim().regex(/^\d+$/, `${label}: enter a whole number`).refine((v) => Number(v) >= 1, `${label} must be at least 1`)
const schema = z.object({
  price: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Enter a price like 149 or 149.50"),
  activeUsers: whole("Active users"),
  storageGb: whole("Storage"),
  messages: whole("Messages"),
  transcriptionMinutes: whole("Transcription"),
})
type Form = z.input<typeof schema> & { modules: string[] }
type Errors = Partial<Record<keyof z.input<typeof schema> | "reason" | "modules", string>>

const toForm = (p: Plan, entitlements: EntitlementsData): Form => ({
  price: Number.isInteger(p.priceMonthly) ? String(p.priceMonthly) : p.priceMonthly.toFixed(2),
  activeUsers: String(p.limits.activeUsers),
  storageGb: String(p.limits.storageGb),
  messages: String(p.limits.messages),
  transcriptionMinutes: String(p.limits.transcriptionMinutes),
  modules: entitlements.plans[p.id] ?? [],
})

/** The plan catalogue as this session knows it: the server's plans and entitlements, overlaid by edits in the stores. */
function usePlanCatalogue(data: PlanFormData) {
  const [plans] = plansStore.useStore(data.plans, SCOPE)
  const [entitlements] = entitlementsStore.useStore(data.entitlements, SCOPE)
  return { plans, entitlements }
}

// /platform/plans/[id]/edit (was a dialog on /platform/plans; long forms are pages). Gets only the plan catalogue
// (plans.ts planFormData) and reads the shared plan stores, so the form starts from any edit made earlier in this session
// and the plans page shows the change after Save. Its audit line goes to auditOutbox (store.ts patch contract).
export function PlanEditView({ data, planId, operator, today }: { data: PlanFormData; planId: string; operator: Operator; today: string }) {
  const { plans, entitlements } = usePlanCatalogue(data)
  const plan = plans.find((p) => p.id === planId)
  if (!plan) return null // the route already 404s unknown ids
  return (
    <>
      <Link href={PLANS_PATH} className="pf-back">← Plans</Link>
      <PageHead title={`Edit ${plan.name} plan`} subtitle={PLAN_EDIT_SUBTITLE} />
      <PlanForm key={plan.id} plan={plan} entitlements={entitlements} operator={operator} today={today} />
    </>
  )
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))

// Edits the plan's price, limits and its product modules (entitlements.plans, FR-M0-15). A price change is sensitive (D7):
// it needs a reason, and the audit line records the price before and after. Existing tenants keep their price until renewal.
function PlanForm({ plan, entitlements, operator, today }: { plan: Plan; entitlements: EntitlementsData; operator: Operator; today: string }) {
  const router = useRouter()
  const [form, setForm] = useState<Form>(() => toForm(plan, entitlements))
  const [reason, setReason] = useState("")
  const [errors, setErrors] = useState<Errors>({})
  const newPrice = /^\d+(\.\d{1,2})?$/.test(form.price.trim()) ? Number(form.price) : null
  const priceChanged = newPrice !== null && newPrice !== plan.priceMonthly

  function setField(k: keyof Errors, v: string) {
    setForm((f) => ({ ...f, [k]: v }))
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = schema.safeParse(form)
    const next: Errors = {}
    if (!parsed.success) {
      for (const i of parsed.error.issues) {
        const k = i.path[0] as keyof Errors
        if (!next[k]) next[k] = i.message
      }
    }
    if (priceChanged && reason.trim().length < REASON_MIN) next.reason = `Explain why in at least ${REASON_MIN} characters`
    if (form.modules.length === 0) next.modules = "Keep at least one module on the plan"
    if (Object.keys(next).length || !parsed.success) {
      setErrors(next)
      return
    }
    const v = parsed.data
    const limits = { activeUsers: Number(v.activeUsers), storageGb: Number(v.storageGb), messages: Number(v.messages), transcriptionMinutes: Number(v.transcriptionMinutes) }
    const updated: Plan = { ...plan, priceMonthly: Number(v.price), limits }
    const was = toForm(plan, entitlements)
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    if (priceChanged) { before.priceMonthly = plan.priceMonthly; after.priceMonthly = updated.priceMonthly }
    for (const l of LIMITS) if (plan.limits[l.key] !== limits[l.key]) { before[l.key] = plan.limits[l.key]; after[l.key] = limits[l.key] }
    if (!sameSet(was.modules, form.modules)) { before.modules = was.modules; after.modules = form.modules }
    const at = nowIso(today)
    plansStore.set((all) => all.map((p) => (p.id === plan.id ? updated : p)))
    entitlementsStore.set((data) => withPlanModules(data, plan.id, form.modules))
    const all = knownAudit()
    auditOutbox.set((list) => [
      priceChanged
        ? sensitiveEntry(all, {
            at, actor: operator.name, staffRole: operator.role, action: "plan.price_changed", target: plan.name,
            detail: `Price of the ${plan.name} plan ${money(plan.priceMonthly, plan.currency)} to ${money(updated.priceMonthly, plan.currency)} a month: ${reason.trim()}`,
            before, after, reason,
          })
        : { ...auditEntry(all, at, operator.name, "plan.updated", plan.name, `Updated limits or modules of the ${plan.name} plan`), staffRole: operator.role, before, after },
      ...list,
    ])
    toast.success(`${plan.name} plan updated`)
    router.push(PLANS_PATH)
  }

  return (
    <form className="card pf-form od-form" onSubmit={submit} noValidate aria-label={`Edit ${plan.name} plan`}>
      <div className="od-form-cols">
        <div className="od-form-col">
          <Field label={priceLabel(plan.currency)} htmlFor="pf-price" error={errors.price} required>
            <Input id="pf-price" inputMode="decimal" value={form.price} onChange={(e) => setField("price", e.target.value)} />
          </Field>
          <div className="od-row2">
            {LIMITS.map((l) => (
              <Field key={l.key} label={limitLabel(l)} htmlFor={`pf-${l.key}`} error={errors[l.key]} required>
                <Input id={`pf-${l.key}`} inputMode="numeric" value={form[l.key]} onChange={(e) => setField(l.key, e.target.value)} />
              </Field>
            ))}
          </div>
          {priceChanged && (
            <>
              <p className="pf-note pf-note-warn pf-note-flat" role="status">
                {PRICE_CHANGE_NOTICE} The change from {money(plan.priceMonthly, plan.currency)} to {money(newPrice, plan.currency)} a month is recorded in the audit trail.
              </p>
              <Field label="Reason" htmlFor="pf-price-reason" error={errors.reason} hint={`At least ${REASON_MIN} characters. Saved in the audit trail.`} required>
                <Textarea id="pf-price-reason" value={reason} rows={2} maxLength={300} onChange={(e) => { setReason(e.target.value); setErrors((x) => ({ ...x, reason: undefined })) }} />
              </Field>
            </>
          )}
        </div>
        <div className="od-form-col">
          <ModuleSet
            entitlements={entitlements}
            modules={form.modules}
            error={errors.modules}
            onChange={(modules) => {
              setForm((f) => ({ ...f, modules }))
              setErrors((x) => ({ ...x, modules: undefined }))
            }}
          />
        </div>
      </div>
      <div className="od-form-foot">
        <Link href={PLANS_PATH} className="btn btn-outline">Cancel</Link>
        <button type="submit" className="btn btn-primary">Save plan</button>
      </div>
    </form>
  )
}

// `error` shows inline under the switches (no toast), so it reads with the other field errors and clears on a change.
function ModuleSet({ entitlements, modules, error, onChange }: { entitlements: EntitlementsData; modules: string[]; error?: string; onChange(m: string[]): void }) {
  return (
    <fieldset className="pf-modset" aria-describedby={error ? "pf-modset-msg" : undefined} aria-invalid={error ? true : undefined} data-invalid={error ? "" : undefined}>
      <legend>Modules</legend>
      {entitlements.productModules.map(({ id: m, label }) => {
        const id = `pf-mod-${m}`
        return (
          <label key={m} htmlFor={id} className="pf-mod">
            <span>{label}</span>
            <Switch id={id} checked={modules.includes(m)} onCheckedChange={(c) => onChange(c ? [...modules, m] : modules.filter((x) => x !== m))} />
          </label>
        )
      })}
      {error && (
        <div className="od-field-msg is-enter pf-modset-msg">
          <p id="pf-modset-msg" className="od-field-err" role="alert">{error}</p>
        </div>
      )}
    </fieldset>
  )
}

// ---------- New plan (/platform/plans/new) ----------

export function PlanNewView({ data, operator, today, defaultTrialDays }: { data: PlanFormData; operator: Operator; today: string; defaultTrialDays: number }) {
  const { plans, entitlements } = usePlanCatalogue(data)
  return (
    <>
      <Link href={PLANS_PATH} className="pf-back">← Plans</Link>
      <PageHead title="New plan" subtitle={PLAN_NEW_SUBTITLE} />
      <NewPlanForm plans={plans} entitlements={entitlements} operator={operator} today={today} defaultTrialDays={defaultTrialDays} />
    </>
  )
}

function NewPlanForm({ plans, entitlements, operator, today, defaultTrialDays }: { plans: Plan[]; entitlements: EntitlementsData; operator: Operator; today: string; defaultTrialDays: number }) {
  const router = useRouter()
  // Plans share a currency in practice; the first plan decides (the price label and the comparison show it).
  const currency = plans[0]?.currency ?? "EUR"
  const [form, setForm] = useState<NewPlanInput>({
    // A trial length saved in the console's Settings this session wins over the server value (final review minor 7).
    id: "", name: "", price: "", trialDays: String(settingsStore.get()?.defaultTrialDays ?? defaultTrialDays), activeUsers: "", storageGb: "", messages: "", transcriptionMinutes: "",
  })
  const [modules, setModules] = useState<string[]>([])
  const [reason, setReason] = useState("")
  const [errors, setErrors] = useState<NewPlanErrors>({})
  const [modulesError, setModulesError] = useState<string | undefined>()

  function setField(k: keyof NewPlanInput, v: string) {
    setForm((f) => ({ ...f, [k]: v }))
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const { errors: found, plan } = validateNewPlan(form, plans, currency)
    const noModules = modules.length === 0
    setModulesError(noModules ? "Choose at least one module for the plan" : undefined)
    if (!plan || noModules) {
      setErrors(found)
      return
    }
    const note = reason.trim()
    plansStore.set((all) => [...all, plan])
    entitlementsStore.set((data) => withPlanModules(data, plan.id, modules))
    auditOutbox.set((list) => [
      {
        ...auditEntry(knownAudit(), nowIso(today), operator.name, "plan.created", plan.name, `Created the ${plan.name} plan at ${money(plan.priceMonthly, currency)} a month${note ? `: ${note}` : ""}`),
        staffRole: operator.role,
        before: {},
        after: { id: plan.id, priceMonthly: plan.priceMonthly, trialDays: plan.trialDays, limits: plan.limits, modules },
        ...(note ? { reason: note } : {}),
      },
      ...list,
    ])
    toast.success(`${plan.name} plan created`)
    router.push(PLANS_PATH)
  }

  return (
    <form className="card pf-form od-form" onSubmit={submit} noValidate aria-label="New plan">
      <div className="od-form-cols">
        <div className="od-form-col">
          <div className="od-row2">
            <Field label="Plan ID" htmlFor="pf-id" error={errors.id} required>
              <Input id="pf-id" value={form.id} placeholder="team-plus" autoComplete="off" spellCheck={false} maxLength={40} onChange={(e) => setField("id", e.target.value)} />
            </Field>
            <Field label="Name" htmlFor="pf-name" error={errors.name} required>
              <Input id="pf-name" value={form.name} autoComplete="off" maxLength={40} onChange={(e) => setField("name", e.target.value)} />
            </Field>
          </div>
          <div className="od-row2">
            <Field label={priceLabel(currency)} htmlFor="pf-price" error={errors.price} required>
              <Input id="pf-price" inputMode="decimal" value={form.price} onChange={(e) => setField("price", e.target.value)} />
            </Field>
            <Field label={TRIAL_LABEL} htmlFor="pf-trial" error={errors.trialDays} required>
              <Input id="pf-trial" inputMode="numeric" value={form.trialDays} onChange={(e) => setField("trialDays", e.target.value)} />
            </Field>
          </div>
          <div className="od-row2">
            {LIMITS.map((l) => (
              <Field key={l.key} label={limitLabel(l)} htmlFor={`pf-${l.key}`} error={errors[l.key]} required>
                <Input id={`pf-${l.key}`} inputMode="numeric" value={form[l.key]} onChange={(e) => setField(l.key, e.target.value)} />
              </Field>
            ))}
          </div>
        </div>
        <div className="od-form-col">
          <ModuleSet
            entitlements={entitlements}
            modules={modules}
            error={modulesError}
            onChange={(m) => {
              setModules(m)
              setModulesError(undefined)
            }}
          />
          <Field label="Reason" htmlFor="pf-new-reason" hint="Optional. Saved in the audit trail.">
            <Textarea id="pf-new-reason" value={reason} rows={2} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
      </div>
      <div className="od-form-foot">
        <Link href={PLANS_PATH} className="btn btn-outline">Cancel</Link>
        <button type="submit" className="btn btn-primary">Create plan</button>
      </div>
    </form>
  )
}
