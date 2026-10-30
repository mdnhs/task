import { moneyFormatter } from "@/lib/money"
import { PLATFORM_LOCALE } from "./constants"

// D11: the console's one money formatter set. Exact values (tables, sheets, audit text) use `money`; KPI cards use
// `compact` (with the exact `money` value beside it when shortened). Built on the tenant app's lib/money formatter, in the
// platform locale and the amount's own currency.

/** Exact amount: whole units without decimals, cents when there are any (€149, €149.50, €1,234,567). */
export function money(n: number, currency: string): string {
  if (!currency) return String(n)
  // Round to cents first, so float sums (0.1 + 0.2) don't print as €0.30 vs €0 by accident of representation.
  return moneyFormatter(currency, PLATFORM_LOCALE).format(Math.round(n * 100) / 100)
}

/** The currency's symbol in the platform locale ("€"); the code itself when there is none. */
export function currencySymbol(currency: string): string {
  if (!currency) return ""
  return new Intl.NumberFormat(PLATFORM_LOCALE, { style: "currency", currency }).formatToParts(0).find((p) => p.type === "currency")?.value ?? currency
}

/** D11 compact numbers for KPI cards: €640, €1.6k, €19.7k, €1.2m. Below 1,000 the value is whole. */
export function compact(n: number, currency: string): { prefix: string; value: string; suffix: string } {
  const prefix = currencySymbol(currency)
  const abs = Math.abs(n)
  const sign = n < 0 ? "-" : ""
  if (abs < 1000) return { prefix, value: `${sign}${Math.round(abs)}`, suffix: "" }
  const [div, suffix] = abs >= 1e9 ? [1e9, "bn"] : abs >= 1e6 ? [1e6, "m"] : [1e3, "k"]
  const v = Math.round((abs / div) * 10) / 10
  return { prefix, value: `${sign}${Number.isInteger(v) ? v : v.toFixed(1)}`, suffix }
}

/** True when `compact` shortened the value (€12.4k), so the card also shows the exact amount (D11). */
export const isCompacted = (suffix: string | undefined) => suffix === "k" || suffix === "m" || suffix === "bn"
