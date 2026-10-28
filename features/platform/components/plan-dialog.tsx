"use client"

import { useState } from "react"
import { toast } from "sonner"
import { z } from "zod"

import { Field } from "@/components/field"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { auditEntry, moduleLabel, nowIso } from "../logic"
import { auditStore, plansStore } from "../store"
import { LIMITS } from "../types"
import type { Plan } from "../types"

const whole = (label: string) => z.string().trim().regex(/^\d+$/, `${label}: enter a whole number`).refine((v) => Number(v) >= 1, `${label} must be at least 1`)
const schema = z.object({
  price: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Enter a price like 149 or 149.50"),
  activeUsers: whole("Active users"),
  storageGb: whole("Storage"),
  messages: whole("Messages"),
  transcriptionMinutes: whole("Transcription"),
})
type Form = z.input<typeof schema> & { modules: string[] }
type Errors = Partial<Record<keyof z.input<typeof schema>, string>>

const toForm = (p: Plan): Form => ({
  price: String(p.priceMonthly),
  activeUsers: String(p.limits.activeUsers),
  storageGb: String(p.limits.storageGb),
  messages: String(p.limits.messages),
  transcriptionMinutes: String(p.limits.transcriptionMinutes),
  modules: p.modules,
})

// Edits the plan's price, limits and modules. Remounted per plan (key), so the form always starts from the plan's values.
export function PlanDialog({ plan, modules, open, onOpenChange, actor, today }: { plan: Plan | undefined; modules: string[]; open: boolean; onOpenChange(o: boolean): void; actor: string; today: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        {plan && <PlanForm key={plan.id} plan={plan} modules={modules} onOpenChange={onOpenChange} actor={actor} today={today} />}
      </DialogContent>
    </Dialog>
  )
}

function PlanForm({ plan, modules, onOpenChange, actor, today }: { plan: Plan; modules: string[]; onOpenChange(o: boolean): void; actor: string; today: string }) {
  const [form, setForm] = useState<Form>(() => toForm(plan))
  const [errors, setErrors] = useState<Errors>({})

  function setField(k: keyof Errors, v: string) {
    setForm((f) => ({ ...f, [k]: v }))
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = schema.safeParse(form)
    if (!parsed.success) {
      const next: Errors = {}
      for (const i of parsed.error.issues) {
        const k = i.path[0] as keyof Errors
        if (!next[k]) next[k] = i.message
      }
      setErrors(next)
      return
    }
    if (form.modules.length === 0) {
      toast.error("Keep at least one module on the plan")
      return
    }
    const v = parsed.data
    const next: Plan = {
      ...plan,
      priceMonthly: Number(v.price),
      limits: { activeUsers: Number(v.activeUsers), storageGb: Number(v.storageGb), messages: Number(v.messages), transcriptionMinutes: Number(v.transcriptionMinutes) },
      modules: modules.filter((m) => form.modules.includes(m)),
    }
    plansStore.set((all) => all.map((p) => (p.id === plan.id ? next : p)))
    auditStore.set((all) => [auditEntry(all, nowIso(today), actor, "plan.updated", plan.name, `Updated price, limits or modules of the ${plan.name} plan`), ...all])
    toast.success(`${plan.name} plan updated`)
    onOpenChange(false)
  }

  const limitFields = LIMITS.map((l) => ({ ...l, id: `pf-${l.key}` }))

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit {plan.name} plan</DialogTitle>
        <DialogDescription>Changes apply to every tenant on this plan and are recorded in the audit trail.</DialogDescription>
      </DialogHeader>
      <form className="od-form" onSubmit={submit} noValidate>
        <Field label={`Price per month (${plan.currency})`} htmlFor="pf-price" error={errors.price} required>
          <Input id="pf-price" inputMode="decimal" value={form.price} onChange={(e) => setField("price", e.target.value)} />
        </Field>
        <div className="od-row2">
          {limitFields.map((l) => (
            <Field key={l.key} label={`${l.label}${l.unit ? ` (${l.unit})` : ""}`} htmlFor={l.id} error={errors[l.key]} required>
              <Input id={l.id} inputMode="numeric" value={form[l.key]} onChange={(e) => setField(l.key, e.target.value)} />
            </Field>
          ))}
        </div>
        <fieldset className="pf-mods">
          <legend>Modules</legend>
          {modules.map((m) => {
            const id = `pf-mod-${m}`
            return (
              <label key={m} htmlFor={id} className="pf-mod">
                <span>{moduleLabel(m)}</span>
                <Switch
                  id={id}
                  checked={form.modules.includes(m)}
                  onCheckedChange={(c) => setForm((f) => ({ ...f, modules: c ? [...f.modules, m] : f.modules.filter((x) => x !== m) }))}
                />
              </label>
            )
          })}
        </fieldset>
        <div className="od-form-foot">
          <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
          <button type="submit" className="btn btn-primary">Save plan</button>
        </div>
      </form>
    </>
  )
}
