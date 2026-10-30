"use client"

import { useState } from "react"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { Field } from "@/components/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { REASON_MIN } from "../constants"


// ConfirmDialog for sensitive actions (D7). `reason`: a required reason field (passed to onConfirm). `slug`: a
// type-to-confirm field for destructive actions. Confirm stays disabled until both are filled in.
export function SlugConfirmDialog({
  open,
  onOpenChange,
  title,
  text,
  slug,
  reason = false,
  confirmLabel,
  destructive,
  onConfirm,
}: {
  open: boolean
  onOpenChange(o: boolean): void
  title: string
  text: string
  slug?: string
  reason?: boolean
  confirmLabel: string
  destructive?: boolean
  onConfirm(reason: string): void
}) {
  const [typed, setTyped] = useState("")
  const [why, setWhy] = useState("")

  function change(o: boolean) {
    onOpenChange(o)
    if (!o) {
      setTyped("")
      setWhy("")
    }
  }

  const reasonOk = !reason || why.trim().length >= REASON_MIN
  // An empty slug never matches: a destructive dialog without a slug to type fails closed rather than skipping the check.
  const slugOk = slug === undefined || (slug !== "" && typed.trim() === slug)

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={change}
      title={title}
      text={text}
      confirmLabel={confirmLabel}
      destructive={destructive}
      confirmDisabled={!reasonOk || !slugOk}
      onConfirm={() => onConfirm(why.trim())}
    >
      {reason && (
        <Field label="Reason" htmlFor="pf-confirm-reason" hint={`At least ${REASON_MIN} characters. Saved in the audit trail.`} required>
          <Textarea id="pf-confirm-reason" value={why} rows={2} maxLength={300} onChange={(e) => setWhy(e.target.value)} />
        </Field>
      )}
      {slug !== undefined && (
        <Field label={`Type ${slug} to confirm`} htmlFor="pf-confirm-slug" required>
          <Input id="pf-confirm-slug" value={typed} autoComplete="off" spellCheck={false} onChange={(e) => setTyped(e.target.value)} />
        </Field>
      )}
    </ConfirmDialog>
  )
}
