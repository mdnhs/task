import { isIP } from "node:net"

/** Used when no address can be resolved at all (no socket info and no usable header). Every such caller shares one bucket: fail safe, never a fresh bucket. */
export const UNKNOWN_IP = "unknown"

/** Strips an IPv6 bracket form and an IPv4 `:port`; returns null when the rest is not an IP address. */
function parseEntry(raw: string): string | null {
  let v = raw.trim()
  if (!v) return null
  if (v.startsWith("[")) {
    const end = v.indexOf("]")
    if (end < 0) return null
    v = v.slice(1, end)
  } else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(v)) {
    v = v.slice(0, v.lastIndexOf(":"))
  }
  const zone = v.indexOf("%")
  if (zone >= 0) v = v.slice(0, zone)
  return isIP(v) ? v.toLowerCase() : null
}

/**
 * The one reader of the caller's address (ruling S3). With `hops` = 0 the `x-forwarded-for` header is ignored and the
 * socket address is used. With `hops` = n the client is the n-th entry FROM THE RIGHT: the proxies we operate append
 * (or overwrite) on the right, so anything a client prepends sits to the left and is never read. A missing, empty or
 * non-IP entry falls back to the socket address, never to a client-chosen value.
 */
export function clientIp(headers: Headers, socketAddr: string | undefined, hops: number): string {
  const socket = socketAddr ? (parseEntry(socketAddr) ?? UNKNOWN_IP) : UNKNOWN_IP
  if (!Number.isInteger(hops) || hops <= 0) return socket
  const entries = (headers.get("x-forwarded-for") ?? "").split(",")
  const picked = entries.length >= hops ? parseEntry(entries[entries.length - hops] ?? "") : null
  return picked ?? socket
}

/**
 * The rate-limit bucket for an address. An IPv6 caller usually owns a whole /64, so one address per request would be a
 * fresh bucket each time: IPv6 collapses to its /64, IPv4-mapped IPv6 to the IPv4 address.
 */
export function ipBucket(ip: string): string {
  if (isIP(ip) !== 6) return ip
  const mapped = /^(?:0{0,4}:){0,5}ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip) ?? /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip)
  if (mapped?.[1]) return mapped[1]
  const [head = "", tail] = ip.split("::")
  const left = head ? head.split(":") : []
  const right = tail === undefined ? [] : tail ? tail.split(":") : []
  const groups = tail === undefined ? left : [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right]
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`
}
