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
import { memberships, roles, tenants, user } from "../src/db/schema"
import { withTenant } from "../src/db/tenant-tx"
import { seedRoleTemplates } from "../src/modules/tenants"

let seq = 0
const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}`

/** Inserts a tenant (no RLS on `tenants`) and seeds its role templates. */
export async function makeTenant(
  deps: Deps,
  over: Partial<{ slug: string; name: string; sessionIdleHours: number; mfaPolicy: MfaPolicy }> = {},
): Promise<{ id: string; slug: string }> {
  const slug = over.slug ?? `t-${uniq()}`
  const [row] = await deps.db
    .insert(tenants)
    .values({ slug, name: over.name ?? slug, ...(over.sessionIdleHours ? { sessionIdleHours: over.sessionIdleHours } : {}), ...(over.mfaPolicy ? { mfaPolicy: over.mfaPolicy } : {}) })
    .returning({ id: tenants.id, slug: tenants.slug })
  await withTenant(deps.db, row.id, (tx) => seedRoleTemplates(tx, row.id))
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
