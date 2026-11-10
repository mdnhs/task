"use client"

import { useState } from "react"

import { Field } from "@/components/field"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { formatDate } from "@/lib/dates"
import type { RepeatConflict } from "@/lib/roster-repeat"
import { addDays } from "@/lib/shifts"
import type { RosterWeek } from "../types"

const MAX_WEEKS = 12
const MAX_ROWS = 3

export type RepeatDone = { weeks: number; conflicts: RepeatConflict[] }

// Repeat a week into the next N weeks (FR-RS-22/26, D10). Published weeks in the way stop it, drafts need "Replace". After it runs the
// dialog shows how many shifts were opened; the full list stays on the page (conflicts panel).
export function RepeatDialog({ source, locationName, weeks, nameOf, onRepeat, onClose }: {
  source: RosterWeek
  locationName: string
  weeks: RosterWeek[]
  nameOf(personId: string | null): string
  /** Runs the repeat; throws with a readable message when it cannot. */
  onRepeat(count: number, replace: boolean): RepeatDone
  onClose(): void
}) {
  const [count, setCount] = useState("1")
  const [replace, setReplace] = useState(false)
  const [error, setError] = useState("")
  const [done, setDone] = useState<RepeatDone | null>(null)
  const n = Math.min(MAX_WEEKS, Math.max(1, Math.floor(Number(count)) || 1))
  const targets = Array.from({ length: n }, (_, i) => addDays(source.weekStart, 7 * (i + 1)))
  const there = targets.map((t) => weeks.find((w) => w.locationId === source.locationId && w.weekStart === t))
  const published = there.filter((w) => w?.status === "published").length
  const drafts = there.filter((w) => w?.status === "draft").length

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!Number.isInteger(Number(count)) || Number(count) < 1 || Number(count) > MAX_WEEKS) { setError(`Choose 1 to ${MAX_WEEKS} weeks`); return }
    try { setDone(onRepeat(n, replace)) } catch (err) { setError(err instanceof Error ? err.message : "Could not repeat") }
  }

  const open = done?.conflicts.filter((c) => c.open) ?? []
  const info = done?.conflicts.filter((c) => !c.open) ?? []
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Repeat {locationName}, {formatDate(source.weekStart)}</DialogTitle>
          <DialogDescription>
            {done
              ? `${done.weeks} draft ${done.weeks === 1 ? "week" : "weeks"} made. ${open.length ? `${open.length} shift${open.length === 1 ? "" : "s"} opened because the person can't work them.` : "Every shift kept its person."}`
              : "Copies the people and times into draft weeks. Shifts someone can't work become open shifts."}
          </DialogDescription>
        </DialogHeader>
        {done ? (
          <div className="od-form">
            {done.conflicts.length > 0 && (
              <ul className="ros-viol" aria-label="Repeat conflicts">
                {done.conflicts.slice(0, MAX_ROWS).map((c) => (
                  <li key={c.shiftId} className="ros-viol-row" data-kind={c.open ? "block" : "warn"}>
                    <span><b>{nameOf(c.personId)}</b> {c.message}{c.open ? " (now open)" : ""}</span>
                  </li>
                ))}
                {done.conflicts.length > MAX_ROWS && <li className="ros-viol-more num">+{done.conflicts.length - MAX_ROWS} more, listed on the page{info.length ? ` (${info.length} info)` : ""}</li>}
              </ul>
            )}
            <div className="od-form-foot">
              <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <form className="od-form" onSubmit={submit} noValidate>
            <Field label="Repeat into the next" htmlFor="rp-count" hint={`${formatDate(targets[0])}${n > 1 ? ` to ${formatDate(targets[n - 1])}` : ""}, ${MAX_WEEKS} weeks at most`} error={error || undefined}>
              <Input id="rp-count" type="number" inputMode="numeric" min={1} max={MAX_WEEKS} autoFocus value={count} onChange={(e) => { setCount(e.target.value); setError("") }} />
            </Field>
            {published > 0 && <p className="rl-err" role="alert">{published} of these weeks {published === 1 ? "is" : "are"} already published and can&apos;t be repeated into.</p>}
            {drafts > 0 && published === 0 && (
              <label className="ros-switch-row">
                <Switch checked={replace} onCheckedChange={setReplace} aria-label="Replace existing drafts" />
                <span>Replace {drafts === 1 ? "the draft that is" : `${drafts} drafts that are`} already there</span>
              </label>
            )}
            <div className="od-form-foot">
              <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
              <button type="submit" className="btn btn-primary" disabled={published > 0 || (drafts > 0 && !replace)}>Repeat</button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
