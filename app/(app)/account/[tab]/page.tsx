import type { Metadata } from "next"
import { notFound } from "next/navigation"

import {
  ACCOUNT_TABS, AccountLayout, AccountNotificationsPanel, ProfilePanel, SecurityPanel,
  getNotificationPrefs, getOwnDevices, getProfile, getSecurity, isTab,
} from "@/features/account"
import type { AccountTabId } from "@/features/account"
import { getUser } from "@/features/shell"
import { getMfaState } from "@/lib/device-session"
import { getOrg } from "@/lib/org"
import { getPeople, todayUserId } from "@/lib/people"
import { requireMfaOk } from "@/lib/session"

export const dynamicParams = false

export function generateStaticParams() {
  return ACCOUNT_TABS.map((t) => ({ tab: t.id }))
}

export async function generateMetadata({ params }: { params: Promise<{ tab: string }> }): Promise<Metadata> {
  const { tab } = await params
  const t = ACCOUNT_TABS.find((x) => x.id === tab)
  return { title: t ? `${t.label} · Account · OpsDesk` : "Account · OpsDesk" }
}

// Personal account: every signed-in role may open it (the app layout already redirects signed-out visitors).
export default async function Page({ params }: { params: Promise<{ tab: string }> }) {
  const { tab } = await params
  if (!isTab(tab)) notFound()
  // This page calls the API (sessions): it gates itself on the second factor (a layout does not protect the page below it).
  const session = await requireMfaOk()
  const [org, user, profile, prefs] = await Promise.all([getOrg(), getUser(), getProfile(), getNotificationPrefs()])
  const [mfa, security, people, ownDevices] = await Promise.all([
    getMfaState(session), getSecurity({ timezone: org.timezone, twoFactorEnabled: session.twoFactorEnabled }), getPeople().catch(() => []),
    session.device.id === null ? getOwnDevices(session.user.id).catch(() => []) : Promise.resolve([]),
  ])
  const role = session.role.label
  const department = org.departments.find((d) => people.some((p) => p.id === session.user.id && p.dept === d)) ?? people.find((p) => p.id === session.user.id)?.dept ?? ""

  const panels: Record<AccountTabId, React.ReactNode> = {
    profile: <ProfilePanel data={profile} name={user.name} email={user.email} initials={user.initials} role={role} tzLabel={org.tzLabel} department={department} />,
    security: <SecurityPanel data={security} mfaRequired={mfa.required} email={user.email} today={org.today} tzLabel={org.tzLabel} device={{ label: session.device.label, registered: session.device.id !== null }} ownDevices={ownDevices} />,
    notifications: <AccountNotificationsPanel data={prefs} todayUser={todayUserId(session, people, user.name)} />,
  }

  // All panels render up front so the client switches tabs in place.
  return <AccountLayout tab={tab} panels={panels} />
}
