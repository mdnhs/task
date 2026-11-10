"use client"

import { ActionButton } from "@/components/action-button"
import { useState } from "react"

import { Field } from "@/components/field"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

// A one-line reason (FR-RS-35): office edits to a published roster must say why. Small enough for a dialog, no scrolling.
export function ReasonDialog({ title, description, confirmLabel, onConfirm, onClose }: {
  title: string
  description: string
  confirmLabel: string
  onConfirm(reason: string): void
  onClose(): void
}) {
  const [reason, setReason] = useState("")
  const [error, setError] = useState("")
  function submit(e: React.FormEvent) {
    e.preventDefault()
    const v = reason.trim()
    if (!v) { setError("Give a reason"); return }
    onConfirm(v)
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={submit} noValidate>
          <Field label="Reason" htmlFor="rd-reason" error={error || undefined} required>
            <Input id="rd-reason" autoFocus placeholder="e.g. Cover for sickness" value={reason} onChange={(e) => { setReason(e.target.value); setError("") }} />
          </Field>
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <ActionButton type="submit" className="btn btn-primary">{confirmLabel}</ActionButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
