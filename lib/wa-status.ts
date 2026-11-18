// Pure WhatsApp status rules shared by Settings -> Users and the WhatsApp feature (no store, safe on the server).
import type { PhoneValue } from "@/lib/phone"

export type WaPersonStatus = "no_number" | "pending" | "verified" | "opted_out"
export const WA_PERSON_STATUS: Record<WaPersonStatus, { tone: "ok" | "warn" | "mute" | "bad"; label: string }> = {
  verified: { tone: "ok", label: "Verified" },
  pending: { tone: "warn", label: "Pending confirmation" },
  no_number: { tone: "mute", label: "No number" },
  opted_out: { tone: "bad", label: "Opted out" },
}

/** What the people list shows: a staged number means Pending confirmation (also when a verified number was changed); a cleared one means No number. */
export function effectiveStatus(base: WaPersonStatus, staged: PhoneValue | null | undefined): WaPersonStatus {
  if (staged === undefined) return base
  return staged === null ? "no_number" : "pending"
}
