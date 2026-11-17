import { apiServer } from "@/lib/api/server"
import { getData } from "@/lib/data"
import { toPrefs } from "./adapters"
import { securityFromSessions } from "./security-data"
import type { OwnDevice, PrefsView, ProfileData, SecurityData } from "./types"

/** Display rules for the name field (static). The member's own values come from the session. */
export const getProfile = () => getData<ProfileData>("account/profile.json")
/** Real sessions from the API (I21); `timezone` is the tenant's, for the wall-clock display. */
export async function getSecurity(o: { timezone: string; twoFactorEnabled: boolean }): Promise<SecurityData> {
  const { items } = await (await apiServer()).get("/v1/me/sessions")
  return securityFromSessions(items, o)
}
export async function getNotificationPrefs(): Promise<PrefsView> {
  return toPrefs(await (await apiServer()).get("/v1/me/notification-preferences"))
}
/** The signed-in user's own devices (a member only ever gets their own, an admin gets all: filtered to the caller here). */
export async function getOwnDevices(userId: string): Promise<OwnDevice[]> {
  const all = await (await apiServer()).get("/v1/devices")
  return all.filter((d) => d.userId === userId).map((d) => ({ id: d.id, label: d.label }))
}
