import { beforeEach, describe, expect, test } from "vitest"
import { call, resetDb, testApp, testEnv } from "../../../test/harness"
import { ownerQuery } from "../../../test/db"
import { cookieFrom, makeApiKey, makeMember, makeTenant, makeUser } from "../../../test/factories"

const CHROME_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
const SAFARI_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
const IP = "203.0.113.77"

const signInAs = async (app: ReturnType<typeof testApp>["app"], email: string, password: string, ua: string) => {
  const res = await call(app, "POST", "/api/auth/sign-in/email", { body: { email, password }, headers: { origin: testEnv.APP_URL, "user-agent": ua, "x-forwarded-for": IP } })
  if (res.status !== 200) throw new Error(`sign-in ${res.status}`)
  return cookieFrom(res)
}
type Item = { id: string; label: string; createdAt: string; lastSeenAt: string; current: boolean }

beforeEach(resetDb)

describe("T6.3 GET/DELETE /v1/me/sessions (I21)", () => {
  test("lists the caller's sessions with a device label and last activity, marks the current one, and never returns a token or an IP", async () => {
    const t = testApp()
    const u = await makeUser(t.deps)
    const mac = await signInAs(t.app, u.email, u.password, CHROME_MAC)
    await signInAs(t.app, u.email, u.password, SAFARI_IOS)
    const r = await call(t.app, "GET", "/v1/me/sessions", { cookie: mac })
    expect(r.status).toBe(200)
    const text = await r.text()
    const { items } = JSON.parse(text) as { items: Item[] }
    expect(items).toHaveLength(2)
    expect(items.map((i) => i.label).sort()).toEqual(["Chrome on macOS", "Safari on iOS"])
    expect(items.filter((i) => i.current)).toHaveLength(1)
    expect(items.find((i) => i.current)?.label).toBe("Chrome on macOS")
    for (const i of items) {
      expect(Object.keys(i).sort()).toEqual(["createdAt", "current", "id", "label", "lastSeenAt"])
      expect(new Date(i.lastSeenAt).toString()).not.toBe("Invalid Date")
    }
    for (const row of await ownerQuery("select token, ip_address from session")) {
      expect(text).not.toContain(String(row.token))
      expect(text).not.toContain(String(row.ip_address))
    }
    expect(text).not.toContain(IP)
    expect(text).not.toMatch(/token|ipAddress|userAgent|Mozilla/i)
    expect(decodeURIComponent(mac)).not.toBe("")
  })

  test("an unknown or missing user agent is a neutral label, and another user's sessions never appear", async () => {
    const t = testApp()
    const a = await makeUser(t.deps)
    const b = await makeUser(t.deps)
    const ca = await signInAs(t.app, a.email, a.password, "curl/8.0")
    await signInAs(t.app, b.email, b.password, SAFARI_IOS)
    const { items } = (await (await call(t.app, "GET", "/v1/me/sessions", { cookie: ca })).json()) as { items: Item[] }
    expect(items.map((i) => i.label)).toEqual(["Unknown device"])
  })

  test("DELETE removes one of the caller's own other sessions (204), that session is dead, the current one survives", async () => {
    const t = testApp()
    const u = await makeUser(t.deps)
    const mac = await signInAs(t.app, u.email, u.password, CHROME_MAC)
    const ios = await signInAs(t.app, u.email, u.password, SAFARI_IOS)
    const { items } = (await (await call(t.app, "GET", "/v1/me/sessions", { cookie: mac })).json()) as { items: Item[] }
    const other = items.find((i) => !i.current)!
    const del = await call(t.app, "DELETE", `/v1/me/sessions/${other.id}`, { cookie: mac, headers: { origin: testEnv.APP_URL } })
    expect(del.status).toBe(204)
    expect((await call(t.app, "GET", "/v1/me", { cookie: ios })).status).toBe(401)
    expect((await call(t.app, "GET", "/v1/me", { cookie: mac })).status).toBe(200)
    expect(((await (await call(t.app, "GET", "/v1/me/sessions", { cookie: mac })).json()) as { items: Item[] }).items).toHaveLength(1)
  })

  test("another user's session id, a never-existing id and a malformed id are all 404 session_not_found, and nothing is deleted", async () => {
    const t = testApp()
    const a = await makeUser(t.deps)
    const b = await makeUser(t.deps)
    const ca = await signInAs(t.app, a.email, a.password, CHROME_MAC)
    const cb = await signInAs(t.app, b.email, b.password, SAFARI_IOS)
    const bId = ((await (await call(t.app, "GET", "/v1/me/sessions", { cookie: cb })).json()) as { items: Item[] }).items[0].id
    for (const id of [bId, "never-existed-id", "x".repeat(200)]) {
      const r = await call(t.app, "DELETE", `/v1/me/sessions/${encodeURIComponent(id)}`, { cookie: ca, headers: { origin: testEnv.APP_URL } })
      expect(r.status, id).toBe(404)
      expect(await r.json()).toMatchObject({ code: "session_not_found" })
    }
    expect((await call(t.app, "GET", "/v1/me", { cookie: cb })).status).toBe(200)
  })

  test("the current session cannot be removed here (409 current_session: signing out is the sign-out call)", async () => {
    const t = testApp()
    const u = await makeUser(t.deps)
    const c = await signInAs(t.app, u.email, u.password, CHROME_MAC)
    const cur = ((await (await call(t.app, "GET", "/v1/me/sessions", { cookie: c })).json()) as { items: Item[] }).items[0]
    const r = await call(t.app, "DELETE", `/v1/me/sessions/${cur.id}`, { cookie: c, headers: { origin: testEnv.APP_URL } })
    expect(r.status).toBe(409)
    expect(await r.json()).toMatchObject({ code: "current_session" })
  })

  test("no session: 401; a foreign Origin on DELETE: 403 bad_origin", async () => {
    const t = testApp()
    const u = await makeUser(t.deps)
    const c = await signInAs(t.app, u.email, u.password, CHROME_MAC)
    expect((await call(t.app, "GET", "/v1/me/sessions")).status).toBe(401)
    expect((await call(t.app, "DELETE", "/v1/me/sessions/abc", { headers: { origin: testEnv.APP_URL } })).status).toBe(401)
    expect((await call(t.app, "DELETE", "/v1/me/sessions/abc", { cookie: c, headers: { origin: "https://evil.example" } })).status).toBe(403)
  })

  test("an api key cannot read or delete sessions (human only), with or without a cookie", async () => {
    const t = testApp()
    const tenant = await makeTenant(t.deps)
    const owner = await makeMember(t.deps, tenant.id, "owner")
    const { key } = await makeApiKey(t.deps, tenant.id, owner.userId, ["settings:write"])
    const bearer = { authorization: `Bearer ${key}` }
    expect((await call(t.app, "GET", "/v1/me/sessions", { headers: bearer, tenant: tenant.slug })).status).toBe(401)
    expect((await call(t.app, "DELETE", "/v1/me/sessions/abc", { headers: bearer, tenant: tenant.slug })).status).toBe(401)
    expect((await call(t.app, "GET", "/v1/me/sessions", { headers: bearer })).status).toBe(401)
  })

  test("a 2FA user whose session has not passed the second factor gets 401 mfa_challenge on both calls", async () => {
    const t = testApp()
    const u = await makeUser(t.deps, { totp: true })
    const r = await call(t.app, "GET", "/v1/me/sessions", { cookie: u.staleCookie })
    expect(r.status).toBe(401)
    expect(await r.json()).toMatchObject({ code: "mfa_challenge" })
    const d = await call(t.app, "DELETE", "/v1/me/sessions/abc", { cookie: u.staleCookie, headers: { origin: testEnv.APP_URL } })
    expect(d.status).toBe(401)
    expect(await d.json()).toMatchObject({ code: "mfa_challenge" })
    expect((await call(t.app, "GET", "/v1/me/sessions", { cookie: u.cookie })).status).toBe(200) // the MFA-passed session
  })

  test("expired sessions (past their absolute expiry) are not listed", async () => {
    const t = testApp()
    const u = await makeUser(t.deps)
    const c = await signInAs(t.app, u.email, u.password, CHROME_MAC)
    await signInAs(t.app, u.email, u.password, SAFARI_IOS)
    await ownerQuery("update session set expires_at = now() - interval '1 day' where user_agent like 'Mozilla/5.0 (iPhone%'")
    expect(((await (await call(t.app, "GET", "/v1/me/sessions", { cookie: c })).json()) as { items: Item[] }).items).toHaveLength(1)
  })
})
