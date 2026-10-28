"use client"

import type { ReactNode } from "react"
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog"

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  text,
  confirmLabel,
  destructive,
  confirmDisabled,
  children,
  onConfirm,
}: {
  open: boolean
  onOpenChange(o: boolean): void
  title: string
  text: string
  confirmLabel: string
  destructive?: boolean
  /** Keeps the confirm button disabled (e.g. until a type-to-confirm field matches). */
  confirmDisabled?: boolean
  /** Extra content under the description (a field, a list...). */
  children?: ReactNode
  onConfirm(): void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="od-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{text}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          {/* Base UI primitive, not the shadcn AlertDialogCancel: that one renders shadcn's Button (h-8, ring) */}
          <AlertDialogPrimitive.Close render={<button type="button" className="btn btn-outline" />}>Cancel</AlertDialogPrimitive.Close>
          <button
            type="button"
            className={`${destructive ? "btn btn-danger" : "btn btn-primary"} od-confirm-btn`}
            disabled={confirmDisabled}
            onClick={() => {
              onConfirm()
              onOpenChange(false)
            }}
          >
            {confirmLabel}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
