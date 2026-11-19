"use client"

import { useRef, useState } from "react"

import { ActionButton } from "@/components/action-button"
import { Field } from "@/components/field"
import { Icon } from "@/components/icon"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { RuleViolation } from "@/lib/roster-rules"
import { NamedLine } from "./named-line"
import { groupByPerson, publishPlan } from "../publishing"
import type { WeekAccess } from "../types"

const MAX_ROWS = 4

// Publish a draft (FR-RS-23/24). The rule breaks are the API's (`POST /check`, then the publish itself checks again under the lock). A warning never stops anything. A block stops a supervisor (the API
// says 403 rule_blocked_office_required: shown as "not publishable") and asks the office for a reason. One request per click: a second click while it runs does nothing.
export function PublishDialog({ title, violations, level, nameOf, checking, onPublish, onClose }: {
  title: string
  violations: RuleViolation[]
  level: WeekAccess["level"]
  nameOf(id: string): string
  /** The server check is still running: publishing waits for it. */
  checking?: boolean
  /** Sends the publish; resolves when the API has answered (the dialog stays until the caller closes it). */
  onPublish(reason: string): Promise<void> | void
  onClose(): void
}) {
  const plan = publishPlan(violations, level)
  const people = groupByPerson(violations, nameOf)
  const [reason, setReason] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const once = useRef(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (plan.stopped || checking || once.current) return
    if (plan.needsReason && !reason.trim()) { setError("Give a reason to publish anyway"); return }
    once.current = true
    setBusy(true)
    try {
      await onPublish(plan.needsReason ? reason.trim() : "")
    } finally {
      once.current = false
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Publish {title}</DialogTitle>
          <DialogDescription>
            {checking
              ? "Checking the rules..."
              : violations.length === 0
                ? "No rule breaks. Staff will see and confirm their shifts."
                : plan.stopped
                  ? "A rule is broken. Fix it, or ask the office to publish."
                  : plan.needsReason
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
                    <Icon name={hard ? "ban" : "warning"} size={24} />
                    <span>
                      <NamedLine person={p.name} message={p.items[0]!.message} />
                      {p.items.length > 1 && <span className="ros-viol-more num"> +{p.items.length - 1} more</span>}
                    </span>
                  </li>
                )
              })}
              {people.length > MAX_ROWS && <li className="ros-viol-more num">+{people.length - MAX_ROWS} more people</li>}
            </ul>
          )}
          {plan.needsReason && (
            <Field label="Reason to publish anyway" htmlFor="pd-reason" error={error || undefined} required>
              <Input id="pd-reason" autoFocus maxLength={500} placeholder="e.g. Agreed with the staff member" value={reason} onChange={(e) => { setReason(e.target.value); setError("") }} />
            </Field>
          )}
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" disabled={busy} />}>Cancel</DialogClose>
            <ActionButton type="submit" className="btn btn-primary" disabled={plan.stopped || checking || busy}>
              {plan.stopped ? <><Icon name="lock" size={24} />Not publishable</> : plan.needsReason ? "Publish anyway" : "Publish"}
            </ActionButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
