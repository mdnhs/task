"use client"

import { useState } from "react"
import { z } from "zod"

import { ActionButton } from "@/components/action-button"
import { Field } from "@/components/field"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { remaining } from "../mutations"
import type { Order } from "../types"

// Mark delivered with the quantity actually received. Less than the outstanding amount books a partial delivery.
export function DeliverDialog({ order, open, onOpenChange, onReceive }: { order: Order | undefined; open: boolean; onOpenChange(o: boolean): void; onReceive(ref: string, qty: number): void }) {
  // undefined = untouched: the field shows the outstanding quantity so "all delivered" is one click.
  const [typed, setQty] = useState<string>()
  const [error, setError] = useState<string>()
  const left = order ? remaining(order) : 0
  const qty = typed ?? String(left)

  function close(o: boolean) {
    onOpenChange(o)
    if (!o) {
      setQty(undefined)
      setError(undefined)
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!order) return
    const schema = z
      .string()
      .trim()
      .regex(/^\d+$/, "Enter a whole number")
      .transform(Number)
      .pipe(z.number().min(1, "Enter at least 1").max(left, `Only ${left} still to arrive`))
    const parsed = schema.safeParse(qty)
    if (!parsed.success) return setError(parsed.error.issues[0].message)
    onReceive(order.ref, parsed.data)
    close(false)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Mark delivered</DialogTitle>
          <DialogDescription>
            {order ? `${order.item} (${order.ref}) · ${order.received} of ${order.qty} received, ${left} to come.` : "Enter the quantity received."}
          </DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={submit} noValidate>
          <Field label="Received" htmlFor="ord-qty" error={error} hint={error ? undefined : `Less than ${left} books a partial delivery`} required>
            <Input id="ord-qty" inputMode="numeric" value={qty} onChange={(e) => { setQty(e.target.value); setError(undefined) }} />
          </Field>
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <ActionButton type="submit" className="btn btn-primary">Save delivery</ActionButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
