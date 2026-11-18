// Strict readers for API DTOs (B6 T6.7). A missing or mistyped REQUIRED field THROWS: a renamed field must not become a silent "" or 0 in the UI (Review Focus 4).
// `exact` also refuses a key the mapper does not know, so an API that grows a field makes the contract test fail instead of being dropped unseen.
export type Rec = Record<string, unknown>
export const bad = (what: string, k: string, want: string): never => {
  throw new Error(`${what}: ${k} must be ${want}`)
}
export const rec = (v: unknown, what: string): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : bad(what, "value", "an object"))
export const reader = (what: string) => ({
  rec: (v: unknown, name = what): Rec => rec(v, name),
  str: (r: Rec, k: string): string => (typeof r[k] === "string" ? (r[k] as string) : bad(what, k, "a string")),
  int: (r: Rec, k: string): number => (Number.isInteger(r[k]) ? (r[k] as number) : bad(what, k, "an integer")),
  num: (r: Rec, k: string): number => (typeof r[k] === "number" && Number.isFinite(r[k]) ? (r[k] as number) : bad(what, k, "a number")),
  bool: (r: Rec, k: string): boolean => (typeof r[k] === "boolean" ? (r[k] as boolean) : bad(what, k, "a boolean")),
  arr: (r: Rec, k: string): unknown[] => (Array.isArray(r[k]) ? (r[k] as unknown[]) : bad(what, k, "an array")),
  strOrNull: (r: Rec, k: string): string | null => (r[k] === null ? null : typeof r[k] === "string" ? (r[k] as string) : bad(what, k, "a string or null")),
  intOrNull: (r: Rec, k: string): number | null => (r[k] === null ? null : Number.isInteger(r[k]) ? (r[k] as number) : bad(what, k, "an integer or null")),
  oneOf: <T extends string>(r: Rec, k: string, set: readonly T[]): T => (set.includes(r[k] as T) ? (r[k] as T) : bad(what, k, `one of ${set.join(", ")}`)),
  /** The record may hold exactly these keys (every required one present) and no other. */
  exact: (r: Rec, required: readonly string[], optional: readonly string[] = []): void => {
    for (const k of required) if (!(k in r)) bad(what, k, "present")
    for (const k of Object.keys(r)) if (!required.includes(k) && !optional.includes(k)) bad(what, k, "a known field")
  },
})
