import { getData } from "@/lib/data"

import type { NavigationData, Notification, UserData } from "./types"

export const getNavigation = () => getData<NavigationData>("shell/navigation.json")
export const getUser = () => getData<UserData>("shell/user.json")
export const getNotifications = () => getData<Notification[]>("shell/notifications.json")

export const findNavItem = (nav: NavigationData, section: string) =>
  [...nav.menu, ...nav.general].find((n) => n.href === `/${section}`)
