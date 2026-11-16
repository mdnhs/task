/** Deterministic JSON: object keys sorted recursively, undefined treated as null. Used for hashing only. */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(sort(v))
}

function sort(v: unknown): unknown {
  if (v === undefined) return null
  if (Array.isArray(v)) return v.map(sort)
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, sort(o[k])]))
  }
  return v
}
