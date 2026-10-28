import { daysBetween } from "@/lib/dates"

// "in 12 days", "today", "3 days ago" (FR-EFILE expiry wording). null expiry means there is no document.
export function expiryLabel(expiry: string | null, today: string): string {
  if (!expiry) return "No expiry"
  const n = daysBetween(expiry, today)
  if (n === 0) return "today"
  if (n === 1) return "in 1 day"
  if (n > 1) return `in ${n} days`
  return n === -1 ? "1 day ago" : `${-n} days ago`
}

/** Status a document takes once a reviewer confirms it: lapsed dates stay expired, dates within 60 days are flagged. */
export function statusAfterConfirm(expiry: string | null, today: string): "valid" | "expiring" | "expired" {
  if (!expiry) return "valid"
  const n = daysBetween(expiry, today)
  return n < 0 ? "expired" : n <= 60 ? "expiring" : "valid"
}
