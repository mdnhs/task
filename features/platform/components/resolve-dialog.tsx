"use client"

import { useState } from "react"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { Field } from "@/components/field"
import { Textarea } from "@/components/ui/textarea"
import { REASON_MIN } from "../constants"

// ConfirmDialog with one required text field (D7): the completion note ("export ready") or the rejection reason.
export function ResolveDialog({
  open, onOpenChange, title, text, label, confirmLabel, destructive, onConfirm,
}: {
  open: boolean
  onOpenChange(o: boolean): void
  title: string
  text: string
  label: string
  confirmLabel: string
  destructive?: boolean
  onConfirm(text: string): void
}) {
  const [value, setValue] = useState("")
  function change(o: boolean) {
    onOpenChange(o)
    if (!o) setValue("")
  }
  return (
    <ConfirmDialog open={open} onOpenChange={change} title={title} text={text} confirmLabel={confirmLabel} destructive={destructive} confirmDisabled={value.trim().length < REASON_MIN} onConfirm={() => onConfirm(value.trim())}>
      <Field label={label} htmlFor="pf-resolve-text" hint={`At least ${REASON_MIN} characters · no personal data`} required>
        <Textarea id="pf-resolve-text" value={value} rows={3} maxLength={300} onChange={(e) => setValue(e.target.value)} />
      </Field>
    </ConfirmDialog>
  )
}
