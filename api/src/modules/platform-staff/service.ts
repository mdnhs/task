import { and, asc, eq, ne, sql } from "drizzle-orm"
import { z } from "zod"
import { AppError, Conflict, NotFound } from "../../core/errors"
import type { PlatformRole } from "../../core/context"
import type { Db } from "../../db/client"
import { platformStaff, user } from "../../db/schema"
import { PLATFORM_LOCK_NS, PLATFORM_STAFF_LOCK } from "../platform-audit/chain"
import { recordPlatformAudit, type PlatformTx } from "../platform-audit/record"

export const PLATFORM_ROLES = ["owner", "support", "billing", "viewer"] as const
export const PLATFORM_STATUSES = ["active", "suspended"] as const
export type StaffStatus = (typeof PLATFORM_STATUSES)[number]
export type StaffMember = { userId: string; name: string; email: string; role: PlatformRole; status: StaffStatus; twoFactorEnabled: boolean; addedBy: string; addedAt: Date }

/** Serialises every change to platform_staff (last-owner checks). Taken BEFORE the audit lock. */
export const lockStaff = (tx: PlatformTx) => tx.execute(sql`select pg_advisory_xact_lock(${PLATFORM_LOCK_NS}::int4, ${PLATFORM_STAFF_LOCK}::int4)`)

const email = z.email()

export async function listStaff(db: Db): Promise<StaffMember[]> {
  const rows = await db
    .select({ userId: platformStaff.userId, name: user.name, email: user.email, role: platformStaff.role, status: platformStaff.status, twoFactorEnabled: user.twoFactorEnabled, addedBy: platformStaff.addedBy, addedAt: platformStaff.addedAt })
    .from(platformStaff)
    .innerJoin(user, eq(user.id, platformStaff.userId))
    .orderBy(asc(platformStaff.addedAt), asc(platformStaff.userId))
  return rows.map((r) => ({ ...r, role: r.role as PlatformRole, status: r.status as StaffStatus, twoFactorEnabled: r.twoFactorEnabled === true }))
}

const snap = (r: { role: string; status: string }) => ({ role: r.role, status: r.status })

/** Adds an existing, non-erased user as staff. Audit entries carry the user id, never the address. */
export async function addStaff(db: Db, now: Date, actorId: string, input: { email: string; role: PlatformRole }): Promise<{ userId: string }> {
  const addr = input.email.trim().toLowerCase()
  if (!email.safeParse(addr).success) throw new AppError(422, "user_not_found", "Unprocessable Entity")
  return db.transaction(async (tx) => {
    await lockStaff(tx)
    const [u] = await tx.select({ id: user.id, erasedAt: user.erasedAt }).from(user).where(eq(user.email, addr))
    if (!u || u.erasedAt) throw new AppError(422, "user_not_found", "Unprocessable Entity")
    const [existing] = await tx.select({ userId: platformStaff.userId }).from(platformStaff).where(eq(platformStaff.userId, u.id))
    if (existing) throw Conflict("already_staff")
    await tx.insert(platformStaff).values({ userId: u.id, role: input.role, status: "active", addedBy: actorId, addedAt: now })
    await recordPlatformAudit(tx, { action: "platform.staff.added", entity: "platform_staff", entityId: u.id, actorId, before: null, after: { role: input.role, status: "active" } }, now)
    return { userId: u.id }
  })
}

/** Changes role and/or status. The last active owner can be neither demoted nor suspended (409 last_platform_owner). */
export async function updateStaff(db: Db, now: Date, actorId: string, userId: string, patch: { role?: PlatformRole; status?: StaffStatus }): Promise<void> {
  await db.transaction(async (tx) => {
    await lockStaff(tx)
    const [cur] = await tx.select().from(platformStaff).where(eq(platformStaff.userId, userId))
    if (!cur) throw NotFound()
    const next = { role: patch.role ?? cur.role, status: patch.status ?? cur.status }
    if (next.role === cur.role && next.status === cur.status) return
    const leavingOwner = cur.role === "owner" && cur.status === "active" && (next.role !== "owner" || next.status !== "active")
    if (leavingOwner) {
      const others = await tx
        .select({ userId: platformStaff.userId })
        .from(platformStaff)
        .where(and(eq(platformStaff.role, "owner"), eq(platformStaff.status, "active"), ne(platformStaff.userId, userId)))
        .limit(1)
      if (others.length === 0) throw Conflict("last_platform_owner")
    }
    await tx.update(platformStaff).set(next).where(eq(platformStaff.userId, userId))
    await recordPlatformAudit(tx, { action: "platform.staff.updated", entity: "platform_staff", entityId: userId, actorId, before: snap(cur), after: next }, now)
  })
}
