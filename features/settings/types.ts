import type { DeliveryStatus, TenantNotify } from "@/lib/notify"
import type { Access, Module } from "@/lib/types"

export const SETTINGS_TABS = [
  { id: "organisation", label: "Organisation", icon: "gear" },
  { id: "departments", label: "Departments", icon: "roster" },
  { id: "users", label: "Users & invites", icon: "userplus" },
  { id: "roles", label: "Roles", icon: "badge" },
  { id: "template", label: "Report template", icon: "report" },
  { id: "notifications", label: "Notifications", icon: "bell" },
  { id: "integrations", label: "Integrations", icon: "sliders" },
  { id: "devices", label: "Devices", icon: "phone" },
  { id: "branding", label: "Branding", icon: "brand" },
  { id: "billing", label: "Billing", icon: "wallet" },
  { id: "privacy", label: "Data & privacy", icon: "lock" },
] as const

export type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"]
export const isTab = (id: string): id is SettingsTabId => SETTINGS_TABS.some((t) => t.id === id)

type Option = { value: string; label: string }

export type OrganisationData = {
  timezones: Option[]
  weekendRule: string
  weekendRules: Option[]
  sessionTimeouts: Option[]
  sessionTimeout: string
  domain: string
}

export type Department = { id: string; name: string; active: boolean; sites: string[]; teams: string[]; reportOwner: string }

export type UserStatus = "active" | "deactivated"
export type SettingsUser = { id: string; name: string; email: string; role: string; dept: string; status: UserStatus; lastActive: string }
export type Invite = { id: string; email: string; role: string; dept: string; sentAt: string; expiresAt: string }
export type RoleOption = { id: string; label: string }

export type MatrixData = {
  modules: { id: Module; label: string }[]
  roles: { id: string; label: string; access: Record<Module, Access> }[]
}

export type TemplateField = { id: string; label: string; required: boolean }
export type TemplateSection = { id: string; title: string; enabled: boolean; fields: TemplateField[] }
export type TemplateData = { departments: { dept: string; sections: TemplateSection[] }[] }

export type NotificationsData = TenantNotify

/** One row of the delivery log (FR-NOT-05). Channel ids come from the notification settings. */
export type DeliveryRow = { id: string; at: string; event: string; recipient: string; channel: string; status: DeliveryStatus; reason: string | null }

export type IntegrationStatus = "connected" | "not_connected" | "error"
export type Integration = {
  id: string
  name: string
  icon: string
  description: string
  status: IntegrationStatus
  lastEvent: string
  lastEventAt: string | null
  policy: string
}

export type BrandingData = { presets: string[] }
/** Support access rows live in lib/support-access.ts (shared with the platform console). */
export type PrivacyData = { grantHours: number }
