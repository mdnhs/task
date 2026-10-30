// Device register and policy (CR-02, CR-06, FR-M0-08..10). Pure: no cookies, no React.
// A device belongs to one user. A policy decides, per feature, which devices may use it.

export type DeviceType = "pc" | "android" | "browser"
export type DeviceOwner = "company" | "personal"
export type DeviceFeature = "drive" | "whatsapp" | "payroll"
export type DeviceAllow = "trusted-company-pc" | "any" | "none"

export type Device = {
  id: string
  userId: string
  type: DeviceType
  owner: DeviceOwner
  label: string
  trusted: boolean
  lastSeen: string | null
}
export type DevicePolicy = { feature: DeviceFeature; allow: DeviceAllow }

export const DEVICE_TYPES: { value: DeviceType; label: string }[] = [
  { value: "pc", label: "Windows or Mac PC" },
  { value: "android", label: "Android phone" },
  { value: "browser", label: "Browser" },
]
export const DEVICE_OWNERS: { value: DeviceOwner; label: string }[] = [
  { value: "company", label: "Company" },
  { value: "personal", label: "Personal" },
]
export const DEVICE_FEATURES: { value: DeviceFeature; label: string }[] = [
  { value: "drive", label: "Google Drive" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "payroll", label: "Payroll" },
]
export const DEVICE_ALLOWS: { value: DeviceAllow; label: string }[] = [
  { value: "trusted-company-pc", label: "Only on trusted company PCs" },
  { value: "any", label: "On any device" },
  { value: "none", label: "Nowhere" },
]

/** The session of a browser that is not in the register. */
export const UNREGISTERED_ID = "unregistered"
export const unregisteredDevice = (): Device => ({
  id: UNREGISTERED_ID,
  userId: "",
  type: "browser",
  owner: "personal",
  label: "Unregistered browser",
  trusted: false,
  lastSeen: null,
})

export const isTrustedCompanyPc = (d: Device) => d.type === "pc" && d.owner === "company" && d.trusted

const DEFAULT_ALLOW: DeviceAllow = "any"

/** What a policy list says for a feature (no policy = open to any device). */
export function allowFor(feature: DeviceFeature, policies: DevicePolicy[]): DeviceAllow {
  return policies.find((p) => p.feature === feature)?.allow ?? DEFAULT_ALLOW
}

/** FR-M0-10: evaluated on the server for each request with the device of that request. */
export function canUse(feature: DeviceFeature, device: Device | null | undefined, policies: DevicePolicy[]): boolean {
  const allow = allowFor(feature, policies)
  if (allow === "any") return true
  if (allow === "none") return false
  return !!device && isTrustedCompanyPc(device)
}

/** The device a cookie id refers to for this user: a register entry of that user, else the unregistered browser. */
export function resolveDevice(id: string | undefined, userId: string, devices: Device[]): Device {
  return devices.find((d) => d.id === id && d.userId === userId) ?? unregisteredDevice()
}

const oneOf = <T extends string>(v: unknown, list: readonly { value: T }[]): v is T => list.some((o) => o.value === v)

/** Validates untrusted input (a cookie) into a device list; anything malformed returns null. */
export function parseDevices(input: unknown): Device[] | null {
  if (!Array.isArray(input) || input.length > 60) return null
  const out: Device[] = []
  const seen = new Set<string>()
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return null
    const d = raw as Record<string, unknown>
    if (typeof d.id !== "string" || !/^[\w-]{1,40}$/.test(d.id) || d.id === UNREGISTERED_ID || seen.has(d.id)) return null
    if (typeof d.userId !== "string" || !/^[\w-]{1,40}$/.test(d.userId)) return null
    if (!oneOf(d.type, DEVICE_TYPES) || !oneOf(d.owner, DEVICE_OWNERS)) return null
    if (typeof d.label !== "string" || d.label.trim().length < 2 || d.label.length > 60) return null
    if (typeof d.trusted !== "boolean") return null
    if (d.lastSeen !== null && typeof d.lastSeen !== "string") return null
    seen.add(d.id)
    out.push({ id: d.id, userId: d.userId, type: d.type, owner: d.owner, label: d.label.trim(), trusted: d.trusted, lastSeen: d.lastSeen })
  }
  return out
}

export function parsePolicies(input: unknown): DevicePolicy[] | null {
  if (!Array.isArray(input) || input.length > DEVICE_FEATURES.length) return null
  const out: DevicePolicy[] = []
  for (const raw of input) {
    const p = raw as Record<string, unknown> | null
    if (!p || !oneOf(p.feature, DEVICE_FEATURES) || !oneOf(p.allow, DEVICE_ALLOWS) || out.some((x) => x.feature === p.feature)) return null
    out.push({ feature: p.feature, allow: p.allow })
  }
  return out
}

/** Policy sentence for the settings card, e.g. "Google Drive: allowed only on trusted company PCs". */
export function describePolicy(p: DevicePolicy): string {
  const name = DEVICE_FEATURES.find((f) => f.value === p.feature)?.label ?? p.feature
  const how = p.allow === "any" ? "allowed on any device" : p.allow === "none" ? "blocked on every device" : "allowed only on trusted company PCs"
  return `${name}: ${how}`
}

/** A Google Drive or Docs link (FR-M1-50): these follow the "drive" device policy. */
export const isDriveUrl = (v: string) => /^https?:\/\/(?:drive|docs)\.google\.com\//i.test(v.trim())

/** What a withheld Drive link shows instead of its URL (the UI renders "Available on your work PC"). */
export const WITHHELD_DRIVE_NAME = "Google Drive link"

/**
 * Server side, before a task payload leaves for an untrusted device (FR-M1-52): Drive evidence and any evidence text that is
 * a Drive URL lose the URL (name and preview url), so the link never reaches the browser. Other evidence is untouched.
 */
export function withholdDriveLinks<T extends { evidence: { kind: string; name: string; url?: string }[] }>(tasks: T[]): T[] {
  return tasks.map((t) => {
    if (!t.evidence.some((e) => e.kind === "drive" || isDriveUrl(e.name) || (e.url && isDriveUrl(e.url)))) return t
    return {
      ...t,
      evidence: t.evidence.map((e) => {
        if (e.kind !== "drive" && !isDriveUrl(e.name) && !(e.url && isDriveUrl(e.url))) return e
        const rest = { ...e, name: WITHHELD_DRIVE_NAME }
        delete rest.url
        return rest
      }),
    }
  })
}
