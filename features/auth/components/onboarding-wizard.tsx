"use client"

import { useState, useTransition } from "react"
import { Building2, CalendarClock, ClipboardList, UserPlus } from "lucide-react"
import { toast } from "sonner"

import { signIn } from "@/app/actions/session"
import { useSlideDir } from "@/components/data-pagination"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { FormSection, OptionalTag } from "@/components/form-section"
import { TimePicker } from "@/components/time-picker"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { emailSchema } from "../schemas"
import type { OnboardingDefaults, RoleOption } from "../types"
import { Stepper } from "./stepper"

const STEPS = ["Departments", "Timezone and deadline", "Report template", "Invite users"]

type Invite = { id: number; email: string; role: string; dept: string }

// FR-SAAS-04: first-run checklist. Every step can be revisited; Finish signs in as the owner.
export function OnboardingWizard({ defaults, roles }: { defaults: OnboardingDefaults; roles: RoleOption[] }) {
  const [step, setStep] = useState(0)
  // Next step slides in from the right, going back from the left.
  const dir = useSlideDir(step)
  const [reached, setReached] = useState(0)
  const [depts, setDepts] = useState(() => defaults.departments.map((name, id) => ({ id, name })))
  const [nextId, setNextId] = useState(defaults.departments.length)
  const [removing, setRemoving] = useState<number | null>(null)
  const [timezone, setTimezone] = useState(defaults.countries[0].timezone)
  const [deadline, setDeadline] = useState(defaults.deadline)
  const [off, setOff] = useState<Set<string>>(new Set()) // "section|department" pairs switched off
  const inviteRoles = roles.filter((r) => defaults.inviteRoles.includes(r.id))
  const [invites, setInvites] = useState<Invite[]>([{ id: 0, email: "", role: inviteRoles[0]?.id ?? "", dept: "" }])
  const [inviteId, setInviteId] = useState(1)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pending, start] = useTransition()

  const names = depts.map((d) => d.name.trim())

  const go = (i: number) => {
    setErrors({})
    setStep(i)
    setReached((r) => Math.max(r, i))
  }

  function deptErrors() {
    const next: Record<string, string> = {}
    if (names.length === 0) next.form = "Add at least one department"
    names.forEach((n, i) => {
      if (!n) next[`d${depts[i].id}`] = "Enter a department name"
      else if (names.indexOf(n) !== i) next[`d${depts[i].id}`] = "That name is already used. Choose a different one"
    })
    return next
  }
  function nextFromDepts() {
    const next = deptErrors()
    if (Object.keys(next).length) return setErrors(next)
    go(1)
  }
  // Stepper jumps forward only past valid departments and a set deadline.
  const jump = (i: number) => {
    if (i > step && step === 0) {
      const next = deptErrors()
      if (Object.keys(next).length) return setErrors(next)
    }
    if (i > step && step <= 1 && !deadline) return go(1)
    go(i)
  }

  function nextFromInvites() {
    const next: Record<string, string> = {}
    for (const inv of invites) if (inv.email.trim() && !emailSchema.safeParse(inv.email).success) next[`i${inv.id}`] = "Enter a valid email like name@company.com"
    if (Object.keys(next).length) return setErrors(next)
    finish()
  }

  function finish() {
    const sent = invites.filter((i) => i.email.trim()).length
    toast.success(sent ? `Workspace ready. ${sent} invite${sent === 1 ? "" : "s"} sent` : "Workspace ready")
    start(() => signIn("owner"))
  }

  // Keyed by department id so renaming a department keeps its switches.
  const key = (s: string, d: number) => `${s}|${d}`
  const toggle = (k: string, on: boolean) =>
    setOff((o) => {
      const n = new Set(o)
      if (on) n.delete(k)
      else n.add(k)
      return n
    })

  const removingName = depts.find((d) => d.id === removing)?.name.trim() || "this department"

  return (
    <div className="auth-form">
      <header className="auth-head">
        <h1>Set up your workspace</h1>
        <p>Four quick steps. You can change all of this later in Settings.</p>
      </header>
      <Stepper steps={STEPS} current={step} reached={reached} onGo={jump} label="Onboarding progress" />

      {step === 0 && (
        <div className="auth-form od-slide" data-slide={dir}>
          <FormSection icon={Building2} title="Departments">
            {errors.form && <p className="od-field-err" role="alert">{errors.form}</p>}
            <ul className="auth-list">
              {depts.map((d) => (
                <li key={d.id}>
                  <Field label={`Department ${depts.indexOf(d) + 1}`} htmlFor={`ob-d${d.id}`} error={errors[`d${d.id}`]}>
                    <Input id={`ob-d${d.id}`} value={d.name} onChange={(e) => { setDepts(depts.map((x) => (x.id === d.id ? { ...x, name: e.target.value } : x))); setErrors({}) }} />
                  </Field>
                  <button type="button" className="btn btn-outline auth-rm" onClick={() => setRemoving(d.id)} aria-label={`Remove ${d.name.trim() || "department"}`}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className="btn btn-outline auth-add" onClick={() => { setDepts([...depts, { id: nextId, name: "" }]); setNextId(nextId + 1) }}>
              Add department
            </button>
          </FormSection>
          <div className="auth-actions">
            <button type="button" className="btn btn-primary" onClick={nextFromDepts}>Continue</button>
          </div>
          <ConfirmDialog
            open={removing !== null}
            onOpenChange={(o) => !o && setRemoving(null)}
            title={`Remove ${removingName}?`}
            text="Its report template settings are removed with it. You can add it again later."
            confirmLabel="Remove"
            destructive
            onConfirm={() => { setDepts(depts.filter((d) => d.id !== removing)); setRemoving(null); setErrors({}) }}
          />
        </div>
      )}

      {step === 1 && (
        <div className="auth-form od-slide" data-slide={dir}>
          <FormSection icon={CalendarClock} title="Timezone and deadline">
            <div className="od-row2">
              <Field label="Timezone" htmlFor="ob-tz">
                <FilterSelect label="Timezone" value={timezone} options={defaults.timezones.map((t) => ({ value: t.value, label: t.label }))} onChange={setTimezone} />
              </Field>
              <Field label="Report deadline" htmlFor="ob-deadline">
                <TimePicker value={deadline} onChange={setDeadline} label="Daily report deadline" defaultTime={defaults.deadline} />
              </Field>
            </div>
          </FormSection>
          <div className="auth-actions">
            <button type="button" className="btn btn-outline" onClick={() => go(0)}>Back</button>
            <button type="button" className="btn btn-primary" disabled={!deadline} onClick={() => go(2)}>Continue</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="auth-form od-slide" data-slide={dir}>
          <FormSection icon={ClipboardList} title="Report template" note={`${defaults.reportSections.length} sections`}>
            <div className="auth-matrix" role="group" aria-label="Report sections by department" style={{ "--auth-cols": names.length } as React.CSSProperties}>
              <div className="auth-matrix-head" aria-hidden="true">
                <span>Section</span>
                {depts.map((d) => <span key={d.id}>{d.name.trim()}</span>)}
              </div>
              {defaults.reportSections.map((s) => (
                <div key={s} className="auth-matrix-row">
                  <span className="auth-matrix-name">{s}</span>
                  {depts.map((d) => {
                    const id = `ob-t-${s}-${d.id}`.replace(/\W+/g, "-")
                    return (
                      <label key={d.id} className="auth-matrix-cell" htmlFor={id}>
                        <Switch id={id} checked={!off.has(key(s, d.id))} onCheckedChange={(c) => toggle(key(s, d.id), c)} aria-label={`${s} for ${d.name.trim()}`} />
                      </label>
                    )
                  })}
                </div>
              ))}
            </div>
          </FormSection>
          <div className="auth-actions">
            <button type="button" className="btn btn-outline" onClick={() => go(1)}>Back</button>
            <button type="button" className="btn btn-primary" onClick={() => go(3)}>Continue</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="auth-form od-slide" data-slide={dir}>
          <FormSection icon={UserPlus} title="Invite users" action={<OptionalTag />}>
            <ul className="auth-list">
              {invites.map((inv, idx) => (
                <li key={inv.id} className="auth-invite">
                  <Field label={`Email ${idx + 1}`} htmlFor={`ob-i${inv.id}`} error={errors[`i${inv.id}`]}>
                    <Input id={`ob-i${inv.id}`} type="email" value={inv.email} placeholder="name@company.com" onChange={(e) => { setInvites(invites.map((x) => (x.id === inv.id ? { ...x, email: e.target.value } : x))); setErrors({}) }} />
                  </Field>
                  <Field label="Role" htmlFor={`ob-r${inv.id}`}>
                    <FilterSelect label="Role" value={inv.role} options={inviteRoles.map((r) => ({ value: r.id, label: r.label }))} onChange={(v) => setInvites(invites.map((x) => (x.id === inv.id ? { ...x, role: v } : x)))} />
                  </Field>
                  <Field label="Department" htmlFor={`ob-p${inv.id}`}>
                    <FilterSelect label="Department" value={inv.dept} options={[{ value: "", label: "All departments" }, ...names.filter(Boolean).map((n) => ({ value: n, label: n }))]} onChange={(v) => setInvites(invites.map((x) => (x.id === inv.id ? { ...x, dept: v } : x)))} />
                  </Field>
                  <button type="button" className="btn btn-outline auth-rm" disabled={invites.length === 1} onClick={() => setInvites(invites.filter((x) => x.id !== inv.id))} aria-label={`Remove invite ${idx + 1}`}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className="btn btn-outline auth-add" onClick={() => { setInvites([...invites, { id: inviteId, email: "", role: inviteRoles[0]?.id ?? "", dept: "" }]); setInviteId(inviteId + 1) }}>
              Add another
            </button>
          </FormSection>
          <div className="auth-actions">
            <button type="button" className="btn btn-outline" onClick={() => go(2)}>Back</button>
            <button type="button" className="btn btn-primary" disabled={pending} onClick={nextFromInvites}>
              {pending ? "Finishing…" : "Finish setup"}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
