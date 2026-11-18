import type { AppType } from "../src/app"
import type { Deps } from "../src/deps"
import { ownerQuery, ownerTenantQuery } from "./db"
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

type Resource = "rosterWeek" | "rosterShift" | "changeRequest" | "exchange" | "leave" | "role" | "member" | "team" | "device" | "feature" | "notification" | "pushToken" | "file" | "integration" | "dataRequest" | "supportGrant" | "apiKey" | "webhook" | "task" | "checklistItem" | "comment" | "taskFile" | "project" | "milestone" | "template" | "evidence" | "pattern" | "assignment" | "report" | "reportFile" | "reportExport" | "session" | "invite" | "location" | "shiftType" | "lifecycleMember"

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
  "/v1/me/sessions/{id}": { id: "session" },
  "/v1/invites/{id}": { id: "invite" },
  "/v1/invites/{id}/resend": { id: "invite" },
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
  "/v1/shifts/patterns/{id}": { id: "pattern" },
  "/v1/shifts/assignments/{id}": { id: "assignment" },
  "/v1/shifts/reporting/teams/{teamId}": { teamId: "team" },
  "/v1/shifts/reporting/people/{userId}": { userId: "member" },
  "/v1/shift-reports/{id}": { id: "report" },
  "/v1/shift-reports/{id}/draft": { id: "report" },
  "/v1/shift-reports/{id}/submit": { id: "report" },
  "/v1/shift-reports/{id}/accept": { id: "report" },
  "/v1/shift-reports/{id}/return": { id: "report" },
  "/v1/shift-reports/{id}/versions": { id: "report" },
  "/v1/shift-reports/{id}/uploads": { id: "report" },
  "/v1/shift-reports/{id}/uploads/{fileId}/complete": { id: "report", fileId: "reportFile" },
  "/v1/shift-reports/{id}/files/{fileId}/download": { id: "report", fileId: "reportFile" },
  "/v1/report-exports/{id}": { id: "reportExport" },
  "/v1/report-exports/{id}/download": { id: "reportExport" },
  "/v1/locations/{id}": { id: "location" },
  "/v1/locations/{id}/archive": { id: "location" },
  "/v1/locations/{id}/supervisors": { id: "location" },
  "/v1/locations/{id}/shift-types": { id: "location" },
  "/v1/shift-types/{id}": { id: "shiftType" },
  "/v1/shift-types/{id}/targets": { id: "shiftType" },
  "/v1/roster/office-limits/{userId}": { userId: "member" },
  "/v1/members/{userId}/deactivate": { userId: "lifecycleMember" }, // its own throwaway member per fixture: the control run really deactivates them
  "/v1/members/{userId}/reactivate": { userId: "lifecycleMember" },
  "/v1/members/{userId}/qualifications": { userId: "member" },
  "/v1/members/{userId}/home-location": { userId: "member" },
  "/v1/roster/weeks/{id}": { id: "rosterWeek" },
  "/v1/roster/weeks/{id}/check": { id: "rosterWeek" },
  "/v1/roster/weeks/{id}/shifts": { id: "rosterWeek" },
  "/v1/roster/weeks/{id}/publish": { id: "rosterWeek" },
  "/v1/roster/weeks/{id}/history": { id: "rosterWeek" },
  "/v1/roster/shifts/{id}/confirm": { id: "rosterShift" },
  "/v1/roster/shifts/{id}/change-requests": { id: "rosterShift" },
  "/v1/roster/change-requests/{id}/decide": { id: "changeRequest" },
  "/v1/roster/shifts/{id}/claim": { id: "rosterShift" },
  "/v1/roster/shifts/{id}/swap": { id: "rosterShift" },
  "/v1/roster/exchanges/{id}/recommend": { id: "exchange" },
  "/v1/roster/exchanges/{id}/decide": { id: "exchange" },
  "/v1/roster/exchanges/{id}/cancel": { id: "exchange" },
  "/v1/locations/{id}/history": { id: "location" },
  "/v1/roster/shifts/{id}": { id: "rosterShift" },
  "/v1/leave/{id}/cancel": { id: "leave" },
  "/v1/leave/{id}/decide": { id: "leave" },
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
let leaveSeq = 0

const DAY_MS = 86_400_000
/** A date that is always comfortably in the future of the REAL clock (the walker runs on it): the control DELETE of an assignment is only allowed while it has not started (409 assignment_started). */
export const fixtureFutureFrom = (): string => new Date(Date.now() + 400 * DAY_MS).toISOString().slice(0, 10)
/** The end date the PATCH control sends: after `fixtureFutureFrom` whatever today is. */
export const fixtureFutureUntil = (): string => new Date(Date.now() + 430 * DAY_MS).toISOString().slice(0, 10)
/** A day that is always in the past of the real clock (a shift that has started, so a report can be opened for it). */
const fixturePastDay = (): string => new Date(Date.now() - 3 * DAY_MS).toISOString().slice(0, 10)

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
  // T5.1: a shift pattern of the team and a FUTURE assignment of the staff member (so the control DELETE is allowed), through the real API as its owner
  const patRes = await call(t.app, "POST", "/v1/shifts/patterns", { cookie: owner.cookie, tenant: tenant.slug, body: { name: `Pattern ${uniq}`, teamId: team.id, start: "22:00", end: "06:00", days: [1, 2, 3] } })
  if (patRes.status !== 201) throw new Error(`fixture pattern failed: ${patRes.status} ${await patRes.text()}`)
  const pattern = (await patRes.json()) as { id: string }
  const asgRes = await call(t.app, "POST", "/v1/shifts/assignments", { cookie: owner.cookie, tenant: tenant.slug, body: { userId: staff.userId, patternId: pattern.id, from: fixtureFutureFrom() } })
  if (asgRes.status !== 201) throw new Error(`fixture assignment failed: ${asgRes.status} ${await asgRes.text()}`)
  const assignment = (await asgRes.json()) as { id: string }
  // T5.2: a report of the OWNER (opened through the real API on a shift that has started on the real clock: an all-day pattern assigned from long ago, reporting on for the team) and one attachment intent of it
  const rpatRes = await call(t.app, "POST", "/v1/shifts/patterns", { cookie: owner.cookie, tenant: tenant.slug, body: { name: `Report pattern ${uniq}`, teamId: team.id, start: "07:00", end: "15:00", days: [0, 1, 2, 3, 4, 5, 6] } })
  if (rpatRes.status !== 201) throw new Error(`fixture report pattern failed: ${rpatRes.status} ${await rpatRes.text()}`)
  const rpat = (await rpatRes.json()) as { id: string }
  for (const [path, method, body] of [
    ["/v1/shifts/assignments", "POST", { userId: owner.userId, patternId: rpat.id, from: "2020-01-01" }],
    [`/v1/shifts/reporting/teams/${team.id}`, "PUT", { on: true }],
  ] as [string, string, unknown][]) {
    const r = await call(t.app, method, path, { cookie: owner.cookie, tenant: tenant.slug, body })
    if (r.status !== 201 && r.status !== 200) throw new Error(`fixture report setup ${path} failed: ${r.status} ${await r.text()}`)
  }
  const repRes = await call(t.app, "POST", "/v1/shift-reports/open", { cookie: owner.cookie, tenant: tenant.slug, body: { patternId: rpat.id, date: fixturePastDay() } })
  if (repRes.status !== 201) throw new Error(`fixture report failed: ${repRes.status} ${await repRes.text()}`)
  const report = (await repRes.json()) as { id: string }
  const rfRes = await call(t.app, "POST", `/v1/shift-reports/${report.id}/uploads`, { cookie: owner.cookie, tenant: tenant.slug, body: { name: `Shot ${uniq}.pdf`, mime: "application/pdf", sizeBytes: 1000 } })
  if (rfRes.status !== 201) throw new Error(`fixture report file failed: ${rfRes.status} ${await rfRes.text()}`)
  const reportFile = (await rfRes.json()) as { fileId: string }
  // T5.5: an export of that report requested by the OWNER (queued: the walker's fake queue never runs the job)
  const exRes = await call(t.app, "POST", "/v1/report-exports", { cookie: owner.cookie, tenant: tenant.slug, body: { format: "csv", reportId: report.id } })
  if (exRes.status !== 202) throw new Error(`fixture report export failed: ${exRes.status} ${await exRes.text()}`)
  const reportExport = (await exRes.json()) as { id: string }
  await ownerTenantQuery(tenant.id, "update report_exports set status = 'failed', error_code = 'fixture' where id = $1", [reportExport.id]) // not "active": the control loop makes many fixtures for one owner (3 active exports at most, export_limit)
  // T6.3: one more (non-current) session of the OWNER, inserted directly (no token the walker could replay): the walker acts as A's owner, so B's owner's id must 404
  const [sess] = await ownerQuery("insert into session (id, expires_at, token, user_id, user_agent, last_seen_at, mfa_passed, created_at, updated_at) values ($1, now() + interval '30 days', $2, $3, 'Fixture browser', now(), false, now(), now()) returning id", [`sess_${uniq}`, `fixture-token-${uniq}-${crypto.randomUUID()}`, owner.userId])
  // T6.5: a pending invite of the tenant, through the real API as its owner (the address is unique per fixture; nothing reads the mail)
  const inviteRes = await call(t.app, "POST", "/v1/invites", { cookie: owner.cookie, tenant: tenant.slug, body: { email: `invitee-${uniq}-${crypto.randomUUID().slice(0, 8)}@example.com`, roleId: await roleIdOf(t.deps, tenant.id, "employee") } })
  if (inviteRes.status !== 201) throw new Error(`fixture invite failed: ${inviteRes.status} ${await inviteRes.text()}`)
  const invite = (await inviteRes.json()) as { id: string; email: string }
  // B8 T5: a location of the tenant and one of its shift types, through the real API as its owner
  const locRes = await call(t.app, "POST", "/v1/locations", { cookie: owner.cookie, tenant: tenant.slug, body: { name: `Location ${uniq}`, address: `Address ${uniq}` } })
  if (locRes.status !== 201) throw new Error(`fixture location failed: ${locRes.status} ${await locRes.text()}`)
  const location = (await locRes.json()) as { id: string }
  const stRes = await call(t.app, "POST", `/v1/locations/${location.id}/shift-types`, { cookie: owner.cookie, tenant: tenant.slug, body: { name: `Shift type ${uniq}`, start: "07:00", end: "15:00", role: `Role ${uniq}` } })
  if (stRes.status !== 201) throw new Error(`fixture shift type failed: ${stRes.status} ${await stRes.text()}`)
  const shiftType = (await stRes.json()) as { id: string }
  // B8 T8/T9: a draft roster week of that location and an open shift on it (the fixture inserts the week as the owner role would via the API; the shift goes through the real add route)
  const [rosterWeek] = await ownerTenantQuery(tenant.id, "insert into roster_weeks (tenant_id, location_id, week_start, created_at, updated_at) values ($1, $2, '2026-11-02', now(), now()) returning id", [tenant.id, location.id])
  const shiftRes = await call(t.app, "POST", `/v1/roster/weeks/${rosterWeek.id}/shifts`, { cookie: owner.cookie, tenant: tenant.slug, body: { shifts: [{ date: "2026-11-02", userIds: [null], shiftTypeId: shiftType.id }] } })
  if (shiftRes.status !== 201) throw new Error(`fixture roster shift failed: ${shiftRes.status} ${await shiftRes.text()}`)
  const rosterShift = ((await shiftRes.json()) as { shifts: { id: string }[] }).shifts[0]
  // B8 T11: a PUBLISHED week of that location with one open shift and the OWNER'S own change request on it (control: decide 403 self_decision, nobody decides their own)
  const [pubWeek] = await ownerTenantQuery(tenant.id, "insert into roster_weeks (tenant_id, location_id, week_start, created_at, updated_at) values ($1, $2, '2026-11-09', now(), now()) returning id, version", [tenant.id, location.id])
  const pubShiftRes = await call(t.app, "POST", `/v1/roster/weeks/${pubWeek.id}/shifts`, { cookie: owner.cookie, tenant: tenant.slug, body: { shifts: [{ date: "2026-11-09", userIds: [null], shiftTypeId: shiftType.id }] } })
  if (pubShiftRes.status !== 201) throw new Error(`fixture published-week shift failed: ${pubShiftRes.status} ${await pubShiftRes.text()}`)
  const pubShift = ((await pubShiftRes.json()) as { shifts: { id: string }[] }).shifts[0]
  const [pubVersion] = await ownerTenantQuery(tenant.id, "select version from roster_weeks where id = $1", [pubWeek.id])
  const pubRes = await call(t.app, "POST", `/v1/roster/weeks/${pubWeek.id}/publish`, { cookie: owner.cookie, tenant: tenant.slug, body: { version: pubVersion.version } })
  if (pubRes.status !== 200) throw new Error(`fixture publish failed: ${pubRes.status} ${await pubRes.text()}`)
  const crRes = await call(t.app, "POST", `/v1/roster/shifts/${pubShift.id}/change-requests`, { cookie: owner.cookie, tenant: tenant.slug, body: { patch: { start: "09:00" }, reason: `Change ${uniq}` } })
  if (crRes.status !== 201) throw new Error(`fixture change request failed: ${crRes.status} ${await crRes.text()}`)
  const changeRequest = (await crRes.json()) as { id: string }
  // B8 T12: a PUBLISHED, upcoming week with one open shift and the OWNER'S own claim on it (control: decide and recommend 403 self_decision, cancel 200)
  const [claimWeek] = await ownerTenantQuery(tenant.id, "insert into roster_weeks (tenant_id, location_id, week_start, created_at, updated_at) values ($1, $2, '2026-11-23', now(), now()) returning id", [tenant.id, location.id])
  const claimShiftRes = await call(t.app, "POST", `/v1/roster/weeks/${claimWeek.id}/shifts`, { cookie: owner.cookie, tenant: tenant.slug, body: { shifts: [{ date: "2026-11-23", userIds: [null], shiftTypeId: shiftType.id }] } })
  if (claimShiftRes.status !== 201) throw new Error(`fixture claim shift failed: ${claimShiftRes.status} ${await claimShiftRes.text()}`)
  const claimShift = ((await claimShiftRes.json()) as { shifts: { id: string }[] }).shifts[0]
  const [claimVersion] = await ownerTenantQuery(tenant.id, "select version from roster_weeks where id = $1", [claimWeek.id])
  const claimPub = await call(t.app, "POST", `/v1/roster/weeks/${claimWeek.id}/publish`, { cookie: owner.cookie, tenant: tenant.slug, body: { version: claimVersion.version } })
  if (claimPub.status !== 200) throw new Error(`fixture claim publish failed: ${claimPub.status} ${await claimPub.text()}`)
  const claimRes = await call(t.app, "POST", `/v1/roster/shifts/${claimShift.id}/claim`, { cookie: owner.cookie, tenant: tenant.slug })
  if (claimRes.status !== 201) throw new Error(`fixture claim failed: ${claimRes.status} ${await claimRes.text()}`)
  const exchange = (await claimRes.json()) as { id: string }
  const lifecycle = await makeMember(t.deps, tenant.id, "employee")
  // B8 T7: the OWNER'S own leave request (control: cancel 200, decide 403 self_decision: nobody decides their own)
  const leaveDay = new Date(Date.UTC(2030, 0, 1) + leaveSeq++ * 7 * DAY_MS).toISOString().slice(0, 10) // a fresh week per fixture: the owner may not hold overlapping leave
  const leaveRes = await call(t.app, "POST", "/v1/leave", { cookie: owner.cookie, tenant: tenant.slug, body: { from: leaveDay, to: leaveDay, kind: "annual", note: `Leave ${uniq}` } })
  if (leaveRes.status !== 201) throw new Error(`fixture leave failed: ${leaveRes.status} ${await leaveRes.text()}`)
  const leave = (await leaveRes.json()) as { id: string }
  const resources = { rosterWeek: String(rosterWeek.id), rosterShift: rosterShift.id, changeRequest: changeRequest.id, exchange: exchange.id, leave: leave.id, lifecycleMember: lifecycle.userId, location: location.id, shiftType: shiftType.id, invite: invite.id, session: String(sess.id), pattern: pattern.id, assignment: assignment.id, report: report.id, reportFile: reportFile.fileId, reportExport: reportExport.id, evidence: evItem.id!, template: template.id, project: project.id, milestone: milestone.id, checklistItem: item.id!, comment: comment.id!, taskFile: taskFile.fileId!, task: task.id, apiKey: apiKey.id, webhook: hook.id, supportGrant: String(sg.id), dataRequest: dsr.id, integration: String(integ.id), file: file.fileId, role: await roleIdOf(t.deps, tenant.id, "employee"), member: staff.userId, team: team.id, device: device.id, notification: String(notif.id), pushToken: ((await tokRes.json()) as { id: string }).id }
  const fixtures: TenantFixtures = {}
  for (const [path, params] of Object.entries(ROUTE_PARAMS)) {
    fixtures[path] = {}
    for (const [param, res] of Object.entries(params)) {
      fixtures[path][param] = res === "feature" ? { kind: "static", value: "drive" } : { kind: "id", value: resources[res] }
    }
  }
  return { fixtures, resources, marks: [String(rosterWeek.id), rosterShift.id, String(pubWeek.id), pubShift.id, changeRequest.id, `Change ${uniq}`, String(claimWeek.id), claimShift.id, exchange.id, leave.id, `Leave ${uniq}`, lifecycle.userId, lifecycle.email, location.id, shiftType.id, `Location ${uniq}`, `Address ${uniq}`, `Shift type ${uniq}`, `Role ${uniq}`, tenant.id, tenant.slug, String(integ.id), `drive-${uniq}@example.com`, team.id, device.id, file.fileId, dsr.id, `Fix ${uniq}`, `Support ${uniq}`, String(sg.id), `File ${uniq}.pdf`, staff.userId, owner.userId, `Team ${uniq}`, `Device ${uniq}`, apiKey.id, apiKey.prefix, `Key ${uniq}`, hook.id, `hooks-${uniq}.example.com`, task.id, `Task ${uniq}`, `Desc ${uniq}`, item.id!, comment.id!, taskFile.fileId!, `Item ${uniq}`, `Comment ${uniq}`, `Attach ${uniq}.pdf`, project.id, milestone.id, template.id, `Template ${uniq}`, `Blueprint ${uniq}`, `Steps ${uniq}`, evItem.id!, evFile.fileId!, `Evid ${uniq}.pdf`, `Project ${uniq}`, `Plan ${uniq}`, pattern.id, assignment.id, `Pattern ${uniq}`, rpat.id, `Report pattern ${uniq}`, report.id, reportFile.fileId, reportExport.id, `Shot ${uniq}.pdf`, `Milestone ${uniq}`, String(sess.id), invite.id, invite.email] }
}

// ---- B7 Task 14: the route inventory ----
import { ROUTE_CLASSIFICATION, type Classification } from "./route-classification"

export type InventoryEntry = { method: string; path: string; key: string; source: "openapi" | "registered"; classification?: Classification; reason?: string }
const OPENAPI_METHODS = ["get", "put", "post", "delete", "patch"]

/**
 * Every route the app serves, never hand-listed: the OpenAPI operations plus the registered routes that are NOT in the document
 * (health, Better Auth, the provider webhook, the test probes, and method-ALL mounts: an ALL route is never skipped, it must be classified too). `classification` comes from route-classification.ts and is
 * `undefined` for a route nobody classified, which route-inventory.test.ts turns into a failure by name.
 * (`method` is upper case.)
 */
export function routeInventory(app: AppType): InventoryEntry[] {
  const doc = app.getOpenAPI31Document({ openapi: "3.1.0", info: { title: "t", version: "1" } })
  const seen = new Set<string>()
  const out: InventoryEntry[] = []
  const add = (method: string, path: string, source: InventoryEntry["source"]) => {
    const key = `${method} ${path}`
    if (seen.has(key)) return
    seen.add(key)
    const hit = ROUTE_CLASSIFICATION[key]
    out.push({ method, path, key, source, classification: hit?.[0], reason: hit?.[1] })
  }
  for (const [path, item] of Object.entries(doc.paths ?? {})) for (const m of OPENAPI_METHODS) if ((item as Record<string, unknown>)[m]) add(m.toUpperCase(), path, "openapi")
  for (const r of app.routes) add(r.method, r.path.replace(/:(\w+)/g, "{$1}"), "registered")
  return out.sort((x, y) => x.key.localeCompare(y.key))
}
