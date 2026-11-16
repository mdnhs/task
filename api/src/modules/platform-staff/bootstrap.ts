import { eq } from "drizzle-orm"
import type { Db } from "../../db/client"
import { platformStaff, user } from "../../db/schema"
import { recordPlatformAudit } from "../platform-audit/record"
import { lockStaff } from "./service"

export const CLI_ACTOR = "system:cli"

/** Why bootstrapping an owner was refused. `code` is safe to print and log. */
export class BootstrapError extends Error {
  constructor(public code: "user_not_found" | "email_not_verified" | "two_factor_required" | "user_erased") {
    super(code)
  }
}

/**
 * First-owner bootstrap (CLI only, never an HTTP route): only for an EXISTING, email-verified, 2FA-enrolled, non-erased
 * user. Idempotent: an active owner is left untouched (no second audit entry); another role or a suspended row is promoted.
 */
export async function createPlatformOwner(db: Db, now: Date, rawEmail: string): Promise<{ userId: string; outcome: "created" | "promoted" | "unchanged" }> {
  const addr = rawEmail.trim().toLowerCase()
  return db.transaction(async (tx) => {
    await lockStaff(tx)
    const [u] = await tx.select({ id: user.id, verified: user.emailVerified, tfa: user.twoFactorEnabled, erasedAt: user.erasedAt }).from(user).where(eq(user.email, addr))
    if (!u) throw new BootstrapError("user_not_found")
    if (u.erasedAt) throw new BootstrapError("user_erased")
    if (!u.verified) throw new BootstrapError("email_not_verified")
    if (u.tfa !== true) throw new BootstrapError("two_factor_required")
    const [cur] = await tx.select().from(platformStaff).where(eq(platformStaff.userId, u.id))
    if (cur?.role === "owner" && cur.status === "active") return { userId: u.id, outcome: "unchanged" as const }
    if (cur) await tx.update(platformStaff).set({ role: "owner", status: "active" }).where(eq(platformStaff.userId, u.id))
    else await tx.insert(platformStaff).values({ userId: u.id, role: "owner", status: "active", addedBy: CLI_ACTOR, addedAt: now })
    await recordPlatformAudit(
      tx,
      { action: "platform.staff.owner_bootstrapped", entity: "platform_staff", entityId: u.id, actorId: CLI_ACTOR, before: cur ? { role: cur.role, status: cur.status } : null, after: { role: "owner", status: "active" } },
      now,
    )
    return { userId: u.id, outcome: cur ? ("promoted" as const) : ("created" as const) }
  })
}
