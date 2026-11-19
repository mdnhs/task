"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"

import {
  applyWeekTemplate, checkWeek, claimShift, createWeek, decideChange, decideExchange, historyPage, proposeSwap, publishWeek, recommendExchange, reloadRoster, repeatWeek, requestChange, saveWeekTemplate, addShifts, deleteShift, patchShift,
} from "@/app/actions/rosters"
import { FilterBar, FilterSelect, FilterSeg } from "@/components/filter-bar"
import { Icon } from "@/components/icon"
import { PageHead } from "@/components/page-head"
import { StatusPill } from "@/components/status-pill"
import { formatDate } from "@/lib/dates"
import { addDays, weekStart, weekdayOf } from "@/lib/shifts"
import type { RuleViolation } from "@/lib/roster-rules"
import type { Status } from "@/lib/types"
import { overrideFields } from "../editing"
import { EditQueue, pendingView, runEdit, type Ask, type Edit, type EditorApi, type EditorState, type EditResult } from "../editor"
import { retryable, type RosterError } from "../errors"
import { decideBody, publishBody } from "../publishing"
import type { RepeatConflict, RepeatCounts, ApiChangeRequest, ApiExchange, HistoryEntry, Page, RosterPayload, RosterQuery, WeekTemplateSummary } from "../types"
import { violationLines, weekViewData, type RosterGroup, type RosterViewData, type RosterViewKind, type ViewDay } from "../view"
import { ChangeRequestDialog } from "./change-request-dialog"
import { ConflictsPanel } from "./conflicts-panel"
import { DayBoard, type DayEditor } from "./day-board"
import { HistoryPanel } from "./history-panel"
import { OpenShiftsPanel, type OpenRow, type SwapRow } from "./open-shifts-panel"
import { PersonGrid } from "./person-grid"
import { PublishDialog } from "./publish-dialog"
import { ReasonDialog } from "./reason-dialog"
import { RepeatDialog, type RepeatDone } from "./repeat-dialog"
import { RequestsPanel } from "./requests-panel"
import { ShiftDialog, type ShiftSave } from "./shift-dialog"
import { SwapDialog } from "./swap-dialog"
import { ApplyTemplateDialog, TemplatesPanel } from "./templates-panel"
import { ViolationsPanel } from "./violations-panel"

const STATUS: Record<"published" | "draft" | "none", Status> = {
  published: { tone: "ok", label: "Published" },
  draft: { tone: "warn", label: "Draft" },
  none: { tone: "mute", label: "No roster" },
}

const range_ = (d: RosterViewData) => (d.from === d.to ? formatDate(d.from) : `${formatDate(d.from)} – ${formatDate(d.to)}`)
const refOf = (ref: string | null) => (ref ? { description: `Ref ${ref}` } : undefined)

type Dialog = { kind: "add"; weekId: string; locationId: string; date: string; n: number } | { kind: "edit"; id: string; n: number }
/** An edit waiting for its reason: the week is published (office), or the API asked for one (an override, a decision over a block). */
type Reasoning = { title: string; description: string; confirmLabel: string; lines?: string[]; /** Resolves true when the dialog may close: it went through, or the answer leaves nothing to retry. */ run(reason: string): Promise<boolean> }
type Gate = { reason?: string; overrideRuleIds?: string[] }
type Publishing = { weekId: string; violations: RuleViolation[]; checking: boolean }

const withGate = (e: Edit, gate: Gate): Edit => (e.kind === "remove" ? { ...e, reason: gate.reason } : { ...e, gate })
const HISTORY_PAGE = 20
const NONE: ReadonlySet<string> = new Set()

/** What the server reads for the panels under the week (the API cut each list to the caller's sites). */
export type RosterPanels = {
  requests: ApiChangeRequest[]
  exchanges: ApiExchange[]
  /** The first page of the history of `weekId`; null when the caller has no week to show. */
  history: { weekId: string; page: Page<HistoryEntry> } | null
}
const noPanels: RosterPanels = { requests: [], exchanges: [], history: null }

// Location Rosters, week view and editing on the API (FR-RS-10/11/12/20..24/26/36/37/38/42/43; B8 Tasks 20 and 21). Filters live in the URL (?location=&week=&view=&group=) and the server reads the API again on every change.
// The payload is the API's: what shows, what is highlighted (short, over) and which controls are on (`access`) all come from it; nothing is re-scoped or re-derived here. An edit shows at once and the API
// answers (./editor.ts): a stale version is "Changed by someone else" and the server's copy is shown, a locked week turns read-only without an error toast. Edits wait in a queue (one at a time, in order) and
// every one of them shows at once, over the payload (`pendingView`). Publish, repeat, change requests, open shifts and swaps are one request per click (a second click while it runs does nothing).
export function RostersView({ payload, query, today, templates = [], panels = noPanels, me = "" }: { payload: RosterPayload; query: RosterQuery; today: string; templates?: WeekTemplateSummary[]; panels?: RosterPanels; me?: string }) {
  const router = useRouter()
  const [navigating, nav] = useTransition()
  const [state, setState] = useState<EditorState>({ payload, violations: [] })
  const [pending, setPending] = useState<Edit[]>([])
  const [served, setServed] = useState(payload)
  // The server's payload moved on (a navigation or a refresh): it wins over any local copy, and the edits that were waiting are gone with it.
  if (served !== payload) {
    setServed(payload)
    setState({ payload, violations: [] })
    setPending([])
  }
  const live = useRef(state)
  const range = useRef({ location: query.location, from: payload.range.from, view: payload.range.view })
  const queue = useRef(new EditQueue())
  const seq = useRef(0)
  useEffect(() => {
    live.current = state
  }, [state])
  useEffect(() => {
    range.current = { location: query.location, from: payload.range.from, view: payload.range.view }
    queue.current.reset() // the range on screen changed: an answer for the old one is not laid over the new one
  }, [payload, query.location])

  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [reasoning, setReasoning] = useState<Reasoning | null>(null)
  const [override, setOverride] = useState<{ edit: Edit; needsOffice: boolean } | null>(null)
  const [applying, setApplying] = useState<WeekTemplateSummary | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [publishing, setPublishing] = useState<Publishing | null>(null)
  const [requesting, setRequesting] = useState<string | null>(null)
  const [swapping, setSwapping] = useState<string | null>(null)
  const [repeating, setRepeating] = useState<string | null>(null)
  const [repeated, setRepeated] = useState<{ conflicts: RepeatConflict[]; counts: RepeatCounts } | null>(null)
  const [decisionNeedsOffice, setDecisionNeedsOffice] = useState(false)
  const inflight = useRef(new Set<string>())
  const [working, setWorking] = useState<ReadonlySet<string>>(NONE)

  // What is on screen: the confirmed payload with the edits still waiting laid over it.
  const shown = pendingView(state.payload, pending)
  const view = weekViewData(shown, query, today)
  const data = "denied" in view ? null : view
  const api: EditorApi = {
    patchShift, addShifts, deleteShift,
    reload: () => reloadRoster({ locationId: range.current.location && range.current.location !== "all" ? range.current.location : undefined, from: range.current.from, view: range.current.view }),
  }

  const nameOf = (id: string | null) => (id ? (shown.members.find((m) => m.id === id)?.name ?? "Member") : "Open shift")
  const shiftOf = (id: string) => shown.shifts.find((x) => x.id === id)
  const locationOf = (id: string) => shown.locations.find((l) => l.id === id)

  function announce(res: EditResult, what: string, description?: string) {
    if (res.toast) toast.error(res.toast.text, refOf(res.toast.ref))
    else if (res.ok && res.sent) toast.success(what, description ? { description } : undefined)
  }

  /** One edit at a time, in order: the second sees the first's answer (and its new `version`), and every waiting edit shows at once. */
  function run(edit0: Edit, ok: { what: string; description?: string }): Promise<boolean> {
    const edit: Edit = edit0.kind === "add" ? { ...edit0, localKey: `${++seq.current}` } : edit0
    setPending((p) => [...p, edit])
    let close = true // the range was left: nothing to retry here
    return queue.current.add(
      async (current) => {
        const res = await runEdit(live.current, edit, api)
        if (!current() && res.toast) toast.error(res.toast.text, refOf(res.toast.ref)) // the range was left: no state to settle, but a refusal is still said
        return res
      },
      (res) => {
        live.current = res.state
        setState(res.state)
        setPending((p) => p.filter((x) => x !== edit))
        setOverride(null)
        announce(res, ok.what, ok.description)
        if (res.ask) ask(res.ask, edit, ok)
        close = res.ok || res.ask !== null || !res.toast // a refusal with a toast keeps a reason dialog open, with its text, for the retry
      },
    ).then(() => close, () => false)
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
    const week = shown.weeks.find((w) => w.id === weekId)
    if (week?.access.lockReason === "reason_required") {
      setReasoning({ title, description: "This week is published. Give a reason; the person will need to confirm again.", confirmLabel: title, run: (reason) => run(make({ reason }), ok) })
      return
    }
    run(make({}), ok)
  }

  function onMove(id: string, date: string) {
    const s = shiftOf(id)
    if (!s || s.date === date || s.id.startsWith("local-")) return
    guarded(s.weekId, (gate) => ({ kind: "patch", shiftId: id, edit: { date }, gate }), { what: "Shift moved", description: `${nameOf(s.personId)} to ${formatDate(date)}` }, "Move shift")
  }

  /** What a refused write does on the screen (the mapping is ./errors.ts): its toast, and a fresh read when the page is stale. */
  function report(e: RosterError) {
    if (e.toast) toast.error(e.toast.text, refOf(e.toast.ref))
    if (e.refetch) router.refresh()
  }

  /** One request per key at a time: a second click on the same button while it runs does nothing. */
  async function once(key: string, fn: () => Promise<boolean | void>): Promise<boolean> {
    if (inflight.current.has(key)) return false
    inflight.current.add(key)
    setWorking(new Set(inflight.current))
    try {
      return (await fn()) !== false
    } finally {
      inflight.current.delete(key)
      setWorking(new Set(inflight.current))
    }
  }

  const editing = dialog?.kind === "edit" ? data?.blocks.flatMap((b) => b.days.flatMap((d) => d.shifts)).find((s) => s.id === dialog.id) : undefined
  const dialogLoc = dialog?.kind === "add" ? dialog.locationId : shown.shifts.find((s) => s.id === (dialog?.kind === "edit" ? dialog.id : ""))?.locationId
  const dialogWeek = dialog?.kind === "add" ? dialog.weekId : editing?.weekId
  const weekDays = (shown.weeks.find((x) => x.id === dialogWeek)?.days ?? []).map((d) => ({ value: d.date, label: formatDate(d.date) }))

  function save(v: ShiftSave) {
    if (!dialog || !dialogWeek) return
    if (editing) {
      guarded(dialogWeek, (gate) => ({ kind: "patch", shiftId: editing.id, edit: { date: v.date, start: v.start, end: v.end, unpaidBreakMin: v.unpaidBreakMin, personId: v.people[0] ?? null, templateId: v.templateId, role: v.role }, gate }), { what: "Shift saved", description: `${nameOf(v.people[0] ?? null)} · ${formatDate(v.date)}` }, "Save changes")
    } else {
      const type = shown.shiftTypes.find((t) => t.id === v.templateId)
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
    if (r.value.conflicts.length) setRepeated({ conflicts: r.value.conflicts, counts: r.value.counts })
    router.refresh()
  }

  // ---------------------------------------------------------------- publish (FR-RS-23/24)
  async function openPublish(weekId: string) {
    setPublishing({ weekId, violations: [], checking: true })
    const r = await checkWeek(weekId)
    if (!r.ok) { setPublishing(null); report(r.error); return }
    setPublishing({ weekId, violations: r.value.violations, checking: false })
  }

  async function doPublish(reason: string) {
    if (!publishing) return
    const week = shown.weeks.find((w) => w.id === publishing.weekId)
    if (!week) return
    const r = await publishWeek(week.id, publishBody(week, reason, publishing.violations))
    if (r.ok) {
      // The API's week (published, with this caller's own access: a supervisor's is locked now) replaces ours; the page then reads everything again.
      const next = (p: RosterPayload): RosterPayload => ({ ...p, weeks: p.weeks.map((w) => (w.id === r.value.week.id ? r.value.week : w)) })
      live.current = { ...live.current, payload: next(live.current.payload) }
      setState((s) => ({ ...s, payload: next(s.payload), violations: r.value.violations }))
      setPublishing(null)
      toast.success("Week published", { description: formatDate(week.weekStart) })
      router.refresh()
      return
    }
    const e = r.error
    if (e.state === "rule_blocked") { setPublishing({ weekId: week.id, violations: e.violations, checking: false }); return } // the check moved on: show what the API found now
    setPublishing(null)
    report(e)
  }

  // ---------------------------------------------------------------- change requests (FR-RS-36/37)
  async function sendRequest(shiftId: string, body: { patch: Record<string, string | null>; reason: string }) {
    const r = await requestChange(shiftId, body)
    if (!r.ok) { report(r.error); return }
    setRequesting(null)
    toast.success("Request sent", { description: "An office role decides." })
    router.refresh()
  }

  function violationText(v: RuleViolation[]) {
    return violationLines(v, shown).map((l) => (l.message.startsWith(l.person) ? l.message : `${l.person} ${l.message}`))
  }

  /** A decision that a new block stopped: the office goes over it with a reason (reason and rule ids together); anyone else sees the rule lines and that only the office can. */
  function blockedDecision(violations: RuleViolation[], again: (over: { reason: string; violations: RuleViolation[] }) => Promise<boolean>, level: string | null) {
    setState((s) => ({ ...s, violations }))
    if (level === "office") {
      setReasoning({ title: "Go over the rule", description: "A rule is broken. Say why. It is kept in the history.", confirmLabel: "Approve anyway", lines: violationText(violations), run: (reason) => again({ reason, violations }) })
      return
    }
    setDecisionNeedsOffice(true)
  }

  function decide(r: ApiChangeRequest, decision: "approve" | "reject", note: string, over?: { reason: string; violations: RuleViolation[] }): Promise<boolean> {
    return once(r.id, async () => {
      const res = await decideChange(r.id, decideBody(decision, note, over))
      if (res.ok) {
        toast.success(decision === "approve" ? "Change approved" : "Change rejected")
        setState((s) => ({ ...s, violations: res.value.violations }))
        setDecisionNeedsOffice(false)
        router.refresh()
        return
      }
      if (res.error.state === "rule_blocked") { blockedDecision(res.error.violations, (o) => decide(r, "approve", note, o), data?.access.level ?? null); return }
      report(res.error)
      return !retryable(res.error)
    })
  }

  // ---------------------------------------------------------------- open shifts, claims, swaps (FR-RS-38/42/43)
  function exchangeDecide(x: ApiExchange, decision: "approve" | "reject", over?: { reason: string; violations: RuleViolation[] }): Promise<boolean> {
    return once(x.id, async () => {
      const res = await decideExchange(x.id, decideBody(decision, "", over))
      if (res.ok) {
        toast.success(decision === "approve" ? "Approved" : "Rejected")
        setState((s) => ({ ...s, violations: res.value.violations }))
        setDecisionNeedsOffice(false)
        router.refresh()
        return
      }
      if (res.error.state === "rule_blocked") { blockedDecision(res.error.violations, (o) => exchangeDecide(x, "approve", o), data?.access.level ?? null); return }
      report(res.error)
      return !retryable(res.error)
    })
  }

  function recommend(x: ApiExchange) {
    void once(x.id, async () => {
      const res = await recommendExchange(x.id)
      if (!res.ok) { report(res.error); return }
      toast.success("Recommended", { description: "The office decides." })
      router.refresh()
    })
  }

  function claim(shiftId: string) {
    void once(shiftId, async () => {
      const res = await claimShift(shiftId)
      if (!res.ok) { report(res.error); return }
      toast.success("Claim sent", { description: "A manager decides." })
      router.refresh()
    })
  }

  async function sendSwap(shiftId: string, toUserId: string) {
    const r = await proposeSwap(shiftId, { toUserId })
    if (!r.ok) { report(r.error); return }
    setSwapping(null)
    toast.success("Swap requested", { description: "A manager approves it." })
    router.refresh()
  }

  // ---------------------------------------------------------------- repeat (FR-RS-22/26)
  const repeatSource = repeating ? shown.weeks.find((w) => w.id === repeating) : undefined
  const loadTargets = useCallback(async (locationId: string, from: string, to: string) => {
    const r = await reloadRoster({ locationId, from, to })
    return r.ok ? r.value.weeks.filter((w) => w.locationId === locationId) : null
  }, [])
  async function runRepeat(body: Parameters<typeof repeatWeek>[1]): Promise<RepeatDone | null> {
    if (!repeatSource) return null
    const r = await repeatWeek(repeatSource.id, body)
    if (!r.ok) { report(r.error); return null }
    setRepeated({ conflicts: r.value.conflicts, counts: r.value.counts })
    router.refresh()
    return r.value
  }

  if (!data) return <p className="ros-empty">No roster to show.</p>

  const level = data.access.level
  const anyEditable = shown.weeks.some((w) => w.access.canEdit)
  const anyLocked = shown.weeks.some((w) => w.access.locked)
  const editor: DayEditor | undefined = anyEditable || anyLocked
    ? {
        onAdd: (day: ViewDay) => { if (day.weekId) setDialog({ kind: "add", weekId: day.weekId, locationId: shown.weeks.find((w) => w.id === day.weekId)!.locationId, date: day.date, n: (dialog?.n ?? 0) + 1 }) },
        onEdit: (id) => setDialog({ kind: "edit", id, n: (dialog?.n ?? 0) + 1 }),
        onMove,
        // AC-RS-05: a published week the caller may not edit offers "Request change" and nothing else; the API says which weeks those are (`access.locked`).
        canRequest: (day) => day.locked,
        onRequest: (id) => setRequesting(id),
        canSwap: (s, day) => !!me && s.personId === me && day.weekStatus === "published" && s.date >= data.today && !s.pending,
        onSwap: (id) => setSwapping(id),
      }
    : undefined
  const go = (patch: Partial<{ location: string; week: string; view: string; group: string }>) => {
    const q = new URLSearchParams({ location: data.location, week: data.from, view: data.view, group: data.group, ...patch })
    nav(() => router.push(`/rosters?${q.toString()}`))
  }
  const lines = violationLines(state.violations, shown)
  const pendingOverride = override
  const savable = data.location !== "all" ? data.blocks[0] : undefined
  const savableWeek = savable?.days.find((d) => d.weekId && d.canEdit)?.weekId ?? null
  const editableLocations = data.locations.filter((l) => l.value !== "all")
  const nextMonday = addDays(weekStart(today.slice(0, 10)), 7)
  const taken = new Set(shown.weeks.map((w) => `${w.locationId}|${w.weekStart}`))
  const { totals } = data

  const requestShift = requesting ? data.blocks.flatMap((b) => b.days.flatMap((d) => d.shifts)).find((s) => s.id === requesting) : undefined
  const swapShift = swapping ? data.blocks.flatMap((b) => b.days.flatMap((d) => d.shifts)).find((s) => s.id === swapping) : undefined
  const weekById = (id: string) => shown.weeks.find((w) => w.id === id)
  const inShown = (locationId: string) => data.location === "all" || locationId === data.location
  const openRows: OpenRow[] = shown.shifts
    .filter((s) => s.personId === null && !s.id.startsWith("local-") && inShown(s.locationId) && s.date >= data.from && s.date <= data.to)
    .flatMap((s) => {
      const w = weekById(s.weekId)
      const loc = locationOf(s.locationId)
      return w && w.status === "published" ? [{ shift: s, place: loc?.name ?? "", weekStatus: w.status, delegated: loc?.swapApprovalDelegated ?? false }] : []
    })
  const swapRows: SwapRow[] = panels.exchanges
    .filter((x) => x.kind === "swap" && inShown(x.locationId) && x.date >= data.from && x.date <= data.to)
    .flatMap((x) => {
      const w = weekById(x.weekId)
      const loc = locationOf(x.locationId)
      return w ? [{ exchange: x, place: loc?.name ?? "", weekStatus: w.status, delegated: loc?.swapApprovalDelegated ?? false }] : []
    })
  const historyWeeks = shown.weeks
    .filter((w) => data.location === "all" || w.locationId === data.location)
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.locationId.localeCompare(b.locationId))
    .map((w) => ({ id: w.id, label: `${shown.locations.length > 1 ? `${locationOf(w.locationId)?.name ?? "Location"} · ` : ""}${formatDate(w.weekStart)}` }))
  const historyFirst = panels.history && historyWeeks.some((w) => w.id === panels.history!.weekId) ? panels.history : null
  const loadHistory = async (weekId: string, cursor: string | null) => {
    const r = await historyPage(weekId, cursor, HISTORY_PAGE)
    if (r.ok) return r.value
    report(r.error)
    return null
  }
  const placeOfWeek = (weekId: string) => locationOf(weekById(weekId)?.locationId ?? "")?.name ?? "Location"

  return (
    <>
      <PageHead
        title="Location Rosters"
        subtitle={
          <span className="ros-sub num">
            {range_(data)}
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
              {range_(data)}
            </button>
            <button type="button" className="ros-nav-btn" aria-label="Next" onClick={() => go({ week: data.next })}>
              <Icon name="chevron-right" size={24} />
            </button>
          </div>
        </FilterBar>
        {data.group === "location" ? (
          data.blocks.map((b) => {
            const weekId = b.days.find((d) => d.weekId && d.canEdit)?.weekId ?? null
            const several = b.weeks.length > 1
            const draft = b.weeks.find((w) => w.status === "draft" && w.canEdit)
            const source = data.access.canEdit ? b.weeks[0] : undefined
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
                  {draft && (
                    <button type="button" className="btn btn-primary ros-publish" disabled={publishing?.weekId === draft.id} onClick={() => void openPublish(draft.id)}>
                      <Icon name="send" size={24} />Publish{several ? ` ${formatDate(draft.weekStart)}` : ""}
                    </button>
                  )}
                  {source && (
                    <button type="button" className="btn btn-outline ros-repeat" onClick={() => setRepeating(source.id)}>
                      <Icon name="repeat" size={24} />Repeat{several ? ` ${formatDate(source.weekStart)}` : ""}
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
        needsOffice={pendingOverride?.needsOffice || decisionNeedsOffice}
        onOpen={(id) => setDialog({ kind: "edit", id, n: (dialog?.n ?? 0) + 1 })}
        onOverride={pendingOverride && !pendingOverride.needsOffice ? () => setReasoning({
          title: "Go over the rule", description: "Say why. It is kept in the history.", confirmLabel: "Go over it",
          run: (reason) => run(withGate(pendingOverride.edit, overrideFields(reason, state.violations)), { what: "Saved over the rule" }),
        }) : undefined}
        onDismiss={() => { setState((s) => ({ ...s, violations: [] })); setOverride(null); setDecisionNeedsOffice(false) }}
      />
      {repeated && <ConflictsPanel conflicts={repeated.conflicts} counts={repeated.counts} shiftOf={shiftOf} nameOf={nameOf} onOpen={(id) => setDialog({ kind: "edit", id, n: (dialog?.n ?? 0) + 1 })} onDismiss={() => setRepeated(null)} />}
      <RequestsPanel requests={panels.requests.filter((r) => weekById(r.weekId))} shiftOf={shiftOf} nameOf={nameOf} canDecide={level === "office"} busy={working} onDecide={(r, d, note) => decide(r, d, note)} />
      <OpenShiftsPanel
        level={level} me={me} today={today} open={openRows} swaps={swapRows} exchanges={panels.exchanges} nameOf={nameOf} busy={working}
        onClaim={claim} onRecommend={recommend} onDecide={(x, d) => exchangeDecide(x, d)}
      />
      {anyEditable && (
        <TemplatesPanel
          templates={templates}
          locationName={(id) => shown.locations.find((l) => l.id === id)?.name ?? "Location"}
          canSave={!!savableWeek}
          onSave={(name) => savableWeek && void saveTemplate(name, savableWeek)}
          onApply={setApplying}
        />
      )}
      {historyFirst && <HistoryPanel weeks={historyWeeks} weekId={historyFirst.weekId} first={historyFirst.page} shiftOf={shiftOf} nameOf={nameOf} load={loadHistory} pageRows={HISTORY_PAGE} />}
      {dialog && dialogLoc && dialogWeek && (dialog.kind === "add" || editing) && (
        <ShiftDialog
          key={dialog.n}
          shift={editing}
          date={dialog.kind === "add" ? dialog.date : (editing?.date ?? "")}
          types={shown.shiftTypes.filter((t) => t.locationId === dialogLoc && !t.archived)}
          members={shown.members}
          membersTruncated={shown.membersTruncated}
          dates={weekDays}
          onSave={save}
          onRemove={editing ? removeEditing : undefined}
          onClose={() => setDialog(null)}
        />
      )}
      {reasoning && <ReasonDialog title={reasoning.title} description={reasoning.description} confirmLabel={reasoning.confirmLabel} lines={reasoning.lines} onConfirm={async (r) => { const cur = reasoning; if (await cur.run(r)) setReasoning((x) => (x === cur ? null : x)) }} onClose={() => setReasoning(null)} />}
      {publishing && (
        <PublishDialog
          title={`${placeOfWeek(publishing.weekId)}, ${formatDate(weekById(publishing.weekId)?.weekStart ?? "")}`}
          violations={publishing.violations}
          level={weekById(publishing.weekId)?.access.level ?? level}
          nameOf={(id) => nameOf(id)}
          checking={publishing.checking}
          onPublish={doPublish}
          onClose={() => setPublishing(null)}
        />
      )}
      {requestShift && <ChangeRequestDialog key={requestShift.id} shift={requestShift} members={shown.members} membersTruncated={shown.membersTruncated} onSend={(b) => sendRequest(requestShift.id, b)} onClose={() => setRequesting(null)} />}
      {swapShift && (
        <SwapDialog
          key={swapShift.id} shift={swapShift} place={swapShift.location} truncated={shown.membersTruncated}
          people={shown.members.filter((m) => m.active && m.id !== me).map((m) => ({ id: m.id, name: m.name }))}
          onSend={(to) => sendSwap(swapShift.id, to)} onClose={() => setSwapping(null)}
        />
      )}
      {repeatSource && (
        <RepeatDialog
          source={repeatSource} locationName={locationOf(repeatSource.locationId)?.name ?? "Location"} nameOf={nameOf}
          loadTargets={(from, to) => loadTargets(repeatSource.locationId, from, to)} run={runRepeat} onClose={() => setRepeating(null)}
        />
      )}
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
