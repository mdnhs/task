import { describe, expect, test, vi } from "vitest"
import { fakeApi, problem } from "@/test/support/fake-api"
import { makeActionRunner } from "@/lib/api/action"
import { ApiError, userMessage } from "@/lib/api/problem"
import {
  fieldErrorOf, organisationPatch, roleUuid, toDataRequest, toDepartments, toDevice, toGrant, toIntegration, toInvites, toOrganisation, toRoles, toUsers,
} from "./adapters"
import { makeSettingsClient } from "./client"

const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const ROLE_DTOS = [
  { id: UUID(1), key: "owner", label: "Owner", description: "", home: "manager", access: { settings: "write", tasks: "write", audit: "write" }, fieldRules: {}, isTemplate: true, clonedFrom: null },
  { id: UUID(2), key: "admin", label: "Admin", description: "", home: "manager", access: { settings: "write", tasks: "read", audit: "write" }, fieldRules: {}, isTemplate: false, clonedFrom: null },
  { id: UUID(3), key: "employee", label: "Employee", description: "", home: "staff", access: { settings: "none", tasks: "write" }, fieldRules: {}, isTemplate: false, clonedFrom: null },
]
const nav = () => ({ go: vi.fn() })

describe("T6.5 settings adapters: strict, keyed by role KEY, no silent defaults", () => {
  test("toOrganisation keeps the DTO's fields and throws on a missing one", () => {
    const dto = { name: "Acme", slug: "acme", timezone: "Europe/Dublin", currency: "EUR", locale: "en-IE", reportDeadline: "17:30", reportDueAfterMinutes: 60 }
    expect(toOrganisation(dto)).toEqual(dto)
    const { timezone: _tz, ...bad } = dto
    expect(() => toOrganisation(bad)).toThrow(/timezone/)
  })

  test("organisationPatch sends only what changed (never the slug), and nothing when nothing changed", () => {
    const cur = toOrganisation({ name: "Acme", slug: "acme", timezone: "Europe/Dublin", currency: "EUR", locale: "en-IE", reportDeadline: "17:30", reportDueAfterMinutes: 60 })
    expect(organisationPatch(cur, { name: "Acme Ltd", timezone: "Europe/Dublin", reportDeadline: "17:30" })).toEqual({ name: "Acme Ltd" })
    expect(organisationPatch(cur, { name: "Acme", timezone: "Europe/London", reportDeadline: "18:00" })).toEqual({ timezone: "Europe/London", reportDeadline: "18:00" })
    expect(organisationPatch(cur, { name: "  Acme  ", timezone: "Europe/Dublin", reportDeadline: "17:30" })).toEqual({})
  })

  test("API field codes become field errors (invalid colour, timezone, name, deadline); anything else is not a field error", () => {
    expect(fieldErrorOf(new ApiError(422, "invalid_color", "r"))).toMatchObject({ field: "color" })
    expect(fieldErrorOf(new ApiError(422, "invalid_timezone", "r"))).toMatchObject({ field: "timezone" })
    expect(fieldErrorOf(new ApiError(422, "invalid_name", "r"))).toMatchObject({ field: "name" })
    expect(fieldErrorOf(new ApiError(422, "invalid_report_deadline", "r"))).toMatchObject({ field: "reportDeadline" })
    expect(fieldErrorOf(new ApiError(422, "invalid_logo", "r"))).toMatchObject({ field: "logo" })
    expect(fieldErrorOf(new ApiError(500, "boom", "r"))).toBeNull()
    expect(fieldErrorOf(new ApiError(422, "invalid_color", "r"))!.message).not.toMatch(/invalid_color/)
  })

  test("toRoles: FE Role.id is the KEY, the uuid is kept for writes; roleUuid maps a key to its uuid and refuses an unknown key", () => {
    const roles = toRoles(ROLE_DTOS)
    expect(roles.map((r) => r.id)).toEqual(["owner", "admin", "employee"])
    expect(roles[1]).toMatchObject({ id: "admin", uuid: UUID(2), label: "Admin", locked: false })
    expect(roles[0]!.locked).toBe(true) // the owner column is fixed
    expect(toRoles([{ ...ROLE_DTOS[1]!, isTemplate: true }])[0]!.locked).toBe(true) // a built-in role is read-only (409 template_locked); a copy is editable
    expect(roles[2]!.access.settings).toBe("none")
    expect(roles[2]!.access.audit).toBe("none") // a module the role has no entry for reads as none
    expect(roleUuid(roles, "employee")).toBe(UUID(3))
    expect(() => roleUuid(roles, "nope")).toThrow(/role/)
  })

  test("toUsers: user id, role key, department from the team membership; an erased user reads as a former member; no deactivated state exists", () => {
    const people = [
      { userId: "u1", name: "Ada Byrne", email: "ada@example.com", roleKey: "admin", managerId: null },
      { userId: "u2", name: "Erased user", email: "erased+x@invalid", roleKey: "employee", managerId: null },
    ]
    const users = toUsers(people, (id) => (id === "u1" ? "Security" : ""))
    expect(users[0]).toEqual({ id: "u1", name: "Ada Byrne", email: "ada@example.com", role: "admin", dept: "Security" })
    expect(users[1]!.name).toBe("Former member")
  })

  test("toInvites maps the DTO (expiry in the tenant's wall time, role key) and never has a token field", () => {
    const rows = toInvites({ items: [{ id: UUID(9), email: "n@example.com", roleKey: "employee", createdAt: "2026-11-18T09:00:00.000Z", expiresAt: "2026-11-25T23:30:00.000Z", invitedBy: "u1" }] }, "Pacific/Auckland")
    expect(rows).toEqual([{ id: UUID(9), email: "n@example.com", role: "employee", createdAt: "2026-11-18T22:00:00", expiresAt: "2026-11-26T12:30:00", invitedBy: "u1" }])
    expect(JSON.stringify(rows)).not.toMatch(/token/i)
  })

  test("toDepartments lists the department teams with their member counts", () => {
    expect(toDepartments([{ id: "t1", name: "Security", kind: "department", memberIds: ["a", "b"] }])).toEqual([{ id: "t1", name: "Security", members: 2 }])
  })

  test("toDevice, toGrant, toIntegration, toDataRequest map instants into the tenant's wall time and refuse malformed rows", () => {
    expect(toDevice({ id: "d1", userId: "u1", type: "pc", owner: "company", label: "PC", trusted: true, lastSeen: "2026-11-18T09:00:00.000Z" }, "Europe/Dublin").lastSeen).toBe("2026-11-18T09:00:00")
    expect(() => toDevice({ id: "d1", userId: "u1", type: "tablet", owner: "company", label: "PC", trusted: true, lastSeen: null }, "UTC")).toThrow(/type/)
    expect(toGrant({ id: "g1", tenantId: "t", staffUserId: "s", reason: "Ticket 4411", grantedBy: "s", startsAt: "2026-11-18T09:00:00.000Z", expiresAt: "2026-11-18T11:00:00.000Z", revokedAt: null, status: "active", staffName: "Aoife" }, "UTC")).toMatchObject({ id: "g1", who: "Aoife", status: "active", expiresAt: "2026-11-18T11:00:00" })
    expect(toIntegration({ id: "i1", provider: "google", status: "connected", scopes: [], accountEmail: "drive@example.com", connectedBy: "u1", connectedAt: "2026-11-17T09:00:00.000Z", lastRefreshAt: null }, "UTC")).toMatchObject({ id: "i1", name: "Google Drive", status: "connected", account: "drive@example.com" })
    expect(toIntegration({ id: "i2", provider: "google", status: "revoked", scopes: [], accountEmail: null, connectedBy: "u1", connectedAt: "2026-11-17T09:00:00.000Z", lastRefreshAt: null }, "UTC").status).toBe("not_connected")
    const dsr = toDataRequest({ id: "r1", subjectUserId: "u1", kind: "export", status: "pending", requestedBy: "u1", reason: "x", createdAt: "2026-11-17T09:00:00.000Z", dueAt: "2026-12-17T09:00:00.000Z", overdue: false, startedAt: null, completedAt: null, resultFileId: null, errorCode: null, notes: null }, "UTC", (id) => (id === "u1" ? "Ada Byrne" : id))
    expect(dsr).toMatchObject({ id: "r1", subject: "Ada Byrne", kind: "export", status: "pending", overdue: false, dueAt: "2026-12-17T09:00:00" })
  })
})

describe("T6.5 settings client: every write is one API call with the API's shapes", () => {
  test("role matrix: changing a member's role sends the role UUID found through the KEY map; an unknown key sends nothing", async () => {
    const { client, calls } = fakeApi({ "PATCH /v1/members/{userId}": { userId: "u1", roleId: UUID(3), roleKey: "employee" } })
    const roles = toRoles(ROLE_DTOS)
    await makeSettingsClient(client, nav()).changeRole("u1", "employee", roles)
    expect(calls[0]).toMatchObject({ method: "patch", path: "/v1/members/{userId}", body: { roleId: UUID(3) } })
    await expect(makeSettingsClient(client, nav()).changeRole("u1", "ghost", roles)).rejects.toThrow()
    expect(calls).toHaveLength(1)
  })

  test("a 403 role_escalation shows ONE toast with the clear copy and rolls the screen back", async () => {
    const { client } = fakeApi({ "PATCH /v1/members/{userId}": problem(403, "role_escalation") })
    const notify = vi.fn()
    const refresh = vi.fn()
    const rollback = vi.fn()
    const run = makeActionRunner({ notify, refresh })
    const r = await run("role:u1", () => makeSettingsClient(client, nav()).changeRole("u1", "admin", toRoles(ROLE_DTOS)), { rollback })
    expect(r.ok).toBe(false)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0]![0]).toEqual({ text: "That role has more access than yours.", ref: "req-1" })
    expect(rollback).toHaveBeenCalledTimes(1)
  })

  test("the roles matrix PATCHes the role by uuid with the one changed module", async () => {
    const { client, calls } = fakeApi({ "PATCH /v1/roles/{id}": ROLE_DTOS[1]! })
    await makeSettingsClient(client, nav()).setRoleAccess(UUID(2), "tasks", "write")
    expect(calls[0]).toMatchObject({ method: "patch", path: "/v1/roles/{id}", body: { access: { tasks: "write" } } })
  })

  test("users: invite posts the email and the role UUID; resend and revoke call the API; a 422 shows its message", async () => {
    const roles = toRoles(ROLE_DTOS)
    const ok = fakeApi({ "POST /v1/invites": { id: UUID(9), email: "n@example.com", expiresAt: "2026-11-25T00:00:00.000Z" }, "POST /v1/invites/{id}/resend": { id: UUID(9), email: "n@example.com", expiresAt: "2026-11-25T00:00:00.000Z" }, "DELETE /v1/invites/{id}": undefined })
    const c = makeSettingsClient(ok.client, nav())
    await c.invite("n@example.com", "employee", roles)
    await c.resendInvite(UUID(9))
    await c.revokeInvite(UUID(9))
    expect(ok.calls.map((x) => [x.method, x.path])).toEqual([["post", "/v1/invites"], ["post", "/v1/invites/{id}/resend"], ["delete", "/v1/invites/{id}"]])
    expect(ok.calls[0]!.body).toEqual({ email: "n@example.com", roleId: UUID(3) })
    const bad = fakeApi({ "POST /v1/invites": problem(422, "role_not_invitable") })
    const e = await makeSettingsClient(bad.client, nav()).invite("n@example.com", "owner", roles).catch((x: unknown) => x)
    expect(userMessage(e).text).toBe("That role can't be given by invite.")
    const full = fakeApi({ "POST /v1/invites/{id}/resend": problem(429, "resend_too_soon") })
    expect(userMessage(await makeSettingsClient(full.client, nav()).resendInvite(UUID(9)).catch((x: unknown) => x)).text).toBe("Sent a moment ago. Wait a minute.")
    for (const [code, text] of [["already_member", "Already a member."], ["invite_used", "That invite was already accepted."], ["seat_limit", "No seats left. Raise the plan's seats first."]] as const) {
      expect(userMessage(new ApiError(409, code, "r")).text).toBe(text)
    }
  })

  test("devices: register, trust toggle, remove, and the enrolment code are the API's calls; the code is returned to the caller only", async () => {
    const dev = { id: "d1", userId: "u1", type: "pc", owner: "company", label: "Front desk PC", trusted: true, lastSeen: null }
    const { client, calls } = fakeApi({ "POST /v1/devices": dev, "PATCH /v1/devices/{id}": { ...dev, trusted: false }, "DELETE /v1/devices/{id}": undefined, "POST /v1/devices/{id}/enrolment-code": { code: "ABCD2345JK", expiresAt: "2026-11-18T09:15:00.000Z" } })
    const c = makeSettingsClient(client, nav())
    await c.registerDevice({ userId: "u1", type: "pc", owner: "company", label: "Front desk PC", trusted: true })
    await c.setTrusted("d1", false)
    await c.removeDevice("d1")
    const code = await c.enrolmentCode("d1")
    expect(code).toEqual({ code: "ABCD2345JK", expiresAt: "2026-11-18T09:15:00.000Z" })
    expect(calls.map((x) => `${x.method} ${x.path}`)).toEqual(["post /v1/devices", "patch /v1/devices/{id}", "delete /v1/devices/{id}", "post /v1/devices/{id}/enrolment-code"])
    expect(calls[1]!.body).toEqual({ trusted: false })
    expect(JSON.stringify(calls)).not.toContain("ABCD2345JK") // the code is a response, never sent or kept
  })

  test("device policy and mfa policy PUT the API's shapes", async () => {
    const { client, calls } = fakeApi({ "PUT /v1/device-policies/{feature}": { feature: "drive", allow: "any" }, "PUT /v1/settings/mfa-policy": { mode: "roles", roles: ["admin"] } })
    const c = makeSettingsClient(client, nav())
    await c.setDevicePolicy("drive", "trusted-company-pc")
    await c.setMfaPolicy({ mode: "roles", roles: ["admin"] })
    expect(calls[0]).toMatchObject({ method: "put", path: "/v1/device-policies/{feature}", body: { allow: "trusted-company-pc" } })
    expect(calls[1]).toMatchObject({ method: "put", path: "/v1/settings/mfa-policy", body: { mode: "roles", roles: ["admin"] } })
  })

  test("departments: create (kind department), rename, delete; team_has_shifts and name clashes have their own copy", async () => {
    const { client, calls } = fakeApi({ "POST /v1/teams": { id: "t1", name: "Security", kind: "department", memberIds: [] }, "PATCH /v1/teams/{id}": { id: "t1", name: "Guarding", kind: "department", memberIds: [] }, "DELETE /v1/teams/{id}": undefined })
    const c = makeSettingsClient(client, nav())
    await c.createDepartment("Security")
    await c.renameDepartment("t1", "Guarding")
    await c.deleteDepartment("t1")
    expect(calls[0]).toMatchObject({ body: { name: "Security", kind: "department" } })
    expect(calls[1]).toMatchObject({ path: "/v1/teams/{id}", body: { name: "Guarding" } })
    expect(userMessage(new ApiError(409, "team_has_shifts", "r")).text).toBe("It still has shifts. Move or remove them first.")
    expect(userMessage(new ApiError(409, "team_name_taken", "r")).text).toBe("That name is taken.")
    expect(userMessage(new ApiError(409, "template_dept_exists", "r")).text).toBe("The report template already has a department with that name.")
  })

  test("organisation and branding save only what the API accepts", async () => {
    const { client, calls } = fakeApi({ "PATCH /v1/settings/organisation": { name: "Acme Ltd", slug: "acme", timezone: "Europe/Dublin", currency: "EUR", locale: "en-IE", reportDeadline: "17:30", reportDueAfterMinutes: 60 }, "PUT /v1/settings/branding": { primaryColor: "#1A8A3A", logo: null, favicon: null, storageReady: true } })
    const c = makeSettingsClient(client, nav())
    await c.saveOrganisation({ name: "Acme Ltd" })
    await c.saveBranding({ color: "#1a8a3a" })
    expect(calls[0]!.body).toEqual({ name: "Acme Ltd" })
    expect(calls[1]!.body).toEqual({ primaryColor: "#1a8a3a" })
    await expect(c.saveOrganisation({})).rejects.toThrow() // an empty patch is not sent
    expect(calls).toHaveLength(2)
  })

  test("privacy: the export is POST /v1/me/data-export; opening a request and revoking a support grant call the API", async () => {
    const dsr = { id: "r1", subjectUserId: "u1", kind: "export", status: "pending", requestedBy: "u1", reason: "x", createdAt: "2026-11-17T09:00:00.000Z", dueAt: "2026-12-17T09:00:00.000Z", overdue: false, startedAt: null, completedAt: null, resultFileId: null, errorCode: null, notes: null }
    const { client, calls } = fakeApi({ "POST /v1/me/data-export": dsr, "POST /v1/data-requests": { ...dsr, kind: "erase" }, "DELETE /v1/settings/support-grants/{id}": { id: "g1" } })
    const c = makeSettingsClient(client, nav())
    await c.requestExport()
    await c.openRequest({ subjectUserId: "u1", kind: "erase", reason: "Asked by email" })
    await c.revokeGrant("g1")
    expect(calls.map((x) => `${x.method} ${x.path}`)).toEqual(["post /v1/me/data-export", "post /v1/data-requests", "delete /v1/settings/support-grants/{id}"])
    expect(calls[1]!.body).toEqual({ subjectUserId: "u1", kind: "erase", reason: "Asked by email" })
  })

  test("integrations: Google start follows the returned consent URL on Google's own host only; disconnect is a DELETE", async () => {
    const good = fakeApi({ "POST /v1/integrations/google/start": { url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=y" } })
    const n = nav()
    await makeSettingsClient(good.client, n).startGoogle()
    expect(n.go).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=y")
    for (const url of ["https://accounts.google.com.evil.example/x", "https://evil.example/x", "http://accounts.google.com/x", "javascript:alert(1)", "//evil.example"]) {
      const bad = fakeApi({ "POST /v1/integrations/google/start": { url } })
      const n2 = nav()
      await expect(makeSettingsClient(bad.client, n2).startGoogle()).rejects.toThrow()
      expect(n2.go, url).not.toHaveBeenCalled()
    }
    const del = fakeApi({ "DELETE /v1/integrations/{id}": undefined })
    await makeSettingsClient(del.client, nav()).disconnect("i1")
    expect(del.calls[0]).toMatchObject({ method: "delete", path: "/v1/integrations/{id}" })
    expect(userMessage(new ApiError(503, "integration_not_configured", "r")).text).toBe("Google is not set up for this workspace yet.")
  })
})

describe("organization logo and favicon upload", () => {
  const BRANDING = { primaryColor: null, logo: { version: "9f86d081884c7d65", mime: "image/png", width: 120, height: 40, sizeBytes: 3 }, favicon: null, storageReady: true }
  const file = (name = "logo.png", type = "image/png", size = 3) => ({ name, type, size, arrayBuffer: async () => new ArrayBuffer(size) })
  const intent = { fileId: "f1", upload: { method: "PUT", url: "https://storage.example/put?sig=1", headers: { "Content-Type": "image/png", "Content-Length": "3" } } }
  test("intent, direct PUT with the signed headers (progress reported), complete, waits for a CLEAN scan, then makes it live", async () => {
    let polls = 0
    const { client, calls } = fakeApi({
      "POST /v1/settings/branding/{kind}/uploads": intent,
      "POST /v1/settings/branding/{kind}/uploads/{fileId}/complete": { fileId: "f1", status: "pending" },
      "GET /v1/settings/branding/{kind}/uploads/{fileId}": () => ({ fileId: "f1", status: ++polls < 2 ? "pending" : "clean" }),
      "PUT /v1/settings/branding/{kind}": BRANDING,
    })
    const put = vi.fn(async (_url: string, _init: unknown, onProgress?: (p: number) => void) => { onProgress?.(0.5); onProgress?.(1); return { ok: true } })
    const stages: string[] = []
    const progress: number[] = []
    const out = await makeSettingsClient(client, nav()).uploadBrandAsset("logo", file(), { put, wait: async () => undefined, onStage: (s) => stages.push(s), onProgress: (p) => progress.push(p) })
    expect(out).toEqual(BRANDING)
    expect(put).toHaveBeenCalledWith("https://storage.example/put?sig=1", expect.objectContaining({ headers: { "Content-Type": "image/png", "Content-Length": "3" } }), expect.any(Function))
    expect(calls[0]).toMatchObject({ method: "post", path: "/v1/settings/branding/{kind}/uploads", body: { name: "logo.png", mime: "image/png", sizeBytes: 3 } })
    expect(calls.at(-1)).toMatchObject({ method: "put", path: "/v1/settings/branding/{kind}", body: { fileId: "f1" } })
    expect(polls).toBe(2)
    expect(stages).toEqual(["uploading", "checking", "scanning", "saving"])
    expect(progress).toEqual([0.5, 1])
  })
  test("an .ico is sent as image/x-icon; a type the API never takes is refused before any call", async () => {
    const { client, calls } = fakeApi({ "POST /v1/settings/branding/{kind}/uploads": intent })
    const c = makeSettingsClient(client, nav())
    await expect(c.uploadBrandAsset("favicon", file("f.svg", "image/svg+xml"), { put: async () => ({ ok: true }) })).rejects.toThrow(/unsupported/)
    await expect(c.uploadBrandAsset("logo", file("a.ico", "image/x-icon"), { put: async () => ({ ok: true }) })).rejects.toThrow(/unsupported/)
    expect(calls).toHaveLength(0)
    await c.uploadBrandAsset("favicon", file("favicon.ico", ""), { put: async () => ({ ok: false }) }).catch(() => undefined)
    expect(calls[0]!.body).toMatchObject({ name: "favicon.ico", mime: "image/x-icon" })
  })
  test("an infected file, a refused check and a failed PUT throw (nothing goes live); storage not set up is the API's 503", async () => {
    const base = { "POST /v1/settings/branding/{kind}/uploads": intent }
    const infected = fakeApi({ ...base, "POST /v1/settings/branding/{kind}/uploads/{fileId}/complete": { fileId: "f1", status: "pending" }, "GET /v1/settings/branding/{kind}/uploads/{fileId}": { fileId: "f1", status: "infected" } })
    await expect(makeSettingsClient(infected.client, nav()).uploadBrandAsset("logo", file(), { put: async () => ({ ok: true }), wait: async () => undefined })).rejects.toMatchObject({ code: "file_infected" })
    expect(infected.paths()).not.toContain("PUT /v1/settings/branding/{kind}")
    const refused = fakeApi({ ...base, "POST /v1/settings/branding/{kind}/uploads/{fileId}/complete": problem(422, "image_not_square") })
    await expect(makeSettingsClient(refused.client, nav()).uploadBrandAsset("favicon", file("f.png"), { put: async () => ({ ok: true }) })).rejects.toMatchObject({ status: 422, code: "image_not_square" })
    const failed = fakeApi(base)
    await expect(makeSettingsClient(failed.client, nav()).uploadBrandAsset("logo", file(), { put: async () => ({ ok: false }) })).rejects.toThrow(/upload failed/)
    expect(failed.paths()).toEqual(["POST /v1/settings/branding/{kind}/uploads"])
    const nostore = fakeApi({ "POST /v1/settings/branding/{kind}/uploads": problem(503, "storage_not_configured") })
    await expect(makeSettingsClient(nostore.client, nav()).uploadBrandAsset("logo", file(), { put: async () => ({ ok: true }) })).rejects.toMatchObject({ status: 503, code: "storage_not_configured" })
  })
  test("a scan that never finishes stops waiting", async () => {
    const { client } = fakeApi({ ...{ "POST /v1/settings/branding/{kind}/uploads": intent }, "POST /v1/settings/branding/{kind}/uploads/{fileId}/complete": { fileId: "f1", status: "pending" }, "GET /v1/settings/branding/{kind}/uploads/{fileId}": { fileId: "f1", status: "pending" } })
    await expect(makeSettingsClient(client, nav()).uploadBrandAsset("logo", file(), { put: async () => ({ ok: true }), wait: async () => undefined })).rejects.toThrow(/took too long/)
  })
  test("remove is a DELETE of the kind", async () => {
    const { client, calls } = fakeApi({ "DELETE /v1/settings/branding/{kind}": { ...BRANDING, logo: null } })
    expect(await makeSettingsClient(client, nav()).removeBrandAsset("logo")).toMatchObject({ logo: null })
    expect(calls[0]).toMatchObject({ method: "delete", path: "/v1/settings/branding/{kind}" })
  })
})
