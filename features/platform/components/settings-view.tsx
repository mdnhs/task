"use client"

import { useState } from "react"
import { CreditCard, FileText, Megaphone, SlidersHorizontal } from "lucide-react"
import { toast } from "sonner"

import { DatePicker } from "@/components/date-picker"
import { Field } from "@/components/field"
import { FilterSeg } from "@/components/filter-bar"
import { FormSection } from "@/components/form-section"
import { Icon } from "@/components/icons"
import { PageHead } from "@/components/page-head"
import { PlatformNoticeBanner } from "@/components/platform-notice"
import { StatusPill } from "@/components/status-pill"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { PAGE_HEADS, REASON_MIN } from "../constants"
import { nowIso, sensitiveEntry } from "../logic"
import {
  NOTICE_KINDS, NOTICE_MAX, PAYMENT_STATUS_LABEL, RETENTION_DAYS, SUPPORT_HOURS, TRIAL_DAYS, fromSettings, paymentsLabel, settingsDiff, toSettings, validateSettings,
  type SettingsErrors, type SettingsForm,
} from "../settings"
import { auditOutbox, settingsStore, SCOPE, knownAudit } from "../store"
import type { PlatformSettings } from "../types"
import type { Operator } from "./tenants-view"

const known = knownAudit
const PAY_TONE = { connected: "ok", disconnected: "mute", error: "bad" } as const

type Props = { settings: PlatformSettings; today: string; tzLabel: string; operator: Operator; canWrite: boolean }

// Platform settings (Task 9, D10): a form page (rule 31). Every staff role sees it; without settings.write it is read
// only and has no Save. Saving needs a reason and writes a D7 audit line with the changed fields before and after.
// Mock: the save lives in the console's client store only. Tenant app shells read the seed (platform/settings.json)
// through lib/platform-notice-data.ts, so a saved announcement shows in the preview here, not yet in tenant apps.
export function SettingsView({ settings: server, today, tzLabel, operator, canWrite }: Props) {
  const [settings] = settingsStore.useStore(server, SCOPE)
  const [form, setForm] = useState<SettingsForm>(() => fromSettings(settings))
  const [reason, setReason] = useState("")
  const [errors, setErrors] = useState<SettingsErrors & { reason?: string }>({})
  const now = nowIso(today)
  const draft = toSettings(settings, form)
  const changed = Object.keys(settingsDiff(settings, draft).after).length > 0

  function set<K extends keyof SettingsForm>(k: K, v: SettingsForm[K]) {
    setForm((f) => ({ ...f, [k]: v }))
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e))
  }

  function reset() {
    setForm(fromSettings(settings))
    setReason("")
    setErrors({})
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canWrite) return
    const next = validateSettings(form, now, fromSettings(settings))
    if (!changed) {
      toast("Nothing to save", { description: "Change a setting first." })
      return
    }
    const why = reason.trim()
    const errs: typeof errors = { ...next, ...(why.length < REASON_MIN ? { reason: `Explain why in at least ${REASON_MIN} characters` } : {}) }
    if (Object.keys(errs).length) {
      setErrors(errs)
      return
    }
    const saved = toSettings(settings, form)
    const { before, after } = settingsDiff(settings, saved)
    settingsStore.set(() => saved)
    auditOutbox.set((list) => [
      sensitiveEntry(known(), {
        at: now, actor: operator.name, staffRole: operator.role, action: "settings.changed", target: "Platform settings",
        detail: `Changed ${Object.keys(after).map((k) => FIELD_LABEL[k] ?? k).join(", ")}`, before, after, reason: why,
      }),
      ...list,
    ])
    setForm(fromSettings(saved))
    setReason("")
    setErrors({})
    toast.success("Settings saved", { description: "The change is in the audit log." })
  }

  const { title, subtitle } = PAGE_HEADS.settings
  const preview = form.announce && form.message.trim() ? { kind: form.kind, message: form.message.trim(), endsAt: form.endsAt ? `${form.endsAt}:00` : null } : null
  return (
    <>
      <PageHead title={title} subtitle={subtitle} />
      <form className="card pf-form od-form" onSubmit={submit} noValidate aria-label="Platform settings">
        <fieldset className="pf-fieldset" disabled={!canWrite}>
          <legend className="sr-only">Platform settings{canWrite ? "" : " (read only)"}</legend>
          <div className="od-form-cols">
            <div className="od-form-col">
              <FormSection icon={CreditCard} title="Payments">
                <div className="pf-form-sum">
                  <div className="pf-pay">
                    <span>{paymentsLabel(settings.payments)}</span>
                    <StatusPill status={{ tone: PAY_TONE[settings.payments.status], label: PAYMENT_STATUS_LABEL[settings.payments.status] }} />
                  </div>
                  <p className="pf-pay-note">Managed in the provider&apos;s dashboard.</p>
                </div>
              </FormSection>
              <FormSection icon={SlidersHorizontal} title="Defaults">
                <Field label="Trial length (days)" htmlFor="pf-set-trial" error={errors.defaultTrialDays} hint={`${TRIAL_DAYS.min}–${TRIAL_DAYS.max} · for new plans`} required>
                  <Input id="pf-set-trial" inputMode="numeric" value={form.defaultTrialDays} onChange={(e) => set("defaultTrialDays", e.target.value)} />
                </Field>
                <div className="od-row2">
                  <Field label="Retention (days)" htmlFor="pf-set-ret" error={errors.retentionDays} hint={`${RETENTION_DAYS.min}–${RETENTION_DAYS.max} · closed workspaces`} required>
                    <Input id="pf-set-ret" inputMode="numeric" value={form.retentionDays} onChange={(e) => set("retentionDays", e.target.value)} />
                  </Field>
                  <Field label="Support access (hours)" htmlFor="pf-set-sup" error={errors.supportAccessHours} hint={`${SUPPORT_HOURS.min}–${SUPPORT_HOURS.max} · suggested length`} required>
                    <Input id="pf-set-sup" inputMode="numeric" value={form.supportAccessHours} onChange={(e) => set("supportAccessHours", e.target.value)} />
                  </Field>
                </div>
              </FormSection>
            </div>
            <div className="od-form-col">
              <FormSection icon={Megaphone} title="Announcement">
                <label htmlFor="pf-set-ann" className="pf-mod">
                  <span>Show an announcement in every tenant app</span>
                  <Switch id="pf-set-ann" checked={form.announce} disabled={!canWrite} onCheckedChange={(c) => set("announce", c)} />
                </label>
                {form.announce ? (
                  <>
                    <div className="od-field">
                      <span className="fs-label">Kind</span>
                      <FilterSeg label="Kind" value={form.kind} options={NOTICE_KINDS} onChange={(v) => set("kind", v)} />
                    </div>
                    <Field label="Message" htmlFor="pf-set-msg" error={errors.message} hint={`${form.message.trim().length}/${NOTICE_MAX}`} required>
                      <Textarea id="pf-set-msg" value={form.message} rows={3} maxLength={NOTICE_MAX} placeholder="e.g. Maintenance on Sunday 02:00–03:00" onChange={(e) => set("message", e.target.value)} />
                    </Field>
                    <Field label="Ends" htmlFor="pf-set-end" error={errors.endsAt} hint={`${tzLabel} · empty = until turned off`}>
                      <DatePicker value={form.endsAt} onChange={(v) => set("endsAt", v)} today={today} min={today.slice(0, 10)} withTime label="Ends" placeholder="No end" />
                    </Field>
                    {preview && (
                      <div>
                        <h2 className="pf-sub-h">Preview</h2>
                        <PlatformNoticeBanner notice={preview} today={today} tzLabel={tzLabel} preview />
                      </div>
                    )}
                  </>
                ) : (
                  <p className="pf-notice-off">No announcement is showing.</p>
                )}
              </FormSection>
              {canWrite && changed && (
                <FormSection icon={FileText} title="Reason">
                  <Field label="Why the change" htmlFor="pf-set-reason" error={errors.reason} hint={`At least ${REASON_MIN} characters · audit trail`} required>
                    <Textarea id="pf-set-reason" value={reason} rows={2} maxLength={300} onChange={(e) => { setReason(e.target.value); setErrors((x) => ({ ...x, reason: undefined })) }} />
                  </Field>
                </FormSection>
              )}
            </div>
          </div>
        </fieldset>
        <div className="od-form-foot">
          {canWrite ? (
            <>
              <button type="button" className="btn btn-outline" onClick={reset} disabled={!changed}>Reset</button>
              <button type="submit" className="btn btn-primary">Save settings</button>
            </>
          ) : (
            <p className="pf-readonly"><Icon name="lock" />Read only. Only an owner can change platform settings.</p>
          )}
        </div>
      </form>
    </>
  )
}

const FIELD_LABEL: Record<string, string> = {
  defaultTrialDays: "trial length", retentionDays: "retention", supportAccessHours: "support access length", announcement: "announcement",
}
