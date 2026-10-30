import { isoSeconds } from "./support-access"

// D10: the platform announcement (console → Settings) shown as a banner in every tenant's app shell.
// Pure and server-safe; the data read is lib/platform-notice-data.ts, the banner is components/platform-notice.tsx
// (rendered by app/(app)/layout.tsx).

export type PlatformNotice = { kind: "info" | "maintenance"; message: string; /** Wall-clock ISO on the platform clock; null = until removed. */ endsAt: string | null }

/** The announcement to show at `now` (org.today), or null: none set, a blank message, or `endsAt` reached. */
export function activeNotice(settings: { announcement: PlatformNotice | null } | null | undefined, now: string): PlatformNotice | null {
  const a = settings?.announcement
  if (!a) return null
  const message = a.message.trim()
  if (!message) return null
  if (a.endsAt && isoSeconds(a.endsAt) <= isoSeconds(now)) return null
  return { ...a, message }
}

/** Identifies one announcement, so a dismissal (per browser session) doesn't hide the next one. */
export const noticeKey = (n: PlatformNotice) => `${n.kind}|${n.endsAt ?? ""}|${n.message}`
