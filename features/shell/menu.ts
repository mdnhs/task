// What the user menu shows (pure, so it is tested without a DOM). B6 T6.3: no demo switchers. The role is the membership role, the company switcher
// appears only with two or more memberships, and the device is a read-only label from /v1/me/tenant.device (the API resolves it from the signed
// device cookie; the browser can only enrol it through the enrolment code, never pick it here).
import type { ShellSession, UserData } from "./types"

export type UserMenu = {
  roleLine: string
  /** null with fewer than two memberships (nothing to switch) and in the console. */
  companies: { slug: string; name: string; current: boolean }[] | null
  /** null when the layout does not pass one (the console). */
  device: { label: string; registered: boolean } | null
}

export function userMenu(session: ShellSession, user: UserData, variant: "app" | "platform"): UserMenu {
  const platform = variant === "platform"
  return {
    roleLine: platform ? user.role : session.role.label,
    companies: !platform && session.tenants.length > 1 ? session.tenants.map((t) => ({ slug: t.slug, name: t.name, current: t.slug === session.tenant.slug })) : null,
    device: !platform && session.device ? { label: session.device.label, registered: session.device.registered } : null,
  }
}
