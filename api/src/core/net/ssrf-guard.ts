import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

/**
 * SSRF guard for tenant-supplied webhook URLs (T3.6). Used at create/PATCH AND at every delivery (DNS is re-resolved each
 * time, and the connection is then pinned to the vetted address, see pinned-request.ts).
 *
 * Rejected when ANY resolved address is non-public (fail closed: an unparsable address, no address, or a DNS error all refuse):
 *  IPv4: 0.0.0.0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.0.0/24, 192.168/16, 198.18/15, 224/4, 240/4 (incl. 255.255.255.255)
 *  IPv6: ::/96 (:: ::1 and the deprecated IPv4-compatible form), fc00::/7, fe80::/10, fec0::/10, ff00::/8, Teredo 2001::/32,
 *        and the IPv4 embedded in IPv4-mapped (::ffff:a.b.c.d), SIIT (::ffff:0:a.b.c.d), NAT64 (64:ff9b::/96; 64:ff9b:1::/48 outright)
 *        and 6to4 (2002::/16) forms is judged by the IPv4 rules.
 * IP-literal hosts are judged without DNS. The WHATWG URL parser normalises decimal (2130706433), octal (0177.0.0.1),
 * hex (0x7f000001) and short (127.1) IPv4 forms to dotted decimal, so the literal check sees the real address.
 */

export type Resolved = { address: string; family: number }
export type Resolver = (host: string) => Promise<Resolved[]>
export class WebhookUrlError extends Error {
  /** `resolve_timeout` is internal: create/PATCH report it as unsafe_webhook_url, a delivery treats it as a retryable network error. */
  constructor(public code: "invalid_webhook_url" | "unsafe_webhook_url" | "resolve_timeout") {
    super(code)
  }
}

export const MAX_URL_LENGTH = 2048
/** Default DNS resolver (all A/AAAA records, in resolver order). */
export const systemResolver: Resolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => ({ address: a.address, family: a.family }))

function parseV4(s: string): number[] | null {
  if (isIP(s) !== 4) return null
  return s.split(".").map(Number)
}

function parseV6(s: string): number[] | null {
  if (s.includes("%") || isIP(s) !== 6) return null
  let head = s
  let tail = ""
  const dbl = s.indexOf("::")
  if (dbl >= 0) {
    head = s.slice(0, dbl)
    tail = s.slice(dbl + 2)
  }
  const toGroups = (part: string): number[] | null => {
    if (part === "") return []
    const out: number[] = []
    const items = part.split(":")
    for (let i = 0; i < items.length; i++) {
      if (items[i].includes(".")) {
        if (i !== items.length - 1) return null
        const v4 = parseV4(items[i])
        if (!v4) return null
        out.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3])
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(items[i])) return null
        out.push(parseInt(items[i], 16))
      }
    }
    return out
  }
  const h = toGroups(head)
  const t = toGroups(tail)
  if (!h || !t) return null
  if (dbl < 0) return h.length === 8 ? h : null
  const fill = 8 - h.length - t.length
  if (fill < 1) return null
  return [...h, ...Array<number>(fill).fill(0), ...t]
}

function blockedV4([a, b, c]: number[]): boolean {
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 || // 0/8, 10/8, 127/8, 224/4 + 240/4 (+ 255.255.255.255)
    (a === 100 && b >= 64 && b <= 127) || // 100.64/10
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) || // 192.0.0/24
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) // 198.18/15
  )
}

const v4Of = (hi: number, lo: number) => [hi >> 8, hi & 255, lo >> 8, lo & 255]

/** True when the address must not be contacted. Anything that is not a plain IP literal is blocked (fail closed). */
export function isBlockedIp(ip: string): boolean {
  const v4 = parseV4(ip)
  if (v4) return blockedV4(v4)
  const g = parseV6(ip)
  if (!g) return true
  const zero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0)
  if (zero(0, 6)) return true // ::/96: ::, ::1, IPv4-compatible
  if (zero(0, 5) && g[5] === 0xffff) return blockedV4(v4Of(g[6], g[7])) // IPv4-mapped
  if (zero(0, 4) && g[4] === 0xffff && g[5] === 0) return blockedV4(v4Of(g[6], g[7])) // SIIT
  if (g[0] === 0x64 && g[1] === 0xff9b) {
    if (zero(2, 6)) return blockedV4(v4Of(g[6], g[7])) // NAT64 well-known prefix
    if (g[2] === 1) return true // 64:ff9b:1::/48 local-use NAT64
  }
  if (g[0] === 0x2002) return blockedV4(v4Of(g[1], g[2])) // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true // Teredo
  return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0 || (g[0] & 0xff00) === 0xff00
}

/** The shape rules: https, <= 2048 characters, no userinfo, port 443 (default) or 1024-65535. */
export function parseWebhookUrl(raw: unknown): URL {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_URL_LENGTH) throw new WebhookUrlError("invalid_webhook_url")
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new WebhookUrlError("invalid_webhook_url")
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.hostname === "") throw new WebhookUrlError("invalid_webhook_url")
  if (url.port !== "") {
    const p = Number(url.port)
    if (p !== 443 && (p < 1024 || p > 65535)) throw new WebhookUrlError("invalid_webhook_url")
  }
  return url
}

/**
 * Parses and vets the URL: shape rules (422 invalid_webhook_url) then address rules (422 unsafe_webhook_url). Returns the
 * vetted addresses; the caller must connect to one of THESE (pinned), never re-resolve between check and connect.
 */
export const RESOLVE_TIMEOUT_MS = 5_000

export async function assertSafeUrl(raw: unknown, resolve: Resolver, timeoutMs: number = RESOLVE_TIMEOUT_MS): Promise<{ url: URL; addresses: Resolved[] }> {
  const url = parseWebhookUrl(raw)
  const host = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname
  const family = isIP(host)
  if (family !== 0) {
    if (isBlockedIp(host)) throw new WebhookUrlError("unsafe_webhook_url")
    return { url, addresses: [{ address: host, family }] }
  }
  const lower = host.toLowerCase().replace(/\.$/, "")
  if (lower === "localhost" || lower.endsWith(".localhost")) throw new WebhookUrlError("unsafe_webhook_url")
  let addresses: Resolved[]
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    addresses = await Promise.race([
      resolve(host),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new WebhookUrlError("resolve_timeout")), timeoutMs)
      }),
    ])
  } catch (err) {
    if (err instanceof WebhookUrlError) throw err
    throw new WebhookUrlError("unsafe_webhook_url") // never leak the resolver error
  } finally {
    clearTimeout(timer)
  }
  if (addresses.length === 0 || addresses.some((a) => isBlockedIp(a.address))) throw new WebhookUrlError("unsafe_webhook_url")
  return { url, addresses }
}
