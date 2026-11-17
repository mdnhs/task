import { beforeEach, expect, test } from "vitest"
import { call, resetDb, testApp } from "../../../test/harness"
import { makeMember, makeTenant, signIn } from "../../../test/factories"
import { RoleDto } from "./routes"

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
beforeEach(resetDb)

test("RoleDto.access only allows none|read|write, and every real role parses", async () => {
  const t = testApp()
  const tenant = await makeTenant(t.deps, { slug: "acme" })
  const owner = await makeMember(t.deps, tenant.id, "owner")
  const { cookie } = await signIn(t.app, owner.email, owner.password)
  const roles = (await (await call(t.app, "GET", "/v1/roles", { cookie, tenant: "acme" })).json()) as Json[]
  expect(roles.length).toBeGreaterThan(3)
  for (const r of roles) expect(RoleDto.safeParse(r).success, r.key).toBe(true)
  const sample = { ...roles[0] }
  expect(RoleDto.safeParse({ ...sample, access: { tasks: "admin" } }).success).toBe(false)
  expect(RoleDto.safeParse({ ...sample, access: { tasks: "write", payroll: "none" } }).success).toBe(true)
})
