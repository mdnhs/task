// Display formats of the live console (B6 T6.8). The console is not inside a company, so there is no tenant zone: instants show in UTC and say so. Deterministic (same text on
// the server and in the browser).
import { money } from "./money"

const DATE = new Intl.DateTimeFormat("en-IE", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" })
const DATE_TIME = new Intl.DateTimeFormat("en-IE", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })

export const dateUtc = (iso: string): string => DATE.format(new Date(iso))
export const dateTimeUtc = (iso: string): string => `${DATE_TIME.format(new Date(iso))} UTC`
/** Integer minor units (cents) to a display amount in the platform locale. */
export const minorMoney = (minor: number, currency: string): string => money(minor / 100, currency)

/** Stored bytes in a few characters (1024 steps): "0 B", "512 KB", "48.2 MB", "1.3 GB". */
export function bytes(n: number): string {
  if (!(n > 0)) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  const v = n / 1024 ** i
  return `${i === 0 ? Math.round(v) : v >= 100 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`
}

/** The API's health band as the console's pill (B8 T17 healthOf: red = suspended, past due or unpaid; amber = a trial ending in 7 days or already over while trialing, or no activity for 30 days). */
export const HEALTH_PILL = { green: { tone: "ok", label: "Healthy" }, amber: { tone: "warn", label: "Watch" }, red: { tone: "bad", label: "At risk" } } as const

/** The console clock for the shell (the bell and "today"), as a zone-less UTC wall-clock string. The console is not inside a company, so there is no tenant zone. */
export const nowUtc = (): string => new Date().toISOString().slice(0, 19)
