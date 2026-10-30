"use client"

import { useSyncExternalStore } from "react"
import { Info, Wrench, X } from "lucide-react"

import { formatDue, formatTime } from "@/lib/dates"
import { noticeKey, type PlatformNotice } from "@/lib/platform-notice"

// D10: the platform announcement as a banner. The tenant app shell shows it above every page (app/(app)/layout.tsx);
// the console's Settings page shows the same banner as a preview. Dismissing hides that one announcement for the
// browser session (sessionStorage); a new or changed announcement shows again.

const KEY = "od-notice-dismissed"
let dismissedNow: string | null = null
const listeners = new Set<() => void>()
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
function read(): string | null {
  try {
    return sessionStorage.getItem(KEY)
  } catch {
    return null
  }
}
function dismiss(key: string) {
  try {
    sessionStorage.setItem(KEY, key)
  } catch {
    // Storage blocked: hidden for this page load only.
  }
  dismissedNow = key
  listeners.forEach((fn) => fn())
}
const snapshot = () => dismissedNow ?? read()

/** "Today 3:00 PM" / "Sun 25 Oct, 6:00 PM": the end always carries its time. */
function until(iso: string, today: string) {
  const d = formatDue(iso, today)
  return d.includes(":") ? d : `${d}, ${formatTime(iso)}`
}

export function PlatformNoticeBanner({ notice, today, tzLabel, preview = false }: { notice: PlatformNotice | null; today: string; tzLabel: string; preview?: boolean }) {
  const dismissed = useSyncExternalStore(subscribe, snapshot, () => null)
  if (!notice) return null
  const key = noticeKey(notice)
  if (!preview && dismissed === key) return null
  const maintenance = notice.kind === "maintenance"
  return (
    <div className="od-notice" data-kind={notice.kind} role={preview ? undefined : "status"}>
      {maintenance ? <Wrench aria-hidden="true" /> : <Info aria-hidden="true" />}
      <p>
        <span className="sr-only">{maintenance ? "Maintenance notice: " : "Notice: "}</span>
        {notice.message}
        {notice.endsAt && (
          <span className="od-notice-end">
            {" "}Until {until(notice.endsAt, today)} {tzLabel}
          </span>
        )}
      </p>
      {!preview && (
        <button type="button" className="od-notice-x" aria-label="Dismiss notice" onClick={() => dismiss(key)}>
          <X aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
