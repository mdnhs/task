// Where a billing link may lead (B6 T6.5, T6.4 carry-in 1). The API returns a hosted checkout, portal or invoice URL and the browser follows it, so a wrong or
// tampered answer must not become an open redirect: only an https URL on one of the payment provider's own hosts, or a same-origin path, is allowed.
// PROVIDER_REDIRECT_HOSTS is the ONLY place to add a host (a new payment method in FR-M0-14 adds its own here). Hosts match exactly: no sub-domains, no
// trailing or leading look-alikes, no credentials, no custom port.
export const PROVIDER_REDIRECT_HOSTS: readonly string[] = ["checkout.stripe.com", "billing.stripe.com", "invoice.stripe.com", "pay.stripe.com"]

/** A same-origin path: starts with one slash, not `//` or `/\`, and has no whitespace, backslash or control character. */
const isSamePath = (u: string): boolean => /^\/(?![/\\])[^\s\\\u0000-\u001f]*$/.test(u)

export function isAllowedRedirect(url: unknown): url is string {
  if (typeof url !== "string" || url === "") return false
  if (isSamePath(url)) return true
  if (/[\s\\\u0000-\u001f]/.test(url)) return false
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  return u.protocol === "https:" && u.username === "" && u.password === "" && u.port === "" && PROVIDER_REDIRECT_HOSTS.includes(u.hostname)
}
