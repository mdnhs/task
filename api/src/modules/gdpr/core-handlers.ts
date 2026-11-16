import { and, asc, eq, ilike, or, sql } from "drizzle-orm"
import {
  auditEvents, devices, domainEvents, files, integrationConnections, invites, memberships, notificationDeliveries, notificationPreferences, notifications,
  pushTokens, reportingLines, roles, teamMembers, teams, user,
} from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { removeDocumentsForUser } from "../search"
import { registerDsrHandler } from "./registry"

/** What replaces a subject's value inside records that must stay (event payloads, request notes). */
export const ERASED = "[erased]"
const iso = (d: Date | null | undefined): string | null => d?.toISOString() ?? null
const likeEscape = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`)
const AUDIT_EXPORT_CAP = 10_000

async function subjectUser(tx: TenantTx, userId: string): Promise<{ name: string; email: string } | undefined> {
  const [u] = await tx.select({ name: user.name, email: user.email }).from(user).where(eq(user.id, userId))
  return u
}

/**
 * Replaces, inside a JSON value, every string that is the subject's email (whole or as a substring, any case) or equals
 * their name (whole value only, so a team called "Mary's team" is untouched). Pure; used on domain_events payloads.
 */
export function scrubPayload(value: unknown, email: string, name: string): { value: unknown; changed: boolean } {
  const e = email.trim().toLowerCase()
  const n = name.trim().toLowerCase()
  let changed = false
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      const l = v.toLowerCase()
      if (n && l.trim() === n) return (changed = true), ERASED
      if (e && l.includes(e)) {
        changed = true
        return v.replace(new RegExp(e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), ERASED)
      }
      return v
    }
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
    return v
  }
  const out = walk(value)
  return { value: out, changed }
}

/**
 * The built-in handlers. Each covers the tables of one area; membership removal and the global identity erasure are
 * done by the erase job itself (service.ts) after every handler ran. Export rules: only the subject's rows of THIS
 * tenant; other people appear as ids only; secrets/hashes/sealed tokens and free text that may name third parties
 * (notification bodies) are left out. Erase rules are in docs of each handler. Safe to call again (replaces).
 */
export function registerCoreDsrHandlers(): void {
  registerDsrHandler("identity", {
    async export(tx, tenantId, userId) {
      const [u] = await tx.select({ name: user.name, email: user.email, image: user.image, emailVerified: user.emailVerified, createdAt: user.createdAt }).from(user).where(eq(user.id, userId))
      const [m] = await tx
        .select({ roleKey: roles.key, roleLabel: roles.label, status: memberships.status, joinedAt: memberships.joinedAt })
        .from(memberships)
        .innerJoin(roles, eq(roles.id, memberships.roleId))
        .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
      return {
        userId,
        profile: u ? { name: u.name, email: u.email, image: u.image, emailVerified: u.emailVerified, createdAt: iso(u.createdAt) } : null,
        membership: m ? { roleKey: m.roleKey, roleLabel: m.roleLabel, status: m.status, joinedAt: iso(m.joinedAt) } : null,
      }
    },
    // The profile row is global: the erase job anonymises it only when this was the user's last membership; the
    // membership itself is removed by the job. Nothing tenant-local to do here.
    async erase() {},
  })

  registerDsrHandler("notifications", {
    async export(tx, tenantId, userId) {
      const rows = await tx.select().from(notifications).where(and(eq(notifications.tenantId, tenantId), eq(notifications.userId, userId))).orderBy(asc(notifications.createdAt), asc(notifications.id))
      const [prefs] = await tx.select().from(notificationPreferences).where(and(eq(notificationPreferences.tenantId, tenantId), eq(notificationPreferences.userId, userId)))
      const toks = await tx.select({ platform: pushTokens.platform, createdAt: pushTokens.createdAt }).from(pushTokens).where(and(eq(pushTokens.tenantId, tenantId), eq(pushTokens.userId, userId))).orderBy(asc(pushTokens.createdAt))
      return {
        // bodies are free text that can name other people (e.g. "X joined the team"), so they are not exported
        notifications: rows.map((n) => ({ id: n.id, kind: n.kind, title: n.title, link: n.link, createdAt: iso(n.createdAt), readAt: iso(n.readAt) })),
        preferences: prefs ? { channels: prefs.channels, quietStart: prefs.quietStart, quietEnd: prefs.quietEnd } : null,
        pushTokens: toks.map((t) => ({ platform: t.platform, registeredAt: iso(t.createdAt) })), // the token itself is a sealed secret
      }
    },
    // delivery rows cascade from notifications (composite FK)
    async erase(tx, tenantId, userId) {
      await tx.delete(notificationDeliveries).where(sql`${notificationDeliveries.tenantId} = ${tenantId} and ${notificationDeliveries.notificationId} in (select id from notifications where tenant_id = ${tenantId} and user_id = ${userId})`)
      await tx.delete(notifications).where(and(eq(notifications.tenantId, tenantId), eq(notifications.userId, userId)))
      await tx.delete(notificationPreferences).where(and(eq(notificationPreferences.tenantId, tenantId), eq(notificationPreferences.userId, userId)))
      await tx.delete(pushTokens).where(and(eq(pushTokens.tenantId, tenantId), eq(pushTokens.userId, userId)))
    },
  })

  registerDsrHandler("devices", {
    async export(tx, tenantId, userId) {
      const rows = await tx.select().from(devices).where(and(eq(devices.tenantId, tenantId), eq(devices.userId, userId))).orderBy(asc(devices.createdAt), asc(devices.id))
      // enrolment/binding hashes are credentials, not data about the person: never exported
      return { devices: rows.map((d) => ({ id: d.id, type: d.type, owner: d.owner, label: d.label, trusted: d.trusted, lastSeenAt: iso(d.lastSeenAt), createdAt: iso(d.createdAt) })) }
    },
    // deleted outright, with their enrolment code hash and browser binding (the audit entries keep ids only)
    async erase(tx, tenantId, userId) {
      await tx.delete(devices).where(and(eq(devices.tenantId, tenantId), eq(devices.userId, userId)))
    },
  })

  registerDsrHandler("teams", {
    async export(tx, tenantId, userId) {
      const t = await tx
        .select({ id: teams.id, name: teams.name, kind: teams.kind })
        .from(teamMembers)
        .innerJoin(teams, and(eq(teams.tenantId, teamMembers.tenantId), eq(teams.id, teamMembers.teamId)))
        .where(and(eq(teamMembers.tenantId, tenantId), eq(teamMembers.userId, userId)))
        .orderBy(asc(teams.name))
      const [line] = await tx.select({ managerId: reportingLines.managerId }).from(reportingLines).where(and(eq(reportingLines.tenantId, tenantId), eq(reportingLines.userId, userId)))
      const reports = await tx.select({ userId: reportingLines.userId }).from(reportingLines).where(and(eq(reportingLines.tenantId, tenantId), eq(reportingLines.managerId, userId))).orderBy(asc(reportingLines.userId))
      return { teams: t, managerId: line?.managerId ?? null, directReportIds: reports.map((r) => r.userId) } // other people: ids only
    },
    // their team links, their manager line and every line that names them as manager (those reports simply lose a manager)
    async erase(tx, tenantId, userId) {
      await tx.delete(teamMembers).where(and(eq(teamMembers.tenantId, tenantId), eq(teamMembers.userId, userId)))
      await tx.delete(reportingLines).where(and(eq(reportingLines.tenantId, tenantId), or(eq(reportingLines.userId, userId), eq(reportingLines.managerId, userId))))
    },
  })

  registerDsrHandler("files", {
    async export(tx, tenantId, userId) {
      const rows = await tx.select().from(files).where(and(eq(files.tenantId, tenantId), eq(files.ownerUserId, userId))).orderBy(asc(files.createdAt), asc(files.id))
      // metadata only, never contents or storage keys
      return { files: rows.map((f) => ({ id: f.id, name: f.name, mime: f.mime, sizeBytes: f.sizeBytes, status: f.status, createdAt: iso(f.createdAt) })) }
    },
    // Files are tenant business records and stay; only the person link is cut (owner_user_id -> null = erased owner).
    async erase(tx, tenantId, userId) {
      await tx.update(files).set({ ownerUserId: null }).where(and(eq(files.tenantId, tenantId), eq(files.ownerUserId, userId)))
    },
  })

  registerDsrHandler("integrations", {
    async export(tx, tenantId, userId) {
      const rows = await tx
        .select({ provider: integrationConnections.provider, status: integrationConnections.status, accountEmail: integrationConnections.accountEmail, connectedAt: integrationConnections.connectedAt })
        .from(integrationConnections)
        .where(and(eq(integrationConnections.tenantId, tenantId), eq(integrationConnections.connectedBy, userId)))
      return { connections: rows.map((c) => ({ ...c, connectedAt: iso(c.connectedAt) })) } // never the sealed token
    },
    // A connection holds a credential delegated by this person (and may carry their account email): it is removed with
    // its sealed token and must be reconnected by someone else. (oauth_states cascade with the membership.)
    async erase(tx, tenantId, userId) {
      await tx.delete(integrationConnections).where(and(eq(integrationConnections.tenantId, tenantId), eq(integrationConnections.connectedBy, userId)))
    },
  })

  registerDsrHandler("invites", {
    async export(tx, tenantId, userId) {
      const u = await subjectUser(tx, userId)
      const received = u ? await tx.select().from(invites).where(and(eq(invites.tenantId, tenantId), sql`lower(${invites.email}) = ${u.email.toLowerCase()}`)).orderBy(asc(invites.createdAt)) : []
      const sent = await tx.select({ id: invites.id, createdAt: invites.createdAt, acceptedAt: invites.acceptedAt }).from(invites).where(and(eq(invites.tenantId, tenantId), eq(invites.invitedBy, userId))).orderBy(asc(invites.createdAt))
      return {
        received: received.map((i) => ({ id: i.id, email: i.email, invitedBy: i.invitedBy, createdAt: iso(i.createdAt), expiresAt: iso(i.expiresAt), acceptedAt: iso(i.acceptedAt) })),
        sent: sent.map((i) => ({ id: i.id, createdAt: iso(i.createdAt), accepted: i.acceptedAt !== null })), // invitees' emails belong to them, not to the subject
      }
    },
    // invites addressed to the subject's email are deleted; invites THEY sent stay (the invitee's data, with `invited_by` an id)
    async erase(tx, tenantId, userId) {
      const u = await subjectUser(tx, userId)
      if (!u || u.email.startsWith("erased+")) return
      await tx.delete(invites).where(and(eq(invites.tenantId, tenantId), sql`lower(${invites.email}) = ${u.email.toLowerCase()}`))
    },
  })

  registerDsrHandler("search", {
    async export(tx, tenantId, userId) {
      const res = await tx.execute(sql`select entity, entity_id, title from search_documents where tenant_id = ${tenantId} and entity = 'member' and entity_id = ${userId}`)
      return { documents: (res.rows as { entity: string; entity_id: string; title: string }[]).map((r) => ({ entity: r.entity, entityId: r.entity_id, title: r.title })) }
    },
    async erase(tx, tenantId, userId) {
      await removeDocumentsForUser(tx, tenantId, userId)
    },
  })

  registerDsrHandler("events", {
    async export() {
      return {} // the outbox is transport, not a record about the person
    },
    /** Scrubs the subject's email/name inside this tenant's domain_events payloads (e.g. invite.created); ids and types stay. */
    async erase(tx, tenantId, userId) {
      const u = await subjectUser(tx, userId)
      if (!u || u.email.startsWith("erased+")) return
      const needles = [u.email, JSON.stringify(u.name).slice(1, -1)].filter((s) => s.trim().length > 0)
      const rows = await tx
        .select({ id: domainEvents.id, payload: domainEvents.payload })
        .from(domainEvents)
        .where(and(eq(domainEvents.tenantId, tenantId), or(...needles.map((n) => ilike(sql`${domainEvents.payload}::text`, `%${likeEscape(n)}%`)))))
      for (const r of rows) {
        const s = scrubPayload(r.payload, u.email, u.name)
        if (s.changed) await tx.update(domainEvents).set({ payload: s.value as Record<string, unknown> }).where(and(eq(domainEvents.id, r.id), eq(domainEvents.tenantId, tenantId)))
      }
    },
  })

  registerDsrHandler("audit", {
    async export(tx, tenantId, userId) {
      // what the subject DID (their own activity); before/after bodies are left out, they may hold other people's data
      const rows = await tx
        .select({ seq: auditEvents.seq, at: auditEvents.at, action: auditEvents.action, entity: auditEvents.entity, entityId: auditEvents.entityId })
        .from(auditEvents)
        .where(and(eq(auditEvents.tenantId, tenantId), eq(auditEvents.actorId, userId)))
        .orderBy(asc(auditEvents.seq))
        .limit(AUDIT_EXPORT_CAP + 1)
      return { truncated: rows.length > AUDIT_EXPORT_CAP, events: rows.slice(0, AUDIT_EXPORT_CAP).map((a) => ({ ...a, at: iso(a.at) })) }
    },
    // The audit log is append-only and hash-chained: it references people by id only and is NEVER modified. Erasing the
    // identity (name/email) is what makes those ids anonymous, and the chain keeps verifying.
    async erase() {},
  })
}
