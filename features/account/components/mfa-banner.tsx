"use client"

import Link from "next/link"
import { useSyncExternalStore } from "react"

import { Icon } from "@/components/icon"

// Grace period (see lib/mfa-gate.ts): the workspace requires two-step verification and this person has not set it up yet, but the deadline is still ahead.
// The app keeps working; the banner says how long is left. Dismiss hides it for this browser session only (sessionStorage; blocked storage = this page load).
const KEY = "od-mfa-grace-dismissed"
let dismissedNow = false
const listeners = new Set<() => void>()
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
function read(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1"
  } catch {
    return false
  }
}
function dismiss() {
  try {
    sessionStorage.setItem(KEY, "1")
  } catch {
    /* storage blocked */
  }
  dismissedNow = true
  listeners.forEach((fn) => fn())
}

export function MfaBanner({ daysLeft }: { daysLeft: number }) {
  const hidden = useSyncExternalStore(subscribe, () => dismissedNow || read(), () => false)
  if (hidden) return null
  return (
    <div className="sub-banner mfa-banner" data-tone="warn" role="status">
      <Icon name="lock" size={24} />
      <span>Secure your account in 2 minutes: {daysLeft} {daysLeft === 1 ? "day" : "days"} left</span>
      <Link href="/account/security" className="mfa-banner-go">Set up now</Link>
      <button type="button" className="od-notice-x" aria-label="Dismiss" onClick={dismiss}>
        <Icon name="close" size={24} />
      </button>
    </div>
  )
}
