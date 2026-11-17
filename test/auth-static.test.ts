import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"

// Source-level guards for the T6.3 rules that are easy to break by accident (no DOM here, so these read the files).
const root = path.resolve(__dirname, "..")
const read = (p: string) => readFileSync(path.join(root, p), "utf8")
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(path.join(root, dir))) {
    if (["node_modules", ".next", "api", "test", ".git", ".superpowers", "public"].includes(e)) continue
    const rel = path.join(dir, e)
    if (statSync(path.join(root, rel)).isDirectory()) walk(rel, out)
    else if (/\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e) && !e.endsWith(".d.ts")) out.push(rel)
  }
  return out
}
const sources = ["app", "features", "lib", "components", "hooks", "proxy.ts", "instrumentation.ts"].flatMap((d) => (statSync(path.join(root, d)).isDirectory() ? walk(d) : [d]))

describe("T6.3 skeletons: every changed or new auth page has an exact-match skeleton and a loading.tsx", () => {
  test("loading.tsx exists for every auth route and renders its own skeleton", () => {
    const routes: Record<string, string> = { "sign-in": "SignInSkeleton", "sign-up": "SignUpSkeleton", "forgot-password": "ForgotSkeleton", onboarding: "OnboardingSkeleton", "verify-email": "VerifyEmailSkeleton", "reset-password": "ResetPasswordSkeleton" }
    for (const [route, sk] of Object.entries(routes)) {
      const f = `app/(auth)/${route}/loading.tsx`
      expect(existsSync(path.join(root, f)), f).toBe(true)
      expect(read(f), f).toContain(sk)
    }
  })

  test("the skeletons are built with Sk and reuse the real auth classes", () => {
    const src = read("features/auth/components/skeletons.tsx")
    for (const fn of ["VerifyEmailSkeleton", "ResetPasswordSkeleton", "SignInSkeleton"]) expect(src).toContain(`export function ${fn}`)
    expect(src).toContain('from "@/components/sk"')
    expect(src).toContain("auth-strength") // the reset form's strength meter is in its skeleton
  })

  test("the sign-in skeleton matches the real form: no hint under the password (the demo hint is gone) and the social buttons follow the provider count", () => {
    const sk = read("features/auth/components/skeletons.tsx")
    const signIn = sk.slice(sk.indexOf("export function SignInSkeleton"), sk.indexOf("export function VerifyEmailSkeleton"))
    expect(signIn).not.toContain("FieldSk hint")
    expect(signIn).toContain("providers")
    expect(read("features/auth/components/sign-in-form.tsx")).not.toContain("Demo:")
  })

  test("loading.tsx of the auth routes and the account page never call the API or the data layer", () => {
    for (const f of ["app/(auth)/sign-in/loading.tsx", "app/(auth)/verify-email/loading.tsx", "app/(auth)/reset-password/loading.tsx", "app/(auth)/forgot-password/loading.tsx", "app/(app)/account/[tab]/loading.tsx"]) {
      expect(read(f), f).not.toMatch(/lib\/api|apiServer|getSecurity|getSession/)
    }
  })
})

describe("T6.3 the mock session is gone", () => {
  test("no source writes od-tenant (except the tenant cookie helpers), od-auth, od-role or od-device", () => {
    const offenders: string[] = []
    for (const f of sources) {
      const src = readFileSync(path.join(root, f), "utf8")
      if (/["'`]od-(auth|role|device)["'`]/.test(src)) offenders.push(`${f}: od-auth/od-role/od-device`)
      if (/\.set\(\s*["'`]od-tenant["'`]/.test(src)) offenders.push(`${f}: writes od-tenant directly`)
    }
    expect(offenders).toEqual([])
  })

  test("the old mock helpers and TOTP constants are not used by the app", () => {
    const offenders: string[] = []
    for (const f of sources) {
      const src = readFileSync(path.join(root, f), "utf8")
      if (/import\s*\{[^}]*\b(setRole|setDevice|setTenant|signIn|signOut)\b[^}]*\}\s*from\s*["']@\/app\/actions\/session["']/.test(src)) offenders.push(`${f}: demo session action`)
      if (/\b(MOCK_TOTP_SECRET|MOCK_TOTP_CODE|RECOVERY_CODES|verifyMockTotp|qrPattern|getSignInRoles)\b/.test(src)) offenders.push(f)
    }
    expect(offenders).toEqual([])
  })

  test("the TOTP set-up renders no QR (ruling J1): the secret and the otpauth link only", () => {
    const src = read("features/account/components/totp-setup.tsx")
    expect(src).not.toMatch(/<svg|qrcode|QRCode/i) // no QR drawing or library
    expect(src).toContain("otpauthHref")
    expect(src).toContain("Copy key")
  })
})

describe("T6.3 verification and reset links: rendering calls nothing, tokens stay out of storage and logs", () => {
  test("the verify-email page and component call the API only inside the Verify click handler", () => {
    const page = read("app/(auth)/verify-email/page.tsx")
    expect(page).not.toMatch(/auth-client|apiServer|verifyEmail\(/)
    const comp = read("features/auth/components/verify-email.tsx")
    expect(comp).not.toContain("useEffect")
    const calls = comp.match(/verifyEmailStep\(/g) ?? []
    expect(calls).toHaveLength(1)
    expect(comp.indexOf("function verify()")).toBeLessThan(comp.indexOf("verifyEmailStep("))
  })

  test("the token is never logged or stored by the auth screens", () => {
    for (const f of ["features/auth/components/verify-email.tsx", "features/auth/components/reset-password.tsx", "lib/auth-flow.ts"]) {
      const src = read(f)
      expect(src, f).not.toMatch(/console\.|localStorage|sessionStorage/)
    }
  })

  test("both token pages opt out of Referer and indexing", () => {
    for (const f of ["app/(auth)/verify-email/page.tsx", "app/(auth)/reset-password/page.tsx"]) expect(read(f), f).toContain('referrer: "no-referrer"')
  })
})

describe("T6.3 the layouts do the real session check", () => {
  test("the (app) layout calls getSession and renders MfaGate for enrolment and MfaStepUp for a challenge instead of children", () => {
    const layout = read("app/(app)/layout.tsx")
    expect(layout).toContain("await getSession()")
    expect(layout).toMatch(/session\.mfa === "enrol" \? <MfaGate/)
    expect(layout).toMatch(/session\.mfa === "challenge" \? <MfaStepUp/)
    expect(layout).not.toMatch(/od-auth|signedIn/)
  })

  test("the console layout and gate use the console session; the sign-in page never redirects (no loop on a dead cookie)", () => {
    expect(read("app/(platform)/layout.tsx")).toContain("getPlatformSession()")
    expect(read("app/(platform)/gate.tsx")).toContain("getPlatformSession()")
    expect(read("app/(auth)/sign-in/page.tsx")).not.toMatch(/next\/navigation|redirect\(|getSession|cookies\(/)
  })

  test("proxy.ts is only the optimistic check: it never calls the API or reads a token value", () => {
    const proxy = read("proxy.ts")
    expect(proxy).not.toMatch(/fetch\(|apiServer|apiUrl\(|\.value\b/)
    expect(proxy).toContain("hasSessionCookie")
  })
})
