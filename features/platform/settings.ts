import { isoSeconds } from "@/lib/support-access"
import type { PlatformAnnouncement, PlatformSettings } from "./types"

// Platform settings (Task 9, /platform/settings, D10). Every staff role views them; saving needs settings.write and a
// reason (D7: the audit line records the changed fields before and after). Payments are the billing provider's and read-only.

export const TRIAL_DAYS = { min: 1, max: 90 }
export const RETENTION_DAYS = { min: 30, max: 3650 }
export const SUPPORT_HOURS = { min: 1, max: 72 }
export const NOTICE_MAX = 200

export const NOTICE_KINDS: { value: PlatformAnnouncement["kind"]; label: string }[] = [
  { value: "info", label: "Information" },
  { value: "maintenance", label: "Maintenance" },
]

export const paymentsLabel = (p: PlatformSettings["payments"]) => `${p.provider} · ${p.mode === "live" ? "Live" : "Test mode"}`
export const PAYMENT_STATUS_LABEL: Record<PlatformSettings["payments"]["status"], string> = { connected: "Connected", disconnected: "Not connected", error: "Error" }

/** The form's text state. `endsAt` is "" or YYYY-MM-DDTHH:mm (the date picker's value). */
export type SettingsForm = {
  defaultTrialDays: string
  retentionDays: string
  supportAccessHours: string
  announce: boolean
  kind: PlatformAnnouncement["kind"]
  message: string
  endsAt: string
}
export type SettingsErrors = Partial<Record<keyof SettingsForm, string>>

export function fromSettings(s: PlatformSettings): SettingsForm {
  const a = s.announcement
  return {
    defaultTrialDays: String(s.defaultTrialDays),
    retentionDays: String(s.retentionDays),
    supportAccessHours: String(s.supportAccessHours),
    announce: !!a,
    kind: a?.kind ?? "info",
    message: a?.message ?? "",
    endsAt: a?.endsAt ? a.endsAt.slice(0, 16) : "",
  }
}

function whole(v: string, r: { min: number; max: number }, unit: string): string | undefined {
  const t = v.trim()
  if (!/^\d+$/.test(t)) return "Enter a whole number"
  const n = Number(t)
  return n < r.min || n > r.max ? `Enter ${r.min} to ${r.max} ${unit}` : undefined
}

/** Field errors (empty when valid). `now`: the platform clock (org.today), which an announcement's end must be after. */
/** `saved`: the form as last saved. The end time is only checked when the announcement changed, so an announcement
 *  that ended on its own doesn't block an unrelated edit (trial days, retention). */
export function validateSettings(f: SettingsForm, now: string, saved?: SettingsForm): SettingsErrors {
  const e: SettingsErrors = {
    defaultTrialDays: whole(f.defaultTrialDays, TRIAL_DAYS, "days"),
    retentionDays: whole(f.retentionDays, RETENTION_DAYS, "days"),
    supportAccessHours: whole(f.supportAccessHours, SUPPORT_HOURS, "hours"),
  }
  if (f.announce) {
    const m = f.message.trim()
    if (!m) e.message = "Write the message tenants will see"
    else if (m.length > NOTICE_MAX) e.message = `Keep the message under ${NOTICE_MAX} characters`
    const touched = !saved || !saved.announce || saved.kind !== f.kind || saved.message !== f.message || saved.endsAt !== f.endsAt
    if (touched && f.endsAt && isoSeconds(f.endsAt) <= isoSeconds(now)) e.endsAt = "Pick an end after now"
  }
  for (const k of Object.keys(e) as (keyof SettingsErrors)[]) if (!e[k]) delete e[k]
  return e
}

/** The settings a valid form saves. Payments stay as they are (the provider owns them). */
export function toSettings(s: PlatformSettings, f: SettingsForm): PlatformSettings {
  return {
    ...s,
    defaultTrialDays: Number(f.defaultTrialDays.trim()),
    retentionDays: Number(f.retentionDays.trim()),
    supportAccessHours: Number(f.supportAccessHours.trim()),
    announcement: f.announce ? { kind: f.kind, message: f.message.trim(), endsAt: f.endsAt ? `${f.endsAt.slice(0, 16)}:00` : null } : null,
  }
}

const KEYS = ["defaultTrialDays", "retentionDays", "supportAccessHours", "announcement"] as const

/** The changed fields only, for the audit line (D7). Both empty = nothing to save. */
export function settingsDiff(a: PlatformSettings, b: PlatformSettings): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const before: Record<string, unknown> = {}
  const after: Record<string, unknown> = {}
  for (const k of KEYS) {
    if (JSON.stringify(a[k]) === JSON.stringify(b[k])) continue
    before[k] = a[k]
    after[k] = b[k]
  }
  return { before, after }
}
