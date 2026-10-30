"use client"

import { useState } from "react"
import { toast } from "sonner"

import { DatePicker } from "@/components/date-picker"
import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
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
              <section className="pf-form-sum" aria-labelledby="pf-set-pay">
                <h2 id="pf-set-pay" className="pf-sub-h">Payment provider</h2>
                <div className="pf-pay">
                  <span>{paymentsLabel(settings.payments)}</span>
                  <StatusPill status={{ tone: PAY_TONE[settings.payments.status], label: PAYMENT_STATUS_LABEL[settings.payments.status] }} />
                </div>
                <p className="pf-pay-note">Read from the billing provider. Switch mode or reconnect in the provider&apos;s dashboard.</p>
              </section>
              <Field label="Default trial length (days)" htmlFor="pf-set-trial" error={errors.defaultTrialDays} hint={`${TRIAL_DAYS.min} to ${TRIAL_DAYS.max}. New plans start with this trial.`} required>
                <Input id="pf-set-trial" inputMode="numeric" value={form.defaultTrialDays} onChange={(e) => set("defaultTrialDays", e.target.value)} />
              </Field>
              <Field label="Data retention (days)" htmlFor="pf-set-ret" error={errors.retentionDays} hint={`${RETENTION_DAYS.min} to ${RETENTION_DAYS.max}. How long a closed workspace is kept before deletion.`} required>
                <Input id="pf-set-ret" inputMode="numeric" value={form.retentionDays} onChange={(e) => set("retentionDays", e.target.value)} />
              </Field>
              <Field label="Default support access (hours)" htmlFor="pf-set-sup" error={errors.supportAccessHours} hint={`${SUPPORT_HOURS.min} to ${SUPPORT_HOURS.max}. Suggested length when a tenant grants support access.`} required>
                <Input id="pf-set-sup" inputMode="numeric" value={form.supportAccessHours} onChange={(e) => set("supportAccessHours", e.target.value)} />
              </Field>
            </div>
            <div className="od-form-col">
              <label htmlFor="pf-set-ann" className="pf-mod">
                <span>Show an announcement in every tenant app</span>
                <Switch id="pf-set-ann" checked={form.announce} disabled={!canWrite} onCheckedChange={(c) => set("announce", c)} />
              </label>
              {form.announce ? (
                <>
                  <Field label="Kind" htmlFor="pf-set-kind">
                    <FilterSelect label="Kind" value={form.kind} options={NOTICE_KINDS} onChange={(v) => set("kind", v)} />
                  </Field>
                  <Field label="Message" htmlFor="pf-set-msg" error={errors.message} hint={`${form.message.trim().length}/${NOTICE_MAX}. Tenants see it above every page.`} required>
                    <Textarea id="pf-set-msg" value={form.message} rows={3} maxLength={NOTICE_MAX} onChange={(e) => set("message", e.target.value)} />
                  </Field>
                  <Field label="Ends (optional)" htmlFor="pf-set-end" error={errors.endsAt} hint={`${tzLabel}. Leave empty to show it until you turn it off.`}>
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
                <p className="pf-notice-off">No announcement is showing. Turn it on to add an information or maintenance notice.</p>
              )}
              {canWrite && changed && (
                <Field label="Reason for the change" htmlFor="pf-set-reason" error={errors.reason} hint={`At least ${REASON_MIN} characters. Saved in the audit trail.`} required>
                  <Textarea id="pf-set-reason" value={reason} rows={2} maxLength={300} onChange={(e) => { setReason(e.target.value); setErrors((x) => ({ ...x, reason: undefined })) }} />
                </Field>
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
