"use client"

import { ActionButton } from "@/components/action-button"
import { useEffect, useRef, useState } from "react"

import { Field } from "@/components/field"
import { Icon } from "@/components/icon"
import { Sk } from "@/components/sk"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { formatDate } from "@/lib/dates"
import { addDays } from "@/lib/shifts"
import { NamedLine } from "./named-line"
import { MAX_WEEKS, repeatBlocked, repeatBody, repeatPlan, repeatSummary } from "../repeating"
import type { RepeatConflict, RepeatCounts, WeekRoster } from "../types"

const MAX_ROWS = 3
export type RepeatDone = { created: WeekRoster[]; conflicts: RepeatConflict[]; counts: RepeatCounts }

// Repeat a week into the next N weeks (FR-RS-22/26, D10). The weeks already there are read from the API for the chosen range: a published one stops it, a draft needs "Replace", and a replace
// sends the version of every draft it replaces (the API refuses one without). After it runs the dialog shows kept, warned and open counts; the full list stays on the page (repeat panel).
// One request per click.
export function RepeatDialog({ source, locationName, nameOf, loadTargets, run, onClose }: {
  source: WeekRoster
  locationName: string
  nameOf(personId: string | null): string
  /** The weeks of this location between two dates, as the API has them now; `null` = it could not be read. */
  loadTargets(from: string, to: string): Promise<WeekRoster[] | null>
  /** Sends the repeat; `null` = the API refused (the page has said why). */
  run(body: ReturnType<typeof repeatBody>): Promise<RepeatDone | null>
  onClose(): void
}) {
  const [count, setCount] = useState("1")
  const [replace, setReplace] = useState(false)
  const [error, setError] = useState("")
  const [done, setDone] = useState<RepeatDone | null>(null)
  const [busy, setBusy] = useState(false)
  const [nonce, setNonce] = useState(0)
  const once = useRef(false)
  const n = Math.min(MAX_WEEKS, Math.max(1, Math.floor(Number(count)) || 1))
  const key = `${n}:${nonce}`
  const [found, setFound] = useState<{ key: string; weeks: WeekRoster[] | null }>({ key: "", weeks: null })
  useEffect(() => {
    let live = true
    const first = addDays(source.weekStart, 7)
    void loadTargets(first, addDays(source.weekStart, 7 * n + 6)).then((weeks) => { if (live) setFound({ key, weeks }) })
    return () => { live = false }
  }, [key, n, source.weekStart, loadTargets])
  const checking = found.key !== key
  const plan = repeatPlan(source, n, found.weeks ?? [])
  const unknown = !checking && found.weeks === null
  const blocked = checking || unknown || repeatBlocked(plan, replace)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (once.current || checking) return
    if (!Number.isInteger(Number(count)) || Number(count) < 1 || Number(count) > MAX_WEEKS) { setError(`Choose 1 to ${MAX_WEEKS} weeks`); return }
    if (blocked) return
    once.current = true
    setBusy(true)
    try {
      const r = await run(repeatBody(source, plan, replace))
      if (r) setDone(r)
      else setNonce((x) => x + 1) // refused: read the weeks again (someone may have changed them)
    } finally {
      once.current = false
      setBusy(false)
    }
  }

  const sum = done ? repeatSummary(done.counts, done.conflicts) : null
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Repeat {locationName}, {formatDate(source.weekStart)}</DialogTitle>
          <DialogDescription>
            {done
              ? `${done.created.length} draft ${done.created.length === 1 ? "week" : "weeks"} made. ${sum!.opened ? `${sum!.opened} shift${sum!.opened === 1 ? "" : "s"} opened because the person can't work them.` : "Every shift kept its person."}`
              : "Copies the people and times into draft weeks. Shifts someone can't work become open shifts."}
          </DialogDescription>
        </DialogHeader>
        {done && sum ? (
          <div className="od-form">
            <p className="ros-sum num" aria-label={`${sum.kept} kept, ${sum.warned} with a warning, ${sum.opened} open`}>{sum.kept} kept · {sum.warned} warned · <b>{sum.opened} open</b></p>
            {done.conflicts.length > 0 && (
              <ul className="ros-viol" aria-label="Repeat conflicts">
                {done.conflicts.slice(0, MAX_ROWS).map((c) => (
                  <li key={`${c.shiftId}-${c.reason}`} className="ros-viol-row" data-kind={c.open ? "block" : "warn"}>
                    <Icon name={c.open ? "warning" : "info"} size={24} />
                    <span><NamedLine person={nameOf(c.personId)} message={c.message} />{c.open ? " (now open)" : ""}</span>
                  </li>
                ))}
                {done.conflicts.length > MAX_ROWS && <li className="ros-viol-more num">+{done.conflicts.length - MAX_ROWS} more, listed on the page{sum.info ? ` (${sum.info} info)` : ""}</li>}
              </ul>
            )}
            <div className="od-form-foot">
              <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <form className="od-form" onSubmit={submit} noValidate>
            <Field label="Repeat into the next" htmlFor="rp-count" hint={`${formatDate(plan.targets[0]!.monday)}${n > 1 ? ` to ${formatDate(plan.targets[n - 1]!.monday)}` : ""}, ${MAX_WEEKS} weeks at most`} error={error || undefined}>
              <Input id="rp-count" type="number" inputMode="numeric" min={1} max={MAX_WEEKS} autoFocus value={count} onChange={(e) => { setCount(e.target.value); setError("") }} />
            </Field>
            {checking && <div aria-hidden="true" className="ros-rp-check"><Sk lh={24} w="70%" h={14} /></div>}
            {unknown && <p className="rl-err" role="alert">Could not read the weeks there. Try again.</p>}
            {!checking && plan.published > 0 && <p className="rl-err" role="alert">{plan.published} of these weeks {plan.published === 1 ? "is" : "are"} already published and can&apos;t be repeated into.</p>}
            {!checking && plan.drafts > 0 && plan.published === 0 && (
              <label className="ros-switch-row">
                <Switch checked={replace} onCheckedChange={setReplace} aria-label="Replace existing drafts" />
                <span>Replace {plan.drafts === 1 ? "the draft that is" : `${plan.drafts} drafts that are`} already there</span>
              </label>
            )}
            <div className="od-form-foot">
              <DialogClose render={<button type="button" className="btn btn-outline" disabled={busy} />}>Cancel</DialogClose>
              <ActionButton type="submit" className="btn btn-primary" disabled={blocked || busy}>Repeat</ActionButton>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
