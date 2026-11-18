import { eq } from "drizzle-orm"
import { betterAuth } from "better-auth"
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { twoFactor } from "better-auth/plugins/two-factor"
import type { Db } from "../../db/client"
import * as schema from "../../db/schema"
import type { Logger } from "pino"
import { sanitizeMailError } from "../../core/mail/sanitize"
import type { Clock, Mailer } from "../../deps"
import type { Env } from "../../env"
import { RATE, TOTP_REPLAY_TTL_SEC, hashKey, type RateLimiter } from "../../core/middleware/rate-limit"
import { errorInfo } from "../../core/safe-error"

const DAY = 24 * 60 * 60

type AuthDeps = { env: Env; db: Db; clock: Clock; mailer: Mailer; logger: Logger; rateLimiter: RateLimiter }

/** The header our own /api/auth wrapper sets (overwriting anything the caller sent) to the address resolved by core/net/client-ip. Better Auth reads the client address from nowhere else. */
export const CLIENT_IP_HEADER = "x-opsdesk-client-ip"
const TOTP_PATHS = ["/two-factor/verify-totp", "/two-factor/verify-backup-code"]
// Verification links live 24 hours (NFR/T1.1b). The override exists only so a test can expire one quickly.
type AuthOpts = { verificationTtlSeconds?: number }

/**
 * Better Auth instance. Our own idle check (requireSession) governs session lifetime:
 * Better Auth's absolute `expiresIn` is 30 days with a daily rolling refresh, so it never
 * fires first. It uses real time internally, which is why the idle clock is ours (deps.clock).
 */
export function buildAuth({ env, db, clock, mailer, logger, rateLimiter }: AuthDeps, opts: AuthOpts = {}) {
  const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {}
  // Both id and secret must be non-empty; empty strings never register a provider.
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    socialProviders.google = { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
  }
  if (env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET) {
    socialProviders.microsoft = { clientId: env.MICROSOFT_CLIENT_ID, clientSecret: env.MICROSOFT_CLIENT_SECRET }
  }

  return betterAuth({
    appName: "OpsDesk",
    baseURL: env.APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_URL],
    database: drizzleAdapter(db, { provider: "pg", schema }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      // Reset links live one hour, work once, and end every session of the user (a stolen session must not survive a reset). B6 I23 a.
      resetPasswordTokenExpiresIn: 3600,
      revokeSessionsOnPasswordReset: true,
      // Not awaited, like the verification mail: the answer must not depend on whether a mail was sent (no timing oracle). Better Auth already
      // answers an unknown address with the same body and a simulated lookup. The link goes to the WEB page (the token is a path-free query value);
      // an unverified account gets no reset mail (it has a verification mail instead). Never log the token, link or address.
      sendResetPassword: async ({ user, token }) => {
        if (!user.emailVerified) return
        void mailer
          .send({
            to: user.email,
            subject: "Reset your password",
            text: `Someone asked to reset the password for your account. If it was you, choose a new one here:\n\n${env.APP_URL}/reset-password?token=${token}\n\nThe link works once and expires in 1 hour. If you did not ask, ignore this email; your password stays the same.`,
          })
          .catch((err) => {
            logger.error({ error: sanitizeMailError(err), userId: user.id }, "password reset email send failed")
          })
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      // Explicit sign-in after verifying; verification alone never creates a session.
      autoSignInAfterVerification: false,
      expiresIn: opts.verificationTtlSeconds ?? 86400,
      // Not awaited (Better Auth's advice: avoids a timing side channel on whether a mail was sent).
      sendVerificationEmail: async ({ user, token }) => {
        void mailer
          .send({
            to: user.email,
            subject: "Verify your email",
            text: `Confirm your email address to finish signing up:\n\n${env.APP_URL}/verify-email?token=${token}\n\nThe link expires in 24 hours.`,
          })
          .catch((err) => {
            // Never log the token, link or body: only who it was for (by id) and a sanitized error.
            logger.error({ error: sanitizeMailError(err), userId: user.id }, "verification email send failed")
          })
      },
    },
    socialProviders,
    plugins: [twoFactor({ issuer: "OpsDesk" })],
    session: {
      expiresIn: 30 * DAY,
      updateAge: DAY,
      additionalFields: {
        lastSeenAt: { type: "date", required: false, input: false },
        // Never client-writable; only the hook below sets it, after a verified second factor.
        mfaPassed: { type: "boolean", required: false, input: false, defaultValue: false },
      },
    },
    advanced: {
      // Explicit: Better Auth otherwise skips origin/CSRF checks when NODE_ENV=test, hiding bugs from tests.
      disableOriginCheck: false,
      disableCSRFCheck: false,
      useSecureCookies: env.NODE_ENV === "production",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
      // Never x-forwarded-for: the wrapper in routes.ts resolves the caller with TRUST_PROXY_HOPS and sets this single-value header (S3).
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER], ipv6Subnet: 64 },
    },
    hooks: {
      // S4: TOTP attempt cap (per user) and used-code replay guard, BEFORE Better Auth looks at the code. Every attempt counts; a success clears the
      // counter (after hook). The store being down fails CLOSED. The user is the session's, or on the sign-in challenge the one the two_factor cookie names.
      before: createAuthMiddleware(async (ctx) => {
        if (!TOTP_PATHS.includes(ctx.path)) return
        let userId: string | undefined
        try {
          userId = (await getSessionFromCtx(ctx))?.user.id
          if (!userId) {
            const cookie = ctx.context.createAuthCookie("two_factor")
            const signed = await ctx.getSignedCookie(cookie.name, ctx.context.secret)
            if (signed) userId = (await ctx.context.internalAdapter.findVerificationValue(signed))?.value
          }
        } catch {
          return // unresolvable: Better Auth answers its own 401 for a missing session or challenge
        }
        if (!userId) return
        try {
          const r = await rateLimiter.hit(`totp-fail:${userId}`, RATE.totpFailures)
          if (!r.allowed) {
            throw new APIError("TOO_MANY_REQUESTS", { message: "Too many attempts", code: "MFA_ATTEMPTS_EXCEEDED" }, new Headers({ "retry-after": String(r.retryAfterSec) }))
          }
          const code = (ctx.body as { code?: unknown } | undefined)?.code
          if (typeof code === "string" && ctx.path === "/two-factor/verify-totp" && !(await rateLimiter.once(`totp-used:${userId}:${hashKey(code)}`, TOTP_REPLAY_TTL_SEC))) {
            throw new APIError("UNAUTHORIZED", { message: "Invalid code", code: "INVALID_CODE" })
          }
        } catch (err) {
          if (err instanceof APIError) throw err
          logger.warn({ ...errorInfo(err), limiter: "totp", failClosed: true }, "rate limiter store unavailable")
          throw new APIError("SERVICE_UNAVAILABLE", { message: "Try again shortly", code: "RATE_LIMIT_UNAVAILABLE" })
        }
      }),
      // R14: a session is MFA-passed only if it completed a TOTP or backup-code verification through Better Auth.
      // Sign-in with a second factor creates the session inside verify-*, and a pre-existing session (enrolment,
      // step-up after another device enrolled) is the one the request carries. OAuth callbacks and plain sign-ins
      // never reach here, so their sessions stay false. Disabling 2FA touches nothing.
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/two-factor/verify-totp" && ctx.path !== "/two-factor/verify-backup-code") return
        if (ctx.context.returned instanceof APIError || ctx.context.returned instanceof Error) return // failed attempt
        const sessionId = ctx.context.newSession?.session.id ?? (await getSessionFromCtx(ctx))?.session.id
        if (sessionId) await db.update(schema.session).set({ mfaPassed: true }).where(eq(schema.session.id, sessionId))
        // a verified second factor clears the failure counter (best effort: the next failure window is bounded by its TTL anyway)
        const verifiedUser = ctx.context.newSession?.user.id ?? (await getSessionFromCtx(ctx))?.user.id
        if (verifiedUser) await rateLimiter.reset(`totp-fail:${verifiedUser}`).catch(() => {})
      }),
    },
    databaseHooks: {
      session: {
        create: { before: async (s) => ({ data: { ...s, lastSeenAt: clock.now() } }) },
      },
    },
  })
}

export type Auth = ReturnType<typeof buildAuth>
