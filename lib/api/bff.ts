// The BFF boundary (B6 rulings I4-I6, I21, I22): the browser talks only to same-origin /v1/* and /api/auth/* route handlers, which call forwardToApi.
// Everything the API trusts is set HERE from server-side facts; nothing a browser sends can name a tenant, a bearer key or a cookie.
// Pure on Request/Response (no next/headers) so it is unit-tested with a fake fetch.
import { appOrigin, apiUrl } from "./config"
import { allowedCookieHeader, cookieValue } from "./cookies"
import { problemResponse } from "./problem"
import { PAGE_TENANT_HEADER, TENANT_COOKIE, TENANT_HEADER, isTenantSlug } from "./tenant"
import { violatesSameOrigin } from "../csrf"

export type BffOptions = {
  prefix: "/v1" | "/api/auth"
  /** Paths (the URL pathname) that are a 404 even though they are under the prefix. */
  deny?: RegExp
}

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"])
export const MAX_BODY_BYTES = 2 * 1024 * 1024
export const UPSTREAM_TIMEOUT_MS = 30_000

/**
 * Always refused, whatever the route handler passes: /list-sessions returns raw session tokens (B1 follow-up; the safe list is GET /v1/me/sessions) and
 * /get-session returns the current session row INCLUDING its token (the app asks GET /v1/me instead). Neither token may be readable by page JS.
 */
const ALWAYS_DENIED: Record<BffOptions["prefix"], RegExp[]> = { "/v1": [], "/api/auth": [/^\/api\/auth\/(?:list-sessions|get-session)\/?$/i] }

// Request headers that never cross: identity the browser must not choose, hop-by-hop headers, and the ones rebuilt below.
const DROP_EXACT = new Set([
  "host", "authorization", "cookie", "x-tenant", "origin", "referer", "x-request-id", "forwarded", "x-real-ip",
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade", "content-length", "accept-encoding",
])
const dropRequestHeader = (name: string) => DROP_EXACT.has(name) || name.startsWith("x-od-") || (name.startsWith("x-forwarded-") && name !== "x-forwarded-for") || name.startsWith("x-middleware-") || name.startsWith("x-nextjs-")

const DROP_RESPONSE = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "content-encoding", "content-length", "x-powered-by", "server", "set-cookie"])

const REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/

/** The path is exactly /<prefix>/... with nothing the API (or a proxy in between) could read differently: no dot segments (raw or encoded), no `//`, no encoded slash or backslash, no control characters. */
function pathAllowed(pathname: string, prefix: string): boolean {
  if (!pathname.startsWith(`${prefix}/`) || pathname.length === prefix.length + 1) return false
  if (pathname.includes("//") || /[\\\u0000-\u001f\u007f]/.test(pathname)) return false
  if (/%2f|%5c|%00/i.test(pathname)) return false
  // Better Auth's endpoints are plain ASCII words: nothing there needs a percent escape (tokens travel in the query or the body). A path with one is
  // an attempt to spell a denied route differently (M1: /api/auth/list-%73essions), so it is refused outright.
  if (prefix === "/api/auth" && pathname.includes("%")) return false
  for (const seg of pathname.split("/")) {
    let decoded: string
    try {
      decoded = decodeURIComponent(seg)
    } catch {
      return false
    }
    if (decoded === "." || decoded === "..") return false
  }
  return true
}

/** The path the deny rules see: each segment decoded, lower-cased, empty segments and a trailing slash dropped. Undecodable paths are refused earlier. */
function canonicalPath(pathname: string): string {
  const segs = pathname.split("/").filter(Boolean).map((seg) => {
    try {
      return decodeURIComponent(seg).toLowerCase()
    } catch {
      return seg.toLowerCase()
    }
  })
  return `/${segs.join("/")}`
}

/** Session-token fields Better Auth puts in its JSON answers (sign-in and sign-up return the raw `token`). Page JS must never see one (I21, K3). */
const TOKEN_KEY = /^(?:session[_-]?)?token$/i

function dropTokens(v: unknown): { value: unknown; changed: boolean } {
  if (Array.isArray(v)) {
    let changed = false
    const out = v.map((x) => {
      const r = dropTokens(x)
      changed ||= r.changed
      return r.value
    })
    return { value: changed ? out : v, changed }
  }
  if (v && typeof v === "object") {
    let changed = false
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (TOKEN_KEY.test(k)) {
        changed = true
        continue
      }
      const r = dropTokens(x)
      changed ||= r.changed
      out[k] = r.value
    }
    return { value: changed ? out : v, changed }
  }
  return { value: v, changed: false }
}

class TooLarge extends Error {}

/** Reads the body incrementally and stops at the cap, so an endless stream cannot fill memory. Undefined when there is no body. */
async function readCapped(req: Request): Promise<Uint8Array | undefined> {
  if (!req.body) return undefined
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {})
      throw new TooLarge()
    }
    chunks.push(value)
  }
  if (total === 0) return undefined
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.byteLength
  }
  return out
}

const refuse = (status: number, code: string, title: string) => problemResponse(status, code, title)

export async function forwardToApi(req: Request, o: BffOptions): Promise<Response> {
  if (!METHODS.has(req.method)) return problemResponse(405, "method_not_allowed", "Method Not Allowed", undefined, { allow: [...METHODS].join(", ") })

  let url: URL
  try {
    url = new URL(req.url)
  } catch {
    return refuse(400, "bad_request", "Bad Request")
  }
  const { pathname } = url
  const canonical = canonicalPath(pathname)
  const denied = (re: RegExp) => re.test(pathname) || re.test(canonical)
  if (!pathAllowed(pathname, o.prefix) || ALWAYS_DENIED[o.prefix].some(denied) || (o.deny !== undefined && denied(o.deny))) return refuse(404, "not_found", "Not Found")

  let base: string
  try {
    base = apiUrl()
  } catch {
    return refuse(500, "internal", "Internal Server Error") // misconfiguration: no detail to the browser
  }

  const isWrite = req.method !== "GET"
  const production = process.env.NODE_ENV === "production"
  const origin = appOrigin() ?? (production ? null : url.origin) // dev only: the page's own origin
  if (isWrite) {
    if (origin === null) return refuse(500, "internal", "Internal Server Error")
    if (violatesSameOrigin(req.headers, { origin })) return refuse(403, "bad_origin", "Forbidden")
  }

  // The active tenant is the httpOnly cookie, nothing else. The page's own tenant (x-od-tenant) is only compared with it.
  const cookieHeader = req.headers.get("cookie")
  const rawSlug = cookieValue(cookieHeader, TENANT_COOKIE)
  const slug = isTenantSlug(rawSlug) ? rawSlug : null
  const pageTenant = req.headers.get(PAGE_TENANT_HEADER)
  if (pageTenant !== null && pageTenant !== slug) return refuse(409, "tenant_changed", "Conflict")

  let body: Uint8Array | undefined
  if (isWrite) {
    const declared = Number(req.headers.get("content-length") ?? "0")
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return refuse(413, "payload_too_large", "Payload Too Large")
    try {
      body = await readCapped(req)
    } catch (e) {
      if (e instanceof TooLarge) return refuse(413, "payload_too_large", "Payload Too Large")
      return refuse(400, "bad_request", "Bad Request")
    }
  }

  const headers = new Headers()
  for (const [name, value] of req.headers) if (!dropRequestHeader(name)) headers.set(name, value)
  const cookie = allowedCookieHeader(cookieHeader)
  if (cookie) headers.set("cookie", cookie)
  if (slug) headers.set(TENANT_HEADER, slug)
  if (isWrite && origin) headers.set("origin", origin)
  const clientId = req.headers.get("x-request-id")
  headers.set("x-request-id", clientId && REQUEST_ID.test(clientId) ? clientId : crypto.randomUUID())

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DOMException("upstream timeout", "TimeoutError")), UPSTREAM_TIMEOUT_MS)
  const onClientGone = () => controller.abort(req.signal.reason)
  if (req.signal.aborted) onClientGone()
  else req.signal.addEventListener("abort", onClientGone, { once: true })

  let res: Response
  try {
    res = await fetch(`${base}${pathname}${url.search}`, { method: req.method, headers, body: body as BodyInit | undefined, redirect: "manual", cache: "no-store", signal: controller.signal })
  } catch {
    return refuse(502, "upstream_unavailable", "Bad Gateway") // unreachable, refused, timed out: no upstream text, a new request id
  } finally {
    clearTimeout(timer)
    req.signal.removeEventListener("abort", onClientGone)
  }

  const isProblem = /application\/problem\+json/i.test(res.headers.get("content-type") ?? "")
  if (res.status === 502 || (res.status >= 500 && !isProblem)) {
    await res.body?.cancel().catch(() => {})
    return refuse(502, "upstream_unavailable", "Bad Gateway")
  }

  const out = new Headers()
  for (const [name, value] of res.headers) if (!DROP_RESPONSE.has(name)) out.set(name, value)
  for (const c of res.headers.getSetCookie()) {
    if (c.slice(0, c.indexOf("=")).trim() === TENANT_COOKIE) continue // the tenant cookie is the web's own; the API never sets it
    out.append("set-cookie", c)
  }
  if (!out.has("cache-control")) out.set("cache-control", "no-store")
  // Better Auth's JSON answers carry the raw session token; the cookie (signed, httpOnly) is the only copy the browser may hold. Rewrite only /api/auth
  // JSON bodies that really contain one (anything else, problem+json included, passes untouched); content-length is dropped above, so the new body is framed fresh.
  if (o.prefix === "/api/auth" && ![204, 205, 304].includes(res.status) && /^application\/json\b/i.test(res.headers.get("content-type") ?? "")) {
    const text = await res.text()
    try {
      const r = dropTokens(JSON.parse(text))
      if (r.changed) return new Response(JSON.stringify(r.value), { status: res.status, headers: out })
    } catch {
      /* not JSON after all: pass it on as it came */
    }
    return new Response(text, { status: res.status, headers: out })
  }
  return new Response(res.body, { status: res.status, headers: out })
}
