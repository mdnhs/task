"use client"

import Link from "next/link"
import { useSyncExternalStore } from "react"

import { Icon } from "@/components/icon"

// Prompt mode (policy.enforcement "prompt", the default): the workspace asks for two-step verification but the app keeps working. A quiet reminder above the page
// with a link to the set-up card (/mfa). Dismiss hides it for this browser session only (sessionStorage; blocked storage = this page load).
const KEY = "od-mfa-prompt-dismissed"
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

export function MfaBanner() {
  const hidden = useSyncExternalStore(subscribe, () => dismissedNow || read(), () => false)
  if (hidden) return null
  return (
    <div className="sub-banner mfa-banner" data-tone="warn" role="status">
      <Icon name="lock" size={24} />
      <span>Secure your account in 2 minutes with two-step verification</span>
      <Link href="/mfa" className="mfa-banner-go">Set up now</Link>
      <button type="button" className="od-notice-x" aria-label="Dismiss" onClick={dismiss}>
        <Icon name="close" size={24} />
      </button>
    </div>
  )
}
