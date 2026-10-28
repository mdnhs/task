import type { z } from "zod"

// First zod message per field, for the Field components.
export function fieldErrors<K extends string>(error: z.ZodError): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {}
  for (const i of error.issues) {
    const k = i.path[0] as K
    if (!out[k]) out[k] = i.message
  }
  return out
}
