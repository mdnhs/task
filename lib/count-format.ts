// Counting a displayed value up from zero (components/count-up.tsx): the pure part. A value like "€12,400", "94%", "£12.50" or
// "1,234" is split into what stays fixed (prefix and suffix) and the number that counts. Pure; tested in count-format.test.ts.
//
// Only the English shape is read: "," groups thousands, "." starts the decimals (also a space or no-break space as the group).
// Anything else (a different locale's "12.400,50", a range, a date, two numbers) is not parsed, so it renders unchanged.

export type CountShape = {
  prefix: string
  suffix: string
  /** The number that counts. */
  target: number
  /** Decimal places the value shows (0 for a whole number). */
  decimals: number
  /** The thousands separator the value uses, "" if it has none. */
  group: "" | "," | " " | " "
}

const SHAPE = /^([^\d\-+.,]*?)(\d{1,3}(?:[,  ]\d{3})+|\d+)(?:\.(\d+))?([^\d]*)$/

/** Splits a display value into prefix, number and suffix. `null` when it is not one plain number with optional affixes. */
export function parseCount(value: string): CountShape | null {
  const m = SHAPE.exec(value.trim())
  if (!m) return null
  const [, prefix, whole, frac, suffix] = m
  // A group separator must be the same character throughout ("1,234,567", not "1,234 567").
  const seps = new Set(whole.replace(/\d/g, "").split(""))
  if (seps.size > 1) return null
  const group = (seps.values().next().value ?? "") as CountShape["group"]
  return {
    prefix: prefix,
    suffix: suffix,
    target: Number(whole.replace(/[,  ]/g, "") + (frac ? `.${frac}` : "")),
    decimals: frac?.length ?? 0,
    group,
  }
}

/** The shown text for a number `n` in `shape`: same decimals, same grouping, same prefix and suffix. */
export function formatCount(n: number, shape: Pick<CountShape, "prefix" | "suffix" | "decimals" | "group">): string {
  const [int, frac] = n.toFixed(shape.decimals).split(".")
  const grouped = shape.group ? int.replace(/\B(?=(\d{3})+(?!\d))/g, shape.group) : int
  return `${shape.prefix}${grouped}${frac ? `.${frac}` : ""}${shape.suffix}`
}

/** The number inside a display value ("€12,400" -> 12400), or null. Used to tell whether a changed value went down. */
export function countNumber(value: string): number | null {
  return parseCount(value)?.target ?? null
}
