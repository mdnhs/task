import { beforeEach, expect, test } from "vitest"
import { call, resetDb, testApp } from "../../../test/harness"
import { makeMember, makeStaff, makeTenant, roleIdOf, signIn } from "../../../test/factories"
import { resetSubscribers } from "../../core/events"
import { changeSubscription } from "."

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
beforeEach(async () => {
  await resetDb()
  resetSubscribers()
})

/** Ruling C13: a blocked tenant (402 billing_required on writes) can still revoke / disable and open data requests. */
async function world() {
  const t = testApp()
  const tenant = await makeTenant(t.deps, { slug: "acme" })
  const owner = await makeMember(t.deps, tenant.id, "owner")
  const employee = await makeMember(t.deps, tenant.id, "employee")
  const { cookie } = await signIn(t.app, owner.email, owner.password)
  const req = (method: string, path: string, body?: unknown) => call(t.app, method, path, { cookie, tenant: "acme", body })
  const ok = async (method: string, path: string, body: unknown, status: number) => {
    const r = await req(method, path, body)
    expect(r.status, `${method} ${path}`).toBe(status)
    return (await r.json().catch(() => ({}))) as Json
  }
  // resources created while the tenant still pays
  const key = await ok("POST", "/v1/api-keys", { name: "ci", scopes: ["settings:read"] }, 201)
  const key2 = await ok("POST", "/v1/api-keys", { name: "ci2", scopes: ["settings:read"] }, 201)
  const hook = await ok("POST", "/v1/webhooks", { url: "https://hooks.example.com/a", events: ["team.created"] }, 201)
  const hook2 = await ok("POST", "/v1/webhooks", { url: "https://hooks.example.com/b", events: ["team.created"] }, 201)
  const hook3 = await ok("POST", "/v1/webhooks", { url: "https://hooks.example.com/c", events: ["team.created"] }, 201)
  const device = await ok("POST", "/v1/devices", { userId: employee.userId, type: "pc", owner: "company", label: "PC", trusted: true }, 201)
  const device2 = await ok("POST", "/v1/devices", { userId: employee.userId, type: "pc", owner: "company", label: "PC 2", trusted: true }, 201)
  const inv = await ok("POST", "/v1/invites", { email: "new.hire@example.com", roleId: await roleIdOf(t.deps, tenant.id, "employee") }, 201)
  const staff = await makeStaff(t.deps, "support")
  const g = (await (await call(t.app, "POST", `/v1/platform/tenants/${tenant.id}/support-grants`, { cookie: staff.cookie!, body: { reason: "Ticket 4411: report totals look wrong", hours: 2 } })).json()) as Json
  await changeSubscription(t.deps, tenant.id, owner.userId, { status: "canceled" })
  return { ...t, tenant, owner, employee, req, ok, key, key2, hook, hook2, hook3, device, device2, inv, grant: g }
}

test("blocked tenant: non-exempt writes are still 402, revoke/disable routes are 2xx", async () => {
  const w = await world()
  expect(((await (await w.req("POST", "/v1/_probe/write")).json()) as Json).code).toBe("billing_required")
  expect((await w.req("PATCH", `/v1/members/${w.employee.userId}`, { roleId: "x" })).status).toBe(402)
  // a PATCH that is not purely the disabling field stays blocked
  expect(((await (await w.req("PATCH", `/v1/webhooks/${w.hook3.id}`, { events: ["team.updated"] })).json()) as Json).code).toBe("billing_required")
  expect((await w.req("PATCH", `/v1/webhooks/${w.hook3.id}`, { active: true })).status).toBe(402) // resuming is not a disable
  expect((await w.req("PATCH", `/v1/webhooks/${w.hook3.id}`, { active: false, url: "https://hooks.example.com/z" })).status).toBe(402)
  expect((await w.req("PATCH", `/v1/devices/${w.device.id}`, { label: "renamed" })).status).toBe(402)
  expect((await w.req("POST", "/v1/api-keys", { name: "n", scopes: ["settings:read"] })).status).toBe(402)

  await w.ok("DELETE", `/v1/api-keys/${w.key.id}`, undefined, 200)
  await w.ok("DELETE", `/v1/webhooks/${w.hook.id}`, undefined, 204)
  expect((await w.ok("PATCH", `/v1/webhooks/${w.hook2.id}`, { active: false }, 200)).active).toBe(false)
  await w.ok("DELETE", `/v1/settings/support-grants/${w.grant.id}`, undefined, 200)
  expect((await w.ok("PATCH", `/v1/devices/${w.device.id}`, { trusted: false }, 200)).trusted).toBe(false)
  // T6.5: revoking an invite and retiring a device are security duties too (a leaked link, a lost PC); creating or re-sending an invite is not
  await w.ok("DELETE", `/v1/invites/${w.inv.id}`, undefined, 204)
  await w.ok("DELETE", `/v1/devices/${w.device2.id}`, undefined, 204)
  expect((await w.req("POST", "/v1/invites", { email: "late@example.com", roleId: await roleIdOf(w.deps, w.tenant.id, "employee") })).status).toBe(402)
  for (const kind of ["export", "erase", "correct", "restrict"]) {
    const r = await w.req("POST", "/v1/data-requests", { subjectUserId: w.employee.userId, kind, reason: `Subject asked for ${kind} by email` })
    expect(r.status, kind).not.toBe(402)
  }
})

/** Ruling K5 (B6 T6.5): marking a notification read changes no business data, so a blocked tenant can still dismiss billing notices. */
test("blocked tenant: notification read and read-all are 2xx, a non-exempt write is still 402", async () => {
  const w = await world()
  const list = (await (await w.req("GET", "/v1/notifications")).json()) as Json
  expect(list.items.length, "the billing notice raised by the cancel is there to read").toBeGreaterThan(0)
  const id = list.items[0].id as string
  const one = await w.req("POST", `/v1/notifications/${id}/read`)
  expect(one.status).toBe(200)
  const all = await w.req("POST", "/v1/notifications/read-all")
  expect(all.status).toBe(200)
  expect(((await (await w.req("POST", "/v1/_probe/write")).json()) as Json).code).toBe("billing_required")
  // another route that merely ends in /read is not exempt
  expect((await w.req("POST", `/v1/tasks/${id}/read`)).status).not.toBe(200)
  // and only POST is exempt: a DELETE on the same path is not
  expect((await w.req("DELETE", `/v1/notifications/${id}/read`)).status).not.toBe(200)
})
