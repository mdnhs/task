import { AccountLoading, getNotificationPrefs, getSecurity } from "@/features/account"
import { getMfaState } from "@/lib/device-session"
import { getOrg } from "@/lib/org"
import { getSession } from "@/lib/session"

// Async so the skeleton uses the real row counts and the security tab's real text (ghost); the client wrapper picks the tab from the pathname.
export default async function Loading() {
  const session = await getSession()
  const [security, prefs, org, mfa] = await Promise.all([getSecurity(), getNotificationPrefs(), getOrg(), getMfaState(session)])
  return (
    <AccountLoading
      counts={{
        sessions: security.sessions.length,
        others: security.sessions.filter((s) => !s.current).length,
        activity: security.activity.length,
        events: prefs.events.length,
        channels: prefs.channels.length,
        prefs: { channels: prefs.channels, events: prefs.events },
        security: {
          mfaHint: mfa.enrolled ? (mfa.required ? "On: required by your workspace administrator" : "On: a code is asked at every new sign-in") : "Off: add a code step to protect your account",
          sessions: security.sessions,
          activity: security.activity,
          today: org.today,
          tzLabel: org.tzLabel,
        },
      }}
    />
  )
}
