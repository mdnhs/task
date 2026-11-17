// A tiny in-page signal: "a write just answered 402 billing_required" (B6 ruling I10). The browser client announces it; the billing banner listens and
// flips to the read-only state (and asks the page to re-read the session). Module state is per tab, like the browser client itself.
const listeners = new Set<() => void>()

export function reportBillingBlocked(): void {
  for (const l of [...listeners]) l()
}

/** Subscribes; returns the unsubscribe. */
export function onBillingBlocked(cb: () => void): () => void {
  listeners.add(cb)
  return () => void listeners.delete(cb)
}
