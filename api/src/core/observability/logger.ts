import pino, { type DestinationStream, type Logger } from "pino"
import type { Context } from "hono"
import type { AppEnv } from "../context"
import { errorInfo } from "../safe-error"

const CENSOR = "[redacted]"

/**
 * The ONE redaction path list (B7 Task 15), given to pino itself and reused by the API, the worker and the demo seed, which all build
 * their logger with `makeLogger`. It covers the known shapes cheaply; `scrub` below is the net for every other depth, spelling and value.
 */
export const LOG_REDACT_PATHS = [
  "authorization", "cookie", '["set-cookie"]', "password", "token", "secret", // bare `code` is value-aware (scrub): a SQLSTATE stays, a one-time code goes
  "req.headers.authorization", "req.headers.cookie", 'req.headers["set-cookie"]', 'req.headers["x-api-key"]',
  "res.headers.authorization", "res.headers.cookie", 'res.headers["set-cookie"]',
  "headers.authorization", "headers.cookie", 'headers["set-cookie"]',
  "*.authorization", "*.cookie", "*.password", "*.token", "*.secret",
]

// Key names whose value is never logged, whatever the depth or the case: credentials, session material, signing secrets, one-time codes.
const SECRET_KEY = /(authorization|cookie|passw(or)?d|token|secret|api[-_]?key|signature|credential|private[-_]?key|otp|(verification|enrol+ment|invite|reset|backup|recovery|login|totp|mfa|sms|auth)[-_]?code)/i
// A request or job body is never logged (it holds passwords, tokens and personal data).
const BODY_KEY = /^(body|req[-_]?body|request[-_]?body|raw[-_]?body|payload)$/i
const OTP_VALUE = /^\d{6,8}$/ // a bare `code` is kept when it is a machine code (a SQLSTATE, `queue_timeout`), dropped when it looks like a one-time code
const EMAIL = /([A-Za-z0-9._%+-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g
const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi
const TOKENISH = /\b(?:odk_|whsec_|sk_(?:live|test)_|rk_(?:live|test)_|re_)[A-Za-z0-9_-]{6,}/g
const MAX_DEPTH = 8
const MAX_ITEMS = 100
const MAX_STRING = 2000

const cleanString = (s: string): string =>
  s.slice(0, MAX_STRING).replace(BEARER, `Bearer ${CENSOR}`).replace(TOKENISH, CENSOR).replace(EMAIL, (_m, local: string, domain: string) => `${local[0]}***@${domain}`)

function walk(v: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof v === "string") return cleanString(v)
  if (v === null || typeof v !== "object") return typeof v === "function" || typeof v === "symbol" ? undefined : v
  if (v instanceof Date) return v
  if (v instanceof Error) return errorInfo(v)
  if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return "[binary]"
  if (seen.has(v)) return "[circular]"
  if (depth >= MAX_DEPTH) return "[truncated]"
  seen.add(v)
  try {
    if (Array.isArray(v)) return v.slice(0, MAX_ITEMS).map((x) => walk(x, depth + 1, seen))
    const out: Record<string, unknown> = {}
    const put = (k: string, val: unknown) => void Object.defineProperty(out, k, { value: val, enumerable: true, writable: true, configurable: true }) // defineProperty, not out[k]=: a `__proto__` key from JSON.parse is data, never the prototype setter
    for (const k of Object.keys(v).slice(0, MAX_ITEMS)) {
      let raw: unknown
      try {
        raw = (v as Record<string, unknown>)[k]
      } catch {
        put(k, "[unreadable]")
        continue
      }
      if (SECRET_KEY.test(k)) put(k, CENSOR)
      else if (BODY_KEY.test(k)) put(k, "[omitted]")
      else if (k.toLowerCase() === "code" && OTP_VALUE.test(String(raw))) put(k, CENSOR)
      else put(k, walk(raw, depth + 1, seen))
    }
    return out
  } finally {
    seen.delete(v) // only ancestors count as a cycle, so a value shared by two siblings is still logged twice
  }
}

/** A cleaned COPY of what is about to be logged (never mutates the caller's object). */
export const scrub = (o: object): Record<string, unknown> => walk(o, 0, new WeakSet()) as Record<string, unknown>

/** The structured JSON logger of the API, the worker and the seed: redaction, scrubbing and a class-name-only error serializer. */
export function makeLogger(o: { level?: string; service?: string; destination?: DestinationStream } = {}): Logger {
  return pino(
    {
      level: o.level ?? "info",
      base: { service: o.service ?? "api" },
      redact: { paths: LOG_REDACT_PATHS, censor: CENSOR },
      formatters: { log: scrub, bindings: (b) => scrub(b) },
      serializers: { err: (e: unknown) => errorInfo(e) },
    },
    o.destination,
  )
}

/** Adds ids to the request-scoped logger once they are known (session: userId, tenant resolution: tenantId). A bare context without a logger is left alone. */
export function bindLog(c: Context<AppEnv>, fields: { tenantId?: string; userId?: string }): void {
  const log = c.get("log")
  if (log) c.set("log", log.child(fields))
}
