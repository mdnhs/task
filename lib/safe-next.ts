// The `next` parameter after sign-in (open-redirect defence, B6 T6.3): a same-origin, path-only target or "/". Pure.
// Anything that a browser could read as another host is refused: a second slash or a backslash after the first slash (protocol-relative), a scheme,
// control characters or spaces (stripped by URL parsers), percent-escaped slashes/backslashes/dots at the start, userinfo-looking paths.
// The auth pages and the API routes are never a destination (a redirect back to /sign-in or into /api would loop or act).

const FORBIDDEN_TARGET = /^\/(?:api|v1|sign-in|sign-up|forgot-password|verify-email|reset-password)(?:[/?]|$)/i

export function safeNext(raw: unknown, fallback = "/"): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2000) return fallback
  if (raw[0] !== "/" || raw[1] === "/" || raw[1] === "\\") return fallback
  if (/[\\\u0000- \u007f-\u009f]/.test(raw)) return fallback // backslash, control characters, spaces
  if (/%(?:2f|5c|2e|09|0a|0d|00)/i.test(raw.split("?")[0] ?? "")) return fallback // escaped slash, backslash, dot, tab, newline, nul in the PATH
  let u: URL
  try {
    u = new URL(raw, "http://od.invalid")
  } catch {
    return fallback
  }
  if (u.origin !== "http://od.invalid") return fallback
  const out = `${u.pathname}${u.search}`
  if (!out.startsWith("/") || out.startsWith("//") || out.includes("\\")) return fallback
  if (FORBIDDEN_TARGET.test(out)) return fallback
  return out
}
