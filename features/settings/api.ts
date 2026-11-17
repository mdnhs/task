// Server side of settings (B6 T6.5): every tab reads the API as the signed-in member. A tab the member may not read (403) or whose module is not in the plan is simply
// left out by the page (permission-hidden); any other failure is the page's error state. Pure loaders take the client, so they are testable.
import type { ApiClient } from "@/lib/api/client"
import { gateOf } from "@/lib/api/problem"
import { apiServer } from "@/lib/api/server"
import { getData } from "@/lib/data"
import { getPeople } from "@/lib/people"
import { toDataRequest, toDepartments, toDevice, toGrant, toIntegration, toInvites, toOrganisation, toRoles, toUsers } from "./adapters"
import { MATRIX_MODULE_LABELS } from "./constants"
import type { BrandingData, DataRequestRow, DeliveryRow, Department, Integration, Invite, MatrixData, NotificationsData, Organisation, OrganisationData, SettingsUser, SupportGrant, TemplateData } from "./types"
import type { Device, DevicePolicy } from "@/lib/devices"
import type { MfaPolicy } from "@/lib/mfa"

type Reader = Pick<ApiClient, "get">

/** The tab's data, or null when this member may not read it (403) or the plan lacks it. Anything else (5xx, network, a malformed answer) is thrown to the page's error state. */
export async function readable<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load()
  } catch (e) {
    if (gateOf(e) !== null) return null
    throw e
  }
}

// ---- static display choices (structure, not tenant data) ----
export const getOrganisationOptions = () => getData<OrganisationData>("settings/organisation.json")
export const getBrandingPresets = () => getData<BrandingData>("settings/branding.json")

// ---- the API ----
export const loadOrganisation = async (api: Reader): Promise<Organisation> => toOrganisation(await api.get("/v1/settings/organisation"))
export const loadBranding = async (api: Reader) => {
  const b = await api.get("/v1/settings/branding")
  return { primaryColor: b.primaryColor, logoFileId: b.logoFileId }
}
export const loadDepartments = async (api: Reader): Promise<Department[]> => toDepartments(await api.get("/v1/teams", { query: { kind: "department" } }))
export const loadRoles = async (api: Reader) => toRoles(await api.get("/v1/roles"))
export async function loadMatrix(api: Reader): Promise<MatrixData> {
  return { modules: MATRIX_MODULE_LABELS, roles: await loadRoles(api) }
}
export async function loadUsers(api: Reader): Promise<SettingsUser[]> {
  const [people, depts] = await Promise.all([api.get("/v1/people"), api.get("/v1/teams", { query: { kind: "department" } })])
  const dept = new Map<string, string>()
  for (const t of depts) for (const id of t.memberIds) if (!dept.has(id)) dept.set(id, t.name)
  return toUsers(people, (id) => dept.get(id) ?? "")
}
export const loadInvites = async (api: Reader, tz: string): Promise<Invite[]> => toInvites(await api.get("/v1/invites"), tz)
export const loadDevices = async (api: Reader, tz: string): Promise<Device[]> => (await api.get("/v1/devices")).map((d) => toDevice(d, tz))
export const loadPolicies = async (api: Reader): Promise<DevicePolicy[]> => (await api.get("/v1/device-policies")).map((p) => ({ feature: p.feature, allow: p.allow }))
export const loadMfaPolicy = async (api: Reader): Promise<MfaPolicy> => {
  const p = await api.get("/v1/settings/mfa-policy")
  if (p.mode !== "off" && p.mode !== "all" && p.mode !== "roles") throw new Error("settings: mfa mode must be off, all or roles")
  return { mode: p.mode, roles: p.roles }
}
export const loadIntegrations = async (api: Reader, tz: string): Promise<Integration[]> => (await api.get("/v1/integrations")).map((i) => toIntegration(i, tz))
export async function loadRequests(api: Reader, tz: string, nameOf: (id: string) => string): Promise<DataRequestRow[]> {
  return (await api.get("/v1/data-requests")).map((r) => toDataRequest(r, tz, nameOf))
}
export async function loadGrants(api: Reader, tz: string): Promise<SupportGrant[]> {
  return (await api.get("/v1/settings/support-grants")).items.map((g) => toGrant(g, tz))
}
export async function loadMyExports(api: Reader, tz: string, nameOf: (id: string) => string): Promise<DataRequestRow[]> {
  return (await api.get("/v1/me/data-export")).map((r) => toDataRequest(r, tz, nameOf))
}

/** Names for ids (the people the caller can see); anyone else reads as "Member". */
export async function getNames(): Promise<Record<string, string>> {
  const people = await getPeople().catch(() => [])
  return Object.fromEntries(people.map((p) => [p.id, p.name]))
}
export const nameOfFrom = (names: Record<string, string>) => (id: string) => names[id] ?? "Member"

export const serverApi = apiServer

/** The idle sign-out hours the platform set for this company (GET /v1/me/tenant, open to every member). */
export const loadSessionIdleHours = async (api: Reader): Promise<number> => (await api.get("/v1/me/tenant")).tenant.sessionIdleHours

/**
 * MOCK: no backend (the API has no deactivate route and no last-active). Per-email status and last-active from the demo seed, read only on a demo deployment
 * (ENABLE_MOCK_MODULES=1, ruling J2). It never calls the API. Isolated: the page loads it only behind mockEnabled().
 */
export async function getMockUserActivity(): Promise<Record<string, { status: "active" | "deactivated"; lastActive: string }>> {
  const { users } = await getData<{ users: { email: string; status: "active" | "deactivated"; lastActive: string }[] }>("settings/users.json")
  return Object.fromEntries(users.map((u) => [u.email.toLowerCase(), { status: u.status, lastActive: u.lastActive }]))
}

// ---- MOCK: no backend until T6.7 (template editor) and B9 (tenant-default notification settings, delivery log). Shown only on a demo deployment (I16). ----
export const getTemplate = () => getData<TemplateData>("settings/template.json")
export const getNotificationSettings = () => getData<NotificationsData>("settings/notifications.json")
export const getDeliveryLog = () => getData<DeliveryRow[]>("settings/delivery-log.json")
