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

/** Evidence video (ruling D19 / FR-M1-46): allowed only through the task upload intent, never through /v1/files. */
export const TASK_VIDEO_MIMES = ["video/mp4", "video/quicktime", "video/webm"] as const
/** Voice note mimes (ruling D21). */
export const TASK_VOICE_MIMES = ["audio/webm", "audio/mp4", "audio/ogg"] as const

const EXT: Record<string, string[]> = {
  "video/mp4": ["mp4"],
  "video/quicktime": ["mov"],
  "video/webm": ["webm"],
  "audio/webm": ["webm"],
  "audio/mp4": ["m4a", "mp4"],
  "audio/ogg": ["ogg", "oga"],
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/webp": ["webp"],
  "image/heic": ["heic"],
  "application/pdf": ["pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ["pptx"],
  "text/csv": ["csv"],
  "text/plain": ["txt"],
}

/**
 * The stored (and downloaded) name: its extension is forced to the declared mime's canonical one, so the allow-list
 * cannot be bypassed through the name (`invoice.exe` + application/pdf -> `invoice.pdf`, `x.html` + text/plain ->
 * `x.txt`). A matching extension is kept as typed; a missing or purely numeric one (`v1.2`) gets the canonical one
 * appended; trailing dots/spaces are dropped. The base is shortened so the result stays within 255 characters.
 */
export function canonicalName(name: string, mime: string): string {
  const accepted = EXT[mime]
  const trimmed = name.replace(/[. ]+$/, "")
  const dot = trimmed.lastIndexOf(".")
  const ext = dot > 0 ? trimmed.slice(dot + 1) : ""
  if (ext && accepted.includes(ext.toLowerCase())) return trimmed
  const base = ext && /^[A-Za-z0-9]{1,10}$/.test(ext) && !/^[0-9]+$/.test(ext) ? trimmed.slice(0, dot) : trimmed
  const suffix = `.${accepted[0]}`
  const room = 255 - suffix.length
  return (Array.from(base || "file").slice(0, room).join("")) + suffix
}
