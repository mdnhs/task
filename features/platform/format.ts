// Display formats of the live console (B6 T6.8). The console is not inside a company, so there is no tenant zone: instants show in UTC and say so. Deterministic (same text on
// the server and in the browser).
import { money } from "./money"

const DATE = new Intl.DateTimeFormat("en-IE", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" })
const DATE_TIME = new Intl.DateTimeFormat("en-IE", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })

export const dateUtc = (iso: string): string => DATE.format(new Date(iso))
export const dateTimeUtc = (iso: string): string => `${DATE_TIME.format(new Date(iso))} UTC`
/** Integer minor units (cents) to a display amount in the platform locale. */
export const minorMoney = (minor: number, currency: string): string => money(minor / 100, currency)

/** The console clock for the shell (the bell and "today"), as a zone-less UTC wall-clock string. The console is not inside a company, so there is no tenant zone. */
export const nowUtc = (): string => new Date().toISOString().slice(0, 19)
