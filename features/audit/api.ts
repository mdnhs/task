// Server side of the audit log (B6 T6.5): the newest 1,000 entries (GET /v1/audit), with actor names from the directory. The caller needs audit:read.
import { apiServer } from "@/lib/api/server"
import { getPeople } from "@/lib/people"
import { loadAudit } from "./adapters"
import { EMPTY_FILTERS } from "./filters"
import type { AuditEvent } from "./types"

/** Actor id -> name for the people the caller can see (their report scope). Anyone else reads as the id's short form. */
export async function actorNames(): Promise<Record<string, string>> {
  const people = await getPeople().catch(() => [])
  return Object.fromEntries(people.map((p) => [p.id, p.name]))
}

export const nameFrom = (names: Record<string, string>) => (id: string) => names[id] ?? (id.length > 10 ? `${id.slice(0, 8)}…` : id)

export async function getAuditEvents(tz: string, names: Record<string, string>): Promise<AuditEvent[]> {
  return loadAudit(await apiServer(), EMPTY_FILTERS, tz, nameFrom(names))
}
