import { getData } from "@/lib/data"
import { getSession } from "@/lib/session"
import { initialsOf } from "@/lib/branding"

import type { NavigationData, UserData } from "./types"

export const getNavigation = () => getData<NavigationData>("shell/navigation.json")
/** The signed-in person (B6 T6.3): the real user from /v1/me and the role label from the membership, not the demo file. */
export async function getUser(): Promise<UserData> {
  const s = await getSession()
  return { name: s.user.name, role: s.role.label, email: s.user.email, initials: initialsOf(s.user.name) }
}

export const findNavItem = (nav: NavigationData, section: string) =>
  [...nav.menu, ...nav.general].find((n) => n.href === `/${section}`)
