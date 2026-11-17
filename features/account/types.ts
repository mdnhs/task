export const ACCOUNT_TABS = [
  { id: "profile", label: "Profile", icon: "badge" },
  { id: "security", label: "Security", icon: "lock" },
  { id: "notifications", label: "Notifications", icon: "bell" },
] as const

export type AccountTabId = (typeof ACCOUNT_TABS)[number]["id"]
export const isTab = (id: string): id is AccountTabId => ACCOUNT_TABS.some((t) => t.id === id)

export type ProfileData = { department: string; nameMin: number; nameMax: number }

/** A sign-in session (GET /v1/me/sessions): the device label and last activity. No location (no GeoIP) and never a token. */
export type DeviceSession = { id: string; device: string; kind: "laptop" | "phone"; lastActive: string; current: boolean }
export type ActivityItem = { id: string; text: string; at: string }
export type SecurityData = { mfa: boolean; resetLinkMinutes: number; sessions: DeviceSession[]; activity: ActivityItem[] }

type Option = { value: string; label: string }
export type NotificationPrefsData = {
  channels: { id: string; label: string }[]
  events: { id: string; label: string; hint: string }[]
  prefs: Record<string, Record<string, boolean>>
  leadOptions: Option[]
  lead: string
}
export type NotificationPrefs = Pick<NotificationPrefsData, "prefs" | "lead">
