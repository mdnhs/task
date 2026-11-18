import { and, count, eq, notInArray, sql } from "drizzle-orm"
import { memberships, subscriptions, tenants, tenantSettings } from "../../db/schema"
import type { Deps } from "../../deps"
import { Conflict, Forbidden, Unauthorized } from "../../core/errors"
import { publish } from "../../core/events"
import { recordAudit } from "../audit"
import { entitlementsData, planFacts } from "../entitlements/data"
import { onboardingDefaults } from "./defaults"
import { seedRoleTemplates } from "./seed"

export const DEFAULT_INVITE_TTL_DAYS = 7
const DAY_MS = 86_400_000

const TENANT_CREATE_LOCK_NS = 0x74637265 // "tcre": serialises one user's tenant creations so the cap cannot be raced past
/** Tenants in these states no longer count towards a user's cap. Not produced yet (only active/suspended exist); listed for forward compatibility. */
const GONE = ["deleted", "erased"]

export type NewTenant = { name: string; slug: string; timezone?: string; currency?: string; locale?: string }
/** The caller's second-factor state. Omitted only by trusted internal callers (the demo seed), which skip the cap and the MFA rule. */
export type CreateGate = { twoFactorEnabled: boolean; mfaPassed: boolean }

/** Creates the tenant, its role templates, the caller's owner membership, default settings and the audit entry in ONE transaction. */
export async function createTenant(deps: Deps, userId: string, input: NewTenant, gate?: CreateGate): Promise<{ id: string; slug: string }> {
  const d = onboardingDefaults()
  try {
    return await deps.db.transaction(async (tx) => {
      if (gate) {
        // Per-user lock first: the count and the insert are one critical section, so two concurrent creates cannot both pass the cap.
        await tx.execute(sql`select pg_advisory_xact_lock(${TENANT_CREATE_LOCK_NS}::int, hashtext(${userId}::text))`)
        const [{ n }] = await tx.select({ n: count() }).from(tenants).where(and(eq(tenants.createdBy, userId), notInArray(tenants.status, GONE)))
        // The first tenant is exempt from MFA (sign-up has nothing to enrol into yet); every later one needs a second-factor session (same codes as enforceMfa).
        if (n >= 1) {
          if (!gate.twoFactorEnabled) throw Unauthorized("mfa_enrolment_required")
          if (!gate.mfaPassed) throw Unauthorized("mfa_challenge")
        }
        if (n >= deps.env.TENANT_CREATE_MAX_PER_USER) throw Forbidden("tenant_limit_reached")
      }
      const [t] = await tx
        .insert(tenants)
        .values({
          slug: input.slug,
          name: input.name,
          createdBy: userId,
          timezone: input.timezone ?? d.timezone,
          locale: input.locale ?? d.locale,
          // currency: the column default (EUR, R7) unless given
          ...(input.currency ? { currency: input.currency } : {}),
        })
        .returning()
      await tx.execute(sql`select set_config('app.tenant_id', ${t.id}, true)`)
      const roleIds = await seedRoleTemplates(tx, t.id)
      const now = deps.clock.now()
      await tx.insert(memberships).values({ tenantId: t.id, userId, roleId: roleIds.get("owner")!, joinedAt: now })
      await tx.insert(tenantSettings).values({ tenantId: t.id, key: "invite_ttl_days", value: DEFAULT_INVITE_TTL_DAYS })
      // Every tenant starts a trial on the default plan (billing/entitlements.json) for that plan's trialDays (billing/plans.json).
      const plan = planFacts(entitlementsData().defaultPlan)
      await tx.insert(subscriptions).values({
        tenantId: t.id, planId: plan.id, status: "trialing", seats: plan.limits.activeUsers ?? 0, trialEndsAt: new Date(now.getTime() + plan.trialDays * DAY_MS),
      })
      await recordAudit(
        tx,
        t.id,
        {
          action: "tenant.created",
          entity: "tenant",
          entityId: t.id,
          actorId: userId,
          before: null,
          after: { slug: t.slug, name: t.name, timezone: t.timezone, currency: t.currency, locale: t.locale },
        },
        now,
      )
      // The founding owner is a member too: lets subscribers (search index) see them like any joiner. Publish stays last.
      await publish(tx, { tenantId: t.id, type: "member.joined", payload: { userId, roleKey: "owner" }, actorId: userId }, now)
      return { id: t.id, slug: t.slug }
    })
  } catch (err) {
    // drizzle wraps the pg error (R9): the SQLSTATE is on .cause
    if ((err as { cause?: { code?: string } }).cause?.code === "23505") throw Conflict("slug_taken")
    throw err
  }
}

export async function tenantName(deps: Deps, tenantId: string): Promise<{ name: string; slug: string }> {
  const [t] = await deps.db.select({ name: tenants.name, slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId))
  return t
}
