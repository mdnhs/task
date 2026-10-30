// Tenant money formatting. Currency and locale come from the org settings (shell/org.json), never hard-coded.
export type Money = { currency: string; format(n: number): string }

/** Whole amounts show no decimals, others two: EUR/en-IE 640 -> "€640", 12.5 -> "€12.50". */
export function moneyFormatter(currency: string, locale: string): Money {
  const whole = new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 })
  const cents = new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return { currency, format: (n) => (Number.isInteger(n) ? whole : cents).format(n) }
}
