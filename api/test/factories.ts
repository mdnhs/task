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
import type { Deps } from "../src/deps"
import { memberships, roles, tenants, user } from "../src/db/schema"
import { withTenant } from "../src/db/tenant-tx"
import { seedRoleTemplates } from "../src/modules/tenants"

let seq = 0
const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}`

/** Inserts a tenant (no RLS on `tenants`) and seeds its role templates. */
export async function makeTenant(
  deps: Deps,
  over: Partial<{ slug: string; name: string; sessionIdleHours: number }> = {},
): Promise<{ id: string; slug: string }> {
  const slug = over.slug ?? `t-${uniq()}`
  const [row] = await deps.db
    .insert(tenants)
    .values({ slug, name: over.name ?? slug, ...(over.sessionIdleHours ? { sessionIdleHours: over.sessionIdleHours } : {}) })
    .returning({ id: tenants.id, slug: tenants.slug })
  await withTenant(deps.db, row.id, (tx) => seedRoleTemplates(tx, row.id))
  return row
}

/** A verified Better Auth user (real password hash, via auth.api) with an active membership in `tenantId`. */
export async function makeMember(
  deps: Deps,
  tenantId: string,
  roleKey: string,
  over: { email?: string } = {},
): Promise<{ userId: string; email: string; password: string }> {
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
  return { userId: uid, email, password }
}

/** Role id by key inside a tenant. */
export function roleIdOf(deps: Deps, tenantId: string, key: string): Promise<string> {
  return withTenant(deps.db, tenantId, async (tx) => {
    const [r] = await tx.select({ id: roles.id }).from(roles).where(and(eq(roles.tenantId, tenantId), eq(roles.key, key)))
    if (!r) throw new Error(`no role ${key}`)
    return r.id
  })
}
