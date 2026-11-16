export type FieldRuleRole = { fieldRules?: Record<string, string[]> }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date)

// Copy-on-write removal of one dotted path; arrays on the way are applied element-wise. Never mutates its input.
function omit(value: unknown, parts: string[]): unknown {
  if (Array.isArray(value)) return value.map((v) => omit(v, parts))
  if (!isObj(value)) return value
  const [head, ...rest] = parts
  if (!Object.hasOwn(value, head)) return value
  if (rest.length === 0) {
    const kept = { ...value }
    delete kept[head]
    return kept
  }
  return { ...value, [head]: omit(value[head], rest) }
}

/** Removes the field paths the role hides for `entity` (role.field_rules: entity -> dotted paths). Returns a copy. */
export function redactFields<T>(role: FieldRuleRole, entity: string, row: T): T {
  const paths = Object.hasOwn(role.fieldRules ?? {}, entity) ? role.fieldRules![entity] : []
  let out: unknown = row
  for (const p of paths) out = omit(out, p.split("."))
  return out as T
}
