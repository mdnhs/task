// Account pure logic (B6 T6.5): notification preferences as the API has them (a channel matrix per kind plus quiet hours) and the "enter a code" attempt counter.
import type { NotificationPrefsRow, PrefChannel, PrefsView } from "./types"

type Rec = Record<string, unknown>
const bad = (k: string, want: string): never => {
  throw new Error(`account: ${k} must be ${want}`)
}

/** The kinds in the order the table shows them, with the words the member sees. `security` always keeps in-app and email (the API refuses to turn them off). */
export const PREF_KINDS: { kind: string; label: string; hint: string }[] = [
  { kind: "task", label: "Tasks", hint: "Assigned to you, due, changed" },
  { kind: "report", label: "Shift report", hint: "Reminders and reviews" },
  { kind: "member", label: "People", hint: "New members and changes" },
  { kind: "invite", label: "Invites", hint: "Invites you send" },
  { kind: "file", label: "Files", hint: "Uploads and scans" },
  { kind: "dsr", label: "Data requests", hint: "Export, erase and correct" },
  { kind: "billing", label: "Billing", hint: "Plan and payment notices" },
  { kind: "security", label: "Security", hint: "Sign-ins and devices" },
  { kind: "system", label: "System", hint: "Anything else from OpsDesk" },
]
export const PREF_CHANNELS: { id: PrefChannel; label: string }[] = [
  { id: "inApp", label: "In-app" },
  { id: "email", label: "Email" },
  { id: "push", label: "Push" },
]

export function toPrefs(dto: unknown): PrefsView {
  const r = dto as Rec
  const channels = (r && typeof r === "object" ? r.channels : null) as Rec | null
  if (!channels || typeof channels !== "object") bad("channels", "an object")
  const rows: NotificationPrefsRow[] = PREF_KINDS.map((k) => {
    const c = (channels as Rec)[k.kind] as Rec | undefined
    if (!c || typeof c !== "object") return bad(k.kind, "a channel object")
    const flag = (n: string) => (typeof c[n] === "boolean" ? (c[n] as boolean) : bad(`${k.kind}.${n}`, "a boolean"))
    return { kind: k.kind, label: k.label, hint: k.hint, inApp: flag("inApp"), email: flag("email"), push: flag("push"), locked: k.kind === "security" }
  })
  const q = (n: "quietStart" | "quietEnd") => (r[n] === null ? null : typeof r[n] === "string" ? (r[n] as string) : bad(n, "a time or null"))
  const start = q("quietStart")
  const end = q("quietEnd")
  return { rows, quiet: start && end ? { start, end } : null }
}

export type PrefsChange = { kind: string; channel: PrefChannel; on: boolean } | { quiet: { start: string; end: string } | null }
export type PrefsBody = { channels: Record<string, Partial<Record<PrefChannel, boolean>>>; quietStart: string | null; quietEnd: string | null }

/** The PUT body: the one switch that changed (the API merges it into the stored matrix) and the quiet hours as they stand, because the route takes both every time. */
export function prefsBody(cur: PrefsView, change: PrefsChange): PrefsBody {
  if ("quiet" in change) return { channels: {}, quietStart: change.quiet?.start ?? null, quietEnd: change.quiet?.end ?? null }
  return { channels: { [change.kind]: { [change.channel]: change.on } }, quietStart: cur.quiet?.start ?? null, quietEnd: cur.quiet?.end ?? null }
}

export const MAX_WRONG_CODES = 5
const LOCKED = "Too many wrong codes. Ask an admin for a new code."

/**
 * Counts wrong enrolment codes typed in a row on this page. The API gives no distinct answer for a wrong, expired or used code (no oracle), and it invalidates a code
 * after five wrong tries, so the page does the same: the fifth wrong code in a row shows the locked message and stops asking. A success resets the count.
 */
export function makeCodeAttempts() {
  let wrong = 0
  return {
    record(ok: boolean) {
      wrong = ok ? 0 : wrong + 1
    },
    locked: () => wrong >= MAX_WRONG_CODES,
    message: () => LOCKED,
  }
}
