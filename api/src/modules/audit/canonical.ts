/**
 * Deterministic JSON: object keys sorted recursively. Input must already be plain JSON (recordAudit normalises
 * through JSON first); Date, BigInt and non-plain objects throw so the hashed form can never differ from the stored form.
 */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(sort(v))
}

function sort(v: unknown): unknown {
  if (v === undefined) throw new Error("canonicalJson: undefined is not JSON")
  if (typeof v === "bigint" || typeof v === "function" || typeof v === "symbol") throw new Error(`canonicalJson: ${typeof v} is not JSON`)
  if (Array.isArray(v)) return v.map(sort)
  if (v && typeof v === "object") {
    const proto = Object.getPrototypeOf(v)
    if (proto !== Object.prototype && proto !== null) throw new Error("canonicalJson: non-plain object")
    const o = v as Record<string, unknown>
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, sort(o[k])]))
  }
  return v
}
