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
