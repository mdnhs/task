// Server env of the web app (B6 ruling I4). Read at CALL time, never at import: tests stub it, and a missing value fails the request, not the build.
// Neither value is ever `NEXT_PUBLIC_*`: scripts/check-bundle.mjs greps the client bundle for API_URL after every build.

/** Where server code reaches the API (internal address), without a trailing slash. Throws when unset. */
export function apiUrl(): string {
  const v = process.env.API_URL?.trim()
  if (!v) throw new Error("API_URL is not set")
  return v.replace(/\/+$/, "")
}

/** The public web origin (scheme://host[:port]): what the browser's Origin must equal, and what the API's APP_URL is. `null` when it cannot be known. */
export function appOrigin(): string | null {
  const v = process.env.APP_ORIGIN?.trim()
  if (!v) return null
  try {
    const u = new URL(v)
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null
  } catch {
    return null
  }
}
