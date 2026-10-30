"use client"

import { useState } from "react"
import { Package, Truck } from "lucide-react"
import { toast } from "sonner"
import { z } from "zod"

import { ActionButton } from "@/components/action-button"
import { DatePicker } from "@/components/date-picker"
import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { FormSection } from "@/components/form-section"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { nextRef } from "../mutations"
import { ordersStore } from "../store"
import type { Order } from "../types"

const schema = z.object({
  item: z.string().trim().min(2, "Enter the item").max(100, "Keep the item under 100 characters"),
  qty: z.string().trim().regex(/^\d+$/, "Enter a whole number").refine((v) => Number(v) >= 1, "Enter at least 1"),
  supplier: z.string().trim().min(2, "Enter the supplier").max(80),
  amount: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 640 or 12.50").refine((v) => Number(v) > 0, "Enter an amount above 0"),
  dept: z.string().min(1, "Choose a department"),
  expected: z.string().min(1, "Choose the expected date"),
})
type Form = z.input<typeof schema>
type Errors = Partial<Record<keyof Form, string>>

// A stock request starts as "waiting approval" (FR-STOCK-01).
export function NewOrderDialog({
  open,
  onOpenChange,
  departments,
  defaultDept,
  requester,
  today,
  currency,
  onCreated,
}: {
  open: boolean
  onOpenChange(o: boolean): void
  departments: string[]
  defaultDept: string
  requester: string
  today: string
  /** Tenant currency code (org settings), shown in the amount label. */
  currency: string
  onCreated(): void
}) {
  const blank = (): Form => ({ item: "", qty: "", supplier: "", amount: "", dept: defaultDept, expected: "" })
  const [form, setForm] = useState<Form>(blank)
  const [errors, setErrors] = useState<Errors>({})
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e))
  }

  function close(o: boolean) {
    onOpenChange(o)
    if (!o) {
      setForm(blank())
      setErrors({})
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = schema.safeParse(form)
    if (!parsed.success) {
      const next: Errors = {}
      for (const i of parsed.error.issues) {
        const k = i.path[0] as keyof Form
        if (!next[k]) next[k] = i.message
      }
      setErrors(next)
      return
    }
    const v = parsed.data
    const ref = nextRef(ordersStore.get() ?? [])
    ordersStore.set((prev) => {
      const at = `${today.slice(0, 10)}T${today.slice(11, 19)}`
      const order: Order = {
        ref, item: v.item, qty: Number(v.qty), supplier: v.supplier, requester, dept: v.dept,
        approval: "pending", delivery: "not_ordered", expected: v.expected, amount: Number(v.amount), received: 0, requested: at,
        history: [{ at, by: requester, action: "Requested", note: `${v.qty} x ${v.item} from ${v.supplier}` }],
      }
      return [order, ...prev]
    })
    toast.success(`Request ${ref} sent for approval`)
    close(false)
    onCreated()
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>New stock request</DialogTitle>
          <DialogDescription>An approver signs it off before anything is ordered.</DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={submit} noValidate>
          <FormSection icon={Package} title="Item">
            <div className="od-row2">
              <Field label="Item" htmlFor="no-item" error={errors.item} required>
                <Input id="no-item" placeholder="e.g. Floor cleaner 5L" value={form.item} onChange={(e) => set("item", e.target.value)} />
              </Field>
              <Field label="Department" htmlFor="no-dept" error={errors.dept} required>
                <FilterSelect label="Department" value={form.dept} options={departments.map((d) => ({ value: d, label: d }))} onChange={(v) => set("dept", v)} />
              </Field>
            </div>
            <div className="od-row2">
              <Field label="Quantity" htmlFor="no-qty" error={errors.qty} required>
                <Input id="no-qty" inputMode="numeric" placeholder="e.g. 10" value={form.qty} onChange={(e) => set("qty", e.target.value)} />
              </Field>
              <Field label={`Amount (${currency})`} htmlFor="no-amount" error={errors.amount} required>
                <Input id="no-amount" inputMode="decimal" placeholder="e.g. 12.50" value={form.amount} onChange={(e) => set("amount", e.target.value)} />
              </Field>
            </div>
          </FormSection>
          <FormSection icon={Truck} title="Delivery">
            <div className="od-row2">
              <Field label="Supplier" htmlFor="no-supplier" error={errors.supplier} required>
                <Input id="no-supplier" value={form.supplier} onChange={(e) => set("supplier", e.target.value)} />
              </Field>
              <Field label="Expected" htmlFor="no-expected" error={errors.expected} required>
                <DatePicker label="Expected delivery" value={form.expected} today={today} min={today.slice(0, 10)} placeholder="Pick a date" onChange={(v) => set("expected", v)} />
              </Field>
            </div>
          </FormSection>
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <ActionButton type="submit" className="btn btn-primary">Send for approval</ActionButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
