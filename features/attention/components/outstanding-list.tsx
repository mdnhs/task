"use client"

import { useMemo, useState } from "react"
import { toast } from "sonner"
import { z } from "zod"

import { DatePicker } from "@/components/date-picker"
import { EmptyState } from "@/components/empty-state"
import { Field } from "@/components/field"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { daysBetween } from "@/lib/dates"
import { outstandingStore } from "../store"
import { PRIORITY } from "../types"
import type { OutstandingItem } from "../types"

const updateSchema = z.object({
  nextAction: z.string().trim().min(3, "Describe the next action").max(200, "Keep it under 200 characters"),
  target: z.string().min(1, "Choose a target date"),
})
// Closing needs a resolution note (FR-OUT-05).
const closeSchema = z.object({ resolution: z.string().trim().min(3, "Add a resolution note of at least 3 characters").max(500, "Keep the note under 500 characters") })

const carried = (o: OutstandingItem, today: string) => Math.max(0, daysBetween(today, o.carriedFrom))
const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`

export function OutstandingList({
  outstanding,
  today,
  tzLabel,
  canEdit,
  scopeKey,
}: {
  outstanding: OutstandingItem[]
  today: string
  tzLabel: string
  canEdit: boolean
  scopeKey: string
}) {
  const [stored, setStored] = outstandingStore.useStore(outstanding, scopeKey)
  const [target, setTarget] = useState<{ id: string; mode: "update" | "close"; open: boolean; n: number }>()
  const rows = useMemo(
    () =>
      [...stored].sort(
        (a, b) =>
          Number(a.status === "closed") - Number(b.status === "closed") ||
          (a.status === "open" ? a.priority - b.priority || carried(b, today) - carried(a, today) : a.id.localeCompare(b.id)),
      ),
    [stored, today],
  )
  const open = stored.filter((o) => o.status === "open")
  const old = open.filter((o) => carried(o, today) >= 3).length
  const current = stored.find((o) => o.id === target?.id)

  return (
    <section className="card att-card att-out" aria-labelledby="att-out-h">
      <div className="card-head">
        <div>
          <h2 id="att-out-h">Outstanding (carried forward)</h2>
          <div className="sub">{open.length} open · {old} carried 3 days or more</div>
        </div>
      </div>
      {rows.length > 0 ? (
        <ul className="att-list">
          {rows.map((o) => {
            const n = carried(o, today)
            return (
              <li key={o.id} className="att-out-row" data-closed={o.status === "closed" ? "" : undefined}>
                <div className="att-main">
                  <span className="att-top">
                    <StatusPill status={o.status === "closed" ? { tone: "ok", label: "Closed" } : PRIORITY[o.priority]} />
                    <span className="att-title">{o.title}</span>
                  </span>
                  <span className="att-sum">{o.reason}</span>
                  {o.status === "open" ? (
                    <span className="att-ask"><b>Next:</b> {o.nextAction} · target <When iso={o.target} today={today} tzLabel={tzLabel} mode="date" /></span>
                  ) : (
                    <span className="att-ask"><b>Resolution:</b> {o.resolution}</span>
                  )}
                </div>
                <div className="att-meta">
                  <span className="att-owner">{o.owner}</span>
                  <span className={`att-carry${o.status === "open" && n >= 3 ? " att-carry-old" : ""}`}>Carried {days(n)}</span>
                  {canEdit && o.status === "open" && (
                    <span className="att-actions">
                      <button type="button" className="btn btn-outline" onClick={() => setTarget((t) => ({ id: o.id, mode: "update", open: true, n: (t?.n ?? 0) + 1 }))}>Update</button>
                      <button type="button" className="btn btn-outline" onClick={() => setTarget((t) => ({ id: o.id, mode: "close", open: true, n: (t?.n ?? 0) + 1 }))}>Close</button>
                    </span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <EmptyState icon="flag" title="Nothing carried forward" text="Unfinished items from earlier days will be listed here." />
      )}
      <OutstandingDialog
        // A new key per open resets the form; it stays stable while closing so the exit animation plays.
        key={target?.n ?? 0}
        item={current}
        mode={target?.mode ?? "update"}
        open={!!target?.open}
        today={today}
        onOpenChange={(o) => !o && setTarget((t) => t && { ...t, open: false })}
        onUpdate={(id, nextAction, date) => {
          setStored((prev) => prev.map((o) => (o.id === id ? { ...o, nextAction, target: date } : o)))
          toast.success("Outstanding item updated")
        }}
        onClose={(id, resolution) => {
          setStored((prev) => prev.map((o) => (o.id === id ? { ...o, status: "closed", resolution } : o)))
          toast.success("Outstanding item closed")
        }}
      />
    </section>
  )
}

function OutstandingDialog({
  item,
  mode,
  open,
  today,
  onOpenChange,
  onUpdate,
  onClose,
}: {
  item: OutstandingItem | undefined
  mode: "update" | "close"
  open: boolean
  today: string
  onOpenChange(o: boolean): void
  onUpdate(id: string, nextAction: string, target: string): void
  onClose(id: string, resolution: string): void
}) {
  const [nextAction, setNextAction] = useState(item?.nextAction ?? "")
  const [date, setDate] = useState(item?.target.slice(0, 10) ?? "")
  const [resolution, setResolution] = useState("")
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!item) return
    const parsed = mode === "update" ? updateSchema.safeParse({ nextAction, target: date }) : closeSchema.safeParse({ resolution })
    if (!parsed.success) {
      const next: typeof errors = {}
      for (const i of parsed.error.issues) {
        const k = String(i.path[0])
        if (!next[k]) next[k] = i.message
      }
      setErrors(next)
      return
    }
    if (mode === "update") onUpdate(item.id, nextAction.trim(), date)
    else onClose(item.id, resolution.trim())
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{mode === "update" ? "Update outstanding item" : "Close outstanding item"}</DialogTitle>
          <DialogDescription>{item?.title}</DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={submit} noValidate>
          {mode === "update" ? (
            <div className="od-row2">
              <Field label="Next action" htmlFor="out-next" error={errors.nextAction} required>
                <Input id="out-next" value={nextAction} onChange={(e) => { setNextAction(e.target.value); setErrors((x) => ({ ...x, nextAction: undefined })) }} />
              </Field>
              <Field label="Target date" htmlFor="out-target" error={errors.target} required>
                <DatePicker label="Target date" value={date} today={today} min={today.slice(0, 10)} placeholder="Pick a target date" onChange={(v) => { setDate(v); setErrors((x) => ({ ...x, target: undefined })) }} />
              </Field>
            </div>
          ) : (
            <Field label="Resolution note" htmlFor="out-res" error={errors.resolution} required>
              <Textarea id="out-res" placeholder="e.g. Fixed by the day team" value={resolution} onChange={(e) => { setResolution(e.target.value); setErrors((x) => ({ ...x, resolution: undefined })) }} />
            </Field>
          )}
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <button type="submit" className="btn btn-primary">{mode === "update" ? "Save changes" : "Close item"}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
