import type { AppType } from "../src/app"
import { call, mailerOf, testEnv } from "./harness"

// Better Auth's CSRF check wants a trusted Origin on state-changing requests.
const ORIGIN = { origin: testEnv.APP_URL }

/** Turn a response's Set-Cookie headers into a request Cookie header value. */
export function cookieFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c) => !c.endsWith("="))
    .join("; ")
}

/** Token from the newest verification email sent to `email` (link: APP_URL/verify-email?token=...). */
export function verificationToken(app: AppType, email: string): string {
  const mailer = mailerOf.get(app)
  if (!mailer) throw new Error("no fake mailer registered for this app")
  const mail = [...mailer.sent].reverse().find((m) => m.to === email)
  const token = mail?.text.match(/\/verify-email\?token=([^\s&]+)/)?.[1]
  if (!token) throw new Error(`no verification email for ${email}`)
  return token
}

/** Follow the verification link through Better Auth's verify-email endpoint. */
export function verifyEmail(app: AppType, token: string): Promise<Response> {
  return call(app, "GET", `/api/auth/verify-email?token=${encodeURIComponent(token)}`)
}

/** Sign up; by default also verifies the address by following the emailed link. */
export async function signUp(
  app: AppType,
  email: string,
  password: string,
  name = "Test User",
  o: { verify?: boolean } = {},
): Promise<Response> {
  const res = await call(app, "POST", "/api/auth/sign-up/email", { body: { email, password, name }, headers: ORIGIN })
  if (res.status === 200 && o.verify !== false) {
    const v = await verifyEmail(app, verificationToken(app, email))
    if (v.status !== 200) throw new Error(`verify failed: ${v.status} ${await v.text()}`)
  }
  return res
}

export async function signIn(app: AppType, email: string, password: string): Promise<{ cookie: string }> {
  const res = await call(app, "POST", "/api/auth/sign-in/email", { body: { email, password }, headers: ORIGIN })
  if (res.status !== 200) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`)
  const cookie = cookieFrom(res)
  if (!cookie) throw new Error("sign-in set no cookie")
  return { cookie }
}

// ---- tenancy factories (T1.3) ----
import { and, eq } from "drizzle-orm"
import { base32 } from "@better-auth/utils/base32"
import { createOTP } from "@better-auth/utils/otp"
import type { MfaPolicy } from "@opsdesk/domain/mfa"
import type { Deps } from "../src/deps"
import { memberships, roles, subscriptions, tenants, user, type SubscriptionStatus } from "../src/db/schema"
import { withTenant } from "../src/db/tenant-tx"
import { seedRoleTemplates } from "../src/modules/tenants"

let seq = 0
const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}`

/** Inserts a tenant (no RLS on `tenants`) and seeds its role templates. */
export async function makeTenant(
  deps: Deps,
  over: Partial<{
    slug: string; name: string; sessionIdleHours: number; mfaPolicy: MfaPolicy
    /** Ruling C2: defaults to an ACTIVE paid business subscription so existing tests are unaffected; trial/grace/402 tests opt in. */
    subscription: Partial<{ planId: string; status: SubscriptionStatus; seats: number; trialEndsAt: Date | null }>
  }> = {},
): Promise<{ id: string; slug: string }> {
  const slug = over.slug ?? `t-${uniq()}`
  const [row] = await deps.db
    .insert(tenants)
    .values({ slug, name: over.name ?? slug, ...(over.sessionIdleHours ? { sessionIdleHours: over.sessionIdleHours } : {}), ...(over.mfaPolicy ? { mfaPolicy: over.mfaPolicy } : {}) })
    .returning({ id: tenants.id, slug: tenants.slug })
  await withTenant(deps.db, row.id, async (tx) => {
    await seedRoleTemplates(tx, row.id)
    const planId = over.subscription?.planId ?? "business"
    await tx.insert(subscriptions).values({
      tenantId: row.id, planId, status: over.subscription?.status ?? "active", seats: over.subscription?.seats ?? (planId === "business" ? 40 : 10),
      trialEndsAt: over.subscription?.trialEndsAt ?? null,
    })
  })
  return row
}

/** A verified Better Auth user (real password hash, via auth.api) with an active membership in `tenantId`. */
export async function makeMember(
  deps: Deps,
  tenantId: string,
  roleKey: string,
  over: { email?: string; totp?: boolean } = {},
): Promise<{ userId: string; email: string; password: string; totpSecret?: string; backupCodes?: string[] }> {
  const email = over.email ?? `m-${uniq()}@x.ie`
  const password = "Passw0rd!long"
  const existing = await deps.db.select({ id: user.id }).from(user).where(eq(user.email, email))
  let userId = existing[0]?.id
  if (!userId) {
    const created = await deps.auth.api.signUpEmail({ body: { email, password, name: "Test Member" } })
    userId = created.user.id
    await deps.db.update(user).set({ emailVerified: true }).where(eq(user.id, userId))
  }
  const uid = userId
  await withTenant(deps.db, tenantId, async (tx) => {
    const [role] = await tx.select({ id: roles.id }).from(roles).where(and(eq(roles.tenantId, tenantId), eq(roles.key, roleKey)))
    if (!role) throw new Error(`no role ${roleKey} in tenant`)
    await tx.insert(memberships).values({ tenantId, userId: uid, roleId: role.id, joinedAt: deps.clock.now() })
  })
  if (!over.totp) return { userId: uid, email, password }
  const enrolled = await enrollTotp(deps, email, password)
  return { userId: uid, email, password, totpSecret: enrolled.secret, backupCodes: enrolled.backupCodes }
}

// ---- TOTP (T1.5). All through Better Auth's twoFactor plugin; codes use the same OTP library it does. ----
const cookieOf = (h: Headers) => cookieFrom(new Response(null, { headers: h }))

/**
 * Enrols TOTP for a (verified, password) user the way a client would: sign in, /two-factor/enable, then verify the
 * first code. Uses its own throwaway session(s), so any session the test created earlier stays un-MFA'd.
 * Returns the base32 secret (for totpCode) and the backup codes. `cookie` is the MFA-passed session it ended with.
 */
export async function enrollTotp(deps: Deps, email: string, password: string) {
  const api = deps.auth.api
  const login = await api.signInEmail({ body: { email, password }, returnHeaders: true })
  const c1 = cookieOf(login.headers)
  const enable = await api.enableTwoFactor({ body: { password }, headers: new Headers({ cookie: c1 }) })
  if (!("totpURI" in enable)) throw new Error("expected TOTP enrolment")
  const secret = new URL(enable.totpURI).searchParams.get("secret")!
  const verified = await api.verifyTOTP({ body: { code: await totpCode(secret) }, headers: new Headers({ cookie: c1 }), returnHeaders: true })
  return { secret, backupCodes: enable.backupCodes, cookie: cookieOf(verified.headers) }
}

/** A valid TOTP for `secret` (base32) as of `msAgo` milliseconds ago (Better Auth accepts +-1 step of 30 s). */
export async function totpCode(secret: string, msAgo = 0): Promise<string> {
  const counter = Math.floor((Date.now() - msAgo) / 30_000)
  return createOTP(base32.decode(secret), { digits: 6, period: 30 }).hotp(counter)
}

/** Full 2FA sign-in over HTTP: password step (sets only the two_factor cookie), then verify-totp (creates the session). */
export async function signInWithTotp(app: AppType, email: string, password: string, secret: string): Promise<{ cookie: string }> {
  const first = await call(app, "POST", "/api/auth/sign-in/email", { body: { email, password }, headers: ORIGIN })
  if (first.status !== 200) throw new Error(`sign-in failed: ${first.status}`)
  const body = (await first.json()) as { twoFactorRedirect?: boolean }
  if (!body.twoFactorRedirect) throw new Error("expected a two-factor challenge")
  const second = await call(app, "POST", "/api/auth/two-factor/verify-totp", {
    body: { code: await totpCode(secret) },
    cookie: cookieFrom(first),
    headers: ORIGIN,
  })
  if (second.status !== 200) throw new Error(`verify-totp failed: ${second.status} ${await second.text()}`)
  return { cookie: cookieFrom(second) }
}

/** Role id by key inside a tenant. */
export function roleIdOf(deps: Deps, tenantId: string, key: string): Promise<string> {
  return withTenant(deps.db, tenantId, async (tx) => {
    const [r] = await tx.select({ id: roles.id }).from(roles).where(and(eq(roles.tenantId, tenantId), eq(roles.key, key)))
    if (!r) throw new Error(`no role ${key}`)
    return r.id
  })
}

// ---- platform staff (B3 T3.1) ----
import type { PlatformRole } from "../src/core/context"
import { platformStaff } from "../src/db/schema"

/** A verified password user; with `totp` also enrolled in TOTP. `staleCookie` is a session from BEFORE enrolment (mfa_passed false). */
export async function makeUser(deps: Deps, over: { email?: string; totp?: boolean; verified?: boolean } = {}) {
  const email = over.email ?? `p-${uniq()}@x.ie`
  const password = "Passw0rd!long"
  const created = await deps.auth.api.signUpEmail({ body: { email, password, name: "Platform Person" } })
  await deps.db.update(user).set({ emailVerified: true }).where(eq(user.id, created.user.id)) // sign-in (TOTP enrolment) needs it
  if (!over.totp) {
    if (over.verified === false) await deps.db.update(user).set({ emailVerified: false }).where(eq(user.id, created.user.id))
    return { userId: created.user.id, email, password }
  }
  const login = await deps.auth.api.signInEmail({ body: { email, password }, returnHeaders: true })
  const staleCookie = cookieOf(login.headers)
  const enrolled = await enrollTotp(deps, email, password)
  if (over.verified === false) await deps.db.update(user).set({ emailVerified: false }).where(eq(user.id, created.user.id))
  return { userId: created.user.id, email, password, totpSecret: enrolled.secret, cookie: enrolled.cookie, staleCookie }
}

/** A platform staff person: TOTP enrolled (cookie = MFA-passed session, staleCookie = not passed) unless `totp: false`. */
export async function makeStaff(deps: Deps, role: PlatformRole, over: { email?: string; totp?: boolean; status?: "active" | "suspended" } = {}) {
  const u = await makeUser(deps, { email: over.email, totp: over.totp ?? true })
  await deps.db.insert(platformStaff).values({ userId: u.userId, role, status: over.status ?? "active", addedBy: "test", addedAt: deps.clock.now() })
  return u
}

// ---- API keys (B4): staff-home roles have no settings:write, so keys for them are minted through the service ----
import { createApiKey } from "../src/modules/api-keys"

/** An API key created by `userId` (any role) with `scopes` limited by that member's CURRENT role, exactly like POST /v1/api-keys. */
export async function makeApiKey(deps: Deps, tenantId: string, userId: string, scopes: string[]): Promise<{ key: string; id: string }> {
  const access = await withTenant(deps.db, tenantId, async (tx) => {
    const [r] = await tx.select({ access: roles.access }).from(memberships).innerJoin(roles, eq(roles.id, memberships.roleId)).where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
    return r.access
  })
  const out = await createApiKey(deps, tenantId, { userId, access }, { name: "test", scopes })
  return { key: out.key, id: out.view.id }
}
