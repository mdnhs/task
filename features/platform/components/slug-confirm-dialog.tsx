"use client"

import { useState } from "react"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { Field } from "@/components/field"
import { Input } from "@/components/ui/input"

// ConfirmDialog with a type-to-confirm field (its children slot), confirm disabled until the slug matches.
export function SlugConfirmDialog({
  open,
  onOpenChange,
  title,
  text,
  slug,
  confirmLabel,
  destructive,
  onConfirm,
}: {
  open: boolean
  onOpenChange(o: boolean): void
  title: string
  text: string
  slug: string
  confirmLabel: string
  destructive?: boolean
  onConfirm(): void
}) {
  const [typed, setTyped] = useState("")

  function change(o: boolean) {
    onOpenChange(o)
    if (!o) setTyped("")
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={change}
      title={title}
      text={text}
      confirmLabel={confirmLabel}
      destructive={destructive}
      confirmDisabled={typed.trim() !== slug}
      onConfirm={onConfirm}
    >
      <Field label={`Type ${slug} to confirm`} htmlFor="pf-confirm-slug" required>
        <Input id="pf-confirm-slug" value={typed} autoComplete="off" spellCheck={false} onChange={(e) => setTyped(e.target.value)} />
      </Field>
    </ConfirmDialog>
  )
}
