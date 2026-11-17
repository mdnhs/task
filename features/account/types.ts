export const ACCOUNT_TABS = [
  { id: "profile", label: "Profile", icon: "badge" },
  { id: "security", label: "Security", icon: "lock" },
  { id: "notifications", label: "Notifications", icon: "bell" },
] as const

export type AccountTabId = (typeof ACCOUNT_TABS)[number]["id"]
export const isTab = (id: string): id is AccountTabId => ACCOUNT_TABS.some((t) => t.id === id)

export type ProfileData = { nameMin: number; nameMax: number }

/** A sign-in session (GET /v1/me/sessions): the device label and last activity. No location (no GeoIP) and never a token. */
export type DeviceSession = { id: string; device: string; kind: "laptop" | "phone"; lastActive: string; current: boolean }
export type ActivityItem = { id: string; text: string; at: string }
export type SecurityData = { mfa: boolean; resetLinkMinutes: number; sessions: DeviceSession[]; activity: ActivityItem[] }

export type PrefChannel = "inApp" | "email" | "push"
export type NotificationPrefsRow = { kind: string; label: string; hint: string; inApp: boolean; email: boolean; push: boolean; locked: boolean }
/** GET /v1/me/notification-preferences, mapped: a row per kind and the quiet window (tenant-local HH:MM) or null. */
export type PrefsView = { rows: NotificationPrefsRow[]; quiet: { start: string; end: string } | null }
/** A device allocated to the signed-in user, for the "This device" row. */
export type OwnDevice = { id: string; label: string }
