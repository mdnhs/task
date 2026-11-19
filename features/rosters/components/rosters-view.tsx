"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"

import { applyWeekTemplate, checkWeek, createWeek, reloadRoster, saveWeekTemplate, addShifts, deleteShift, patchShift } from "@/app/actions/rosters"
import { FilterBar, FilterSelect, FilterSeg } from "@/components/filter-bar"
import { Icon } from "@/components/icon"
import { PageHead } from "@/components/page-head"
import { StatusPill } from "@/components/status-pill"
import { formatDate } from "@/lib/dates"
import { addDays, weekStart, weekdayOf } from "@/lib/shifts"
import type { Status } from "@/lib/types"
import { overrideFields } from "../editing"
import { runEdit, type Ask, type Edit, type EditorApi, type EditorState, type EditResult } from "../editor"
import type { RosterPayload, RosterQuery, WeekTemplateSummary } from "../types"
import { violationLines, weekViewData, type RosterGroup, type RosterViewData, type RosterViewKind, type ViewDay } from "../view"
import { DayBoard, type DayEditor } from "./day-board"
import { PersonGrid } from "./person-grid"
import { ReasonDialog } from "./reason-dialog"
import { ShiftDialog, type ShiftSave } from "./shift-dialog"
import { ApplyTemplateDialog, TemplatesPanel } from "./templates-panel"
import { ViolationsPanel } from "./violations-panel"

const STATUS: Record<"published" | "draft" | "none", Status> = {
  published: { tone: "ok", label: "Published" },
  draft: { tone: "warn", label: "Draft" },
  none: { tone: "mute", label: "No roster" },
}

const range = (d: RosterViewData) => (d.from === d.to ? formatDate(d.from) : `${formatDate(d.from)} – ${formatDate(d.to)}`)
const refOf = (ref: string | null) => (ref ? { description: `Ref ${ref}` } : undefined)

type Dialog = { kind: "add"; weekId: string; locationId: string; date: string; n: number } | { kind: "edit"; id: string; n: number }
/** An edit waiting for its reason: the week is published (office), or the API asked for one. */
type Reasoning = { title: string; description: string; confirmLabel: string; run(reason: string): void }
type Gate = { reason?: string; overrideRuleIds?: string[] }

const withGate = (e: Edit, gate: Gate): Edit => (e.kind === "remove" ? { ...e, reason: gate.reason } : { ...e, gate })

// Location Rosters, week view and draft editing on the API (FR-RS-10/11/12/20/21; B8 Task 20). Filters live in the URL (?location=&week=&view=&group=) and the server reads the API again on every change.
// The payload is the API's: what shows, what is highlighted (short, over) and which controls are on (`access`) all come from it; nothing is re-scoped or re-derived here. An edit shows at once and the API
// answers (./editor.ts): a stale version is "Changed by someone else" and the server's copy is shown, a locked week turns read-only without an error toast.
export function RostersView({ payload, query, today, templates = [] }: { payload: RosterPayload; query: RosterQuery; today: string; templates?: WeekTemplateSummary[] }) {
  const router = useRouter()
  const [navigating, nav] = useTransition()
  const [state, setState] = useState<EditorState>({ payload, violations: [] })
  const [served, setServed] = useState(payload)
  // The server's payload moved on (a navigation or a refresh): it wins over any local copy.
  if (served !== payload) {
    setServed(payload)
    setState({ payload, violations: [] })
  }
  const live = useRef(state)
  useEffect(() => { live.current = state }, [state])
  const queue = useRef<Promise<unknown>>(Promise.resolve())

  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [reasoning, setReasoning] = useState<Reasoning | null>(null)
  const [override, setOverride] = useState<{ edit: Edit; needsOffice: boolean } | null>(null)
  const [applying, setApplying] = useState<WeekTemplateSummary | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const view = weekViewData(state.payload, query, today)
  const data = "denied" in view ? null : view
  const location = query.location && query.location !== "all" ? query.location : undefined
  const api: EditorApi = { patchShift, addShifts, deleteShift, reload: () => reloadRoster({ locationId: location, from: payload.range.from, view: payload.range.view }) }

  const nameOf = (id: string | null) => (id ? (state.payload.members.find((m) => m.id === id)?.name ?? "Member") : "Open shift")

  function announce(res: EditResult, what: string, description?: string) {
    if (res.toast) toast.error(res.toast.text, refOf(res.toast.ref))
    else if (res.ok) toast.success(what, description ? { description } : undefined)
  }

  /** One edit at a time, in order: the second sees the first's answer (and its new `version`). */
  function run(edit: Edit, ok: { what: string; description?: string }) {
    queue.current = queue.current.then(async () => {
      const res = await runEdit(live.current, edit, api, (s) => { live.current = s; setState(s) })
      live.current = res.state
      setState(res.state)
      setOverride(null)
      announce(res, ok.what, ok.description)
      if (res.ask) ask(res.ask, edit, ok)
    })
  }

  function ask(a: Ask, edit: Edit, ok: { what: string; description?: string }) {
    if (a.kind === "reason") {
      setReasoning({ title: "Say why", description: "This week is published. Give a reason; the person will need to confirm again.", confirmLabel: "Save", run: (reason) => run(withGate(edit, { reason }), ok) })
      return
    }
    setOverride({ edit, needsOffice: a.needsOffice })
  }

  /** The week's own access decides whether the edit asks for a reason first (office on a published week). */
  function guarded(weekId: string | null, make: (gate: Gate) => Edit, ok: { what: string; description?: string }, title: string) {
    const week = state.payload.weeks.find((w) => w.id === weekId)
    if (week?.access.lockReason === "reason_required") {
      setReasoning({ title, description: "This week is published. Give a reason; the person will need to confirm again.", confirmLabel: title, run: (reason) => run(make({ reason }), ok) })
      return
    }
    run(make({}), ok)
  }

  function onMove(id: string, date: string) {
    const s = state.payload.shifts.find((x) => x.id === id)
    if (!s || s.date === date) return
    guarded(s.weekId, (gate) => ({ kind: "patch", shiftId: id, edit: { date }, gate }), { what: "Shift moved", description: `${nameOf(s.personId)} to ${formatDate(date)}` }, "Move shift")
  }

  const editing = dialog?.kind === "edit" ? data?.blocks.flatMap((b) => b.days.flatMap((d) => d.shifts)).find((s) => s.id === dialog.id) : undefined
  const dialogLoc = dialog?.kind === "add" ? dialog.locationId : state.payload.shifts.find((s) => s.id === (dialog?.kind === "edit" ? dialog.id : ""))?.locationId
  const dialogWeek = dialog?.kind === "add" ? dialog.weekId : editing?.weekId
  const weekDays = (state.payload.weeks.find((x) => x.id === dialogWeek)?.days ?? []).map((d) => ({ value: d.date, label: formatDate(d.date) }))

  function save(v: ShiftSave) {
    if (!dialog || !dialogWeek) return
    if (editing) {
      guarded(dialogWeek, (gate) => ({ kind: "patch", shiftId: editing.id, edit: { date: v.date, start: v.start, end: v.end, unpaidBreakMin: v.unpaidBreakMin, personId: v.people[0] ?? null, templateId: v.templateId, role: v.role }, gate }), { what: "Shift saved", description: `${nameOf(v.people[0] ?? null)} · ${formatDate(v.date)}` }, "Save changes")
    } else {
      const type = state.payload.shiftTypes.find((t) => t.id === v.templateId)
      if (!type) return
      guarded(dialogWeek, (gate) => ({ kind: "add", weekId: dialogWeek, type, form: { date: v.date, people: v.people, start: v.start, end: v.end, unpaidBreakMin: v.unpaidBreakMin }, gate }), { what: v.people.length > 1 ? `${v.people.length} shifts added` : "Shift added", description: formatDate(v.date) }, "Add shift")
    }
    setDialog(null)
  }

  function removeEditing() {
    if (!editing) return
    guarded(editing.weekId, (gate) => ({ kind: "remove", shiftId: editing.id, reason: gate.reason }), { what: "Shift removed", description: `${editing.person} · ${formatDate(editing.date)}` }, "Remove shift")
    setDialog(null)
  }

  async function check(weekId: string) {
    setBusy(`check-${weekId}`)
    const r = await checkWeek(weekId)
    setBusy(null)
    if (!r.ok) { toast.error(r.error.toast?.text ?? "Could not check the rules", refOf(r.error.toast?.ref ?? null)); return }
    setState((s) => ({ ...s, violations: r.value.violations }))
    if (r.value.violations.length === 0) toast.success("No rule problems")
  }

  async function start(locationId: string, weekStartDate: string) {
    setBusy(`create-${locationId}`)
    const r = await createWeek({ locationId, weekStart: weekStartDate })
    setBusy(null)
    if (!r.ok) { toast.error(r.error.toast?.text ?? "Could not start the week", refOf(r.error.toast?.ref ?? null)); return }
    toast.success("Week started", { description: formatDate(weekStartDate) })
    router.refresh()
  }

  async function saveTemplate(name: string, weekId: string) {
    const r = await saveWeekTemplate(weekId, name)
    if (!r.ok) { toast.error(r.error.toast?.text ?? "Could not save the template", refOf(r.error.toast?.ref ?? null)); return }
    toast.success("Template saved", { description: name })
    router.refresh()
  }

  async function applyTemplate(t: WeekTemplateSummary, locationId: string, start: string) {
    const r = await applyWeekTemplate({ templateId: t.id, locationId, weekStart: start })
    setApplying(null)
    if (!r.ok) { toast.error(r.error.toast?.text ?? "Could not apply the template", refOf(r.error.toast?.ref ?? null)); return }
    const opened = r.value.counts.opened
    toast.success("Template applied", { description: `${t.name} · ${formatDate(start)}${opened ? ` · ${opened} open shift${opened === 1 ? "" : "s"}` : ""}` })
    router.refresh()
  }

  if (!data) return <p className="ros-empty">No roster to show.</p>

  const editable = state.payload.weeks.some((w) => w.access.canEdit)
  const editor: DayEditor | undefined = editable
    ? {
        onAdd: (day: ViewDay) => { if (day.weekId) setDialog({ kind: "add", weekId: day.weekId, locationId: state.payload.weeks.find((w) => w.id === day.weekId)!.locationId, date: day.date, n: (dialog?.n ?? 0) + 1 }) },
        onEdit: (id) => setDialog({ kind: "edit", id, n: (dialog?.n ?? 0) + 1 }),
        onMove,
      }
    : undefined
  const go = (patch: Partial<{ location: string; week: string; view: string; group: string }>) => {
    const q = new URLSearchParams({ location: data.location, week: data.from, view: data.view, group: data.group, ...patch })
    nav(() => router.push(`/rosters?${q.toString()}`))
  }
  const lines = violationLines(state.violations, state.payload)
  const pendingOverride = override
  const savable = data.location !== "all" ? data.blocks[0] : undefined
  const savableWeek = savable?.days.find((d) => d.weekId && d.canEdit)?.weekId ?? null
  const editableLocations = data.locations.filter((l) => l.value !== "all")
  const nextMonday = addDays(weekStart(today.slice(0, 10)), 7)
  const taken = new Set(state.payload.weeks.map((w) => `${w.locationId}|${w.weekStart}`))
  const { totals } = data

  return (
    <>
      <PageHead
        title="Location Rosters"
        subtitle={
          <span className="ros-sub num">
            {range(data)}
            {totals.target > 0 && (
              <span className="ros-sum" data-short={totals.short > 0 || undefined}>
                {totals.count}/{totals.target}
                {totals.short > 0 && <b> · {totals.short} short</b>}
              </span>
            )}
          </span>
        }
        actions={data.access.level === "office" ? <Link href="/rosters/locations" className="btn btn-outline"><Icon name="pin" size={24} />Manage locations</Link> : undefined}
      />
      <div className="card ros-card" data-pending={navigating || undefined}>
        <FilterBar>
          {data.locations.length > 1 && <FilterSelect label="Location" value={data.location} options={data.locations} onChange={(v) => go({ location: v })} />}
          <FilterSeg<RosterViewKind>
            label="Range"
            value={data.view}
            options={[{ value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "fortnight", label: "Fortnight" }, { value: "month", label: "Month" }]}
            onChange={(v) => go({ view: v })}
          />
          <FilterSeg<RosterGroup>
            label="Group"
            value={data.group}
            options={[{ value: "location", label: "By location" }, { value: "person", label: "By person" }, { value: "role", label: "By role" }]}
            onChange={(v) => go({ group: v })}
          />
          <div className="ros-nav" role="group" aria-label="Range">
            <button type="button" className="ros-nav-btn" aria-label="Previous" onClick={() => go({ week: data.prev })}>
              <Icon name="chevron-left" size={24} />
            </button>
            <button type="button" className="ros-nav-label num" onClick={() => go({ week: data.today })} title="Back to today">
              {range(data)}
            </button>
            <button type="button" className="ros-nav-btn" aria-label="Next" onClick={() => go({ week: data.next })}>
              <Icon name="chevron-right" size={24} />
            </button>
          </div>
        </FilterBar>
        {data.group === "location" ? (
          data.blocks.map((b) => {
            const weekId = b.days.find((d) => d.weekId && d.canEdit)?.weekId ?? null
            return (
              <section key={b.locationId} className="ros-block" aria-label={b.name}>
                <div className="ros-block-head">
                  <h2>{b.name}</h2>
                  <StatusPill status={STATUS[b.status]} tick={false} />
                  {b.locked && <span className="ros-lock" role="img" aria-label="Published and locked: read-only"><Icon name="lock" size={24} /></span>}
                  {b.target > 0 && (
                    <span className="ros-sum num" data-short={b.short > 0 || undefined}>
                      {b.count}/{b.target}
                      {b.short > 0 && <b> · {b.short} short</b>}
                    </span>
                  )}
                  {weekId && (
                    <button type="button" className="btn btn-outline ros-check" disabled={busy === `check-${weekId}`} onClick={() => void check(weekId)}>
                      <Icon name="shield" size={24} />Check rules
                    </button>
                  )}
                  {b.canCreate && (
                    <button type="button" className="btn btn-primary ros-start" disabled={busy === `create-${b.locationId}`} onClick={() => void start(b.locationId, b.createWeekStart)}>
                      <Icon name="calendar-plus" size={24} />Start week
                    </button>
                  )}
                </div>
                <DayBoard block={b} today={data.today} view={data.view} firstWeekday={(weekdayOf(data.from) + 6) % 7} editor={editor} />
              </section>
            )
          })
        ) : (
          <PersonGrid groups={data.groups} dates={data.dates} today={data.today} place={data.location === "all"} />
        )}
      </div>
      <ViolationsPanel
        lines={lines}
        needsOffice={pendingOverride?.needsOffice}
        onOpen={(id) => setDialog({ kind: "edit", id, n: (dialog?.n ?? 0) + 1 })}
        onOverride={pendingOverride && !pendingOverride.needsOffice ? () => setReasoning({
          title: "Go over the rule", description: "Say why. It is kept in the history.", confirmLabel: "Go over it",
          run: (reason) => run(withGate(pendingOverride.edit, overrideFields(reason, state.violations)), { what: "Saved over the rule" }),
        }) : undefined}
        onDismiss={() => { setState((s) => ({ ...s, violations: [] })); setOverride(null) }}
      />
      {editable && (
        <TemplatesPanel
          templates={templates}
          locationName={(id) => state.payload.locations.find((l) => l.id === id)?.name ?? "Location"}
          canSave={!!savableWeek}
          onSave={(name) => savableWeek && void saveTemplate(name, savableWeek)}
          onApply={setApplying}
        />
      )}
      {dialog && dialogLoc && dialogWeek && (dialog.kind === "add" || editing) && (
        <ShiftDialog
          key={dialog.n}
          shift={editing}
          date={dialog.kind === "add" ? dialog.date : (editing?.date ?? "")}
          types={state.payload.shiftTypes.filter((t) => t.locationId === dialogLoc && !t.archived)}
          members={state.payload.members}
          dates={weekDays}
          onSave={save}
          onRemove={editing ? removeEditing : undefined}
          onClose={() => setDialog(null)}
        />
      )}
      {reasoning && <ReasonDialog title={reasoning.title} description={reasoning.description} confirmLabel={reasoning.confirmLabel} onConfirm={(r) => { reasoning.run(r); setReasoning(null) }} onClose={() => setReasoning(null)} />}
      {applying && (
        <ApplyTemplateDialog
          template={applying}
          locations={editableLocations}
          firstMonday={nextMonday}
          taken={taken}
          onApply={(loc, wk) => void applyTemplate(applying, loc, wk)}
          onClose={() => setApplying(null)}
        />
      )}
    </>
  )
}
