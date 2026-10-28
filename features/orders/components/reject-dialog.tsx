"use client"

import { useState } from "react"
import { z } from "zod"

import { ActionButton } from "@/components/action-button"
import { Field } from "@/components/field"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import type { Order } from "../types"

const schema = z.object({ reason: z.string().trim().min(3, "Give a reason of at least 3 characters").max(300, "Keep the reason under 300 characters") })

// FR-STOCK-03: rejecting a request needs a reason, which the requester sees.
export function RejectDialog({ order, open, onOpenChange, onReject }: { order: Order | undefined; open: boolean; onOpenChange(o: boolean): void; onReject(ref: string, reason: string): void }) {
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string>()

  function close(o: boolean) {
    onOpenChange(o)
    if (!o) {
      setReason("")
      setError(undefined)
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!order) return
    const parsed = schema.safeParse({ reason })
    if (!parsed.success) return setError(parsed.error.issues[0].message)
    onReject(order.ref, parsed.data.reason)
    close(false)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Reject request</DialogTitle>
          <DialogDescription>{order ? `${order.item} (${order.ref}) from ${order.requester}. The reason is shown to the requester.` : "Give a reason."}</DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={submit} noValidate>
          <Field label="Reason" htmlFor="ord-reason" error={error} required>
            <Textarea id="ord-reason" value={reason} onChange={(e) => { setReason(e.target.value); setError(undefined) }} />
          </Field>
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <ActionButton type="submit" className="btn btn-danger">Reject request</ActionButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
