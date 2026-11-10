"use client"

import { useState } from "react"
import { AlertTriangle, TriangleAlert } from "lucide-react"

import { Field } from "@/components/field"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { blocking, type RuleViolation } from "@/lib/roster-rules"

export type PersonViolations = { personId: string; name: string; items: RuleViolation[] }

/** Group by person (not by shift): weekly rest and the 48h average are reported on one shift only (FR-RS-44). */
export function groupByPerson(violations: RuleViolation[], nameOf: (id: string) => string): PersonViolations[] {
  const map = new Map<string, RuleViolation[]>()
  for (const v of violations) map.set(v.personId, [...(map.get(v.personId) ?? []), v])
  return [...map].map(([personId, items]) => ({ personId, name: nameOf(personId), items: items.sort((a, b) => Number(b.severity === "block") - Number(a.severity === "block")) }))
}

const MAX_ROWS = 4

// Publish a draft (FR-RS-23/24): shows the rule breaks per person. A block can only be published over by an office role, with a reason.
export function PublishDialog({ title, violations, nameOf, canOverride, checking, onPublish, onClose }: {
  title: string
  violations: RuleViolation[]
  nameOf(id: string): string
  canOverride: boolean
  /** The server check is still running: publishing waits for it. */
  checking?: boolean
  onPublish(reason: string | null): void
  onClose(): void
}) {
  const blocks = blocking(violations)
  const people = groupByPerson(violations, nameOf)
  const [reason, setReason] = useState("")
  const [error, setError] = useState("")
  const stopped = blocks.length > 0 && !canOverride

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (stopped || checking) return
    if (blocks.length && !reason.trim()) { setError("Give a reason to publish anyway"); return }
    onPublish(blocks.length ? reason.trim() : null)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Publish {title}</DialogTitle>
          <DialogDescription>
            {checking
              ? "Checking the rules..."
              : violations.length === 0
              ? "No rule breaks. Staff will be able to see and confirm their shifts."
              : stopped
                ? "A rule is broken. Fix it before publishing, or ask an office role to publish."
                : blocks.length
                  ? "A rule is broken. Publishing anyway needs a reason."
                  : "Warnings only. You can publish."}
          </DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={submit} noValidate>
          {people.length > 0 && (
            <ul className="ros-viol" aria-label="Rule breaks">
              {people.slice(0, MAX_ROWS).map((p) => {
                const hard = p.items.some((i) => i.severity === "block")
                return (
                  <li key={p.personId} className="ros-viol-row" data-kind={hard ? "block" : "warn"}>
                    {hard ? <TriangleAlert aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
                    <span>
                      <b>{p.name}</b> {p.items[0].message}
                      {p.items.length > 1 && <span className="ros-viol-more num"> +{p.items.length - 1} more</span>}
                    </span>
                  </li>
                )
              })}
              {people.length > MAX_ROWS && <li className="ros-viol-more num">+{people.length - MAX_ROWS} more people</li>}
            </ul>
          )}
          {blocks.length > 0 && canOverride && (
            <Field label="Reason to publish anyway" htmlFor="pd-reason" error={error || undefined} required>
              <Input id="pd-reason" autoFocus placeholder="e.g. Agreed with the staff member" value={reason} onChange={(e) => { setReason(e.target.value); setError("") }} />
            </Field>
          )}
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <button type="submit" className="btn btn-primary" disabled={stopped || checking}>{blocks.length ? "Publish anyway" : "Publish"}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
