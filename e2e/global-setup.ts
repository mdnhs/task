import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { request, type FullConfig } from "@playwright/test"
import { apiEnv, PERSONAS, DEMO_PASSWORD, PLATFORM_TOTP, WEB_ORIGIN, type Persona } from "./stack-env"
import { AUTH_DIR, statePath } from "./paths"
import { totp } from "./totp"
import { buildWorld } from "./world"


/** Re-seeds the demo tenants once (the guards in the seed refuse anything but a demo-only database), then signs every persona in through the API (the BFF) and stores its cookies. */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  void _config
  execFileSync("npx", ["tsx", "scripts/seed-demo.ts", "--reset"], { cwd: new URL("../api/", import.meta.url).pathname, env: { ...process.env, ...apiEnv }, stdio: "pipe" })
  mkdirSync(AUTH_DIR, { recursive: true })
  let n = 0
  for (const persona of Object.keys(PERSONAS) as Persona[]) {
    // Each persona comes from its own (documentation-range) address, as it would behind the proxy, so a rate limit on sign-in (on in production) never sees one busy client.
    const ctx = await request.newContext({ baseURL: WEB_ORIGIN, extraHTTPHeaders: { origin: WEB_ORIGIN, "x-forwarded-for": `198.51.100.${++n}` } })
    const res = await ctx.post("/api/auth/sign-in/email", { data: { email: PERSONAS[persona], password: DEMO_PASSWORD } })
    if (!res.ok()) throw new Error(`sign-in as ${persona} failed: ${res.status()}`)
    if ((await res.json()).twoFactorRedirect) {
      // The console operator: the second factor is a TOTP code from the seed's key.
      const v = await ctx.post("/api/auth/two-factor/verify-totp", { data: { code: totp(PLATFORM_TOTP) } })
      if (!v.ok()) throw new Error(`second factor for ${persona} failed: ${v.status()}`)
    }
    // The active tenant is the httpOnly od-tenant cookie the page layout repairs on first load; set it up front.
    const url = new URL(WEB_ORIGIN)
    await ctx.storageState({ path: statePath(persona) })
    const fs = await import("node:fs")
    const st = JSON.parse(fs.readFileSync(statePath(persona), "utf8"))
    st.cookies.push({ name: "od-tenant", value: "northgate", domain: url.hostname, path: "/", httpOnly: true, secure: false, sameSite: "Lax", expires: -1 })
    fs.writeFileSync(statePath(persona), JSON.stringify(st))
    await ctx.dispose()
  }
  await buildWorld()
}
