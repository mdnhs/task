const MAX = 200

/** Safe-to-log description of a mail error: name, code and a trimmed message, with no keys or token links. */
export function sanitizeMailError(err: unknown): string {
  const e = err as { name?: unknown; code?: unknown; message?: unknown } | null
  const name = typeof e?.name === "string" ? e.name : "Error"
  const code = typeof e?.code === "string" || typeof e?.code === "number" ? ` ${String(e.code)}` : ""
  const raw = typeof err === "string" ? err : typeof e?.message === "string" ? e.message : "unknown error"
  const msg = raw
    .replace(/https?:\/\/\S*token=\S*/gi, "[redacted-url]")
    .replace(/\S*token=\S*/gi, "[redacted]")
    .replace(/re_[A-Za-z0-9_]+/g, "[redacted-key]")
    .replace(/\s+/g, " ")
    .slice(0, MAX)
  return `${name}${code}: ${msg}`
}
