import { TODAY_COOKIE_AUTO, TODAY_COOKIE_DISMISSED, dismissedValue } from "./today"

// Browser-only (localStorage, with a cookie mirror so the server renders the right first paint and skeleton).
// The Today card reads it on the home screen; Account → Notifications writes the two switches. Every access is guarded:
// storage can be blocked (private window, site data off), and the app must still work without it.

const K = (name: string, userId: string) => `opsdesk:today:${name}:${userId}`

function get(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}
function set(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // storage unavailable: the cookie mirror still carries the choice for this browser
  }
}
function cookie(name: string, value: string | null) {
  try {
    document.cookie = value === null ? `${name}=; path=/; max-age=0; samesite=lax` : `${name}=${encodeURIComponent(value)}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`
  } catch {
    // no cookies: the card just falls back to its default each visit
  }
}

/** The automatic card (FR-M1-78); off by default (the home screen shows the compact entry), on once the user switches it on. */
export const readAuto = (userId: string) => get(K("auto", userId)) === "1"
export function writeAuto(userId: string, on: boolean) {
  set(K("auto", userId), on ? "1" : null)
  cookie(TODAY_COOKIE_AUTO, on ? "1" : null)
}

/** "Your day is ready" at shift start (FR-M1-78). Mock: stored only; the push itself needs the mobile app. */
export const readReady = (userId: string) => get(K("ready", userId)) === "1"
export const writeReady = (userId: string, on: boolean) => set(K("ready", userId), on ? "1" : null)

/** Has this user dismissed the card for this working day (FR-M1-70, AC-M1-09)? */
export const readDismissed = (userId: string, dayKey: string) => get(K("dismissed", userId)) === dayKey
export function writeDismissed(userId: string, dayKey: string, dismissed: boolean) {
  set(K("dismissed", userId), dismissed ? dayKey : null)
  cookie(TODAY_COOKIE_DISMISSED, dismissed ? dismissedValue(userId, dayKey) : null)
}
