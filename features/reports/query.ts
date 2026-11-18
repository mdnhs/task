// The inbox query for the URL filters (pure: shared by the server loader and the "Load more" button in the browser).
import type { Req } from "@/lib/api/client"
import { REPORT_PAGE_SIZE, type ReportFilters } from "./types"

export type InboxQuery = NonNullable<Req<"/v1/shift-reports", "get">["query"]>
type InboxStatus = NonNullable<InboxQuery["status"]>

type Team = { id: string; name: string }

/** The inbox query for the URL filters: the team is sent by its id (the screen shows its name), `all` filters are left out. A team name the list does not know is dropped. */
export function inboxQuery(f: Partial<ReportFilters>, teams: Team[], o: { cursor?: string; limit?: number } = {}): InboxQuery {
  const team = f.team && f.team !== "all" ? teams.find((t) => t.name === f.team)?.id : undefined
  return {
    ...(f.from ? { from: f.from } : {}),
    ...(f.to ? { to: f.to } : {}),
    ...(team ? { team } : {}),
    ...(f.person && f.person !== "all" ? { person: f.person } : {}),
    ...(f.status && f.status !== "all" ? { status: f.status as InboxStatus } : {}),
    limit: o.limit ?? REPORT_PAGE_SIZE,
    ...(o.cursor ? { cursor: o.cursor } : {}),
  }
}
