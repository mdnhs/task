"use client"


import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { Icon } from "@/components/icon"

// Right-side detail panel (bottom sheet on phones, see .od-sheet in kit.css).
export function DetailSheet({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean
  onOpenChange(o: boolean): void
  title: string
  subtitle?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" showCloseButton={false} className="od-sheet">
        <header className="od-sheet-head">
          <div>
            <SheetTitle>{title}</SheetTitle>
            {subtitle ? <SheetDescription render={<div />}>{subtitle}</SheetDescription> : <SheetDescription className="sr-only">{title}</SheetDescription>}
          </div>
          <SheetClose className="od-sheet-x" aria-label="Close">
            <Icon name="close" size={24} />
          </SheetClose>
        </header>
        <div className="od-sheet-body">{children}</div>
        {footer && <footer className="od-sheet-foot">{footer}</footer>}
      </SheetContent>
    </Sheet>
  )
}
