// The cookies the web may replay to the API (B6 ruling I6). An allow-list, never a deny-list: anything else (the web's own `od-*` cookies,
// analytics, a cookie set by a sibling subdomain) stays home. Pure: works on header strings, so the BFF and apiServer share it and tests need no Next.

/** Better Auth's session cookies (the prefix `__Secure-` is added over https) and the signed device-binding cookie (`__Host-` over https). */
const BETTER_AUTH = /^(?:__Secure-)?better-auth\.[A-Za-z0-9_.-]+$/
const DEVICE_HOST = /^__Host-od-device-[0-9a-f]{8}$/
/** Plain-http development and e2e: the API sets the device cookie without the `__Host-` prefix (which needs Secure). Never accepted in production. */
const DEVICE_PLAIN = /^od-device-[0-9a-f]{8}$/

export function isForwardedCookie(name: string, o: { production?: boolean } = {}): boolean {
  const production = o.production ?? process.env.NODE_ENV === "production"
  return BETTER_AUTH.test(name) || DEVICE_HOST.test(name) || (!production && DEVICE_PLAIN.test(name))
}

function parse(header: string | null | undefined): [name: string, raw: string][] {
  if (!header) return []
  const out: [string, string][] = []
  for (const part of header.split(";")) {
    const i = part.indexOf("=")
    if (i <= 0) continue
    const name = part.slice(0, i).trim()
    if (name) out.push([name, part.slice(i + 1).trim()])
  }
  return out
}

/** The `Cookie` header to send upstream: only allow-listed cookies, values unchanged, original order. Empty string when none. */
export function allowedCookieHeader(header: string | null | undefined): string {
  return parse(header)
    .filter(([name]) => isForwardedCookie(name))
    .map(([name, raw]) => `${name}=${raw}`)
    .join("; ")
}

/** `name=value` pairs (from a cookie store) filtered the same way. */
export function allowedCookiePairs(all: { name: string; value: string }[]): string {
  return all.filter((c) => isForwardedCookie(c.name)).map((c) => `${c.name}=${c.value}`).join("; ")
}

/** One cookie's raw value (first occurrence wins, nothing decoded), or null. */
export function cookieValue(header: string | null | undefined, name: string): string | null {
  return parse(header).find(([n]) => n === name)?.[1] ?? null
}
