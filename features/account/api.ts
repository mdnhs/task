import { getData } from "@/lib/data"
import type { NotificationPrefsData, ProfileData, SecurityData } from "./types"

export const getProfile = () => getData<ProfileData>("account/profile.json")
export const getSecurity = () => getData<SecurityData>("account/security.json")
export const getNotificationPrefs = () => getData<NotificationPrefsData>("account/notifications.json")
