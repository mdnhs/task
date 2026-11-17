// CSRF rule of the web boundary (B6 ruling I6, layers 1 and 3), shared by the BFF route handlers and proxy.ts (server actions). Pure.
// A state-changing browser request must come from OUR origin: `Origin` equal to the web origin, and, when the browser sent it,
// `Sec-Fetch-Site: same-origin` (so a sibling subdomain, which is "same-site", is refused too). A missing Origin is refused: a browser
// always sends one on a POST, so its absence means a non-browser client, which has no business with the cookie-bearing BFF.

/** True when the request must be refused. `expectedOrigin` is scheme://host[:port]; `host` (the request's own host, dev only) is the fallback reference. */
export function violatesSameOrigin(headers: Headers, ref: { origin: string | null; host?: string | null }): boolean {
  const origin = headers.get("origin")
  if (origin === null || origin === "") return true
  if (ref.origin !== null) {
    if (origin !== ref.origin) return true
  } else {
    let host: string
    try {
      host = new URL(origin).host
    } catch {
      return true
    }
    if (!ref.host || host !== ref.host) return true
  }
  const site = headers.get("sec-fetch-site")
  return site !== null && site !== "same-origin"
}
