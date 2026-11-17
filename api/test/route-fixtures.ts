import type { AppType } from "../src/app"
import type { Deps } from "../src/deps"
import { ownerTenantQuery } from "./db"
import { call } from "./harness"
import { makeMember, roleIdOf, signIn } from "./factories"
import { notify, withTenantAfterCommit } from "../src/modules/notifications"

/**
 * Fixtures for the cross-tenant walker (isolation.test.ts, AC-M0-01).
 *
 * EVERY LATER PHASE ADDS ITS ROUTES HERE. A `/v1` route with a path param that has no entry in `ROUTE_PARAMS`
 * (or a param with no resource mapping) makes the walker fail by name, so a new endpoint cannot ship un-walked.
 *
 * Deviation from the brief's flat `Record<param, id>`: `{id}` means a role, a team or a device depending on the
 * route, so a flat map cannot give a real record per route. Fixtures are therefore keyed by the OpenAPI path
 * template, then by param name.
 *
 * `kind: "id"`     the value is a real record id belonging to that tenant (the walker asserts 404 for tenant B's).
 * `kind: "static"` the value is a fixed vocabulary word (e.g. a device feature), not a tenant record.
 */
export type Fixture = { kind: "id" | "static"; value: string }
export type TenantFixtures = Record<string, Record<string, Fixture>>

type Resource = "role" | "member" | "team" | "device" | "feature" | "notification" | "pushToken" | "file" | "integration" | "dataRequest" | "supportGrant" | "apiKey" | "webhook" | "task" | "checklistItem" | "comment" | "taskFile" | "project" | "milestone" | "template" | "evidence"

/** path template -> param -> which resource that param names on that route. */
export const ROUTE_PARAMS: Record<string, Record<string, Resource>> = {
  "/v1/roles/{id}": { id: "role" },
  "/v1/roles/{id}/clone": { id: "role" },
  "/v1/members/{userId}": { userId: "member" },
  "/v1/members/{userId}/manager": { userId: "member" },
  "/v1/teams/{id}": { id: "team" },
  "/v1/teams/{id}/members": { id: "team" },
  "/v1/devices/{id}": { id: "device" },
  "/v1/devices/{id}/bind": { id: "device" },
  "/v1/devices/{id}/enrolment-code": { id: "device" },
  "/v1/device-policies/{feature}": { feature: "feature" },
  "/v1/notifications/{id}/read": { id: "notification" },
  "/v1/me/push-tokens/{id}": { id: "pushToken" },
  "/v1/files/{id}": { id: "file" },
  "/v1/files/{id}/complete": { id: "file" },
  "/v1/files/{id}/download": { id: "file" },
  "/v1/integrations/{id}": { id: "integration" },
  "/v1/data-requests/{id}": { id: "dataRequest" },
  "/v1/data-requests/{id}/complete": { id: "dataRequest" },
  "/v1/data-requests/{id}/reject": { id: "dataRequest" },
  "/v1/data-requests/{id}/retry": { id: "dataRequest" },
  "/v1/settings/support-grants/{id}": { id: "supportGrant" },
  "/v1/api-keys/{id}": { id: "apiKey" },
  "/v1/webhooks/{id}": { id: "webhook" },
  "/v1/tasks/{id}": { id: "task" },
  "/v1/tasks/{id}/assignees": { id: "task" },
  "/v1/tasks/{id}/status": { id: "task" },
  "/v1/tasks/{id}/complete": { id: "task" },
  "/v1/tasks/{id}/history": { id: "task" },
  "/v1/tasks/{id}/checklist": { id: "task" },
  "/v1/tasks/{id}/checklist/{itemId}": { id: "task", itemId: "checklistItem" },
  "/v1/tasks/{id}/subtasks": { id: "task" },
  "/v1/tasks/{id}/comments": { id: "task" },
  "/v1/tasks/{id}/comments/{commentId}": { id: "task", commentId: "comment" },
  "/v1/tasks/{id}/uploads": { id: "task" },
  "/v1/tasks/{id}/uploads/{fileId}/complete": { id: "task", fileId: "taskFile" },
  "/v1/tasks/{id}/files/{fileId}/download": { id: "task", fileId: "taskFile" },
  "/v1/tasks/{id}/dependencies": { id: "task" },
  "/v1/tasks/{id}/reschedule": { id: "task" },
  "/v1/tasks/{id}/reschedule/preview": { id: "task" },
  "/v1/tasks/{id}/date-proposal": { id: "task" },
  "/v1/tasks/{id}/date-proposal/approve": { id: "task" },
  "/v1/tasks/{id}/date-proposal/decline": { id: "task" },
  "/v1/tasks/{id}/repeat": { id: "task" },
  "/v1/tasks/{id}/archive": { id: "task" },
  "/v1/tasks/{id}/restore": { id: "task" },
  "/v1/tasks/{id}/voice-note": { id: "task" },
  "/v1/tasks/{id}/voice-note/plays": { id: "task" },
  "/v1/tasks/{id}/evidence-rule": { id: "task" },
  "/v1/tasks/{id}/evidence": { id: "task" },
  "/v1/tasks/{id}/evidence/{evidenceId}": { id: "task", evidenceId: "evidence" },
  "/v1/tasks/{id}/evidence/{evidenceId}/download": { id: "task", evidenceId: "evidence" },
  "/v1/tasks/{id}/verify": { id: "task" },
  "/v1/tasks/{id}/reject": { id: "task" },
  "/v1/task-templates/{id}": { id: "template" },
  "/v1/projects/{id}": { id: "project" },
  "/v1/projects/{id}/milestones": { id: "project" },
  "/v1/projects/{id}/milestones/{milestoneId}": { id: "project", milestoneId: "milestone" },
}

export type Actor = { userId: string; cookie: string; slug: string }
export type World = {
  tenant: { id: string; slug: string }
  owner: Actor
  staff: Actor
  /** a distinctive string per kind of tenant data; the walker greps 404 bodies for these */
  marks: string[]
  fixtures: TenantFixtures
  resources: Record<Exclude<Resource, "feature">, string>
}

let n = 0

/** One member with a signed-in session in `tenant`. */
export async function actorIn(t: { app: AppType; deps: Deps }, tenant: { id: string; slug: string }, roleKey: string): Promise<Actor & { email: string }> {
  const m = await makeMember(t.deps, tenant.id, roleKey)
  return { userId: m.userId, email: m.email, slug: tenant.slug, cookie: (await signIn(t.app, m.email, m.password)).cookie }
}

/** Creates one role/member/team/device in the tenant (through the real API as its owner) and maps every walked route param to them. */
export async function fixtureIds(t: { app: AppType; deps: Deps }, tenant: { id: string; slug: string }, owner: Actor, staff: Actor, deviceUser: Actor = staff): Promise<{ fixtures: TenantFixtures; resources: World["resources"]; marks: string[] }> {
  const uniq = `${tenant.slug}-${(n++).toString(36)}`
  const post = async (path: string, body: unknown) => {
    const r = await call(t.app, "POST", path, { cookie: owner.cookie, tenant: tenant.slug, body })
    if (r.status !== 201) throw new Error(`fixture POST ${path} failed: ${r.status} ${await r.text()}`)
    return (await r.json()) as { id: string; name?: string; label?: string }
  }
  const team = await post("/v1/teams", { name: `Team ${uniq}`, kind: "team" })
  const device = await post("/v1/devices", { userId: deviceUser.userId, type: "pc", owner: "company", label: `Device ${uniq}`, trusted: true })
  // the owner's own notification and push token (the walker acts as the owner of A; ids of B's owner must 404)
  await withTenantAfterCommit(t.deps, tenant.id, (tx, enqueue) => notify(tx, tenant.id, { userId: owner.userId, kind: "system", title: `Notice ${uniq}`, body: "b" }, t.deps, enqueue))
  const [notif] = await ownerTenantQuery(tenant.id, "select id from notifications where title = $1", [`Notice ${uniq}`])
  const tokRes = await call(t.app, "POST", "/v1/me/push-tokens", { cookie: owner.cookie, tenant: tenant.slug, body: { token: `fcm-${uniq}-xxxxxxxx`, platform: "android" } })
  if (tokRes.status !== 201) throw new Error(`fixture push token failed: ${tokRes.status}`)
  const fileRes = await call(t.app, "POST", "/v1/files/uploads", { cookie: owner.cookie, tenant: tenant.slug, body: { name: `File ${uniq}.pdf`, mime: "application/pdf", sizeBytes: 1024 } })
  if (fileRes.status !== 201) throw new Error(`fixture file intent failed: ${fileRes.status}`)
  const file = (await fileRes.json()) as { fileId: string }
  // the tenant's (single) google connection, reset to `connected` by every call; the ciphertext is junk on purpose (never opened by the walked route)
  const [integ] = await ownerTenantQuery(
    tenant.id,
    `insert into integration_connections (tenant_id, provider, status, scopes, account_email, token_ciphertext, connected_by, connected_at)
     values ($1::uuid, 'google', 'connected', array['openid'], $3, 'v2:junk', $2, now())
     on conflict (tenant_id, provider) do update set status = 'connected', token_ciphertext = 'v2:junk', account_email = $3 returning id`,
    [tenant.id, owner.userId, `drive-${uniq}@example.com`],
  )
  // a pending `correct` request about the staff member (correct is the one kind with no job and no open-request limit, so the fixture can be made again and again)
  const dsr = await post("/v1/data-requests", { subjectUserId: staff.userId, kind: "correct", reason: `Fix ${uniq}` })
  // an ACTIVE support grant (T3.5) for a made-up staff id, starting now by deps.clock (the revoke checks that clock)
  const now = t.deps.clock.now()
  const [sg] = await ownerTenantQuery(
    tenant.id,
    `insert into support_grants (tenant_id, staff_user_id, reason, granted_by, starts_at, expires_at) values ($1::uuid, $2, $3, $2, $4, $5) returning id`,
    [tenant.id, `usr_staff_${uniq}`, `Support ${uniq}`, now, new Date(now.getTime() + 3_600_000)],
  )
  // an API key and a webhook endpoint of the tenant (T3.6), made through the real API as its owner
  const keyRes = await call(t.app, "POST", "/v1/api-keys", { cookie: owner.cookie, tenant: tenant.slug, body: { name: `Key ${uniq}`, scopes: ["settings:write"] } })
  if (keyRes.status !== 201) throw new Error(`fixture api key failed: ${keyRes.status} ${await keyRes.text()}`)
  const apiKey = (await keyRes.json()) as { id: string; prefix: string }
  // fixtures are made again and again (one per walked operation): retire earlier endpoints so the 10-per-tenant limit never bites
  await ownerTenantQuery(tenant.id, "update webhook_endpoints set deleted_at = now(), active = false where deleted_at is null")
  const hookRes = await call(t.app, "POST", "/v1/webhooks", { cookie: owner.cookie, tenant: tenant.slug, body: { url: `https://hooks-${uniq}.example.com/in`, events: ["team.created"] } })
  if (hookRes.status !== 201) throw new Error(`fixture webhook failed: ${hookRes.status} ${await hookRes.text()}`)
  const hook = (await hookRes.json()) as { id: string }
  // a task of the tenant (B4), made through the real API as its owner: assigned to the staff member
  const taskRes = await call(t.app, "POST", "/v1/tasks", { cookie: owner.cookie, tenant: tenant.slug, body: { title: `Task ${uniq}`, description: `Desc ${uniq}`, start: "2026-11-20T09:00:00", due: "2026-11-20T17:00:00", primary: staff.userId } })
  if (taskRes.status !== 201) throw new Error(`fixture task failed: ${taskRes.status} ${await taskRes.text()}`)
  const task = (await taskRes.json()) as { id: string; ref: string }
  // T4.2: a checklist item, a comment and an (unfinished) attachment upload of that task, through the real API as its owner
  const sub = async (path: string, body: unknown) => {
    const r = await call(t.app, "POST", `/v1/tasks/${task.id}/${path}`, { cookie: owner.cookie, tenant: tenant.slug, body })
    if (r.status !== 201) throw new Error(`fixture ${path} failed: ${r.status} ${await r.text()}`)
    return (await r.json()) as { id?: string; fileId?: string }
  }
  const item = await sub("checklist", { text: `Item ${uniq}` })
  const comment = await sub("comments", { body: `Comment ${uniq}` })
  const taskFile = await sub("uploads", { purpose: "attachment", name: `Attach ${uniq}.pdf`, mime: "application/pdf", sizeBytes: 1024 })
  // T4.6: an evidence item of that task (a pdf whose file upload is unfinished, so its download is 409 file_not_ready), through the real API as its owner
  const evFile = await sub("uploads", { purpose: "evidence", name: `Evid ${uniq}.pdf`, mime: "application/pdf", sizeBytes: 1024 })
  const evItem = await sub("evidence", { kind: "pdf", fileId: evFile.fileId })
  // T4.3: a project (with a milestone) of the tenant, through the real API as its owner
  const projectRes = await call(t.app, "POST", "/v1/projects", { cookie: owner.cookie, tenant: tenant.slug, body: { name: `Project ${uniq}`, description: `Plan ${uniq}` } })
  if (projectRes.status !== 201) throw new Error(`fixture project failed: ${projectRes.status} ${await projectRes.text()}`)
  const project = (await projectRes.json()) as { id: string }
  const msRes = await call(t.app, "POST", `/v1/projects/${project.id}/milestones`, { cookie: owner.cookie, tenant: tenant.slug, body: { name: `Milestone ${uniq}`, due: "2026-12-04" } })
  if (msRes.status !== 201) throw new Error(`fixture milestone failed: ${msRes.status} ${await msRes.text()}`)
  const milestone = (await msRes.json()) as { id: string }
  // T4.4: a task template of the tenant, through the real API as its owner
  const tplRes = await call(t.app, "POST", "/v1/task-templates", { cookie: owner.cookie, tenant: tenant.slug, body: { name: `Template ${uniq}`, title: `Blueprint ${uniq}`, description: `Steps ${uniq}` } })
  if (tplRes.status !== 201) throw new Error(`fixture template failed: ${tplRes.status} ${await tplRes.text()}`)
  const template = (await tplRes.json()) as { id: string }
  const resources = { evidence: evItem.id!, template: template.id, project: project.id, milestone: milestone.id, checklistItem: item.id!, comment: comment.id!, taskFile: taskFile.fileId!, task: task.id, apiKey: apiKey.id, webhook: hook.id, supportGrant: String(sg.id), dataRequest: dsr.id, integration: String(integ.id), file: file.fileId, role: await roleIdOf(t.deps, tenant.id, "employee"), member: staff.userId, team: team.id, device: device.id, notification: String(notif.id), pushToken: ((await tokRes.json()) as { id: string }).id }
  const fixtures: TenantFixtures = {}
  for (const [path, params] of Object.entries(ROUTE_PARAMS)) {
    fixtures[path] = {}
    for (const [param, res] of Object.entries(params)) {
      fixtures[path][param] = res === "feature" ? { kind: "static", value: "drive" } : { kind: "id", value: resources[res] }
    }
  }
  return { fixtures, resources, marks: [tenant.id, tenant.slug, String(integ.id), `drive-${uniq}@example.com`, team.id, device.id, file.fileId, dsr.id, `Fix ${uniq}`, `Support ${uniq}`, String(sg.id), `File ${uniq}.pdf`, staff.userId, owner.userId, `Team ${uniq}`, `Device ${uniq}`, apiKey.id, apiKey.prefix, `Key ${uniq}`, hook.id, `hooks-${uniq}.example.com`, task.id, `Task ${uniq}`, `Desc ${uniq}`, item.id!, comment.id!, taskFile.fileId!, `Item ${uniq}`, `Comment ${uniq}`, `Attach ${uniq}.pdf`, project.id, milestone.id, template.id, `Template ${uniq}`, `Blueprint ${uniq}`, `Steps ${uniq}`, evItem.id!, evFile.fileId!, `Evid ${uniq}.pdf`, `Project ${uniq}`, `Plan ${uniq}`, `Milestone ${uniq}`] }
}
