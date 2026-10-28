import { getData } from "@/lib/data"
import type { AuditEvent } from "./types"

// Newest first.
export async function getAuditEvents() {
  const { events } = await getData<{ events: AuditEvent[] }>("audit/events.json")
  return [...events].sort((a, b) => b.at.localeCompare(a.at))
}
