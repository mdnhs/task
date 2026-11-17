import { apiServer } from "@/lib/api/server"
import { getData } from "@/lib/data"
import { securityFromSessions } from "./security-data"
import type { NotificationPrefsData, ProfileData, SecurityData } from "./types"

export const getProfile = () => getData<ProfileData>("account/profile.json")
/** Real sessions from the API (I21); `timezone` is the tenant's, for the wall-clock display. */
export async function getSecurity(o: { timezone: string; twoFactorEnabled: boolean }): Promise<SecurityData> {
  const { items } = await (await apiServer()).get("/v1/me/sessions")
  return securityFromSessions(items, o)
}
export const getNotificationPrefs = () => getData<NotificationPrefsData>("account/notifications.json")
