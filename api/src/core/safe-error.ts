/**
 * Only the error class name and a short machine code (the pg SQLSTATE in `cause.code`, or `code`), never the message or
 * the error object: Drizzle/pg messages carry the SQL and its parameters (emails, tokens).
 */
export function errorInfo(e: unknown): { name: string; code?: string } {
  const name = e instanceof Error && /^[A-Za-z0-9_.-]{1,64}$/.test(e.name) ? e.name : "NonError"
  const cause = (e as { cause?: { code?: unknown } } | null)?.cause
  const own = (e as { code?: unknown } | null)?.code
  const raw = typeof cause?.code === "string" ? cause.code : typeof own === "string" ? own : undefined
  return { name, code: raw && /^[A-Za-z0-9_.-]{1,64}$/.test(raw) ? raw : undefined }
}
