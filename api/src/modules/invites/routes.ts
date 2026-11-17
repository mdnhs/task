import { createHash, randomBytes } from "node:crypto"
import { createRoute, z } from "@hono/zod-openapi"
import { and, desc, eq, isNull } from "drizzle-orm"
import { AppError, Conflict, Forbidden, NotFound } from "../../core/errors"
import type { Deps } from "../../deps"
import { requirePermission } from "../../core/middleware/permission"
import { requireSession } from "../../core/middleware/session"
import { requireTenant } from "../../core/middleware/tenant"
import { newRouter } from "../../core/router"
import { sanitizeMailError } from "../../core/mail/sanitize"
import { invites, memberships, roles, tenants, tenantSettings, user } from "../../db/schema"
import { withTenant, type TenantTx } from "../../db/tenant-tx"
import { publish } from "../../core/events"
import { emailHmac } from "../../core/crypto/audit-hmac"
import { recordAudit } from "../audit"
import { assertSeatAvailable } from "../entitlements/service"
import { assertNoEscalation, lockActor } from "../rbac"
import { DEFAULT_INVITE_TTL_DAYS, onboardingDefaults } from "../tenants"

const DAY_MS = 86_400_000
// drizzle wraps pg errors: the code lives on .cause (R9)
const isPgError = (err: unknown, code: string) => (err as { cause?: { code?: string } })?.cause?.code === code || (err as { code?: string })?.code === code
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex")

// Token = tenant id (32 hex, not secret: it lets accept find the tenant under RLS) + 32 random bytes (base64url).
// Only sha256(token) is stored.
const TOKEN_RE = /^([0-9a-f]{32})[A-Za-z0-9_-]{43}$/
const mintToken = (tenantId: string) => tenantId.replaceAll("-", "") + randomBytes(32).toString("base64url")
const uuidFromHex = (h: string) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`

/** A resend is refused for this long after the last send (mail-flood guard: the address belongs to someone else). `created_at` is the time of the last send. */
const RESEND_COOLDOWN_MS = 60_000
/** The list is at most this long (pending invites are few; a tenant is bounded by its seats). */
const LIST_LIMIT = 200

const CreateInvite = z
  .object({ email: z.string().trim().toLowerCase().pipe(z.email()), roleId: z.uuid() })
  .openapi({ example: { email: "new.hire@example.com", roleId: "00000000-0000-4000-8000-000000000000" } })
const AcceptInvite = z.object({ token: z.string().min(1).max(256) }).openapi({ example: { token: "invite-token" } })

const createInviteRoute = createRoute({
  method: "post",
  path: "/v1/invites",
  middleware: [requireTenant, requirePermission("settings", "write")] as const,
  request: { body: { content: { "application/json": { schema: CreateInvite } }, required: true } },
  responses: {
    201: {
      description: "Invite created and emailed",
      content: { "application/json": { schema: z.object({ id: z.string(), email: z.string(), expiresAt: z.string() }) } },
    },
  },
})

const InviteIdParam = z.object({ id: z.uuid() })
// No token, no token hash, ever: the link only travels by mail. `invitedBy` is the member who vouches for the invite (the resender after a resend).
const InviteItem = z
  .object({ id: z.uuid(), email: z.string(), roleKey: z.string(), createdAt: z.string(), expiresAt: z.string(), invitedBy: z.string() })
  .openapi({ example: { id: "00000000-0000-4000-8000-000000000000", email: "new.hire@example.com", roleKey: "employee", createdAt: "2026-11-18T09:00:00.000Z", expiresAt: "2026-11-25T09:00:00.000Z", invitedBy: "usr_123" } })
const InviteList = z.object({ items: z.array(InviteItem) }).openapi({ example: { items: [] } })
const Resent = z.object({ id: z.uuid(), email: z.string(), expiresAt: z.string() }).openapi({ example: { id: "00000000-0000-4000-8000-000000000000", email: "new.hire@example.com", expiresAt: "2026-11-25T09:00:00.000Z" } })

const listInvitesRoute = createRoute({
  method: "get",
  path: "/v1/invites",
  middleware: [requireTenant, requirePermission("settings", "write")] as const,
  responses: { 200: { description: "Pending (not yet accepted) invites of the tenant, newest first, at most 200. Expired ones are listed so they can be re-sent. No token or token hash.", content: { "application/json": { schema: InviteList } } } },
})
const revokeInviteRoute = createRoute({
  method: "delete",
  path: "/v1/invites/{id}",
  middleware: [requireTenant, requirePermission("settings", "write")] as const,
  request: { params: InviteIdParam },
  responses: { 204: { description: "Revoked (audited invite.revoked); the link stops working at once. 404 invite_not_found, 409 invite_used (already accepted). Open to a read-only (blocked) tenant." } },
})
const resendInviteRoute = createRoute({
  method: "post",
  path: "/v1/invites/{id}/resend",
  middleware: [requireTenant, requirePermission("settings", "write")] as const,
  request: { params: InviteIdParam },
  responses: {
    200: { description: "A new token replaces the old one (the old link stops working), the expiry restarts and ONE mail is sent. The caller becomes the inviter of record and must be allowed to hand out the invited role (R24: 403 role_escalation). 404 invite_not_found, 409 invite_used, 422 role_not_invitable, 429 resend_too_soon (within 60 s of the last send).", content: { "application/json": { schema: Resent } } },
  },
})

const acceptRoute = createRoute({
  method: "post",
  path: "/v1/invites/accept",
  middleware: [requireSession] as const,
  request: { body: { content: { "application/json": { schema: AcceptInvite } }, required: true } },
  responses: { 200: { description: "Joined the tenant. Re-validates the inviter's CURRENT standing: a demoted, suspended or removed inviter, or an invited role above the inviter's current access, is 410 invite_invalid (nothing is written). 404 invite_not_found, 403 invite_email_mismatch, 409 invite_used | already_member | seat_limit, 410 invite_expired.", content: { "application/json": { schema: z.object({ slug: z.string() }) } } } },
})

/** Emails the invite link. A failure never fails the request (the invite exists; the admin can resend): only a sanitized error and the invite id are logged, never the token or the link. */
async function sendInviteMail(deps: Deps, tenantId: string, o: { to: string; token: string; expiresAt: Date; inviteId: string }): Promise<void> {
  const [t] = await deps.db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId))
  try {
    await deps.mailer.send({
      to: o.to,
      subject: `You are invited to ${t.name}`,
      text: `You have been invited to join ${t.name}.\n\nSign up or sign in with this email address, then accept:\n\n${deps.env.APP_URL}/invite?token=${o.token}\n\nThe link expires on ${o.expiresAt.toISOString().slice(0, 10)}.`,
    })
  } catch (err) {
    deps.logger.error({ error: sanitizeMailError(err), inviteId: o.inviteId }, "invite email send failed")
  }
}

/** The invite TTL in days: the tenant's `invite_ttl_days` setting, else the default. */
async function ttlDays(tx: TenantTx, tenantId: string): Promise<number> {
  const [ttl] = await tx
    .select({ value: tenantSettings.value })
    .from(tenantSettings)
    .where(and(eq(tenantSettings.tenantId, tenantId), eq(tenantSettings.key, "invite_ttl_days")))
  return typeof ttl?.value === "number" && ttl.value > 0 ? ttl.value : DEFAULT_INVITE_TTL_DAYS
}

/**
 * Accept re-validates the invite (B1 follow-up, ruling I25): the inviter must STILL be an active member who may manage settings, and the invited role must still be invitable
 * and not above the inviter's CURRENT administrative access (R24). Judged now, not when the invite was written, so demoting, suspending or removing the inviter kills what they
 * handed out. The inviter's membership and role are share-locked (as lockActor does everywhere), after the invite row, which no writer of memberships ever takes. 410 invite_invalid.
 */
async function assertInviterStillValid(tx: TenantTx, tenantId: string, inv: { invitedBy: string; roleId: string }): Promise<void> {
  const invalid = () => new AppError(410, "invite_invalid", "Gone")
  let inviter: Awaited<ReturnType<typeof lockActor>>
  try {
    inviter = await lockActor(tx, tenantId, inv.invitedBy, "settings", "write")
  } catch (e) {
    if (e instanceof AppError && e.status === 403) throw invalid() // not an active member, or no longer holds settings:write
    throw e
  }
  const [role] = await tx.select({ key: roles.key, access: roles.access }).from(roles).where(and(eq(roles.id, inv.roleId), eq(roles.tenantId, tenantId)))
  if (!role || !onboardingDefaults().inviteRoles.includes(role.key)) throw invalid()
  try {
    assertNoEscalation(inviter, role.access)
  } catch (e) {
    if (e instanceof AppError && e.status === 403) throw invalid()
    throw e
  }
}

export const inviteRoutes = newRouter()
  .openapi(createInviteRoute, async (c) => {
    const deps = c.get("deps")
    const tenant = c.get("tenant")!
    const actorId = c.get("member")!.userId
    const { email, roleId } = c.req.valid("json")
    const now = deps.clock.now()
    const token = mintToken(tenant.id)

    const out = await withTenant(deps.db, tenant.id, async (tx) => {
      const me = await lockActor(tx, tenant.id, actorId, "settings", "write") // R25: re-checked inside the tx
      const [role] = await tx.select({ id: roles.id, key: roles.key, access: roles.access }).from(roles).where(eq(roles.id, roleId)) // RLS: own tenant only
      if (!role) throw NotFound("role_not_found")
      if (!onboardingDefaults().inviteRoles.includes(role.key)) throw new AppError(422, "role_not_invitable", "Unprocessable Entity")
      assertNoEscalation(me, role.access) // an inviter cannot hand out more administrative access than they hold

      const [existing] = await tx
        .select({ id: user.id })
        .from(user)
        .innerJoin(memberships, eq(memberships.userId, user.id))
        .where(and(eq(user.email, email), eq(memberships.tenantId, tenant.id)))
      if (existing) throw Conflict("already_member")

      const days = await ttlDays(tx, tenant.id)
      const expiresAt = new Date(now.getTime() + days * DAY_MS)

      const [inv] = await tx
        .insert(invites)
        .values({ tenantId: tenant.id, email, roleId, tokenHash: sha256(token), invitedBy: actorId, createdAt: now, expiresAt })
        .returning({ id: invites.id })
      // Never the token or its hash in the audit log.
      await recordAudit(
        tx,
        tenant.id,
        { action: "invite.created", entity: "invite", entityId: inv.id, actorId, before: null, after: { emailHmac: emailHmac(deps.env, tenant.id, email), roleKey: role.key, expiresAt } },
        now,
      )
      await publish(tx, { tenantId: tenant.id, type: "invite.created", payload: { inviteId: inv.id, email, roleKey: role.key }, actorId }, now)
      return { id: inv.id, expiresAt }
    })

    await sendInviteMail(deps, tenant.id, { to: email, token, expiresAt: out.expiresAt, inviteId: out.id })
    return c.json({ id: out.id, email, expiresAt: out.expiresAt.toISOString() }, 201)
  })
  .openapi(listInvitesRoute, async (c) => {
    const deps = c.get("deps")
    const tenant = c.get("tenant")!
    const items = await withTenant(deps.db, tenant.id, (tx) =>
      tx
        .select({ id: invites.id, email: invites.email, roleKey: roles.key, createdAt: invites.createdAt, expiresAt: invites.expiresAt, invitedBy: invites.invitedBy })
        .from(invites)
        .innerJoin(roles, eq(roles.id, invites.roleId))
        .where(and(eq(invites.tenantId, tenant.id), isNull(invites.acceptedAt)))
        .orderBy(desc(invites.createdAt), desc(invites.id))
        .limit(LIST_LIMIT),
    )
    return c.json({ items: items.map((i) => ({ ...i, createdAt: i.createdAt.toISOString(), expiresAt: i.expiresAt.toISOString() })) }, 200)
  })
  .openapi(revokeInviteRoute, async (c) => {
    const deps = c.get("deps")
    const tenant = c.get("tenant")!
    const actorId = c.get("member")!.userId
    const { id } = c.req.valid("param")
    const now = deps.clock.now()
    await withTenant(deps.db, tenant.id, async (tx) => {
      await lockActor(tx, tenant.id, actorId, "settings", "write") // R25
      // FOR UPDATE serialises with an accept of the same invite: either the accept commits first (409 invite_used) or the row is gone and the link is a 404
      const [inv] = await tx.select().from(invites).where(and(eq(invites.id, id), eq(invites.tenantId, tenant.id))).for("update")
      if (!inv) throw NotFound("invite_not_found")
      if (inv.acceptedAt) throw new AppError(409, "invite_used", "Conflict")
      const [role] = await tx.select({ key: roles.key }).from(roles).where(eq(roles.id, inv.roleId))
      await tx.delete(invites).where(and(eq(invites.id, id), eq(invites.tenantId, tenant.id)))
      // Never the token or its hash; the address only as an HMAC (like invite.created).
      await recordAudit(
        tx,
        tenant.id,
        { action: "invite.revoked", entity: "invite", entityId: id, actorId, before: { emailHmac: emailHmac(deps.env, tenant.id, inv.email), roleKey: role?.key ?? null, expiresAt: inv.expiresAt }, after: null },
        now,
      )
    })
    return c.body(null, 204)
  })
  .openapi(resendInviteRoute, async (c) => {
    const deps = c.get("deps")
    const tenant = c.get("tenant")!
    const actorId = c.get("member")!.userId
    const { id } = c.req.valid("param")
    const now = deps.clock.now()
    const token = mintToken(tenant.id)

    const out = await withTenant(deps.db, tenant.id, async (tx) => {
      const me = await lockActor(tx, tenant.id, actorId, "settings", "write") // R25
      const [inv] = await tx.select().from(invites).where(and(eq(invites.id, id), eq(invites.tenantId, tenant.id))).for("update")
      if (!inv) throw NotFound("invite_not_found")
      if (inv.acceptedAt) throw new AppError(409, "invite_used", "Conflict")
      if (now.getTime() - inv.createdAt.getTime() < RESEND_COOLDOWN_MS) throw new AppError(429, "resend_too_soon", "Too Many Requests")
      // The same rules as creating it, judged on the invited role and on the person who now vouches for it (R24).
      const [role] = await tx.select({ key: roles.key, access: roles.access }).from(roles).where(eq(roles.id, inv.roleId))
      if (!role) throw NotFound("role_not_found")
      if (!onboardingDefaults().inviteRoles.includes(role.key)) throw new AppError(422, "role_not_invitable", "Unprocessable Entity")
      assertNoEscalation(me, role.access)
      const expiresAt = new Date(now.getTime() + (await ttlDays(tx, tenant.id)) * DAY_MS)
      // createdAt is the time of the last send (the cooldown reads it); the resender becomes the inviter of record, so accept re-validates THEIR standing
      await tx.update(invites).set({ tokenHash: sha256(token), createdAt: now, expiresAt, invitedBy: actorId }).where(and(eq(invites.id, id), eq(invites.tenantId, tenant.id)))
      await recordAudit(
        tx,
        tenant.id,
        { action: "invite.resent", entity: "invite", entityId: id, actorId, before: { expiresAt: inv.expiresAt, invitedBy: inv.invitedBy }, after: { emailHmac: emailHmac(deps.env, tenant.id, inv.email), roleKey: role.key, expiresAt } },
        now,
      )
      return { email: inv.email, expiresAt }
    })
    await sendInviteMail(deps, tenant.id, { to: out.email, token, expiresAt: out.expiresAt, inviteId: id })
    return c.json({ id, email: out.email, expiresAt: out.expiresAt.toISOString() }, 200)
  })
  .openapi(acceptRoute, async (c) => {
    const deps = c.get("deps")
    const me = c.get("user")!
    const { token } = c.req.valid("json")
    const m = TOKEN_RE.exec(token)
    if (!m) throw NotFound("invite_not_found")
    const tenantId = uuidFromHex(m[1])
    const now = deps.clock.now()

    const slug = await withTenant(deps.db, tenantId, async (tx) => {
      // Ruling C14: a suspended (or unknown) tenant accepts nobody; same 404 as a bad token, before any lock or write.
      const [tn] = await tx.select({ status: tenants.status }).from(tenants).where(eq(tenants.id, tenantId))
      if (tn?.status !== "active") throw NotFound("invite_not_found")
      const [inv] = await tx.select().from(invites).where(eq(invites.tokenHash, sha256(token))).for("update") // serialises double accepts
      if (!inv) throw NotFound("invite_not_found")
      if (inv.email !== me.email.toLowerCase()) throw Forbidden("invite_email_mismatch")
      if (inv.acceptedAt) throw new AppError(409, "invite_used", "Conflict")
      if (inv.expiresAt.getTime() <= now.getTime()) throw new AppError(410, "invite_expired", "Gone")

      const [already] = await tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, me.id)))
      if (already) throw Conflict("already_member")

      await assertInviterStillValid(tx, tenantId, inv)
      await assertSeatAvailable(tx, tenantId) // takes the per-tenant seat lock BEFORE the membership insert; 409 seat_limit
      try {
        // A savepoint keeps the tx usable; two different invites for the same user can both pass the check above.
        await tx.transaction((sp) => sp.insert(memberships).values({ tenantId, userId: me.id, roleId: inv.roleId, joinedAt: now }))
      } catch (err) {
        if (isPgError(err, "23505")) throw Conflict("already_member")
        throw err
      }
      await tx.update(invites).set({ acceptedAt: now }).where(eq(invites.id, inv.id))
      // Holding the invite link proves the invited address (checked equal to the signed-in user's above).
      await tx.update(user).set({ emailVerified: true }).where(eq(user.id, me.id))
      const [role] = await tx.select({ key: roles.key }).from(roles).where(eq(roles.id, inv.roleId))
      await recordAudit(
        tx,
        tenantId,
        { action: "member.joined", entity: "membership", entityId: me.id, actorId: me.id, before: null, after: { userId: me.id, roleKey: role?.key ?? null, inviteId: inv.id } },
        now,
      )
      await publish(tx, { tenantId, type: "member.joined", payload: { userId: me.id, roleKey: role?.key ?? null, inviteId: inv.id }, actorId: me.id }, now)
      const [t] = await tx.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId))
      return t.slug
    })
    return c.json({ slug }, 200)
  })
