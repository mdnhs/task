import type { BrandAsset } from "@/lib/branding"
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

/** The organisation form's static choices (the timezone list). The tenant's own values come from GET /v1/settings/organisation. */
export type OrganisationData = { timezones: Option[] }
/** GET /v1/settings/organisation, mapped. The slug is shown, never edited. */
export type Organisation = { name: string; slug: string; timezone: string; currency: string; locale: string; reportDeadline: string; reportDueAfterMinutes: number }
/** GET /v1/settings/branding, mapped (the colour as the API stores it, a clean file id or null). */
/** Settings -> Branding: the colour and the live logo and favicon (null = none). `storageReady` false = no file storage is set up yet, so uploads cannot work. */
export type Branding = { primaryColor: string | null; logo: BrandAsset | null; favicon: BrandAsset | null; storageReady: boolean }

/** A department is a team of kind "department" (GET /v1/teams?kind=department): name and member count. Sites, report owners and deactivation have no backend. */
export type Department = { id: string; name: string; members: number }

/**
 * A member of the workspace (GET /v1/people). `id` is the user id and `role` the role KEY. `active` and `lastActiveAt` are the API's (B8 Task 24: deactivate/reactivate routes; last active is
 * the last authenticated request in tenant wall time, null = never seen, and null for everyone unless the caller can read settings). Optional for the screens that list active people only.
 */
export type SettingsUser = { id: string; name: string; email: string; role: string; dept: string; active?: boolean; lastActiveAt?: string | null }
/** A pending invite (GET /v1/invites): no token, ever. Times are the tenant's wall clock. */
export type Invite = { id: string; email: string; role: string; createdAt: string; expiresAt: string; invitedBy: string }
export type RoleOption = { id: string; label: string }

/** One role of the matrix: `id` is the role KEY (what the rest of the app calls Role.id), `uuid` is what the write routes take. */
export type MatrixRole = { id: string; uuid: string; label: string; access: Record<Module, Access>; locked: boolean }
export type MatrixData = {
  modules: { id: Module; label: string }[]
  roles: MatrixRole[]
}

export type TemplateField = { id: string; label: string; required: boolean }
export type TemplateSection = { id: string; title: string; enabled: boolean; fields: TemplateField[] }
export type TemplateData = { departments: { dept: string; sections: TemplateSection[] }[] }

export type NotificationsData = TenantNotify

/** One row of the delivery log (FR-NOT-05). Channel ids come from the notification settings. */
export type DeliveryRow = { id: string; at: string; event: string; recipient: string; channel: string; status: DeliveryStatus; reason: string | null }

export type IntegrationStatus = "connected" | "not_connected" | "error"
/** Google Drive is the only integration the API has (GET /v1/integrations); the others have no backend and are not listed. */
export type Integration = {
  id: string
  name: string
  icon: string
  description: string
  status: IntegrationStatus
  account: string | null
  lastEvent: string
  lastEventAt: string | null
  policy: string
}

export type BrandingData = { presets: string[] }

/** A data request (GET /v1/data-requests): who it is about, what kind, where it is and when it is due (the tenant's wall clock). */
export type DataRequestStatus = "pending" | "running" | "completed" | "failed" | "rejected"
export type DataRequestRow = { id: string; subject: string; subjectId: string; kind: "export" | "erase" | "correct"; status: DataRequestStatus; overdue: boolean; createdAt: string; dueAt: string; completedAt: string | null; resultFileId: string | null }
/** A support access grant on the tenant side (GET /v1/settings/support-grants). */
export type SupportGrant = { id: string; who: string; reason: string; status: "active" | "expired" | "revoked"; startsAt: string; expiresAt: string; revokedAt: string | null }
