import { getData } from "@/lib/data"
import type { BrandingData, DeliveryRow, Department, Integration, Invite, MatrixData, NotificationsData, OrganisationData, PrivacyData, SettingsUser, TemplateData } from "./types"

export const getOrganisation = () => getData<OrganisationData>("settings/organisation.json")
export const getBranding = () => getData<BrandingData>("settings/branding.json")
export const getTemplate = () => getData<TemplateData>("settings/template.json")
export const getNotificationSettings = () => getData<NotificationsData>("settings/notifications.json")
export const getDeliveryLog = () => getData<DeliveryRow[]>("settings/delivery-log.json")
export const getPrivacy = () => getData<PrivacyData>("settings/privacy.json")
export const getRolesMatrix = () => getData<MatrixData>("settings/roles-matrix.json")

export async function getDepartments() {
  return (await getData<{ departments: Department[] }>("settings/departments.json")).departments
}
export async function getIntegrations() {
  return (await getData<{ integrations: Integration[] }>("settings/integrations.json")).integrations
}
export async function getUsersAndInvites() {
  const [{ users }, { invites }] = await Promise.all([
    getData<{ users: SettingsUser[] }>("settings/users.json"),
    getData<{ invites: Invite[] }>("settings/invites.json"),
  ])
  return { users, invites }
}
