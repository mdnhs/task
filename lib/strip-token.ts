// Removes the query string (the one-time token of /verify-email and /reset-password) from the address bar without a navigation, so it does not stay in
// the history entry, a screenshot or a copied URL. The pages also send `Referrer-Policy: no-referrer`. Client only; never throws.
type Win = { location: { pathname: string; search: string }; history: { replaceState(data: unknown, unused: string, url: string): void } }

export function stripQueryFromAddressBar(w: Win | undefined = typeof window === "undefined" ? undefined : window): void {
  if (!w || !w.location.search) return
  try {
    w.history.replaceState(null, "", w.location.pathname)
  } catch {
    /* blocked: nothing more to do */
  }
}
