import type { Metadata } from "next"
import { notFound } from "next/navigation"

import {
  ACCOUNT_TABS, AccountLayout, AccountNotificationsPanel, ProfilePanel, SecurityPanel,
  getNotificationPrefs, getProfile, getSecurity, isTab,
} from "@/features/account"
import type { AccountTabId } from "@/features/account"
import { getUser } from "@/features/shell"
import { getMfaState } from "@/lib/device-session"
import { getOrg } from "@/lib/org"
import { getPeople } from "@/lib/people"
import { getSession } from "@/lib/session"
import { todayUserId } from "@/lib/today-data"

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
  const [session, org, user, profile, security, prefs] = await Promise.all([getSession(), getOrg(), getUser(), getProfile(), getSecurity(), getNotificationPrefs()])
  const mfa = await getMfaState(session)
  const people = await getPeople()
  // Same title rule as the user menu: the default owner keeps the person's own title, other roles show the previewed role.
  const role = session.role.id === "owner" ? user.role : session.role.label
  const scopeKey = `${session.tenant.id}:${session.role.id}:${mfa.enrolled ? "mfa" : "nomfa"}`

  const panels: Record<AccountTabId, React.ReactNode> = {
    profile: <ProfilePanel data={profile} name={user.name} email={user.email} initials={user.initials} role={role} tzLabel={org.tzLabel} scopeKey={scopeKey} />,
    security: <SecurityPanel data={{ ...security, mfa: mfa.enrolled }} mfaRequired={mfa.required} email={user.email} today={org.today} timezone={org.timezone} tzLabel={org.tzLabel} scopeKey={scopeKey} />,
    notifications: <AccountNotificationsPanel data={prefs} scopeKey={scopeKey} todayUser={todayUserId(session, people, user.name)} />,
  }

  // All panels render up front so the client switches tabs in place.
  return <AccountLayout tab={tab} panels={panels} />
}
