import { and, eq } from "drizzle-orm"
import { subscribe } from "../../core/events"
import { files, memberships, roles, teams, user } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { indexDocument, removeDocument } from "./service"

const str = (v: unknown): string | null => (typeof v === "string" ? v : null)

/** (Re)indexes a member by display name (never email). Module "staff": roles without staff read see no people. */
async function indexMember(tx: TenantTx, tenantId: string, userId: string, now: Date): Promise<void> {
  const [m] = await tx
    .select({ name: user.name, roleLabel: roles.label, status: memberships.status })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
  if (!m || m.status !== "active" || !m.name.trim()) return removeDocument(tx, tenantId, "member", userId)
  await indexDocument(tx, { tenantId, entity: "member", entityId: userId, module: "staff", title: m.name, body: m.roleLabel }, now)
}

async function indexTeam(tx: TenantTx, tenantId: string, teamId: string, now: Date): Promise<void> {
  const [t] = await tx.select({ name: teams.name, kind: teams.kind }).from(teams).where(and(eq(teams.id, teamId), eq(teams.tenantId, tenantId)))
  if (!t) return removeDocument(tx, tenantId, "team", teamId)
  await indexDocument(tx, { tenantId, entity: "team", entityId: teamId, module: "settings", title: t.name, body: t.kind }, now)
}

/** Only clean, live files are searchable; anything else (pending, infected, deleted, missing) drops the document. */
async function indexFile(tx: TenantTx, tenantId: string, fileId: string, now: Date): Promise<void> {
  const [f] = await tx.select({ name: files.name, status: files.status }).from(files).where(and(eq(files.id, fileId), eq(files.tenantId, tenantId)))
  if (!f || f.status !== "clean") return removeDocument(tx, tenantId, "file", fileId)
  await indexDocument(tx, { tenantId, entity: "file", entityId: fileId, module: "files", title: f.name, body: "" }, now)
}

/**
 * Registers the search indexers on the event bus. Each handler re-reads the entity in the delivery tx (RLS), so a
 * stale or replayed event converges on the current state. Call once per process (worker.ts, tests); a duplicate
 * subscriber name is ignored. Later modules (tasks, ...) add their own indexers the same way.
 */
export function registerSearchIndexers(): void {
  const on = (type: Parameters<typeof subscribe>[0], name: string, h: Parameters<typeof subscribe>[2]) => {
    try {
      subscribe(type, `search.${name}`, h)
    } catch (err) {
      if (!(err instanceof Error) || !err.message.startsWith("Duplicate event subscriber")) throw err
    }
  }
  const now = (e: { occurredAt: Date }) => e.occurredAt
  on("member.joined", "member-joined", async (e, { tx }) => { const id = str(e.payload.userId); if (id) await indexMember(tx, e.tenantId, id, now(e)) })
  on("member.role_changed", "member-role-changed", async (e, { tx }) => { const id = str(e.payload.userId); if (id) await indexMember(tx, e.tenantId, id, now(e)) })
  on("member.removed", "member-removed", async (e, { tx }) => { const id = str(e.payload.userId); if (id) await removeDocument(tx, e.tenantId, "member", id) })
  on("team.created", "team-created", async (e, { tx }) => { const id = str(e.payload.teamId); if (id) await indexTeam(tx, e.tenantId, id, now(e)) })
  on("team.updated", "team-updated", async (e, { tx }) => { const id = str(e.payload.teamId); if (id) await indexTeam(tx, e.tenantId, id, now(e)) })
  on("team.deleted", "team-deleted", async (e, { tx }) => { const id = str(e.payload.teamId); if (id) await removeDocument(tx, e.tenantId, "team", id) })
  on("file.scanned", "file-scanned", async (e, { tx }) => { const id = str(e.payload.fileId); if (id) await indexFile(tx, e.tenantId, id, now(e)) })
  on("file.deleted", "file-deleted", async (e, { tx }) => { const id = str(e.payload.fileId); if (id) await removeDocument(tx, e.tenantId, "file", id) })
}
