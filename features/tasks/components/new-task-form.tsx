"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { z } from "zod"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { DatePicker } from "@/components/date-picker"
import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { Textarea } from "@/components/ui/textarea"
import { TimePicker } from "@/components/time-picker"
import { Input } from "@/components/ui/input"
import { VoiceRecorder, type VoiceDraft } from "@/components/voice-note"
import { NO_EVIDENCE, normaliseRule, ruleError } from "@/lib/task-evidence"
import { taskVoice, type VoiceNote } from "@/lib/task-voice"
import { materialiseRecurring, repeatError } from "../recurrence"
import { tasksStore, templatesStore } from "../store"
import { applyTemplate, describeOffset, nextTemplateId, templateFromForm } from "../templates"
import type { EvidenceRule, Person, Project, Task, TaskTemplate } from "../types"
import { EvidenceRuleField } from "./evidence-rule-field"
import { PeopleChips } from "./schedule-dialogs"
import { NO_REPEAT, RepeatField, draftToRule, type RepeatDraft } from "./repeat-field"

// FR-TASK-01 fields. Dates are ISO local wall-clock strings, like the rest of the mock data.
const schema = z
  .object({
    title: z.string().trim().min(3, "Enter a title of at least 3 characters").max(120, "Keep the title under 120 characters"),
    description: z.string().trim().min(1, "Describe what needs doing"),
    dept: z.string().min(1, "Choose a department"),
    assignee: z.string().min(1, "Choose an assignee"),
    priority: z.enum(["1", "2", "3"]),
    start: z.string().min(1, "Choose a start date"),
    dueDate: z.string().min(1, "Choose a due date"),
    dueTime: z.string().min(1, "Choose a due time"),
    client: z.string().trim().max(80),
    evidenceRule: z.custom<EvidenceRule>().superRefine((r, ctx) => { const e = ruleError(r); if (e) ctx.addIssue({ code: "custom", message: e }) }),
    estimate: z.string().refine((v) => v === "" || (/^\d+$/.test(v) && Number(v) > 0 && Number(v) <= 10000), "Enter minutes, e.g. 90"),
    project: z.string(),
    milestone: z.string(),
    tags: z.string(),
  })
  .refine((v) => !v.start || !v.dueDate || v.dueDate >= v.start, { path: ["dueDate"], message: "Due date can't be before the start date" })

type Form = z.input<typeof schema>
type Errors = Partial<Record<keyof Form, string>>

export function nextRef(tasks: Task[], floor = 0): string {
  const max = tasks.reduce((m, t) => Math.max(m, parseInt(t.ref.replace(/\D/g, ""), 10) || 0), floor)
  return `TSK-${max + 1}`
}

// The New task form (FR-TASK-01), on its own page at /tasks/new (a long form: it would scroll as a dialog).
export function NewTaskForm({
  people,
  departments,
  defaultDept,
  defaultAssignee,
  creator,
  today,
  refFloor,
  onCreated,
  templates,
  canManageTemplates = false,
  scopeKey = "",
  projects = [],
  cancelHref,
}: {
  people: Person[]
  departments: string[]
  defaultDept: string
  defaultAssignee?: string
  creator: { id: string; name: string }
  today: string
  refFloor: number
  /** Runs after the task is stored, with its new ref (the page navigates back, or to the new task). */
  onCreated(ref: string): void
  /** Seed for the "Use template" picker (FR-TASK-10). Without it the picker is hidden. */
  templates?: TaskTemplate[]
  /** Managers and admins can save the form as a template and delete templates. */
  canManageTemplates?: boolean
  scopeKey?: string
  /** Projects with milestones (FR-M1-04) for the project picker. */
  projects?: Project[]
  /** Cancel goes back here. */
  cancelHref: string
}) {
  const [tpls, setTpls] = templatesStore.useStore(templates ?? [], scopeKey)
  const [tplId, setTplId] = useState("")
  const [saving, setSaving] = useState(false)
  const [tplName, setTplName] = useState("")
  const [tplError, setTplError] = useState("")
  const [deleting, setDeleting] = useState(false)
  const [repeat, setRepeat] = useState<RepeatDraft>(NO_REPEAT)
  const [repeatErr, setRepeatErr] = useState("")
  const [others, setOthers] = useState<string[]>([])
  // Voice instructions (lib/task-voice.ts). Not part of `form`, so templates never copy it.
  const [voice, setVoice] = useState<VoiceDraft | null>(null)
  // Set once the task is stored: the page is navigating away, so a second click must not create a duplicate.
  const [done, setDone] = useState(false)
  const picked = tpls.find((t) => t.id === tplId)
  const blank = (): Form => ({
    title: "", description: "", dept: defaultDept, assignee: defaultAssignee ?? "", priority: "2",
    start: today.slice(0, 10), dueDate: "", dueTime: "", client: "", evidenceRule: { ...NO_EVIDENCE }, tags: "", estimate: "", project: "", milestone: "",
  })
  const [form, setForm] = useState<Form>(blank)
  const [errors, setErrors] = useState<Errors>({})
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (done) return
    const parsed = schema.safeParse(form)
    if (!parsed.success) {
      const next: Errors = {}
      for (const i of parsed.error.issues) {
        const k = i.path[0] as keyof Form
        if (!next[k]) next[k] = i.message
      }
      setErrors(next)
      return
    }
    const rule = draftToRule(repeat)
    const rErr = rule ? repeatError(rule, parsed.data.dueDate) : ""
    if (rErr) {
      setRepeatErr(rErr)
      return
    }
    const v = parsed.data
    const state = { ref: "" }
    const at = `${today.slice(0, 10)}T${today.slice(11, 16)}:00`
    // Mock: the blob: URL stays in this tab's tasksStore only and is gone on reload (no upload until the backend exists).
    const voiceNote: VoiceNote | undefined = voice ? { ...voice, recordedBy: creator.name, recordedAt: at } : undefined
    const evidenceRule = normaliseRule(v.evidenceRule)
    const assignees = [v.assignee, ...others.filter((o) => o !== v.assignee)]
    tasksStore.set((prev) => {
      state.ref = nextRef(prev, refFloor)
      const task: Task = {
        ref: state.ref,
        title: v.title.trim(),
        description: v.description.trim(),
        dept: v.dept,
        assignee: v.assignee,
        creator: creator.id,
        priority: Number(v.priority) as 1 | 2 | 3,
        start: `${v.start}T09:00:00`,
        due: `${v.dueDate}T${v.dueTime}:00`,
        status: "not_started",
        evidenceRule,
        ...(others.some((o) => o !== v.assignee) ? { assignees: others.filter((o) => o !== v.assignee) } : {}),
        ...(v.estimate ? { estimate: Number(v.estimate) } : {}),
        ...(v.project ? { projectId: v.project } : {}),
        ...(v.project && v.milestone ? { milestoneId: v.milestone } : {}),
        ...(v.client.trim() ? { client: v.client.trim() } : {}),
        tags: v.tags.split(",").map((s) => s.trim()).filter(Boolean),
        ...(rule ? { repeat: rule } : {}),
        notes: [],
        evidence: [],
        ...(voiceNote ? { voiceNote } : {}),
        timeline: [
          { at, by: creator.name, text: `Created by ${creator.name}` },
          ...(voiceNote ? [{ at, by: creator.name, text: "Voice instructions added" }] : []),
        ],
      }
      return materialiseRecurring([task, ...prev], today, refFloor)
    })
    // The Today card can't read this store (features don't import each other): hand the voiced task over (lib/task-voice.ts).
    if (voiceNote) {
      const due = `${v.dueDate}T${v.dueTime}:00`
      const project = v.client.trim() || v.dept
      const line = { ref: state.ref, title: v.title.trim(), priority: Number(v.priority) as 1 | 2 | 3, due, status: "not_started", evidenceRequired: evidenceRule.mode === "required", project }
      taskVoice.put({ tenantId: scopeKey.split(":")[0] ?? "", ref: state.ref, assignees, task: line, note: voiceNote })
    }
    toast.success(`Task ${state.ref} created`)
    setDone(true)
    onCreated(state.ref)
  }

  function useTemplate(id: string) {
    setTplId(id)
    const t = tpls.find((x) => x.id === id)
    if (!t) return
    const fill = applyTemplate(t, form.start || today.slice(0, 10))
    if (!departments.includes(t.dept)) delete fill.dept
    if (!t.assignee || !people.some((p) => p.id === t.assignee)) delete fill.assignee
    setForm((f) => ({ ...f, ...(fill as Partial<Form>) }))
    setErrors({})
  }

  function saveTemplate() {
    if (!tplName.trim()) return setTplError("Name the template")
    if (form.title.trim().length < 3) return setTplError("Enter a title first")
    const made = templateFromForm(tplName, form, nextTemplateId(tpls))
    setTpls((prev) => [...prev, made])
    setTplId(made.id)
    setSaving(false)
    setTplName("")
    setTplError("")
    toast.success(`Template "${made.name}" saved`)
  }

  const pickedProject = projects.find((p) => p.id === form.project)
  const err = (k: keyof Form) => errors[k]
  const clear = (k: keyof Form) => errors[k] && setErrors((e) => ({ ...e, [k]: undefined }))

  return (
    <>
      <form className="od-form nt-form" onSubmit={submit} noValidate>
        <div className="od-form-cols">
          <div className="od-form-col">
            {(tpls.length > 0 || canManageTemplates) && (
              <div className="tpl-bar">
                {tpls.length > 0 && (
                  <div className="tpl-row">
                    <Field label="Use template" htmlFor="nt-tpl">
                      <FilterSelect
                        label="Use template"
                        value={tplId}
                        options={[{ value: "", label: "Start from scratch" }, ...tpls.map((t) => ({ value: t.id, label: t.name }))]}
                        onChange={useTemplate}
                      />
                    </Field>
                    {picked && canManageTemplates && <button type="button" className="tpl-link bad" onClick={() => setDeleting(true)}>Delete template</button>}
                  </div>
                )}
                {picked && <p className="tpl-note">Due {describeOffset(picked)} after the start date. You can still change everything below.</p>}
                {canManageTemplates && !saving && <button type="button" className="tpl-link" style={{ alignSelf: "flex-start" }} onClick={() => setSaving(true)}>Save this form as a template</button>}
                {canManageTemplates && saving && (
                  <div className="tpl-row">
                    <Field label="Template name" htmlFor="nt-tplname" error={tplError || undefined}>
                      <Input id="nt-tplname" value={tplName} onChange={(e) => { setTplName(e.target.value); setTplError("") }} />
                    </Field>
                    <button type="button" className="btn btn-primary" onClick={saveTemplate}>Save template</button>
                    <button type="button" className="tpl-link" onClick={() => { setSaving(false); setTplError("") }}>Cancel</button>
                  </div>
                )}
              </div>
            )}
            <Field label="Title" htmlFor="nt-title" error={err("title")} required>
              <Input id="nt-title" value={form.title} onChange={(e) => { set("title", e.target.value); clear("title") }} />
            </Field>
            <Field label="Description" htmlFor="nt-desc" error={err("description")} required>
              <Textarea id="nt-desc" value={form.description} onChange={(e) => { set("description", e.target.value); clear("description") }} />
            </Field>
            <div className="od-row2">
              <Field label="Department" htmlFor="nt-dept" error={err("dept")} required>
                <FilterSelect label="Department" value={form.dept} options={departments.map((d) => ({ value: d, label: d }))} onChange={(v) => { set("dept", v); clear("dept") }} />
              </Field>
              <Field label="Assignee" htmlFor="nt-assignee" error={err("assignee")} required>
                <FilterSelect
                  label="Assignee"
                  value={form.assignee}
                  options={[{ value: "", label: "Choose…" }, ...people.map((p) => ({ value: p.id, label: p.name }))]}
                  onChange={(v) => { set("assignee", v); clear("assignee") }}
                />
              </Field>
            </div>
            <div className="od-row2">
              <Field label="Priority" htmlFor="nt-prio">
                <FilterSelect
                  label="Priority"
                  value={form.priority}
                  options={[{ value: "1", label: "Low" }, { value: "2", label: "Medium" }, { value: "3", label: "High" }]}
                  onChange={(v) => set("priority", v as Form["priority"])}
                />
              </Field>
              <Field label="Client (optional)" htmlFor="nt-client">
                <Input id="nt-client" value={form.client} onChange={(e) => set("client", e.target.value)} />
              </Field>
            </div>
            <div className="od-row3">
              <Field label="Start date" htmlFor="nt-start" error={err("start")} required>
                <DatePicker label="Start date" value={form.start} today={today} placeholder="Pick a start date" onChange={(v) => { set("start", v); clear("start") }} />
              </Field>
              <Field label="Due date" htmlFor="nt-due" error={err("dueDate")} required>
                <DatePicker label="Due date" value={form.dueDate} today={today} min={form.start} placeholder="Pick a due date" onChange={(v) => { set("dueDate", v); clear("dueDate") }} />
              </Field>
              <Field label="Due time" htmlFor="nt-time" error={err("dueTime")} required>
                <TimePicker label="Due time" value={form.dueTime} onChange={(v) => { set("dueTime", v); clear("dueTime") }} />
              </Field>
            </div>
          </div>
          <div className="od-form-col">
            <RepeatField id="nt-rp" value={repeat} onChange={(v) => { setRepeat(v); setRepeatErr("") }} today={today} min={form.dueDate || form.start} error={repeatErr} />
            <Field label="Labels" htmlFor="nt-tags" hint="Separate with commas">
              <Input id="nt-tags" value={form.tags} onChange={(e) => set("tags", e.target.value)} />
            </Field>
            <Field label="Also assigned (optional)" htmlFor="nt-others" hint="Several people can work on one task">
              <PeopleChips people={people.filter((p) => p.id !== form.assignee)} value={others.filter((o) => o !== form.assignee)} onChange={setOthers} label="Also assigned" />
            </Field>
            <div className="od-row2">
              <Field label="Estimate in minutes (optional)" htmlFor="nt-est" error={err("estimate")}>
                <Input id="nt-est" inputMode="numeric" value={form.estimate} onChange={(e) => { set("estimate", e.target.value); clear("estimate") }} />
              </Field>
              {projects.length > 0 && (
                <Field label="Project (optional)" htmlFor="nt-project">
                  <FilterSelect label="Project" value={form.project} options={[{ value: "", label: "No project" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} onChange={(v) => { set("project", v); set("milestone", "") }} />
                </Field>
              )}
            </div>
            {pickedProject && pickedProject.milestones.length > 0 && (
              <Field label="Milestone (optional)" htmlFor="nt-ms">
                <FilterSelect label="Milestone" value={form.milestone} options={[{ value: "", label: "No milestone" }, ...pickedProject.milestones.map((m) => ({ value: m.id, label: `${m.name} · ${m.due}` }))]} onChange={(v) => set("milestone", v)} />
              </Field>
            )}
            <EvidenceRuleField id="nt-ev" value={form.evidenceRule} onChange={(r) => { set("evidenceRule", r); clear("evidenceRule") }} people={people} error={err("evidenceRule")} />
            <fieldset className="er-field vn-field" aria-describedby="nt-voice-msg">
              <legend className="er-legend">Voice instructions (optional)</legend>
              <VoiceRecorder id="nt-voice" value={voice} onChange={setVoice} />
              <p id="nt-voice-msg" className="tpl-note">Up to 2 minutes. The assignee can play it on the task.</p>
            </fieldset>
          </div>
        </div>
        <div className="od-form-foot">
          <Link href={cancelHref} className="btn btn-outline">Cancel</Link>
          <button type="submit" className="btn btn-primary" disabled={done}>Create task</button>
        </div>
      </form>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete template?"
        text={`"${picked?.name ?? ""}" will be removed for everyone. Tasks already made from it are not changed.`}
        confirmLabel="Delete template"
        destructive
        onConfirm={() => {
          setTpls((prev) => prev.filter((t) => t.id !== tplId))
          setTplId("")
          setDeleting(false)
          toast.success("Template deleted")
        }}
      />
    </>
  )
}
