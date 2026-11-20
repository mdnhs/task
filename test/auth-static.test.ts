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
function walkAll(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(path.join(root, dir))) {
    const rel = `${dir}/${e}`
    if (statSync(path.join(root, rel)).isDirectory()) walkAll(rel, out)
    else out.push(rel)
  }
  return out
}
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

/**
 * Names (exported functions and consts) whose body reaches the API: seeds are the session and API-client entry points; a function that calls a tainted
 * name is tainted too (fixpoint). Chunks are cut at each `export`, so a helper below an export belongs to it. Loading skeletons may use none of them.
 */
function taintedNames(): Set<string> {
  const seeds = ["getSession", "peekSession", "peekPlatformSession", "getPlatformSession", "getIdentity", "apiServer", "apiBrowser", "requireMfaOk"]
  const tainted = new Set(seeds)
  const chunks: { name: string; body: string }[] = []
  for (const f of ["app", "features", "lib", "components", "hooks"].flatMap((d) => walkAll(d))) {
    if (!/\.(ts|tsx)$/.test(f) || /\.test\.tsx?$/.test(f) || f.endsWith(".d.ts") || f.endsWith("/loading.tsx") || /^lib\/(session|session-core|session-route|skeleton-session)\.ts$/.test(f) || /^lib\/api\//.test(f)) continue
    const parts = stripComments(read(f)).split(/^export /m).slice(1)
    for (const body of parts) {
      const m = body.startsWith("default ") ? null : body.match(/^(?:async )?(?:function\*? |const |class )([A-Za-z0-9_]+)/) // a default export (a page, a layout) is not a callable helper
      if (m) chunks.push({ name: m[1]!, body })
    }
  }
  for (let changed = true; changed; ) {
    changed = false
    for (const c of chunks) {
      if (tainted.has(c.name)) continue
      for (const t of tainted) if (t !== c.name && new RegExp(`\\b${t}\\s*\\(`).test(c.body)) { tainted.add(c.name); changed = true; break }
    }
  }
  return tainted
}

const sources = ["app", "features", "lib", "components", "hooks", "proxy.ts", "instrumentation.ts"].flatMap((d) => (statSync(path.join(root, d)).isDirectory() ? walk(d) : [d]))

describe("T6.3 skeletons: every changed or new auth page has an exact-match skeleton and a loading.tsx", () => {
  test("loading.tsx exists for every auth route and renders its own skeleton", () => {
    const routes: Record<string, string> = { "sign-in": "SignInSkeleton", "sign-up": "SignUpSkeleton", "forgot-password": "ForgotSkeleton", onboarding: "OnboardingSkeleton", "verify-email": "VerifyEmailSkeleton", "reset-password": "ResetPasswordSkeleton", invite: "InviteSkeleton" }
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

  test("K1 (ruling I9): NO loading.tsx in the repo calls the API: not directly, not through a helper that does", () => {
    const loadings = walkAll("app").filter((f) => f.endsWith("/loading.tsx") || f === "app/loading.tsx")
    expect(loadings.length).toBeGreaterThan(40) // the glob really found them
    const tainted = taintedNames()
    for (const seed of ["getSession", "peekSession", "getUser", "apiServer"]) expect(tainted.has(seed), seed).toBe(true) // the scan is not vacuous
    const offenders: string[] = []
    for (const f of loadings) {
      const raw = stripComments(read(f))
      const src = raw.replace(/from\s+["'][^"']+["']/g, "from ''") // names, not module paths
      if (/@\/lib\/session["']|@\/lib\/api\/server["']|\bfetch\s*\(/.test(raw)) offenders.push(`${f}: imports lib/session, lib/api/server or calls fetch`)
      for (const name of tainted) if (new RegExp(`\\b${name}\\b`).test(src)) offenders.push(`${f}: uses ${name} (reaches the API)`)
    }
    expect(offenders).toEqual([])
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

  test("K5: the verify-email click removes the token from the address bar before calling the API; reset-password does it on mount", () => {
    const comp = read("features/auth/components/verify-email.tsx")
    expect(comp).toContain("stripQueryFromAddressBar()")
    expect(comp.indexOf("stripQueryFromAddressBar()")).toBeLessThan(comp.indexOf("verifyEmailStep("))
    expect(read("features/auth/components/reset-password.tsx")).toContain("stripQueryFromAddressBar()")
  })

  test("the token is never logged or stored by the auth screens", () => {
    for (const f of ["features/auth/components/verify-email.tsx", "features/auth/components/reset-password.tsx", "lib/auth-flow.ts"]) {
      const src = read(f)
      expect(src, f).not.toMatch(/console\.|localStorage|sessionStorage/)
    }
  })

  test("both token pages opt out of Referer and indexing", () => {
    for (const f of ["app/(auth)/verify-email/page.tsx", "app/(auth)/reset-password/page.tsx", "app/(auth)/invite/page.tsx"]) expect(read(f), f).toContain('referrer: "no-referrer"')
  })

  test("the invite page and component use the invitation only inside the Accept click and the verified step (a link scanner must not consume it)", () => {
    expect(read("app/(auth)/invite/page.tsx")).not.toMatch(/acceptInvite|auth-client|invites\/accept/)
    const comp = read("features/auth/components/accept-invite.tsx")
    expect(comp).not.toContain("useEffect")
    expect(comp).not.toMatch(/console\.|localStorage|sessionStorage/)
    expect(comp.indexOf("function accept()")).toBeLessThan(comp.indexOf("acceptInvite(token)"))
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

describe("K2: pages and actions that call the API use requireMfaOk()", () => {
  // Names whose body reaches a TENANT API call (apiServer or a function that calls it). The session lookup itself (getSession) is not in this set: it is what requireMfaOk wraps.
  function apiCallers(): Set<string> {
    const names = new Set(["apiServer"])
    const chunks: { name: string; body: string }[] = []
    for (const f of ["app", "features", "lib", "components", "hooks"].flatMap((d) => walkAll(d))) {
      if (!/\.(ts|tsx)$/.test(f) || /\.test\.tsx?$/.test(f) || f.endsWith(".d.ts") || /^lib\/(session|session-core|session-route|skeleton-session)\.ts$/.test(f) || /^lib\/api\//.test(f) || /^app\/api\//.test(f)) continue
      for (const body of stripComments(read(f)).split(/^export /m).slice(1)) {
        const m = body.startsWith("default ") ? null : body.match(/^(?:async )?(?:function\*? |const |class )([A-Za-z0-9_]+)/) // a default export (a page, a layout) is not a callable helper
        if (m) chunks.push({ name: m[1]!, body })
      }
    }
    for (let changed = true; changed; ) {
      changed = false
      for (const c of chunks) if (!names.has(c.name) && [...names].some((t) => t !== c.name && new RegExp(`\\b${t}\\s*\\(`).test(c.body))) { names.add(c.name); changed = true }
    }
    return names
  }

  test("every page under app/(app) that reaches the API calls requireMfaOk()", () => {
    const callers = apiCallers()
    expect(callers.has("getSecurity")).toBe(true) // the scan is not vacuous: the account page's data call is found
    const pages = walkAll("app/(app)").filter((f) => /\/(page|route)\.tsx?$/.test(f))
    expect(pages.length).toBeGreaterThan(20)
    const offenders: string[] = []
    for (const f of pages) {
      const src = stripComments(read(f)).replace(/from\s+["'][^"']+["']/g, "from ''")
      const hits = [...callers].filter((n) => new RegExp(`\\b${n}\\b`).test(src))
      if (hits.length && !/\brequireMfaOk\b/.test(src)) offenders.push(`${f}: calls ${hits.join(", ")} without requireMfaOk()`)
    }
    expect(offenders).toEqual([])
  })

  test("every server action that calls the API gates itself, except the ones that exist to establish or leave a session", () => {
    // session.ts: switchTenant/afterSignIn/signOut run before any workspace page; onboarding creates the first company (no tenant, so no tenant MFA policy);
    // platform-search: the console's own gate (it returns nothing unless session.mfa is ok; test/t68-static.test.ts checks it).
    // invite: accepting an invitation creates the caller's FIRST membership of that company (like onboarding): they have no company yet, so there is no tenant
    // MFA policy to gate on; the API's accept route needs only a session, and the (app) layout shows the MFA gate once they are inside the company.
    const exempt = new Set(["app/actions/session.ts", "app/actions/onboarding.ts", "app/actions/platform-search.ts", "app/actions/invite.ts"])
    const offenders: string[] = []
    for (const f of walkAll("app").filter((x) => /\/actions(\/[^/]+)?\.tsx?$/.test(x) && !/\.test\./.test(x))) {
      if (exempt.has(f)) continue
      const src = stripComments(read(f))
      if (/\bapiServer\b|\bapiBrowser\b/.test(src) && !/\brequireMfaOk\b/.test(src)) offenders.push(f)
    }
    expect(offenders).toEqual([])
  })

  test("account page uses the helper, not a hand-written mfa check", () => {
    const src = read("app/(app)/account/[tab]/page.tsx")
    expect(src).toContain("requireMfaOk()")
    expect(src).not.toMatch(/session\.mfa !== "ok"/)
  })
})
