"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { z } from "zod"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { DatePicker } from "@/components/date-picker"
import { Field } from "@/components/field"
import { FilterSeg, FilterSelect } from "@/components/filter-bar"
import { FoldToggle, FormFold, FormSection, PeoplePicker } from "@/components/form-section"
import { Textarea } from "@/components/ui/textarea"
import { TimePicker } from "@/components/time-picker"
import { Input } from "@/components/ui/input"
import { VoiceRecorder, type VoiceDraft } from "@/components/voice-note"
import { NO_EVIDENCE, normaliseRule, ruleError } from "@/lib/task-evidence"
import { repeatError } from "../recurrence"
import { applyTemplate, describeOffset, templateFromForm } from "../templates"
import { createCatalog } from "../catalog"
import { createFlow } from "../create-flow"
import { useTaskWrites } from "../use-task-writes"
import type { EvidenceRule, Person, Project, TaskTemplate } from "../types"
import { EvidenceRuleField } from "./evidence-rule-field"
import { NO_REPEAT, RepeatField, draftToRule, type PatternChoice, type RepeatDraft } from "./repeat-field"
import { Icon } from "@/components/icon"

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

const PRIORITIES: { value: Form["priority"]; label: string }[] = [{ value: "1", label: "Low" }, { value: "2", label: "Medium" }, { value: "3", label: "High" }]

type Errors = Partial<Record<keyof Form, string>>

// The New task form (FR-TASK-01), on its own page at /tasks/new (a long form: it would scroll as a dialog).
export function NewTaskForm({
  people,
  departments,
  defaultDept,
  defaultAssignee,
  today,
  onCreated,
  templates,
  canManageTemplates = false,
  projects = [],
  patterns = [],
  cancelHref,
}: {
  people: Person[]
  /** Department teams: the API takes the team's uuid, the form shows the name. */
  departments: { id: string; name: string }[]
  defaultDept: string
  defaultAssignee?: string
  today: string
  /** Shift patterns for "Every shift"; empty when the shifts data is not available. */
  patterns?: PatternChoice[]
  /** Runs after the task is stored, with its new ref (the page navigates back, or to the new task). */
  onCreated(ref: string): void
  /** The API's templates (FR-TASK-10). Without any the picker is hidden. */
  templates?: (TaskTemplate & { version: number; teamId: string | null })[]
  /** Managers and admins can save the form as a template and delete templates. */
  canManageTemplates?: boolean
  /** Projects with milestones (FR-M1-04) for the project picker. */
  projects?: Project[]
  /** Cancel goes back here. */
  cancelHref: string
}) {
  const { act } = useTaskWrites([])
  const tpls = templates ?? []
  const [tplId, setTplId] = useState("")
  const [saving, setSaving] = useState(false)
  const [tplName, setTplName] = useState("")
  const [tplError, setTplError] = useState("")
  const [deleting, setDeleting] = useState(false)
  const [repeat, setRepeat] = useState<RepeatDraft>(NO_REPEAT)
  const [repeatErr, setRepeatErr] = useState("")
  const [others, setOthers] = useState<string[]>([])
  const [showMore, setShowMore] = useState(false)
  // Voice instructions (lib/task-voice.ts). Not part of `form`, so templates never copy it.
  const [voice, setVoice] = useState<VoiceDraft | null>(null)
  // Set once the task is stored: the page is navigating away, so a second click must not create a duplicate.
  const [done, setDone] = useState(false)
  const [creating, setCreating] = useState(false)
  const picked = tpls.find((t) => t.id === tplId)
  const blank = (): Form => ({
    title: "", description: "", dept: defaultDept, assignee: defaultAssignee ?? "", priority: "2",
    start: today.slice(0, 10), dueDate: "", dueTime: "", client: "", evidenceRule: { ...NO_EVIDENCE }, tags: "", estimate: "", project: "", milestone: "",
  })
  const [form, setForm] = useState<Form>(blank)
  const [errors, setErrors] = useState<Errors>({})
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))

  async function submit(e: React.FormEvent) {
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
    const rErr = rule ? (rule.freq === "per_shift" && !rule.patternId ? "Choose a shift" : repeatError(rule, parsed.data.dueDate)) : ""
    if (rErr) {
      setRepeatErr(rErr)
      return
    }
    const v = parsed.data
    const body = {
      title: v.title.trim(), description: v.description.trim(), teamId: departments.find((d) => d.name === v.dept)?.id ?? null, assignee: v.assignee, others,
      priority: Number(v.priority) as 1 | 2 | 3, start: `${v.start}T09:00:00`, due: `${v.dueDate}T${v.dueTime}:00`,
      ...(v.estimate ? { estimate: Number(v.estimate) } : {}), client: v.client, tags: v.tags.split(",").map((s) => s.trim()).filter(Boolean),
      evidenceRule: normaliseRule(v.evidenceRule), ...(v.project ? { projectId: v.project } : {}), ...(v.project && v.milestone ? { milestoneId: v.milestone } : {}),
      ...(tplId ? { templateId: tplId } : {}),
    }
    setCreating(true)
    // Create is ONE call. The repeat (I13) and the voice note are further calls: if one fails the task STAYS (never a second task) and the toast says what is missing.
    const voiceDraft = voice
    const flow = await createFlow({
      create: () => act("task-create", (c) => c.create(body)),
      repeat: rule ? (t) => act("task-repeat", (c) => c.setRepeat(t, rule)) : undefined,
      voice: voiceDraft
        ? async (t) => {
            const blob = await (await fetch(voiceDraft.url)).blob()
            return act("task-voice", (c) => c.setVoice(t, new File([blob], "voice-note", { type: blob.type || voiceDraft.mime }), voiceDraft.durationSec))
          }
        : undefined,
    })
    if (!flow) return setCreating(false)
    setDone(true)
    const task = flow.task
    if (rule && flow.repeat === "failed") {
      const retry = async () => {
        const again = await act("task-repeat-again", (c) => c.setRepeat(task, rule), { success: "Repeat set" })
        if (!again.ok) toast("Repeat not set", { description: "Open the task to set it again." })
      }
      toast("Task created without its repeat", { action: { label: "Set repeat again", onClick: () => void retry() } })
    }
    if (flow.voice === "failed") toast("Task created without its voice note", { description: "Add it on the task page." })
    toast.success(`Task ${task.ref} created`)
    onCreated(task.ref)
  }

  function pickTemplate(id: string) {
    setTplId(id)
    const t = tpls.find((x) => x.id === id)
    if (!t) return
    const fill = applyTemplate(t, form.start || today.slice(0, 10))
    if (!departments.some((d) => d.name === t.dept)) delete fill.dept
    if (!t.assignee || !people.some((p) => p.id === t.assignee)) delete fill.assignee
    setForm((f) => ({ ...f, ...(fill as Partial<Form>) }))
    setErrors({})
  }

  async function saveTemplate() {
    if (!tplName.trim()) return setTplError("Name the template")
    if (form.title.trim().length < 3) return setTplError("Enter a title first")
    const made = templateFromForm(tplName, form, "new")
    const r = await act(
      "template-save",
      () => createCatalog().createTemplate({
        name: made.name, title: made.title, description: made.description, teamId: departments.find((d) => d.name === made.dept)?.id ?? null, assignee: made.assignee ?? null,
        priority: made.priority, tags: made.tags, evidenceRule: made.evidenceRule, dueOffset: made.dueOffset, dueTime: made.dueTime,
      }),
      { success: `Template "${made.name}" saved` },
    )
    if (!r.ok) return
    setSaving(false)
    setTplName("")
    setTplError("")
  }

  const pickedProject = projects.find((p) => p.id === form.project)
  // "More" starts folded; an error inside it opens it so the message is seen.
  const moreOpen = showMore || !!errors.estimate
  const err = (k: keyof Form) => errors[k]
  const clear = (k: keyof Form) => errors[k] && setErrors((e) => ({ ...e, [k]: undefined }))

  return (
    <>
      <form className="od-form nt-form" onSubmit={submit} noValidate>
        <div className="od-form-cols">
          <div className="od-form-col">
            <FormSection
              icon="report"
              title="Task"
              action={canManageTemplates && !saving && (
                <button type="button" className="fs-act" onClick={() => setSaving(true)}>
                  <Icon name="bookmark" size={24} />
                  Save as template
                </button>
              )}
            >
              {tpls.length > 0 && (
                <div className="nt-tpl">
                  <span className="fs-label" id="nt-tpl-l">Templates</span>
                  <div className="er-types" role="group" aria-labelledby="nt-tpl-l">
                    <button type="button" className="rp-day" aria-pressed={tplId === ""} onClick={() => pickTemplate("")}>
                      No template
                    </button>
                    {tpls.map((t) => (
                      <button key={t.id} type="button" className="rp-day nt-tpl-chip" aria-pressed={tplId === t.id} onClick={() => pickTemplate(t.id)}>
                        <Icon name="bookmark" size={24} />
                        {t.name}
                      </button>
                    ))}
                  </div>
                  {picked && (
                    <p className="tpl-note">
                      Due {describeOffset(picked)} after the start date
                      {canManageTemplates && <> · <button type="button" className="tpl-link bad" onClick={() => setDeleting(true)}>Delete</button></>}
                    </p>
                  )}
                </div>
              )}
              {canManageTemplates && saving && (
                <div className="tpl-row">
                  <Field label="Template name" htmlFor="nt-tplname" error={tplError || undefined}>
                    <Input id="nt-tplname" autoFocus value={tplName} onChange={(e) => { setTplName(e.target.value); setTplError("") }} />
                  </Field>
                  <button type="button" className="btn btn-primary" onClick={() => void saveTemplate()}>Save</button>
                  <button type="button" className="tpl-link" onClick={() => { setSaving(false); setTplError("") }}>Cancel</button>
                </div>
              )}
              <Field label="Title" htmlFor="nt-title" error={err("title")} required>
                <Input id="nt-title" value={form.title} onChange={(e) => { set("title", e.target.value); clear("title") }} />
              </Field>
              <Field label="Description" htmlFor="nt-desc" error={err("description")} required>
                <Textarea id="nt-desc" value={form.description} onChange={(e) => { set("description", e.target.value); clear("description") }} />
              </Field>
              <div className="od-field nt-voice">
                <span className="fs-label">Voice instructions <span className="fs-opt">Optional</span></span>
                <VoiceRecorder id="nt-voice" value={voice} onChange={setVoice} hint="Up to 2 min · the assignee plays it on the task" />
              </div>
            </FormSection>
            <FormSection icon="calendar-clock" title="Schedule">
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
              <RepeatField id="nt-rp" value={repeat} onChange={(v) => { setRepeat(v); setRepeatErr("") }} today={today} min={form.dueDate || form.start} error={repeatErr} patterns={patterns} />
            </FormSection>
          </div>
          <div className="od-form-col">
            <FormSection icon="users" title="People">
              <div className="od-row2">
                <Field label="Department" htmlFor="nt-dept" error={err("dept")} required>
                  <FilterSelect label="Department" value={form.dept} options={departments.map((d) => ({ value: d.name, label: d.name }))} onChange={(v) => { set("dept", v); clear("dept") }} />
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
              <Field label="Also assigned" htmlFor="nt-others">
                <PeoplePicker people={people} value={others} onChange={setOthers} label="Also assigned" exclude={[form.assignee]} />
              </Field>
              <div className="od-field nt-prio">
                <span className="fs-label">Priority</span>
                <FilterSeg label="Priority" value={form.priority} options={PRIORITIES} onChange={(v) => set("priority", v)} />
              </div>
            </FormSection>
            <FormSection
              icon="sliders"
              title="More"
              action={<FoldToggle open={moreOpen} onToggle={() => setShowMore((v) => !v)} controls="nt-more" label="Client, labels, estimate" />}
            >
              <FormFold id="nt-more" open={moreOpen}>
                <div className="od-row2">
                  <Field label="Client" htmlFor="nt-client">
                    <Input id="nt-client" value={form.client} onChange={(e) => set("client", e.target.value)} />
                  </Field>
                  <Field label="Estimate (min)" htmlFor="nt-est" error={err("estimate")}>
                    <Input id="nt-est" inputMode="numeric" placeholder="e.g. 90" value={form.estimate} onChange={(e) => { set("estimate", e.target.value); clear("estimate") }} />
                  </Field>
                </div>
                <div className="od-row2">
                  <Field label="Labels" htmlFor="nt-tags">
                    <Input id="nt-tags" placeholder="e.g. lobby, urgent" value={form.tags} onChange={(e) => set("tags", e.target.value)} />
                  </Field>
                  {projects.length > 0 && (
                    <Field label="Project" htmlFor="nt-project">
                      <FilterSelect label="Project" value={form.project} options={[{ value: "", label: "No project" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} onChange={(v) => { set("project", v); set("milestone", "") }} />
                    </Field>
                  )}
                </div>
                {pickedProject && pickedProject.milestones.length > 0 && (
                  <Field label="Milestone" htmlFor="nt-ms">
                    <FilterSelect label="Milestone" value={form.milestone} options={[{ value: "", label: "No milestone" }, ...pickedProject.milestones.map((m) => ({ value: m.id, label: `${m.name} · ${m.due}` }))]} onChange={(v) => set("milestone", v)} />
                  </Field>
                )}
              </FormFold>
            </FormSection>
            <FormSection icon="shield" title="Proof of completion" className="nt-ev">
              <EvidenceRuleField id="nt-ev" value={form.evidenceRule} onChange={(r) => { set("evidenceRule", r); clear("evidenceRule") }} people={people} error={err("evidenceRule")} />
            </FormSection>
          </div>
        </div>
        <div className="od-form-foot">
          <Link href={cancelHref} className="btn btn-outline">Cancel</Link>
          <button type="submit" className="btn btn-primary" disabled={done || creating}>Create task</button>
        </div>
      </form>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete template?"
        text={`"${picked?.name ?? ""}" will be removed for everyone. Tasks already made from it are not changed.`}
        confirmLabel="Delete template"
        destructive
        onConfirm={async () => {
          const id = tplId
          setDeleting(false)
          const r = await act(`template-del:${id}`, () => createCatalog().deleteTemplate(id), { success: "Template deleted" })
          if (r.ok) setTplId("")
        }}
      />
    </>
  )
}
