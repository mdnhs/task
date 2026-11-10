"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ChevronLeft, ChevronRight, MapPin, Repeat, Send } from "lucide-react"
import { toast } from "sonner"

import { FilterBar, FilterSelect, FilterSeg } from "@/components/filter-bar"
import { PageHead } from "@/components/page-head"
import { StatusPill } from "@/components/status-pill"
import { formatDate } from "@/lib/dates"
import { addDays, weekStart, weekdayOf } from "@/lib/shifts"
import type { Status } from "@/lib/types"
import { canSeeLocation } from "@/lib/roster-access"
import { autoRepeatDue, type RepeatConflict, type WeekTemplate } from "@/lib/roster-repeat"
import { checkShifts, type RuleContext, type RuleViolation } from "@/lib/roster-rules"
import { approveClaim, approveSwap, approverFor, BlockedError, rejectClaim, rejectSwap } from "../exchange"
import { addShiftsChecked, canEditShift, moveShiftChecked, newShiftIds, removeShift, shiftHistory } from "../editing"
import { decideRequest, editPublished, publishWeek, requestChange } from "../publishing"
import { applyTemplateChecked, repeatManyChecked, saveTemplateChecked } from "../repeating"
import { mergeById, mergeLocations, withNewLocations } from "../scope"
import { claimsStore, historyStore, locationsStore, requestsStore, swapsStore, shiftsStore, targetsStore, templatesStore, weekTemplatesStore, weeksStore } from "../store"
import type { Claim, RosterEdit, RosterShift, RosterWeek, SwapRequest } from "../types"
import { rosterViewData, type RosterGroup, type RosterViewData, type RosterViewKind } from "../view"
import { DayBoard, type DayEditor } from "./day-board"
import { PersonGrid } from "./person-grid"
import { ChangeRequestDialog } from "./change-request-dialog"
import { ConflictsPanel } from "./conflicts-panel"
import { RepeatDialog } from "./repeat-dialog"
import { ApplyTemplateDialog, TemplatesPanel } from "./templates-panel"
import { HistoryPanel } from "./history-panel"
import { PublishDialog } from "./publish-dialog"
import { ReasonDialog } from "./reason-dialog"
import { OpenShiftsPanel } from "./open-shifts-panel"
import { RequestsPanel } from "./requests-panel"
import { ShiftDialog, type ShiftSave } from "./shift-dialog"

const STATUS: Record<"draft" | "published" | "none", Status> = {
  published: { tone: "ok", label: "Published" },
  draft: { tone: "warn", label: "Draft" },
  none: { tone: "mute", label: "No roster" },
}

const range = (d: RosterViewData) => (d.from === d.to ? formatDate(d.from) : `${formatDate(d.from)} – ${formatDate(d.to)}`)

// Location Rosters (FR-RS-10/11/12/33): filters live in the URL (?location=&week=&view=&group=), the server rebuilds the view data.
export function RostersView({ data, edit }: { data: RosterViewData; edit?: RosterEdit }) {
  return edit ? <RostersLive data={data} edit={edit} /> : <RostersBody data={data} />
}

type Dialog = { kind: "add"; locationId: string; date: string; n: number } | { kind: "edit"; id: string; n: number }
/** A published-week edit waiting for its reason (FR-RS-35). */
type Reasoning = { title: string; description: string; confirmLabel: string; run(reason: string): void }

// Locations added or renamed on the Locations pages (same stores) show here at once; an office role may open a new one.
function RostersLive({ data, edit }: { data: RosterViewData; edit: RosterEdit }) {
  const [stored] = locationsStore.useStore(edit.roster.locations, edit.scopeKey)
  const locations = mergeLocations(edit.roster.locations, stored)
  return <RostersLiveBody data={data} edit={{ ...edit, roster: { ...edit.roster, locations }, access: withNewLocations(edit.access, edit.roster.locations, locations) }} />
}

// Editing roles (FR-RS-20/21/22): the shifts live in the stores (seeded from the server payload, kept until reload) and the view is rebuilt
// from them on every change, so an add, edit or move shows at once, in every grouping. On a published week office roles give a reason
// (FR-RS-35) and the person must confirm again; supervisors can only request a change (FR-RS-36); draft weeks publish from the board (FR-RS-23).
function RostersLiveBody({ data: served, edit }: { data: RosterViewData; edit: RosterEdit }) {
  const { roster, access, scopeKey, me, now, extra, checkWeek, checkAssign } = edit
  const [shifts, setShifts] = shiftsStore.useStore(roster.shifts, scopeKey)
  const [weeks, setWeeks] = weeksStore.useStore(roster.weeks, scopeKey)
  const [templates] = templatesStore.useStore(roster.templates, scopeKey)
  const [targets] = targetsStore.useStore(roster.targets, scopeKey)
  const [history, setHistory] = historyStore.useStore(extra.history, scopeKey)
  const [requests, setRequests] = requestsStore.useStore(extra.requests, scopeKey)
  const [claims, setClaims] = claimsStore.useStore(extra.exchange.claims, scopeKey)
  const [swaps, setSwaps] = swapsStore.useStore(extra.exchange.swaps, scopeKey)
  // Claims and swaps are shared with My roster (same key): whichever page seeded first, top the lists up with ours without undoing edits.
  useEffect(() => {
    setClaims((p) => mergeById(p, extra.exchange.claims))
    setSwaps((p) => mergeById(p, extra.exchange.swaps))
  }, [extra.exchange.claims, extra.exchange.swaps, setClaims, setSwaps])
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [reasoning, setReasoning] = useState<Reasoning | null>(null)
  const [requesting, setRequesting] = useState<{ id: string; n: number } | null>(null)
  const [publishing, setPublishing] = useState<string | null>(null)
  const [weekTemplates, setWeekTemplates] = weekTemplatesStore.useStore(extra.weekTemplates, scopeKey)
  const [repeating, setRepeating] = useState<{ weekId: string; n: number } | null>(null)
  const [applying, setApplying] = useState<WeekTemplate | null>(null)
  const [conflicts, setConflicts] = useState<RepeatConflict[]>([])

  const live = rosterViewData({ ...roster, shifts, weeks, templates, targets }, access, edit.query, now)
  const data = "denied" in live ? served : live

  const weekOf = (locationId: string, date: string) => weeks.find((w) => w.locationId === locationId && w.weekStart === weekStart(date))
  const editable = (locationId: string, date: string) => {
    const w = weekOf(locationId, date)
    return !!w && canEditShift(access, w)
  }
  const requestable = (locationId: string, date: string) => {
    const w = weekOf(locationId, date)
    return !!w && w.status === "published" && !canEditShift(access, w) && access.editDraft && !access.editPublished && (access.locationIds?.includes(locationId) ?? false)
  }
  // The server's "now" moved on by the time spent on the page, so each entry carries the moment of its own edit (tenant wall clock).
  const [loadedAt] = useState(() => Date.now())
  const stamp = () => new Date(Date.parse(`${now.slice(0, 19)}Z`) + (Date.now() - loadedAt)).toISOString().slice(0, 19)
  const log = (action: string, where: { weekId: string; locationId: string; shiftId: string }, before: unknown, after: unknown, reason: string | null = null) => {
    const at = stamp()
    setHistory((h) => [...h, { ...shiftHistory(action, where, before, after, me, at, h), reason }])
  }
  const nameOf = (id: string | null) => (id ? (roster.members.find((m) => m.id === id)?.name ?? extra.exchange.names[id] ?? "Staff member") : "Open shift")
  const isPublished = (weekId: string) => weeks.find((w) => w.id === weekId)?.status === "published"

  /** An office edit to a published shift: through editPublished (reason, history, confirmedAt cleared). */
  function editLive(s: RosterShift, patch: Partial<RosterShift>, reason: string): boolean {
    try {
      const r = editPublished(s, patch, access, reason, me, stamp(), patchCheck())
      setShifts((p) => p.map((x) => (x.id === s.id ? r.shift : x)))
      setHistory((h) => [...h, r.entry])
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the change")
      return false
    }
  }

  const move = (id: string, date: string) => {
    const s = shifts.find((x) => x.id === id)
    const week = s && weekOf(s.locationId, date)
    if (!s || !week || s.date === date || !editable(s.locationId, s.date) || !canEditShift(access, week)) return
    const done = () => toast.success("Shift moved", { description: `${nameOf(s.personId)} to ${formatDate(date)}` })
    if (isPublished(s.weekId) || week.status === "published") {
      setReasoning({
        title: "Move shift", description: "This week is published. Say why; the person will need to confirm again.", confirmLabel: "Move shift",
        run: (reason) => { if (editLive(s, { date, weekId: week.id }, reason)) done() },
      })
      return
    }
    let next: RosterShift
    try {
      next = moveShiftChecked(access, s, weeks.find((w) => w.id === s.weekId) ?? week, week, date)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not move the shift")
      return
    }
    setShifts((p) => p.map((x) => (x.id === id ? next : x)))
    log("shift.moved", { weekId: next.weekId, locationId: s.locationId, shiftId: id }, { date: s.date, weekId: s.weekId }, { date, weekId: next.weekId })
    done()
  }

  // The first draft week of the shown range that this role may publish (a fortnight or month holds several: publish them one by one).
  const publishWeekOf = (locationId: string) =>
    weeks
      .filter((w) => w.locationId === locationId && w.status === "draft" && w.weekStart >= weekStart(data.from) && w.weekStart <= data.to && canEditShift(access, w))
      .sort((a, b) => a.weekStart.localeCompare(b.weekStart))[0]

  // Repeat (FR-RS-26, D10): the week of the shown range at this location with the latest start, if the role may draft there.
  const repeatSource = (locationId: string) =>
    access.editDraft && canSeeLocation(access, locationId)
      ? weeks
          .filter((w) => w.locationId === locationId && w.weekStart >= weekStart(data.from) && w.weekStart <= data.to)
          .sort((a, b) => b.weekStart.localeCompare(a.weekStart))[0]
      : undefined
  // The roster's people plus those on open claims and swaps (a supervisor's list is cut, the approval check needs them).
  const allMembers = [...roster.members, ...extra.exchange.members.filter((m) => !roster.members.some((x) => x.id === m.id))]
  const ruleCtx = (list: RosterShift[]): RuleContext => ({
    shifts: list, members: allMembers, leave: extra.rules.leave, availability: extra.rules.availability, templates,
    severity: extra.rules.severity, avgWeekReferenceWeeks: extra.rules.avgWeekReferenceWeeks, tz: extra.tz, visibleLocationIds: access.locationIds,
  })
  /** Eligibility and the blocking rules for a change to a published shift (publishing.ts): over the people, templates and shifts in this browser. */
  const patchCheck = () => ({ members: allMembers, templates, ctx: ruleCtx(shifts), weeks })
  const weekIdFor = (locationId: string, start: string) => {
    const base = `wk-${locationId}-${start}`
    return weeks.some((w) => w.id === base) ? `${base}-${Date.now().toString(36)}` : base
  }

  /** N sequential repeats of one week (repeatManyChecked): all or nothing, an error leaves the roster untouched. */
  function runRepeat(source: RosterWeek, count: number, replace: boolean) {
    const r = repeatManyChecked(access, source, shifts, weeks, count, replace, ruleCtx(shifts), extra.holidays, (target, taken, n) => [weekIdFor(source.locationId, target), ...newShiftIds(n, taken)], me, stamp())
    setShifts(() => r.shifts)
    setWeeks(() => r.weeks)
    setHistory((h) => [...h, ...r.entries])
    setConflicts(r.conflicts)
    const opened = r.conflicts.filter((c) => c.open).length
    toast.success(count === 1 ? "Week repeated" : `${count} weeks repeated`, { description: opened ? `${opened} open shifts` : "Drafts are ready" })
    return { weeks: count, conflicts: r.conflicts }
  }

  function saveTemplate(name: string) {
    const src = data.location !== "all" ? repeatSource(data.location) : undefined
    if (!src) return
    try {
      const t = saveTemplateChecked(access, name, src, shifts, `wt-${Date.now().toString(36)}`)
      setWeekTemplates((p) => [...p, t])
      toast.success("Template saved", { description: `${t.name} · ${t.shifts.length} shifts` })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the template")
    }
  }

  function applyTemplate(t: WeekTemplate, locationId: string, start: string) {
    try {
      const r = applyTemplateChecked(access, t, locationId, start, weeks, ruleCtx(shifts), extra.holidays, [weekIdFor(locationId, start), ...newShiftIds(t.shifts.length, shifts)], me, stamp())
      setWeeks((p) => [...p, r.week])
      setShifts((p) => [...p, ...r.shifts])
      setHistory((h) => [...h, r.entry])
      setConflicts(r.conflicts)
      toast.success("Template applied", { description: `${t.name} · ${formatDate(start)}${r.conflicts.some((c) => c.open) ? ` · ${r.conflicts.filter((c) => c.open).length} open shifts` : ""}` })
      setApplying(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not apply the template")
    }
  }

  // Quiet banner: a location's next week is close and not drafted yet (autoRepeatDue). Not an automatic write.
  const due = autoRepeatDue(weeks.filter((w) => access.editDraft && canSeeLocation(access, w.locationId)), now).find((w) => data.location === "all" || w.locationId === data.location)
  const nameOfLocation = (id: string) => roster.locations.find((l) => l.id === id)?.name ?? "Location"
  const bannerNode = due && (
    <div className="ros-banner" role="status">
      <span>{data.location === "all" ? `${nameOfLocation(due.locationId)}: next` : "Next"} week is not drafted yet</span>
      <button type="button" className="btn btn-outline" onClick={() => setRepeating({ weekId: due.id, n: (repeating?.n ?? 0) + 1 })}><Repeat aria-hidden="true" />Repeat</button>
    </div>
  )
  const repeatWeekObj = repeating ? weeks.find((w) => w.id === repeating.weekId) : undefined
  const editableLocations = roster.locations.filter((l) => access.editDraft && canSeeLocation(access, l.id)).map((l) => ({ value: l.id, label: l.name }))
  const mondayAfterToday = addDays(weekStart(now.slice(0, 10)), 7)

  const editor: DayEditor = {
    canRepeat: (locationId) => !!repeatSource(locationId),
    onRepeat: (locationId) => { const w = repeatSource(locationId); if (w) setRepeating({ weekId: w.id, n: (repeating?.n ?? 0) + 1 }) },
    editable,
    shiftInfo: (id) => { const s = shifts.find((x) => x.id === id); return s && { locationId: s.locationId, date: s.date } },
    onAdd: (locationId, date) => setDialog({ kind: "add", locationId, date, n: (dialog?.n ?? 0) + 1 }),
    onEdit: (id) => setDialog({ kind: "edit", id, n: (dialog?.n ?? 0) + 1 }),
    onMove: move,
    canRequest: requestable,
    onRequest: (id) => setRequesting({ id, n: (requesting?.n ?? 0) + 1 }),
    canPublish: (locationId) => !!publishWeekOf(locationId),
    publishLabel: (locationId) => { const w = publishWeekOf(locationId); return w && (data.view === "day" || data.view === "week" ? "Publish" : `Publish ${formatDate(w.weekStart)}`) || "Publish" },
    onPublish: (locationId) => { const w = publishWeekOf(locationId); if (w) setPublishing(w.id) },
  }

  const editing = dialog?.kind === "edit" ? shifts.find((s) => s.id === dialog.id) : undefined
  const dialogLoc = dialog?.kind === "add" ? dialog.locationId : editing?.locationId
  const dialogOpen = !!dialogLoc && (dialog?.kind === "add" || !!editing)

  function save(v: ShiftSave) {
    if (!dialogLoc) return
    const week = weekOf(dialogLoc, v.date)
    if (!week || !canEditShift(access, week)) return
    const times = { templateId: v.templateId, role: v.role, start: v.start, end: v.end, unpaidBreakMin: v.unpaidBreakMin }
    const onPublished = week.status === "published" || (!!editing && isPublished(editing.weekId))
    if (editing) {
      const next = { ...editing, ...times, date: v.date, weekId: week.id, personId: v.people[0] ?? null }
      const done = () => { toast.success("Shift saved", { description: `${nameOf(next.personId)} · ${formatDate(v.date)}` }); setDialog(null) }
      if (onPublished) {
        const full: Partial<RosterShift> = { ...times, date: v.date, weekId: week.id, personId: next.personId }
        const patch = Object.fromEntries(Object.entries(full).filter(([k, val]) => editing[k as keyof RosterShift] !== val)) as Partial<RosterShift>
        if (!Object.keys(patch).length) { toast("No changes to save"); setDialog(null); return }
        setReasoning({ title: "Save changes", description: "This week is published. Say why; the person will need to confirm again.", confirmLabel: "Save changes", run: (reason) => { if (editLive(editing, patch, reason)) done() } })
        return
      }
      setShifts((p) => p.map((x) => (x.id === editing.id ? next : x)))
      log(editing.date !== v.date && editing.personId === next.personId ? "shift.moved" : "shift.edited", { weekId: week.id, locationId: dialogLoc, shiftId: editing.id }, editing, next)
      done()
    } else {
      const done = (reason: string | null) => {
        let made: RosterShift[]
        try {
          made = addShiftsChecked(access, week, { ...times, weekId: week.id, locationId: dialogLoc, date: v.date }, v.people, newShiftIds(Math.max(1, v.people.length), shifts), reason)
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Could not add the shift")
          return
        }
        setShifts((p) => [...p, ...made])
        for (const s of made) log("shift.added", { weekId: week.id, locationId: dialogLoc, shiftId: s.id }, null, s, reason)
        toast.success(made.length > 1 ? `${made.length} shifts added` : "Shift added", { description: formatDate(v.date) })
        setDialog(null)
      }
      if (onPublished) {
        setReasoning({ title: "Add shift", description: "This week is published. Say why; the people added will need to confirm.", confirmLabel: "Add shift", run: (reason) => done(reason) })
        return
      }
      done(null)
    }
  }

  /** Remove the shift being edited: a draft week at once, a published week (office only) with a reason. Always in the history. */
  function removeEditing() {
    if (!editing) return
    const week = weeks.find((w) => w.id === editing.weekId)
    if (!week || !canEditShift(access, week)) return
    const run = (reason: string | null) => {
      try {
        const r = removeShift(access, week, shifts, editing.id, me, stamp(), history, reason)
        setShifts(() => r.shifts)
        setHistory((h) => [...h, r.entry])
        toast.success("Shift removed", { description: `${nameOf(editing.personId)} · ${formatDate(editing.date)}` })
        setDialog(null)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not remove the shift")
      }
    }
    if (week.status === "published") {
      setReasoning({ title: "Remove shift", description: "This week is published. Say why; the person will see it is gone.", confirmLabel: "Remove shift", run })
      return
    }
    run(null)
  }

  const requestShift = requesting ? shifts.find((s) => s.id === requesting.id) : undefined
  function sendRequest(patch: Partial<RosterShift>, why: string) {
    if (!requestShift) return
    const ids = [`cr-${Date.now().toString(36)}-${requests.length + 1}`]
    setRequests((r) => [...r, requestChange(requestShift, patch, why, me, stamp(), ids)])
    toast.success("Request sent", { description: `${nameOf(requestShift.personId)} · ${formatDate(requestShift.date)}` })
    setRequesting(null)
  }

  // Open shifts and swaps (FR-RS-38/42/43, D6). Approving runs the rule check over this browser's shifts and the server's over every location's
  // (a clash at a site the caller can't see). A blocking rule refuses; an office role may approve anyway with a reason.
  const where = (shiftId: string) => {
    const s = shifts.find((x) => x.id === shiftId)
    const w = s && weeks.find((x) => x.id === s.weekId)
    const l = s && roster.locations.find((x) => x.id === s.locationId)
    return s && w && l ? { s, w, l } : undefined
  }
  const canDecide = (shiftId: string) => { const t = where(shiftId); return !!t && approverFor(t.w, t.l, access) }
  const failed = (e: unknown, retry: (reason: string) => void) => {
    const msg = e instanceof Error ? e.message : "Could not approve"
    if (e instanceof BlockedError && access.editPublished) setReasoning({ title: "Approve over a rule", description: msg, confirmLabel: "Approve anyway", run: retry })
    else toast.error(msg)
  }
  const warned = (n: number, what: string) => toast.success(what, { description: n ? `${n} warning${n === 1 ? "" : "s"}, see the rules` : undefined })

  /** The server's check over every location. Fails closed: if it can't run, the approval is refused (null). */
  async function serverCheck(assign: { shiftId: string; personId: string }[]): Promise<RuleViolation[] | null> {
    if (!checkAssign) return []
    try {
      return await checkAssign(assign)
    } catch {
      toast.error("Could not check the rules. Try again.")
      return null
    }
  }

  async function decideClaim(c: Claim, approve: boolean, override: string | null = null) {
    const t = where(c.shiftId)
    if (!t) return
    const at = stamp()
    try {
      if (!approve) {
        const done = rejectClaim(c, t.s, access, t.w, t.l, me, at)
        setClaims((p) => p.map((x) => (x.id === c.id ? done : x)))
        toast.success("Offer rejected", { description: nameOf(c.personId) })
        return
      }
      const found = await serverCheck([{ shiftId: c.shiftId, personId: c.personId }])
      if (!found) return
      const r = approveClaim(c, t.s, access, t.w, t.l, ruleCtx(shifts), me, at, override, found)
      setShifts((p) => p.map((x) => (x.id === t.s.id ? r.shift : x)))
      setClaims((p) => p.map((x) => (x.id === c.id ? r.claim : x.shiftId === c.shiftId && x.status === "open" ? { ...x, status: "rejected", decidedBy: me, decidedAt: at } : x)))
      setHistory((h) => [...h, r.entry])
      warned(r.violations.length, `${nameOf(c.personId)} takes the shift`)
    } catch (e) {
      failed(e, (reason) => void decideClaim(c, approve, reason))
    }
  }

  async function decideSwap(r: SwapRequest, approve: boolean, override: string | null = null) {
    const t = where(r.shiftId)
    if (!t) return
    const other = r.toShiftId ? shifts.find((x) => x.id === r.toShiftId) ?? null : null
    const at = stamp()
    try {
      if (!approve) {
        const done = rejectSwap(r, t.s, access, t.w, t.l, me, at)
        setSwaps((p) => p.map((x) => (x.id === r.id ? done : x)))
        toast.success("Swap rejected", { description: nameOf(r.fromPersonId) })
        return
      }
      const found = await serverCheck([{ shiftId: r.shiftId, personId: r.toPersonId }, ...(r.toShiftId ? [{ shiftId: r.toShiftId, personId: r.fromPersonId }] : [])])
      if (!found) return
      const out = approveSwap(r, t.s, other, access, t.w, t.l, ruleCtx(shifts), me, at, override, found)
      setShifts((p) => p.map((x) => (x.id === out.shift.id ? out.shift : out.other && x.id === out.other.id ? out.other : x)))
      setSwaps((p) => p.map((x) => (x.id === r.id ? out.request : x)))
      setHistory((h) => [...h, out.entry])
      warned(out.violations.length, "Swap approved")
    } catch (e) {
      failed(e, (reason) => void decideSwap(r, approve, reason))
    }
  }
  const openInView = shifts.filter((s) => s.personId === null && s.date >= data.from && s.date <= data.to && (data.location === "all" || s.locationId === data.location) && roster.locations.some((l) => l.id === s.locationId)).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
  const showExchange = access.approve || access.editDraft

  function decide(id: string, approve: boolean, note: string | null, override: string | null = null) {
    const r = requests.find((x) => x.id === id)
    const s = r && shifts.find((x) => x.id === r.shiftId)
    if (!r || !s) return
    let out: ReturnType<typeof decideRequest>
    try {
      out = decideRequest(r, s, access, approve, note, me, stamp(), override, patchCheck())
    } catch (e) {
      failed(e, (reason) => decide(id, approve, note, reason))
      return
    }
    setRequests((p) => p.map((x) => (x.id === id ? out.request : x)))
    if (approve) setShifts((p) => p.map((x) => (x.id === s.id ? out.shift : x)))
    if (out.entry) { const entry = out.entry; setHistory((h) => [...h, entry]) }
    toast.success(approve ? "Change approved" : "Request rejected", { description: `${nameOf(s.personId)} · ${formatDate(s.date)}` })
  }

  // Publish check (D9): the rules over this browser's shifts (so unsaved edits count), merged with the server's check over every location's
  // shifts, which is where a clash at a site the caller can't see comes from. The server sends only results for the caller's own shifts.
  const pubWeek = publishing ? weeks.find((w) => w.id === publishing) : undefined
  const [serverFound, setServerFound] = useState<{ weekId: string; list: RuleViolation[] } | null>(null)
  useEffect(() => {
    if (!publishing || !checkWeek) return
    let live = true
    checkWeek(publishing, shifts.filter((s) => s.weekId === publishing)).then((list) => { if (live) setServerFound({ weekId: publishing, list }) }, () => { if (live) setServerFound({ weekId: publishing, list: [] }) })
    return () => { live = false }
  }, [publishing, checkWeek, shifts])
  const checking = !!pubWeek && !!checkWeek && serverFound?.weekId !== pubWeek.id
  const violations = useMemo(() => {
    if (!pubWeek) return []
    const { rules } = extra
    const ctx: RuleContext = {
      shifts, members: roster.members, leave: rules.leave, availability: rules.availability, templates,
      severity: rules.severity, avgWeekReferenceWeeks: rules.avgWeekReferenceWeeks, tz: extra.tz, visibleLocationIds: access.locationIds,
    }
    const local = checkShifts(shifts.filter((s) => s.weekId === pubWeek.id && s.personId), ctx)
    // Server results count only for shifts still on the page; the same finding from both sides shows once.
    const present = new Set(shifts.map((s) => s.id))
    // The hour average reads differently on each side (this browser's visible hours, the server's wording without a total): once per shift.
    const seen = new Set(local.map((v) => (v.rule === "avg_48h" ? `avg_48h|${v.shiftId}` : `${v.rule}|${v.shiftId}|${v.message}`)))
    const server = (serverFound?.weekId === pubWeek.id ? serverFound.list : []).filter((v) => present.has(v.shiftId) && !seen.has(v.rule === "avg_48h" ? `avg_48h|${v.shiftId}` : `${v.rule}|${v.shiftId}|${v.message}`))
    return [...local, ...server]
  }, [pubWeek, shifts, templates, roster.members, extra, access.locationIds, serverFound])
  const pubLocation = pubWeek ? roster.locations.find((l) => l.id === pubWeek.locationId)?.name : undefined

  function publish(reason: string | null) {
    if (!pubWeek) return
    const out = publishWeek(pubWeek, access, violations, reason, me, stamp())
    setWeeks((p) => p.map((w) => (w.id === pubWeek.id ? out.week : w)))
    setHistory((h) => [...h, out.entry])
    toast.success("Roster published", { description: `${pubLocation ?? "Roster"} · ${formatDate(pubWeek.weekStart)}` })
    setPublishing(null)
  }

  return (
    <>
      <RostersBody data={data} editor={editor} banner={bannerNode || undefined} />
      {access.approve && <RequestsPanel requests={requests} shiftOf={(id) => shifts.find((s) => s.id === id)} nameOf={nameOf} onDecide={decide} />}
      {showExchange && (
        <OpenShiftsPanel
          gapsLink={extra.gapsLink}
          open={openInView}
          claims={claims}
          swaps={swaps}
          shiftOf={(id) => shifts.find((s) => s.id === id)}
          nameOf={nameOf}
          placeOf={nameOfLocation}
          canDecide={canDecide}
          onClaim={(c, a) => void decideClaim(c, a)}
          onSwap={(r, a) => void decideSwap(r, a)}
        />
      )}
      <ConflictsPanel conflicts={conflicts} shiftOf={(id) => shifts.find((s) => s.id === id)} nameOf={nameOf} onOpen={(id) => setDialog({ kind: "edit", id, n: (dialog?.n ?? 0) + 1 })} onDismiss={() => setConflicts([])} />
      {access.editDraft && (
        <TemplatesPanel
          templates={weekTemplates.filter((t) => canSeeLocation(access, t.locationId))}
          locationName={nameOfLocation}
          canSave={data.location !== "all" && !!repeatSource(data.location)}
          onSave={saveTemplate}
          onApply={setApplying}
        />
      )}
      <HistoryPanel entries={history} shiftOf={(id) => shifts.find((s) => s.id === id)} nameOf={nameOf} />
      {dialog && dialogOpen && dialogLoc && (
        <ShiftDialog
          key={dialog.n}
          shift={editing}
          date={dialog.kind === "add" ? dialog.date : (editing?.date ?? "")}
          templates={templates.filter((t) => t.locationId === dialogLoc)}
          members={roster.members}
          dates={moveDates(dialog.kind === "add" ? dialog.date : (editing?.date ?? ""), (d) => editable(dialogLoc, d) || d === editing?.date)}
          onSave={save}
          onRemove={editing ? removeEditing : undefined}
          onClose={() => setDialog(null)}
        />
      )}
      {reasoning && <ReasonDialog title={reasoning.title} description={reasoning.description} confirmLabel={reasoning.confirmLabel} onConfirm={(r) => { reasoning.run(r); setReasoning(null) }} onClose={() => setReasoning(null)} />}
      {requestShift && requesting && (
        <ChangeRequestDialog key={requesting.n} shift={requestShift} template={templates.find((t) => t.id === requestShift.templateId)} members={roster.members} onSend={sendRequest} onClose={() => setRequesting(null)} />
      )}
      {repeatWeekObj && repeating && (
        <RepeatDialog key={repeating.n} source={repeatWeekObj} locationName={nameOfLocation(repeatWeekObj.locationId)} weeks={weeks} nameOf={nameOf} onRepeat={(c, r) => runRepeat(repeatWeekObj, c, r)} onClose={() => setRepeating(null)} />
      )}
      {applying && (
        <ApplyTemplateDialog
          template={applying}
          locations={editableLocations}
          firstMonday={mondayAfterToday}
          taken={new Set(weeks.map((w) => `${w.locationId}|${w.weekStart}`))}
          onApply={(loc, start) => applyTemplate(applying, loc, start)}
          onClose={() => setApplying(null)}
        />
      )}
      {pubWeek && (
        <PublishDialog
          title={`${pubLocation ?? "roster"}, ${formatDate(pubWeek.weekStart)}`}
          violations={violations}
          nameOf={nameOf}
          canOverride={access.editPublished}
          checking={checking}
          onPublish={publish}
          onClose={() => setPublishing(null)}
        />
      )}
    </>
  )
}

/** Days a shift can be moved to from the form: the shown day's week and the weeks either side, so a move isn't limited to the view range. */
function moveDates(from: string, ok: (d: string) => boolean): { value: string; label: string }[] {
  const first = addDays(weekStart(from), -7)
  return Array.from({ length: 21 }, (_, i) => addDays(first, i)).filter(ok).map((d) => ({ value: d, label: formatDate(d) }))
}

function RostersBody({ data, editor, banner }: { data: RosterViewData; editor?: DayEditor; banner?: React.ReactNode }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const go = (patch: Partial<{ location: string; week: string; view: string; group: string }>) => {
    const q = new URLSearchParams({ location: data.location, week: data.from, view: data.view, group: data.group, ...patch })
    start(() => router.push(`/rosters?${q.toString()}`))
  }
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
        actions={data.manageLocations ? <Link href="/rosters/locations" className="btn btn-outline"><MapPin aria-hidden="true" />Manage locations</Link> : undefined}
      />
      {banner}
      <div className="card ros-card" data-pending={pending || undefined}>
        <FilterBar>
          {data.locations.length > 1 && (
            <FilterSelect label="Location" value={data.location} options={data.locations} onChange={(v) => go({ location: v })} />
          )}
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
              <ChevronLeft aria-hidden="true" />
            </button>
            <button type="button" className="ros-nav-label num" onClick={() => go({ week: data.today })} title="Back to today">
              {range(data)}
            </button>
            <button type="button" className="ros-nav-btn" aria-label="Next" onClick={() => go({ week: data.next })}>
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
        </FilterBar>
        {data.group === "location" ? (
          data.blocks.map((b) => {
            return (
              <section key={b.locationId} className="ros-block" aria-label={b.name}>
                <div className="ros-block-head">
                  <h2>{b.name}</h2>
                  <StatusPill status={STATUS[b.status]} tick={false} />
                  {b.target > 0 && (
                    <span className="ros-sum num" data-short={b.short > 0 || undefined}>
                      {b.count}/{b.target}
                      {b.short > 0 && <b> · {b.short} short</b>}
                    </span>
                  )}
                  {editor?.canRepeat(b.locationId) && (
                    <button type="button" className="btn btn-outline ros-repeat" onClick={() => editor.onRepeat(b.locationId)}>
                      <Repeat aria-hidden="true" />Repeat
                    </button>
                  )}
                  {editor?.canPublish(b.locationId) && (
                    <button type="button" className="btn btn-primary ros-publish" onClick={() => editor.onPublish(b.locationId)}>
                      <Send aria-hidden="true" />{editor.publishLabel(b.locationId)}
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
    </>
  )
}
