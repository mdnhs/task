import { createHash, randomBytes } from "node:crypto"
import { createRoute, z } from "@hono/zod-openapi"
import { and, eq } from "drizzle-orm"
import { AppError, Conflict, Forbidden, NotFound } from "../../core/errors"
import { requirePermission } from "../../core/middleware/permission"
import { requireSession } from "../../core/middleware/session"
import { requireTenant } from "../../core/middleware/tenant"
import { newRouter } from "../../core/router"
import { sanitizeMailError } from "../../core/mail/sanitize"
import { invites, memberships, roles, tenants, tenantSettings, user } from "../../db/schema"
import { withTenant } from "../../db/tenant-tx"
import { recordAudit } from "../audit"
import { assertNoEscalation } from "../rbac"
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

const acceptRoute = createRoute({
  method: "post",
  path: "/v1/invites/accept",
  middleware: [requireSession] as const,
  request: { body: { content: { "application/json": { schema: AcceptInvite } }, required: true } },
  responses: { 200: { description: "Joined the tenant", content: { "application/json": { schema: z.object({ slug: z.string() }) } } } },
})

export const inviteRoutes = newRouter()
  .openapi(createInviteRoute, async (c) => {
    const deps = c.get("deps")
    const tenant = c.get("tenant")!
    const actorId = c.get("member")!.userId
    const { email, roleId } = c.req.valid("json")
    const now = deps.clock.now()
    const token = mintToken(tenant.id)

    const out = await withTenant(deps.db, tenant.id, async (tx) => {
      const [role] = await tx.select({ id: roles.id, key: roles.key, access: roles.access }).from(roles).where(eq(roles.id, roleId)) // RLS: own tenant only
      if (!role) throw NotFound("role_not_found")
      if (!onboardingDefaults().inviteRoles.includes(role.key)) throw new AppError(422, "role_not_invitable", "Unprocessable Entity")
      assertNoEscalation(c.get("role")!, role.access) // an inviter cannot hand out more than they hold

      const [existing] = await tx
        .select({ id: user.id })
        .from(user)
        .innerJoin(memberships, eq(memberships.userId, user.id))
        .where(and(eq(user.email, email), eq(memberships.tenantId, tenant.id)))
      if (existing) throw Conflict("already_member")

      const [ttl] = await tx
        .select({ value: tenantSettings.value })
        .from(tenantSettings)
        .where(and(eq(tenantSettings.tenantId, tenant.id), eq(tenantSettings.key, "invite_ttl_days")))
      const days = typeof ttl?.value === "number" && ttl.value > 0 ? ttl.value : DEFAULT_INVITE_TTL_DAYS
      const expiresAt = new Date(now.getTime() + days * DAY_MS)

      const [inv] = await tx
        .insert(invites)
        .values({ tenantId: tenant.id, email, roleId, tokenHash: sha256(token), invitedBy: actorId, createdAt: now, expiresAt })
        .returning({ id: invites.id })
      // Never the token or its hash in the audit log.
      await recordAudit(
        tx,
        tenant.id,
        { action: "invite.created", entity: "invite", entityId: inv.id, actorId, before: null, after: { email, roleKey: role.key, expiresAt } },
        now,
      )
      return { id: inv.id, expiresAt }
    })

    const [t] = await deps.db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenant.id))
    try {
      await deps.mailer.send({
        to: email,
        subject: `You are invited to ${t.name}`,
        text: `You have been invited to join ${t.name}.\n\nSign up or sign in with this email address, then accept:\n\n${deps.env.APP_URL}/invite?token=${token}\n\nThe link expires on ${out.expiresAt.toISOString().slice(0, 10)}.`,
      })
    } catch (err) {
      // The invite exists; never log the token or link, only a sanitized error and the invite id.
      deps.logger.error({ error: sanitizeMailError(err), inviteId: out.id }, "invite email send failed")
    }
    return c.json({ id: out.id, email, expiresAt: out.expiresAt.toISOString() }, 201)
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
      const [t] = await tx.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId))
      return t.slug
    })
    return c.json({ slug }, 200)
  })
