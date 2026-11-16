/**
 * The ONLY allow-list of uploadable types (single source of truth). Matched exactly, case-insensitively, with no
 * parameters (so `text/plain; charset=utf-8` is refused: the signed Content-Type condition is an exact match too).
 * Deliberately excluded: svg and html (script-bearing documents: stored XSS on download), javascript, executables,
 * archives such as zip (can hide anything from a content scanner), and octet-stream.
 */
export const ALLOWED_MIMES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // docx
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // xlsx
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // pptx
  "text/csv",
  "text/plain",
] as const

export type AllowedMime = (typeof ALLOWED_MIMES)[number]

/** The canonical allow-listed mime for a client-supplied value, or null. */
export function normalizeMime(input: string): AllowedMime | null {
  const m = input.trim().toLowerCase()
  return (ALLOWED_MIMES as readonly string[]).includes(m) ? (m as AllowedMime) : null
}
