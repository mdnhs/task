import type { AppType } from "../src/app"
import { call } from "./harness"

// Better Auth's CSRF check wants a trusted Origin on state-changing requests.
const ORIGIN = { origin: "http://localhost:3000" }

/** Turn a response's Set-Cookie headers into a request Cookie header value. */
export function cookieFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c) => !c.endsWith("="))
    .join("; ")
}

export async function signUp(app: AppType, email: string, password: string, name = "Test User"): Promise<Response> {
  return call(app, "POST", "/api/auth/sign-up/email", { body: { email, password, name }, headers: ORIGIN })
}

export async function signIn(app: AppType, email: string, password: string): Promise<{ cookie: string }> {
  const res = await call(app, "POST", "/api/auth/sign-in/email", { body: { email, password }, headers: ORIGIN })
  if (res.status !== 200) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`)
  const cookie = cookieFrom(res)
  if (!cookie) throw new Error("sign-in set no cookie")
  return { cookie }
}
